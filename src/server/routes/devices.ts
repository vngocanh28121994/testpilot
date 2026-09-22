/**
 * Giữ chỗ thiết bị: lấy, gia hạn, nhả, và xem ai đang giữ gì.
 *
 * Đây là phần đầu của P3.7 (điều khiển thiết bị từ web), và nó tồn tại TRƯỚC
 * phần video vì thứ tự đó là bắt buộc: một người cầm máy qua trình duyệt phải
 * chiếm chỗ trong CÙNG bảng mà scheduler đọc, nếu không scheduler sẽ giao máy
 * cho một job trong lúc có người đang chạm vào màn hình — và job ấy không hỏng
 * theo cách nhìn thấy được, nó chỉ chạy sai.
 *
 * Hình dạng quyền ở đây MỚI so với phần còn lại của server: vai kiểm ở cửa
 * ([policy.ts](../auth/policy.ts)), còn quyền-của-người-đang-giữ kiểm trong
 * kho. Một `maintainer` có vai đủ để gọi route này, nhưng không nhả được máy
 * người khác đang giữ — vì thứ quyết định không phải vai, mà là ai đang giữ.
 * Cưỡng chế nhả là route riêng, đòi `admin`.
 */
import { LeaseTakenError, type Lease, type LeaseHolder } from '../db/repo.js';
import type { DeviceLeasesResponse, DeviceLeaseView } from '../../ui/contracts.js';
import { json, readJson } from '../http.js';
import type { RouteTable } from './types.js';
import type { RouteContext } from './types.js';

/** Người đang gọi, dưới dạng một người giữ máy. */
function me(ctx: RouteContext): LeaseHolder {
  return { kind: 'human', userId: ctx.identity.userId };
}

/**
 * Lease gửi ra ngoài không mang `orgId`.
 *
 * Nó không nói thêm gì cho người gọi — họ chỉ đọc được dữ liệu của tổ chức
 * mình — nhưng nó là một mã nội bộ, và mã nội bộ đi ra ngoài thì sớm muộn có
 * người dùng nó làm tham số.
 */
function view(lease: Lease): DeviceLeaseView {
  return {
    id: lease.id,
    deviceId: lease.deviceId,
    holder: lease.holder,
    acquiredAt: lease.acquiredAt,
    expiresAt: lease.expiresAt,
    renewedAt: lease.renewedAt,
  };
}

export const deviceRoutes: RouteTable = {
  /** Ai đang giữ máy nào. Đọc thì vô hại, và người đang chờ máy cần thấy. */
  'GET /api/device/leases': async (_req, res, _url, ctx) => {
    const leases = await ctx.repos.leases.list();
    const body: DeviceLeasesResponse = { leases: leases.map(view) };
    return json(res, 200, body);
  },

  'POST /api/device/lease': async (req, res, _url, ctx) => {
    const body = await readJson<{ deviceId?: string }>(req);
    const deviceId = body.deviceId?.trim();
    if (!deviceId) return json(res, 400, { error: 'Thiếu deviceId.' });

    try {
      return json(res, 200, { lease: view(await ctx.repos.leases.acquire(deviceId, me(ctx))) });
    } catch (err) {
      // 409 chứ không phải 403: người gọi CÓ quyền, chỉ là hiện giờ máy đang
      // có người. Trả 403 ở đây sẽ khiến họ đi xin quyền cho một việc không
      // liên quan gì tới quyền.
      if (err instanceof LeaseTakenError) {
        return json(res, 409, { error: err.message, holder: err.current.holder,
          expiresAt: err.current.expiresAt });
      }
      throw err;
    }
  },

  /**
   * Nhịp tim. Tab trình duyệt gọi mỗi 30 giây, lease sống 60 giây.
   *
   * Vì sao nhịp tim chứ không phải "nhả khi đóng tab": một cái tab bị gập
   * laptop, mất mạng, hoặc bị kill không gửi được gì cả. Thứ duy nhất chịu
   * được cả ba là im lặng thì mất quyền.
   */
  'POST /api/device/lease/renew': async (req, res, _url, ctx) => {
    const body = await readJson<{ leaseId?: string }>(req);
    const leaseId = body.leaseId?.trim();
    if (!leaseId) return json(res, 400, { error: 'Thiếu leaseId.' });

    const lease = await ctx.repos.leases.renew(leaseId, me(ctx));
    if (!lease) {
      // Nói rõ phải DỪNG, không phải thử lại: lease này đã hết hạn hoặc đã bị
      // thu hồi, và giữa lúc đó máy có thể đã sang tay người khác.
      return json(res, 409, {
        error: 'Lease không còn của bạn. Dừng dùng thiết bị và lấy lại chỗ nếu cần.',
      });
    }
    return json(res, 200, { lease: view(lease) });
  },

  'POST /api/device/lease/release': async (req, res, _url, ctx) => {
    const body = await readJson<{ leaseId?: string }>(req);
    const leaseId = body.leaseId?.trim();
    if (!leaseId) return json(res, 400, { error: 'Thiếu leaseId.' });

    const released = await ctx.repos.leases.release(leaseId, me(ctx));
    if (!released) {
      return json(res, 409, { error: 'Lease này không phải của bạn, hoặc đã hết hạn.' });
    }
    return json(res, 200, { ok: true });
  },

  /**
   * Cưỡng chế nhả — `admin`, và chỉ khi có lý do.
   *
   * Việc này lấy máy khỏi tay một người đang dùng, nên nó phải có dấu vết. Hôm
   * nay dấu vết là một dòng log kèm ai thu hồi của ai; bảng `audit_log` được
   * nối vào cùng lúc với phần video (P3.7 bước 2), vì lúc ấy mới có chỗ xem.
   */
  'POST /api/device/lease/force-release': async (req, res, _url, ctx) => {
    const body = await readJson<{ leaseId?: string; reason?: string }>(req);
    const leaseId = body.leaseId?.trim();
    const reason = body.reason?.trim();
    if (!leaseId) return json(res, 400, { error: 'Thiếu leaseId.' });
    if (!reason) {
      return json(res, 400, {
        error: 'Cần lý do: người bị lấy máy sẽ hỏi, và câu trả lời phải có sẵn.',
      });
    }

    const before = (await ctx.repos.leases.list()).find((lease) => lease.id === leaseId);
    const released = await ctx.repos.leases.release(leaseId);
    if (!released) return json(res, 404, { error: 'Không tìm thấy lease đang hiệu lực.' });

    const victim = before?.holder.kind === 'human' ? before.holder.userId
      : before?.holder.kind === 'job' ? `job ${before.holder.jobId}` : 'không rõ';
    console.warn(
      `[lease] ${ctx.identity.email || ctx.identity.userId} cưỡng chế nhả `
        + `thiết bị ${before?.deviceId ?? '?'} của ${victim}: ${reason}`,
    );
    return json(res, 200, { ok: true, deviceId: before?.deviceId, previousHolder: before?.holder });
  },
};
