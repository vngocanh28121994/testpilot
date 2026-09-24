/**
 * Đường mà RUNNER Ở MÁY KHÁC nói chuyện với control plane.
 *
 * **HTTP, không WebSocket — và đó là một quyết định, không phải sự tiện tay.**
 * FARM-PLAN P3.4 viết WebSocket. Làm tới nơi thì HTTP hợp hơn, vì đúng cái
 * yêu cầu khó nhất của bước này:
 *
 *  - "Rút mạng hai phút, không mất một dòng log nào". Với POST gom lô và đánh
 *    số `seq`, điều đó là CẤU TRÚC: runner giữ đệm tới khi server xác nhận,
 *    gửi lại thì trùng seq bị bỏ qua nhờ khoá chính `(job_id, seq)`. Với
 *    WebSocket ta phải dựng lại đúng cơ chế xác nhận ấy trên nền socket.
 *  - Nó đi qua đúng cấu hình nginx đã kiểm ở P2.6, không thêm phụ thuộc `ws`,
 *    và gỡ lỗi được bằng `curl` — thứ mà một runner đặt ở phòng máy người khác
 *    rất cần.
 *
 * Cái mất là độ trễ nhận job: một nhịp hỏi thay vì một cú đẩy. Với một phòng
 * máy thì một giây chờ không đáng kể so với vài phút chạy test.
 *
 * Bốn route, và chúng KHÔNG đi qua phiên đăng nhập: cửa là token dùng chung,
 * kiểm trong `authorize()`. Xem [auth/runnerToken.ts](../auth/runnerToken.ts).
 */
import { isCompatible, PROTOCOL_VERSION } from '../../protocol/version.js';
import { split } from '../proposals/policy.js';
import { summarise } from '../proposals/store.js';
import type { ElementRegistry } from '../../core/types.js';
import type { RouteContext } from './types.js';
import type { PrereqByPlatform } from '../../runner/prereqReport.js';
import type { JobResult } from '../../protocol/messages.js';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { json, readJson } from '../http.js';
import type { RouteTable } from './types.js';

