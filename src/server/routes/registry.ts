/**
 * Registry qua HTTP: kéo về, đẩy lên, và duyệt.
 *
 * Trước P4.4b, cách duy nhất để sửa element là ngồi trước máy có file. Điều đó
 * ổn khi chỉ có một máy. Nó hỏng ngay khi registry chuyển vào Postgres của
 * server: người ta vẫn sửa file local của mình, và không có đường nào đưa bản
 * sửa ấy lên — họ gõ lại bằng tay trong giao diện, hoặc bỏ cuộc.
 *
 * Bốn route, và ranh giới giữa chúng là điều đáng nói: `pull` và `push` là
 * của người ĐỀ XUẤT, `proposals` là của người DUYỆT. Không route nào trong
 * nhóm này ghi thẳng vào registry — kể cả của admin. Đường ghi duy nhất đi
 * qua `review`, và nó đi qua đúng phép đối chiếu revision mà mọi đường ghi
 * khác đi qua.
 */
import { summarise } from '../proposals/store.js';
import { RevisionConflictError } from '../db/repo.js';
import type { ElementRegistry } from '../../core/types.js';
import { json, readJson } from '../http.js';
import type { RouteTable } from './types.js';

export const registryRoutes: RouteTable = {
  /**
   * Bản registry hiện tại, KÈM revision.
   *
   * Revision đi cùng dữ liệu chứ không nằm ở một route riêng: tách ra thì
   * người ta sẽ đọc hai lần và ghép nhầm hai thời điểm, mà cái sai ấy chỉ hiện
   * ra dưới tải.
   */
  'GET /api/registry': async (_req, res, _url, ctx) => {
    const { data, revision } = await ctx.repos.registry.read();
    return json(res, 200, { registry: data, revision: revision ?? null });
  },

  /**
   * Đẩy một bản đã sửa offline lên — thành ĐỀ XUẤT, không thành bản chính.
   *
   * `baseRevision` lệch thì 409 kèm phần khác biệt, và đây là điểm chính của
   * cả route. Một `push` ghi đè thì người đẩy được việc của mình, còn người
   * kia mất việc của họ mà không ai báo. Trả về diff thì người đẩy nhìn thấy
   * đúng thứ mình sắp đè lên, và tự quyết.
   */
  'POST /api/registry/push': async (req, res, _url, ctx) => {
    const body = await readJson<{
      registry?: ElementRegistry; baseRevision?: string; sourceJobId?: string;
    }>(req);
    if (!body.registry || typeof body.registry !== 'object') {
      return json(res, 400, { error: 'Thiếu `registry` trong thân yêu cầu.' });
    }

    const current = await ctx.repos.registry.read();
    if (body.baseRevision && current.revision && body.baseRevision !== current.revision) {
      const conflict = new RevisionConflictError(body.baseRevision, current.revision);
      // 409 chứ không 400: yêu cầu không sai, nó chỉ đến muộn. Và phần khác
      // biệt gửi kèm là giữa bản TRÊN SERVER và bản người ta đẩy — tức là đúng
      // những gì sẽ mất nếu ta ghi đè.
      return json(res, 409, {
        error: conflict.message,
        baseRevision: body.baseRevision,
        currentRevision: current.revision,
        diff: summarise(body.registry, current.data),
      });
    }

    const summary = summarise(current.data, body.registry);
    if (summary.added.length + summary.removed.length + summary.changed.length === 0) {
      // Không có gì đổi thì không tạo đề xuất. Hàng đợi duyệt đầy những đề
      // xuất rỗng là cách nhanh nhất khiến người duyệt thôi đọc.
      return json(res, 200, { proposal: null, summary });
    }

    const proposal = await ctx.repos.proposals.create({
      orgId: ctx.identity.orgId,
      kind: 'elements',
      key: 'default',
      ...(body.baseRevision ? { baseRevision: body.baseRevision } : {}),
      patch: body.registry,
      ...(body.sourceJobId ? { sourceJobId: body.sourceJobId } : {}),
      createdBy: ctx.identity.userId,
      summary,
    });
    return json(res, 201, { proposal, summary });
  },

  /** Hàng chờ duyệt. Mặc định chỉ `pending` — phần còn lại là lịch sử. */
  'GET /api/proposals': async (_req, res, url, ctx) => {
    const wanted = url.searchParams.get('state');
    const proposals = await ctx.repos.proposals.list(
      wanted === 'all' ? undefined : { state: ['pending'] },
    );
    return json(res, 200, { proposals });
  },

  /**
   * Duyệt hoặc từ chối.
   *
   * Duyệt thì GHI, và lúc ghi vẫn đối chiếu `baseRevision` của đề xuất. Nghe
   * như thừa — đề xuất đã qua một lần đối chiếu lúc push — nhưng giữa push và
   * duyệt có thể là ba ngày, và trong ba ngày ấy một runner đã `merge` thêm
   * mấy chục element học được. Bỏ phép đối chiếu ở đây là xoá đúng những thứ
   * ấy, bằng một cú bấm mang nhãn "đồng ý".
   */
  'POST /api/proposals/review': async (req, res, _url, ctx) => {
    const body = await readJson<{ id?: string; decision?: string }>(req);
    const id = body.id?.trim();
    const decision = body.decision;
    if (!id || (decision !== 'accept' && decision !== 'reject')) {
      return json(res, 400, { error: 'Cần `id` và `decision` là accept hoặc reject.' });
    }

    const proposal = await ctx.repos.proposals.find(id);
    if (!proposal) return json(res, 404, { error: 'Không có đề xuất này.' });
    if (proposal.state !== 'pending') {
      return json(res, 409, { error: `Đề xuất này đã ${proposal.state} rồi.` });
    }

    if (decision === 'reject') {
      const decided = await ctx.repos.proposals.decide(id, 'rejected', ctx.identity.userId);
      return json(res, 200, { proposal: decided });
    }

    try {
      const written = await ctx.repos.registry.write(
        proposal.patch as ElementRegistry,
        proposal.baseRevision,
      );
      const decided = await ctx.repos.proposals.decide(id, 'accepted', ctx.identity.userId);
      return json(res, 200, { proposal: decided, revision: written.revision });
    } catch (err) {
      if (err instanceof RevisionConflictError) {
        // Đề xuất KHÔNG bị đánh dấu gì cả: nó vẫn chờ, và người đề xuất pull
        // lại rồi push lại. Đánh dấu `superseded` ở đây thì thay đổi của họ
        // biến mất vì một lý do họ không đọc được ở đâu.
        const current = await ctx.repos.registry.read();
        return json(res, 409, {
          error: err.message,
          currentRevision: current.revision,
          diff: summarise(proposal.patch, current.data),
        });
      }
      throw err;
    }
  },
};
