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
import { loadConfig } from '../../config.js';
import { localRunner } from '../../runner/index.js';
import type { PickedDevice } from '../../runner/execute.js';
import { activeRuns, findActiveRun } from '../../ui/activeRuns.js';
import { json, readJson, stream } from '../http.js';
import type { RouteTable } from './types.js';

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
    const { history, dropped, off } = live.subscribe((line) => send('log', line));
    if (dropped > 0) send('dropped', dropped);
    for (const line of history) send('log', line);
    // Con chết thì đường dây này cũng phải đóng, nếu không trang treo mãi ở
    // trạng thái "đang chạy" — đúng cái bệnh đang chữa, chỉ đổi chỗ.
    const finish = () => { off(); send('done', { ok: true }); res.end(); };
    const timer = setInterval(() => { if (!findActiveRun(id)) { clearInterval(timer); finish(); } }, 1_000);
    req.on('close', () => { clearInterval(timer); off(); });
    return;
  },

  'POST /api/run': async (req, res, _url, ctx) => {
    const body = await readJson<{
      platform: string; tag?: string; headed?: boolean;
      includeQuarantined?: boolean; devices?: string[]; env?: string;
      appSource?: 'device' | 'upload';
    }>(req);
    // Ticked devices arrive qualified as `platform:id`, because an id alone
    // cannot say which phone it means once both platforms are on offer.
    const picked = (body.devices ?? []).map(localRunner.run.parseDeviceToken).filter(Boolean) as PickedDevice[];

    // One device is the single-device path, unchanged — not a parallel run of
    // size one, which would suffix its directory and defer its writes for no
    // reason. Only a genuine second device changes how this runs.
    if (picked.length > 1) {
      // The platforms to run are the ones actually ticked, not whatever the
      // Platform select happens to show: the select is only the default for
      // when nothing is ticked at all.
      const platforms = [...new Set(picked.map((d) => d.platform))].join(',');
      const tokens = picked.map((d) => `${d.platform}:${d.id}`);
      return stream(res, (log) =>
        localRunner.run.startParallel(
          platforms, tokens, body.tag, Boolean(body.includeQuarantined), log, body.env, body.appSource,
        ));
    }

    const one = picked[0];
    // A platform with no `devices` list has a single synthesised entry whose
    // id is the platform's own name. Passing `--device` for it would suffix
    // the run directory and gain nothing, so the plain path is used instead.
    const named = one ? await localRunner.run.isNamedDevice(one, ctx.configFile) : false;
    return stream(res, async (log) => {
      await localRunner.run.startSuite(
        one?.platform ?? body.platform,
        body.tag,
        Boolean(body.headed),
        Boolean(body.includeQuarantined),
        log,
        named ? one!.id : undefined,
        body.env,
        undefined,
        undefined,
        body.appSource,
      );
    });
  },

  'POST /api/run/stop': async (_req, res) => json(res, 200, await localRunner.run.stop()),

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