export const runnerRoutes: RouteTable = {
  /**
   * Lời chào: hai bên đối chiếu giao thức TRƯỚC khi có job nào đi qua.
   *
   * Khác major nghĩa là một bên có trường mà bên kia lặng lẽ bỏ qua — và thứ
   * bị bỏ qua sẽ là thứ quan trọng, vì những trường tuỳ chọn thì không ai tăng
   * major vì chúng.
   */
  /**
   * Bản build của job runner này ĐANG GIỮ.
   *
   * Runner KHÔNG gửi đường dẫn nào: nó đưa mã job, máy chủ tra bản build từ
   * chính job ấy — thứ máy chủ đã tự tính lúc đặt job. Nhận một đường dẫn từ
   * runner là mở cửa cho bất cứ ai cầm được một token runner đọc file tuỳ ý
   * trên máy chủ, `.testpilot.secrets.json` trước tiên.
   *
   * Và chỉ khi đúng runner ấy đang giữ job: token của phòng máy A không lấy
   * được bản build của một job đang chạy ở phòng máy B.
   */
  'GET /api/runner/build': async (_req, res, url, ctx) => {
    const jobId = url.searchParams.get('job')?.trim();
    if (!jobId) return json(res, 400, { error: 'Thiếu job.' });
    const job = await ctx.repos.queue.find(jobId);
    const build = job?.spec.run?.appBuild;
    if (!job || job.runnerId !== ctx.identity.userId
      || (job.state !== 'assigned' && job.state !== 'running')) {
      // Một câu cho mọi trường hợp: phân biệt "job không có" với "job của
      // runner khác" là nói cho người lạ biết mã job nào có thật.
      return json(res, 404, { error: 'Không có job đang chạy nào mang mã này ở runner của bạn.' });
    }
    if (!build) return json(res, 404, { error: 'Job này không kèm bản build nào.' });

    const abs = path.resolve(build.key);
    const info = await stat(abs).catch(() => undefined);
    if (!info?.isFile()) {
      return json(res, 410, { error: `Bản build ${build.name} không còn trên máy chủ.` });
    }
    // Cỡ lệch là file đã bị thay kể từ lúc đặt job — ai đó vừa tải bản mới
    // lên. Nói ngay thay vì gửi 200 MB để runner tự phát hiện hash sai.
    if (info.size !== build.size) {
      return json(res, 409, {
        error: `Bản build ${build.name} đã được thay kể từ lúc đặt job. Chạy lại để dùng bản mới.`,
      });
    }
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': String(info.size),
      'x-build-sha256': build.sha256,
    });
    await pipeline(createReadStream(abs), res).catch(() => undefined);
    return;
  },

  'POST /api/runner/hello': async (req, res, _url, ctx) => {
    const body = await readJson<{
      name?: string; mode?: string; os?: string; arch?: string;
      protocolVersion?: string; agentVersion?: string;
      capabilities?: { platforms?: string[] };
    }>(req);

    const version = body.protocolVersion ?? '';
    if (!isCompatible(PROTOCOL_VERSION, version)) {
      return json(res, 409, {
        error: `Runner nói giao thức ${version || '(không khai)'}, server nói ${PROTOCOL_VERSION}. `
          + 'Khác số MAJOR thì không chạy chung được — cập nhật runner.',
        serverProtocolVersion: PROTOCOL_VERSION,
      });
    }

    return json(res, 200, {
      runnerId: ctx.identity.userId,
      orgId: ctx.identity.orgId,
      protocolVersion: PROTOCOL_VERSION,
      // Nói lại những gì nghe được, để runner thấy server HIỂU đúng nó. Một
      // danh sách nền tảng bị hiểu sai làm job rơi vào máy không chạy được, và
      // triệu chứng xuất hiện ở tận lúc chạy.
      heard: {
        name: body.name ?? 'unknown',
        mode: body.mode ?? 'lab',
        platforms: body.capabilities?.platforms ?? [],
      },
    });
  },

  /**
   * Đòi một job. Rỗng nghĩa là chưa có gì hợp — không phải lỗi.
   *
   * Runner khai nền tảng nó ĐO ĐƯỢC ở đây, mỗi lần hỏi, chứ không khai một
   * lần lúc chào: máy bị rút ra giữa ca làm là chuyện thường, và một danh sách
   * năng lực cũ nghĩa là job rơi vào một runner không còn chiếc máy ấy.
   */
  'POST /api/runner/claim': async (req, res, _url, ctx) => {
    const body = await readJson<{ platforms?: string[]; maxPerUser?: number }>(req);
    // Mỗi lần đòi job là một nhịp tim: runner nào còn hỏi là runner còn sống.
    // Không cần một endpoint heartbeat riêng, và một endpoint riêng thì sẽ có
    // lúc runner gửi nhịp đều mà không đòi job nữa — sống theo sổ, chết theo
    // thực tế.
    await ctx.runners.touch(ctx.identity.userId);
    const job = await ctx.repos.queue.claim({
      runnerId: ctx.identity.userId,
      ...(body.platforms ? { platforms: body.platforms } : {}),
      ...(body.maxPerUser !== undefined ? { maxPerUser: body.maxPerUser } : {}),
    });
    // 200 với `job: null` chứ không phải 204: một thân rỗng và một thân có
    // `job: null` phân biệt được ở mọi client, còn 204 thì `fetch` trả về chuỗi
    // rỗng và `JSON.parse` ném.
    return json(res, 200, { job: job ? { id: job.id, spec: job.spec } : null });
  },

  /**
   * Log của một job, gửi theo LÔ và có đánh số.
   *
   * `seq` do runner đặt và tăng đơn điệu trong phạm vi một job. Gửi lại một lô
   * đã tới nơi là chuyện BÌNH THƯỜNG — đó là cách runner xử lý mạng chập chờn
   * — nên server phải nuốt trùng lặp mà không kêu. Khoá chính `(job_id, seq)`
   * của bảng `job_event` làm đúng việc ấy.
   */
  'POST /api/runner/events': async (req, res, _url, ctx) => {
    const body = await readJson<{
      jobId?: string;
      events?: Array<{ seq?: number; line?: string }>;
    }>(req);
    const jobId = body.jobId?.trim();
    if (!jobId) return json(res, 400, { error: 'Thiếu jobId.' });

    const job = await ctx.repos.queue.find(jobId);
    if (!job) return json(res, 404, { error: 'Không tìm thấy job.' });
    // Runner khác không được ghi log vào job của runner này: log là thứ người
    // ta đọc để tin, nên nguồn của nó phải đúng.
    if (job.runnerId && job.runnerId !== ctx.identity.userId) {
      return json(res, 403, { error: 'Job này do runner khác giữ.' });
    }

    let ack = 0;
    for (const event of body.events ?? []) {
      if (typeof event.line !== 'string') continue;
      await ctx.repos.queue.appendLog(jobId, event.line, event.seq);
      if (typeof event.seq === 'number' && event.seq > ack) ack = event.seq;
    }
    // `ack` là mốc mà runner được phép QUÊN. Không trả nó thì runner phải giữ
    // đệm mãi mãi, hoặc phải đoán — và đoán sai là mất log.
    return json(res, 200, { ack });
  },

  /**
   * "Tôi không nhận job này" — và `retryable` quyết định số phận của nó.
   *
   * Hết đĩa là chuyện của RIÊNG runner ấy: job quay lại hàng đợi, máy khác
   * nhận. Thiếu Xcode thì gửi đi đâu cũng thế, nên trả nó vào hàng đợi chỉ tạo
   * một vòng lặp bận rộn — job phải đỏ lên để người dùng đi sửa.
   */
  'POST /api/runner/reject': async (req, res, _url, ctx) => {
    const body = await readJson<{ jobId?: string; reason?: string; retryable?: boolean }>(req);
    const jobId = body.jobId?.trim();
    const reason = body.reason?.trim();
    if (!jobId || !reason) return json(res, 400, { error: 'Thiếu jobId hoặc reason.' });

    const job = await ctx.repos.queue.find(jobId);
    if (!job) return json(res, 404, { error: 'Không tìm thấy job.' });
    if (job.runnerId && job.runnerId !== ctx.identity.userId) {
      return json(res, 403, { error: 'Job này do runner khác giữ.' });
    }

    if (body.retryable === false) {
      const closed = await ctx.repos.queue.finish(jobId, {
        type: 'job.result', jobId, state: 'failed', error: reason,
      });
      return json(res, 200, { state: closed?.state });
    }
    const back = await ctx.repos.queue.defer(jobId, reason, 5_000);
    return json(res, 200, { state: back?.state });
  },

  /**
   * Runner báo toàn bộ danh sách máy nó đang thấy.
   *
   * Cả danh sách chứ không phải phần đổi: một chiếc máy bị rút ra là một sự
   * VẮNG MẶT, và sự vắng mặt không có sự kiện nào để gửi.
   *
   * Quyền nhìn của máy thừa hưởng từ runner — một chiếc điện thoại cắm vào
   * laptop riêng thì cũng riêng — nên server đọc quyền ấy từ SỔ RUNNER, không
   * từ thứ runner tự khai.
   */
  'POST /api/runner/devices': async (req, res, _url, ctx) => {
    const body = await readJson<{
      devices?: Array<{ platform?: string; udid?: string; label?: string }>;
      prereq?: Record<string, { ok?: boolean; reason?: string; at?: string }>;
    }>(req);

    const runner = await ctx.runners.find(ctx.identity.userId);
    if (!runner) return json(res, 404, { error: 'Runner này không còn trong sổ.' });

    const devices = (body.devices ?? [])
      .filter((device): device is { platform: 'android' | 'ios'; udid: string; label?: string } =>
        (device.platform === 'android' || device.platform === 'ios')
        && typeof device.udid === 'string' && device.udid.length > 0)
      .map((device) => ({
        platform: device.platform,
        udid: device.udid,
        label: device.label?.trim() || device.udid,
      }));

    await ctx.devices.report({
      id: runner.id,
      orgId: runner.orgId,
      ...(runner.ownerUserId ? { ownerUserId: runner.ownerUserId } : {}),
      visibility: runner.visibility,
    }, devices);
    await ctx.runners.touch(runner.id);
    // Tình trạng môi trường đi CÙNG chuyến với danh sách máy, không có nhịp
    // riêng: hai nhịp nghĩa là hai thời điểm, và màn hình sẽ ghép "máy này
    // đang cắm" với "Appium chạy hồi nãy" thành một câu không đúng lúc nào cả.
    if (body.prereq) await ctx.runners.reportPrereq(runner.id, sanePrereq(body.prereq));

    return json(res, 200, { accepted: devices.length });
  },

  'POST /api/runner/result': async (req, res, _url, ctx) => {
    const body = await readJson<{ jobId?: string; result?: Partial<JobResult> }>(req);
    const jobId = body.jobId?.trim();
    const state = body.result?.state;
    if (!jobId || !state) return json(res, 400, { error: 'Thiếu jobId hoặc result.state.' });

    const job = await ctx.repos.queue.find(jobId);
    if (!job) return json(res, 404, { error: 'Không tìm thấy job.' });
    if (job.runnerId && job.runnerId !== ctx.identity.userId) {
      return json(res, 403, { error: 'Job này do runner khác giữ.' });
    }

    const closed = await ctx.repos.queue.finish(jobId, {
      type: 'job.result',
      jobId,
      state,
      ...(body.result?.error ? { error: body.result.error } : {}),
      ...(body.result?.scenarios ? { scenarios: body.result.scenarios } : {}),
    });

    // Phần lượt chạy học được, nếu có. Sau `finish`, cố ý: job phải đóng được
    // kể cả khi việc gộp registry hỏng — một lượt chạy đã xong mà bị treo ở
    // trạng thái `running` vì một element lạ là cái giá không đáng.
    const learned = await absorb(ctx, jobId, body.result?.registryProposal);
    return json(res, 200, { state: closed?.state, ...(learned ? { learned } : {}) });
  },
};

