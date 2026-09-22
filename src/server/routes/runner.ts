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
import type { JobResult } from '../../protocol/messages.js';
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
    return json(res, 200, { state: closed?.state });
  },
};
