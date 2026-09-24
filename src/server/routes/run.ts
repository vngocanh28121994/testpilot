/**
 * Lượt chạy: bấm nút chạy, dừng, xem cái đang chạy, nối lại, đọc log cũ.
 *
 * Năm route này chia làm hai loại, và ranh giới ấy là thứ P3 sẽ dựa vào:
 *
 *  - `POST /api/run` và `/run/stop` là VIỆC CỦA RUNNER. Hôm nay chúng gọi
 *    `localRunner` trong cùng tiến trình; ở chế độ server chúng trở thành job
 *    trong hàng đợi, và runner ở máy khác nhận.
 *  - `/run/active`, `/run/attach`, `/run/log` là việc của CONTROL PLANE: đọc
 *    sổ log của lượt chạy. Ở P1.5 sổ ấy chuyển từ RAM xuống `job_event`, và
 *    ba route này là chỗ duy nhất phải sửa.
 *
 * `/run/attach` không dùng helper `stream()` chung, có lý do: nó KHÔNG khởi
 * động việc gì cả, chỉ nối vào một lượt đang chạy sẵn. Gửi POST tới nó sẽ là
 * bảo server chạy thêm một lần nữa.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { devicesOf, loadConfig } from '../../config.js';
import { localRunner } from '../../runner/index.js';
import { allows } from '../auth/roles.js';
import { activeRuns, findActiveRun } from '../../ui/activeRuns.js';
import { json, readJson, stream } from '../http.js';
import type { JobsResponse } from '../../ui/contracts.js';
import type { AppBuilds } from '../../protocol/messages.js';
import { describeBuild, type BuildLookup } from '../appBuilds.js';
import { LOCAL_HOST_RUNNER } from '../remoteRuns.js';
import type { JobQueue, JobRecord } from '../queue/queue.js';
import type { RouteTable } from './types.js';

/** Trạng thái mà job không đổi nữa. */
const CLOSED = ['succeeded', 'failed', 'cancelled', 'interrupted'];

/**
 * Chờ job đóng lại, và nói ra khi nó được nhận.
 *
 * Đăng ký nghe TRƯỚC rồi mới đọc trạng thái hiện tại, không phải ngược lại:
 * worker có thể nhận và chạy xong job trong vài mili giây, và nếu đọc trước
 * thì sự kiện "đã xong" rơi vào khoảng giữa hai lời gọi — người bấm nút sẽ
 * chờ mãi một job đã xong từ lâu.
 */
export async function waitForClose(
  queue: JobQueue,
  id: string,
  log: (line: string) => void,
): Promise<JobRecord | undefined> {
  return new Promise<JobRecord | undefined>((resolve) => {
    let off = (): void => {};
    let done = false;
    let quiet: ReturnType<typeof setTimeout>;
    const settle = (record: JobRecord | undefined): void => {
      if (done) return;
      done = true;
      clearTimeout(quiet);
      off();
      resolve(record);
    };
    // Nói "đã nhận" MỘT LẦN cho mỗi runner, không phải mỗi lần job được đòi.
    //
    // Một job đang chờ máy bận sẽ đi qua `running → queued` sau mỗi nhịp hoãn,
    // và in lại câu ấy mỗi năm giây nghĩa là sau năm phút có sáu mươi dòng
    // giống hệt nhau — người đọc không học thêm gì sau dòng đầu.
    let announced: string | undefined;
    /**
     * Sau năm giây mà chưa ai nhận thì NÓI RA.
     *
     * Một job nằm `queued` im lặng nhìn giống hệt một job bị treo, và người
     * bấm nút không có cách nào phân biệt. Câu này không đoán nguyên nhân —
     * control plane chưa có sổ năng lực runner, đó là P3.4 — nhưng nó nói
     * đúng thứ nó biết, và chỉ đúng chỗ để đi kiểm.
     */
    quiet = setTimeout(() => {
      void queue.find(id).then((record) => {
        if (done || record?.state !== 'queued' || record.error) return;
        log('[job] Chưa runner nào nhận job này. Kiểm tra máy đã cắm chưa, '
          + 'hoặc xem hàng đợi ở /api/jobs.');
      });
    }, 5_000);
    quiet.unref?.();

    void queue.onState(id, (record) => {
      if (record.state === 'running' && record.runnerId !== announced) {
        announced = record.runnerId;
        log(`[job] runner ${record.runnerId} đã nhận.`);
      }
      if (CLOSED.includes(record.state)) settle(record);
    }).then(async (unsubscribe) => {
      off = unsubscribe;
      if (done) { unsubscribe(); return; }
      const now = await queue.find(id);
      if (now && CLOSED.includes(now.state)) settle(now);
    });
  });
}