/**
 * Lọc báo cáo môi trường về đúng hình dạng đã khai.
 *
 * Runner tự khai phần này, nên nó là dữ liệu từ ngoài như mọi thứ khác đến qua
 * HTTP — kể cả khi nó đến kèm một token hợp lệ. Ba nền tảng, và chỉ ba.
 */
function sanePrereq(
  raw: Record<string, { ok?: boolean; reason?: string; at?: string }>,
): PrereqByPlatform {
  const clean: PrereqByPlatform = {};
  for (const platform of ['web', 'android', 'ios'] as const) {
    const report = raw[platform];
    if (!report || typeof report.ok !== 'boolean') continue;
    clean[platform] = {
      ok: report.ok,
      ...(typeof report.reason === 'string' ? { reason: report.reason.slice(0, 500) } : {}),
      at: typeof report.at === 'string' ? report.at : new Date().toISOString(),
    };
  }
  return clean;
}

/**
 * Nhận phần một lượt chạy học được: gộp thứ an toàn, treo thứ còn lại.
 *
 * Runner KHÔNG ghi vào registry — nó gửi delta và control plane quyết định.
 * Ranh giới ấy là mục 4b của tài liệu kiến trúc, và nó có một lý do rất cụ
 * thể: hai mươi máy cùng học được điều gì đó trong một buổi chiều, và nếu mỗi
 * máy ghi thẳng thì bản cuối cùng thắng còn mười chín bản kia biến mất.
 *
 * Việc chia đôi nằm ở `policy.ts`. Ở đây chỉ còn hai lời gọi kho và một câu
 * tóm tắt — vì phần đáng tranh luận là CHÍNH SÁCH, và nó phải đọc được ở một
 * chỗ mà không lẫn với đường ống.
 */
