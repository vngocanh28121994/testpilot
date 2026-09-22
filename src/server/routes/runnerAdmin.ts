/**
 * "Thêm máy của tôi": người dùng tự đăng ký laptop của họ làm runner.
 *
 * Đây là chỗ P4 khác P3 về bản chất. Ở P3, người quản trị cắm máy vào phòng
 * lab và cả tổ chức dùng chung. Ở P4, một người cắm điện thoại vào laptop của
 * CHÍNH HỌ — nên ba câu hỏi mới xuất hiện, và ba câu ấy định hình cả file này:
 *
 *  1. **Token của ai?** Riêng từng máy, hiện một lần, server chỉ giữ hash.
 *     Mất thì đổi cái mới; không có đường đọc lại.
 *  2. **Ai được quản?** Chủ máy quản máy mình; `admin` quản mọi máy. Một
 *     `runner_user` khác KHÔNG được thu hồi token máy người ta — vai giống
 *     nhau không có nghĩa là quyền giống nhau, đúng như với lease ở P3.7.
 *  3. **Máy riêng hay máy chung?** `personal` mặc định là `private`: laptop
 *     của một người không nên nhận job của cả đội chỉ vì nó vừa online.
 */
import { json, readJson } from '../http.js';
import { allows } from '../auth/roles.js';
import type { RunnerRecord } from '../runners/registry.js';
import type { RouteContext, RouteTable } from './types.js';

/** Bản gửi ra ngoài: KHÔNG có hash token, và không bao giờ có. */
function view(runner: RunnerRecord) {
  return {
    id: runner.id,
    name: runner.name,
    mode: runner.mode,
    ownerUserId: runner.ownerUserId,
    visibility: runner.visibility,
    state: runner.state,
    lastSeenAt: runner.lastSeenAt,
    createdAt: runner.createdAt,
  };
}

/** Người gọi có được đụng vào runner này không. */
function mayManage(ctx: RouteContext, runner: RunnerRecord): boolean {
  if (allows(ctx.identity.role, 'admin')) return true;
  return runner.ownerUserId === ctx.identity.userId;
}

export const runnerAdminRoutes: RouteTable = {
  /**
   * Máy của tổ chức, và máy của chính người đang xem.
   *
   * Runner `private` của người khác KHÔNG hiện: nó là laptop của họ, và danh
   * sách máy cá nhân của cả công ty là một thứ không ai cần nhìn.
   */
  'GET /api/runners': async (_req, res, _url, ctx) => {
    const all = await ctx.runners.list();
    const visible = all.filter((runner) =>
      runner.visibility === 'shared'
      || runner.ownerUserId === ctx.identity.userId
      || allows(ctx.identity.role, 'admin'));
    return json(res, 200, { runners: visible.map(view) });
  },

  /**
   * Tạo runner. Token trả về ĐÚNG MỘT LẦN, trong chính phản hồi này.
   *
   * Không có route nào đọc lại được nó, và đó là chủ ý: server chỉ giữ hash,
   * nên "quên token" có đúng một cách giải quyết — đổi cái mới. Một đường đọc
   * lại nghĩa là token nằm ở dạng đọc được đâu đó, và chỗ ấy sẽ bị đọc trộm.
   */
  'POST /api/runners': async (req, res, _url, ctx) => {
    const body = await readJson<{
      name?: string; mode?: string; visibility?: string;
    }>(req);
    const name = body.name?.trim();
    if (!name) return json(res, 400, { error: 'Máy phải có tên để người ta nhận ra nó.' });

    const mode = body.mode === 'lab' || body.mode === 'farm' ? body.mode : 'personal';
    // Máy chung là tài nguyên của cả tổ chức, nên chỉ `admin` tạo được. Một
    // người tự biến laptop mình thành máy chung rồi tắt nó đi là cách làm hỏng
    // hàng đợi của cả đội mà không cố ý.
    if (mode !== 'personal' && !allows(ctx.identity.role, 'admin')) {
      return json(res, 403, { error: 'Chỉ admin tạo được máy dùng chung.' });
    }

    const visibility = body.visibility === 'shared' ? 'shared' : 'private';
    if (visibility === 'shared' && !allows(ctx.identity.role, 'admin')) {
      return json(res, 403, { error: 'Chỉ admin đặt máy ở chế độ dùng chung.' });
    }

    const { runner, token } = await ctx.runners.create({
      orgId: ctx.identity.orgId,
      name,
      mode,
      // Máy cá nhân luôn có chủ; máy chung thì không thuộc về ai cụ thể.
      ...(mode === 'personal' ? { ownerUserId: ctx.identity.userId } : {}),
      visibility,
    });

    return json(res, 200, {
      runner: view(runner),
      token,
      // Nói thẳng ra rằng đây là lần duy nhất. Giao diện có thể quên nhắc;
      // phản hồi thì không.
      note: 'Token này chỉ hiện một lần. Lưu lại ngay — server chỉ giữ hash của nó.',
    });
  },

  'POST /api/runners/rotate': async (req, res, _url, ctx) => {
    const body = await readJson<{ id?: string }>(req);
    const id = body.id?.trim();
    if (!id) return json(res, 400, { error: 'Thiếu id.' });

    const runner = await ctx.runners.find(id);
    if (!runner) return json(res, 404, { error: 'Không tìm thấy máy này.' });
    if (!mayManage(ctx, runner)) {
      return json(res, 403, { error: 'Chỉ chủ máy hoặc admin đổi được token.' });
    }

    const token = await ctx.runners.rotate(id);
    if (!token) return json(res, 404, { error: 'Không tìm thấy máy này.' });
    return json(res, 200, {
      token,
      note: 'Token cũ đã chết. Cập nhật máy ấy trước khi nó đòi job lần sau.',
    });
  },

  'POST /api/runners/revoke': async (req, res, _url, ctx) => {
    const body = await readJson<{ id?: string }>(req);
    const id = body.id?.trim();
    if (!id) return json(res, 400, { error: 'Thiếu id.' });

    const runner = await ctx.runners.find(id);
    if (!runner) return json(res, 404, { error: 'Không tìm thấy máy này.' });
    if (!mayManage(ctx, runner)) {
      return json(res, 403, { error: 'Chỉ chủ máy hoặc admin thu hồi được.' });
    }

    await ctx.runners.revoke(id);
    // Dòng runner vẫn còn: `job.runner_id` trỏ vào đây, và "job này chạy ở máy
    // nào" là câu mà một cuộc điều tra sau sự cố cần.
    return json(res, 200, { ok: true });
  },
};