export const runRoutes: RouteTable = {
  'GET /api/run/active': async (_req, res) => json(res, 200, { runs: activeRuns() }),

  /**
   * Nối lại một lượt đang chạy: trả toàn bộ log đã có, rồi stream tiếp.
   *
   * Cùng khuôn sự kiện với lúc bấm nút chạy, nên giao diện dùng lại đúng một
   * đường xử lý thay vì có hai kiểu log.
   */
  'GET /api/run/attach': async (req, res, url) => {
    const id = url.searchParams.get('id') ?? '';
    const live = findActiveRun(id);
    if (!live) return json(res, 404, { error: 'Lượt chạy này không còn chạy nữa.' });
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const send = (event: string, data: unknown) =>
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    // `since` = dòng cuối cùng tab này ĐÃ CÓ. Một tab vừa tải lại không có gì,
    // nên nó không gửi tham số và nhận trọn lịch sử — hành vi cũ. Một tab chỉ
    // rớt kết nối vài giây thì nói ra nó đang ở đâu và nhận đúng phần thiếu,
    // thay vì vẽ lại tám nghìn dòng nó đang có sẵn.
    const since = Number(url.searchParams.get('since') ?? 0);
    const { history, dropped, lastSeq, off } = live.subscribe(
      (line) => send('log', line),
      Number.isFinite(since) && since > 0 ? since : 0,
    );
    // Nói ra chỗ đang đứng TRƯỚC khi gửi log, để tab biết lấy `since` cho lần
    // nối lại sau ngay cả khi lượt chạy kết thúc ngay sau đó.
    send('attached', { lastSeq, dropped });
    if (dropped > 0) send('dropped', dropped);
    for (const line of history) send('log', line);
    // Con chết thì đường dây này cũng phải đóng, nếu không trang treo mãi ở
    // trạng thái "đang chạy" — đúng cái bệnh đang chữa, chỉ đổi chỗ.
    const finish = () => { off(); send('done', { ok: true }); res.end(); };
    const timer = setInterval(() => { if (!findActiveRun(id)) { clearInterval(timer); finish(); } }, 1_000);
    req.on('close', () => { clearInterval(timer); off(); });
    return;
  },

  /**
   * Bấm nút chạy: TẠO JOB, rồi nối vào log của nó.
   *
   * Trước đây route này tự chạy suite trong tiến trình của server và stream về
   * đúng cái tab đã bấm. Điều đó ổn khi server và thiết bị ở cùng một máy —
   * nhưng nó làm ba thứ trở thành không thể: bấm chạy khi chưa máy nào rảnh,
   * chạy trên runner ở máy khác, và biết có bao nhiêu việc đang chờ.
   *
   * Hình dạng đường dây KHÔNG đổi: vẫn là SSE với sự kiện `log` và `done`, nên
   * giao diện không phải sửa gì. Thứ đổi là ai chạy — worker đòi job từ hàng
   * đợi, và ở chế độ embedded worker ấy tình cờ nằm trong cùng tiến trình.
   *
   * Job KHÔNG bị huỷ khi tab đóng: nó là việc đã được đặt, và `GET /api/jobs`
   * nói nó đang ở đâu. Đó là khác biệt thật so với bản cũ, nơi đóng tab là mất
   * đường dây duy nhất nhìn thấy lượt chạy.
   */
  'POST /api/run': async (req, res, _url, ctx) => {
    const body = await readJson<{
      platform: string; tag?: string; headed?: boolean;
      includeQuarantined?: boolean; devices?: string[]; env?: string;
      appSource?: 'device' | 'upload';
    }>(req);

    /**
     * Máy mình KHÔNG THẤY thì cũng không đặt job lên được.
     *
     * Kiểm ở đây, lúc TẠO, chứ không lúc chạy: một job đã vào hàng đợi là một
     * job người khác nhìn thấy trong danh sách chờ, kèm tên chiếc máy riêng
     * của người ta — và đó đã là rò rỉ, dù nó không bao giờ chạy.
     *
     * Cùng luật với `maySee` ở sổ thiết bị, gọi qua sổ chứ không chép lại:
     * hai bản chép tay của một luật quyền sẽ lệch, và bên lỏng hơn thắng.
     */
    // Tra MỘT lần cho cả vòng lặp: một job nhắm ba chiếc máy thì ba lời gọi
    // giống hệt nhau vào cùng một bảng.
    const granted = (body.devices ?? []).length > 0
      ? await ctx.grants.forUser(ctx.identity.orgId, ctx.identity.userId)
      : undefined;
    // Config đọc MỘT lần, và chỉ khi có máy được nêu tên.
    const cfgForDevices = (body.devices ?? []).length > 0
      ? await loadConfig(ctx.configFile)
      : undefined;
    /**
     * Máy nằm ở runner nào, theo từng token.
     *
     * Cần cho hai việc: tách lượt chạy theo runner (xem `groups` bên dưới), và
     * biết bản build có phải đi qua mạng không.
     */
    const runnerOf = new Map<string, string>();
    for (const token of body.devices ?? []) {
      const [tokenPlatform, ...rest] = token.split(':');
      const named = rest.join(':');
      if (!named) continue;
      // Màn hình gửi `id` TRONG CONFIG, không gửi udid — "android:sm-s918b".
      // Sổ thiết bị thì khoá theo udid, vì đó là thứ runner báo lên. Thiếu
      // phép quy đổi này, mọi lượt chạy Android đặt từ giao diện đều bị từ
      // chối bằng câu "không có trong danh sách máy của bạn", kể cả với chiếc
      // máy đang cắm ngay trước mặt. Cùng phép quy đổi mà scheduler dùng —
      // xem `udidOf` trong `scheduler/match.ts`.
      const configured = cfgForDevices && (tokenPlatform === 'android' || tokenPlatform === 'ios')
        ? devicesOf(cfgForDevices, tokenPlatform).find((device) => device.id === named)
        : undefined;
      const udid = configured?.udid ?? named;
      const seen = await ctx.devices.find(udid, {
        userId: ctx.identity.userId,
        orgId: ctx.identity.orgId,
        isAdmin: allows(ctx.identity.role, 'admin'),
      }, granted);
      // Không thấy có thể là "máy của người khác" hoặc "máy chưa báo cáo bao
      // giờ". Câu trả lời giống nhau cho cả hai, cố ý: phân biệt chúng là nói
      // cho người lạ biết máy nào có thật.
      if (!seen) {
        return json(res, 403, {
          error: `Không dùng được thiết bị "${named}": nó không có trong danh sách máy của bạn.`,
        });
      }
      runnerOf.set(token, seen.runnerId);
    }

    /**
     * MỘT JOB CHO MỖI RUNNER giữ máy.
     *
     * Một job chỉ được một runner nhận, và runner ấy đòi MỌI máy của job phải
     * cắm ở chính nó — thiếu chiếc nào là hoãn (`resolveDevices`). Nên một job
     * chứa Android ở máy chủ và iPhone ở laptop sẽ bị cả hai runner hoãn mãi
     * mãi, mỗi bên thấy một chiếc "chưa cắm": một lượt chạy treo không một
     * lời. Ô chọn máy gom theo máy tính làm cho tổ hợp ấy chọn được bằng hai cú
     * bấm, nên nó phải chạy được.
     *
     * Tách ra thì mỗi runner nhận đúng phần máy của nó, các job chạy SONG SONG
     * trên các máy tính khác nhau, và log gộp về một luồng. Máy cùng một runner
     * vẫn ở chung một job — đường song song sẵn có của runner ấy lo phần đó.
     */
    const groups = new Map<string, string[]>();
    for (const token of body.devices ?? []) {
      const key = runnerOf.get(token) ?? '';
      groups.set(key, [...(groups.get(key) ?? []), token]);
    }
    if (groups.size === 0) groups.set('', []);

    /**
     * "Bản đã tải lên" là bản trên MÁY CHỦ — gắn nó vào job, cho TỪNG nền tảng.
     *
     * Không có nó, runner ở laptop khác cài bản build nằm trên đĩa của chính
     * nó, có thể là bản cũ ba tuần, rồi báo kết quả như thể đã chạy trên bản
     * vừa tải lên. Worker nhúng trong máy chủ bỏ qua trường này — nó chung đĩa
     * với máy chủ nên bản trong config của nó là đúng bản.
     *
     * Chỉ tra khi bản build CÓ THỂ phải đi qua mạng: nhóm nằm ở runner khác,
     * hoặc không nêu máy nào (không biết runner nào sẽ nhận). Nhóm cắm ở
     * chính máy chủ thì bỏ qua hẳn — tra nghĩa là băm 200 MB, hay đóng gói cả
     * một bản `.app` của simulator, cho một lượt chạy không gửi gì đi đâu.
     *
     * Tra HẾT trước khi tạo job nào: tạo job Android rồi mới phát hiện iOS
     * không gửi được là để nửa lượt chạy trong hàng đợi và trả lỗi cho nửa kia.
     */
    const lookups = new Map<'android' | 'ios', Promise<BuildLookup>>();
    const lookup = async (platform: 'android' | 'ios'): Promise<BuildLookup> => {
      if (!lookups.has(platform)) {
        lookups.set(platform, loadConfig(ctx.configFile)
          .then((cfg) => describeBuild(cfg, body.env, platform)));
      }
      return lookups.get(platform)!;
    };
    const plans: Array<{ runnerId: string; tokens: string[]; platform: string; appBuilds: AppBuilds }> = [];
    for (const [runnerId, tokens] of groups) {
      const platforms = [...new Set(tokens.length > 0
        ? tokens.map((token) => token.split(':')[0]!)
        : [body.platform])];
      const remote = runnerId !== LOCAL_HOST_RUNNER;
      const appBuilds: AppBuilds = {};
      if (body.appSource === 'upload' && (remote || tokens.length === 0)) {
        for (const platform of platforms) {
          if (platform !== 'android' && platform !== 'ios') continue;
          const found = await lookup(platform);
          if (found.ok) appBuilds[platform] = found.build;
          // Không gửi được thì CHỈ chặn khi chắc chắn máy nằm ở runner khác.
          else if (remote && tokens.length > 0) return json(res, 400, { error: found.reason });
        }
      }
      plans.push({
        runnerId,
        tokens,
        // Nền tảng của job quyết định runner nào được mời nhận nó. Giữ nền
        // tảng người dùng chọn nếu nhóm có nó; không thì lấy của chính nhóm.
        platform: platforms.includes(body.platform) ? body.platform : platforms[0]!,
        appBuilds,
      });
    }

    const jobs: JobRecord[] = [];
    for (const plan of plans) {
      jobs.push(await ctx.repos.queue.create({
        orgId: ctx.identity.orgId,
        kind: 'run_suite',
        createdBy: ctx.identity.userId,
        spec: {
          orgId: ctx.identity.orgId,
          kind: 'run_suite',
          createdBy: ctx.identity.userId,
          // Mười lăm phút: dài hơn mọi lượt chạy đã đo, ngắn hơn một đêm. Thu
          // hồi job quá hạn là việc của P3.2.
          timeoutMs: 15 * 60_000,
          // Thiết bị tới dưới dạng `platform:id` vì một id trần không nói được
          // nó là máy nào khi cả hai nền tảng cùng có mặt.
          deviceTokens: plan.tokens,
          run: {
            platform: plan.platform,
            tag: body.tag,
            headed: Boolean(body.headed),
            includeQuarantined: Boolean(body.includeQuarantined),
            env: body.env,
            appSource: body.appSource,
            ...(Object.keys(plan.appBuilds).length > 0 ? { appBuilds: plan.appBuilds } : {}),
          },
        },
      }));
    }

    // Tên runner để gắn vào log khi có nhiều job: hai luồng log trộn vào nhau
    // mà không nói dòng nào của máy nào thì không đọc được.
    const names = new Map<string, string>();
    if (jobs.length > 1) {
      for (const plan of plans) {
        const runner = plan.runnerId ? await ctx.runners.find(plan.runnerId) : undefined;
        names.set(plan.runnerId, runner?.name ?? plan.runnerId);
      }
    }

    return stream(res, async (log) => {
      await Promise.all(jobs.map(async (job, i) => {
        const label = jobs.length > 1 ? `[${names.get(plans[i]!.runnerId)}] ` : '';
        const say = (line: string): void => log(`${label}${line}`);
        say(`[job] ${job.id} đã vào hàng đợi.`);
        const offLog = await ctx.repos.queue.onLog(job.id, say);
        try {
          const closed = await waitForClose(ctx.repos.queue, job.id, say);
          // KHÔNG ném khi job `failed`: một lượt test đỏ không phải lỗi của
          // request, và dòng log đã nói rõ. Ném ở đây sẽ biến mọi lượt có test
          // fail thành một toast lỗi chồng lên chính cái log đang nói điều đó.
          if (closed?.state === 'interrupted') say(`[job] ${closed.error ?? 'Job bị bỏ dở.'}`);
        } finally {
          offLog();
        }
      }));
    });
  },

  'POST /api/run/stop': async (_req, res) => json(res, 200, await localRunner.run.stop()),

  /**
   * Hàng đợi: cái gì đang chờ, cái gì đang chạy, cái gì vừa xong.
   *
   * Đây là câu trả lời mà bản cũ không có. Một lượt chạy chỉ tồn tại trên
   * đường dây SSE của tab đã bấm nút, nên "có gì đang chạy không" là câu hỏi
   * không ai trả lời được sau khi đóng tab.
   */
  'GET /api/jobs': async (_req, res, url, ctx) => {
    const state = url.searchParams.get('state')?.split(',').filter(Boolean);
    const jobs = await ctx.repos.queue.list({
      ...(state?.length ? { state: state as never } : {}),
      limit: Number(url.searchParams.get('limit') ?? 50),
    });
    const body: JobsResponse = {
      jobs: jobs.map((job) => ({
        id: job.id,
        kind: job.kind,
        state: job.state,
        // `spec` KHÔNG đi ra ngoài: nó mang snapshot registry và có thể mang
        // tên môi trường nội bộ. Màn hình chỉ cần biết chạy cái gì.
        platform: job.spec.run?.platform,
        tag: job.spec.run?.tag,
        devices: job.spec.deviceTokens,
        requestedAt: job.requestedAt,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        runnerId: job.runnerId,
        attempt: job.attempt,
        error: job.error,
      })),
    };
    return json(res, 200, body);
  },

  /**
   * Nội dung log của một lượt chạy, lấy riêng khi người dùng bung nó ra.
   *
   * Tách khỏi /api/state vì log là thứ dài nhất mà lại ít được xem nhất: gửi
   * kèm nghĩa là trả giá cho nó sau mỗi thao tác trên trang, cho mọi lượt chạy.
   */
  'GET /api/run/log': async (_req, res, url, ctx) => {
    const id = url.searchParams.get('id') ?? '';
    const cfg = await loadConfig(ctx.configFile);
    // Id đi thẳng vào đường dẫn file, nên phải chặn ../ trước khi chạm đĩa.
    const dir = path.resolve(cfg.paths.runs, id);
    if (!id || !dir.startsWith(path.resolve(cfg.paths.runs) + path.sep)) {
      return json(res, 400, { error: 'Run id không hợp lệ.' });
    }
    const file = path.join(dir, 'log.txt');
    if (!existsSync(file)) return json(res, 404, { error: 'Lượt chạy này không có log.' });
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(await readFile(file, 'utf8'));
    return;
  },
};