async function absorb(
  ctx: RouteContext,
  jobId: string,
  proposal: unknown,
): Promise<{ merged: number; pending: number } | undefined> {
  const delta = proposal as ElementRegistry | undefined;
  if (!delta || typeof delta !== 'object' || !delta.elements) return undefined;

  const current = await ctx.repos.registry.read();
  const parts = split(delta, current.data);

  const mergedCount = Object.keys(parts.autoMerge.elements).length;
  if (mergedCount > 0 || Object.keys(parts.autoMerge.screens ?? {}).length > 0) {
    // `merge` chứ không `write`: delta là "những thứ tôi học thêm", và gộp thì
    // không cần đối chiếu revision — nó không xoá gì của ai.
    await ctx.repos.registry.merge(parts.autoMerge);
  }

  let pending = 0;
  if (parts.needsReview) {
    pending = Object.keys(parts.needsReview.elements).length;
    // Đọc LẠI sau khi gộp, không dùng lại bản đọc ở trên. Phần vừa gộp đã nằm
    // trong registry rồi, và đề xuất dựng trên bản cũ sẽ XOÁ đúng phần ấy lúc
    // được duyệt — một lượt chạy vừa học thêm ba element, người duyệt bấm
    // đồng ý, và ba element ấy biến mất. Bài test bắt được chuyện này.
    const base = await ctx.repos.registry.read();
    const patch = withCurrent(parts.needsReview, base.data);
    await ctx.repos.proposals.create({
      orgId: ctx.identity.orgId,
      kind: 'elements',
      key: 'default',
      // Bản nền là bản ĐANG có lúc lượt chạy kết thúc. Người duyệt mở ra sau
      // đó vài ngày, và nếu trong lúc ấy registry đã đổi thì `review` phải từ
      // chối chứ không được đè — xem routes/registry.ts.
      ...(base.revision ? { baseRevision: base.revision } : {}),
      patch,
      sourceJobId: jobId,
      createdBy: ctx.identity.userId,
      summary: summarise(base.data, patch),
    });
  }
  return { merged: mergedCount, pending };
}

/**
 * Đề xuất mang CẢ registry, không chỉ phần đổi.
 *
 * Vì `review` khi duyệt gọi `registry.write()` — ghi đè toàn bộ. Gửi lên mỗi
 * phần đổi thì duyệt xong registry chỉ còn đúng mấy element ấy, và mọi thứ
 * khác biến mất. Đây đúng là kiểu hỏng mà cả P4.4 sinh ra để chặn, nên nó
 * không được phép xuất hiện ở chính đường này.
 */
function withCurrent(patch: ElementRegistry, current: ElementRegistry): ElementRegistry {
  return {
    ...current,
    screens: { ...current.screens, ...patch.screens },
    elements: { ...current.elements, ...patch.elements },
  };
}
