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
import { allows } from '../auth/roles.js';
import { json, readJson } from '../http.js';
import type { RouteTable } from './types.js';
import type { RouteContext } from './types.js';

/** Người đang gọi, dưới dạng một người đang nhìn danh sách máy. */
function viewer(ctx: RouteContext) {
  return {
    userId: ctx.identity.userId,
    orgId: ctx.identity.orgId,
    isAdmin: allows(ctx.identity.role, 'admin'),
  };
}

/**
 * Ai cho mượn được chiếc máy này.
 *
 * Máy KHÔNG có chủ là máy của một runner dùng chung — nó vốn đã hiện với cả
 * tổ chức, nên "cho mượn" không có nghĩa gì ở đó, và chỉ `admin` mới đụng tới.
 */
function mayShare(ctx: RouteContext, ownerUserId: string | undefined): boolean {
  if (allows(ctx.identity.role, 'admin')) return true;
  return Boolean(ownerUserId) && ownerUserId === ctx.identity.userId;
}

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
/**
 * Người giữ, dưới dạng đồng nghiệp nhận ra: "bạn", email, hoặc "một lượt chạy
 * test". Không bao giờ là mã người dùng — "đang được 597d89e8-7791-… giữ" là
 * câu thật đã hiện trên màn hình, và không ai đọc ra đó là ai.
 */
async function holderName(ctx: RouteContext, holder: LeaseHolder): Promise<string> {
  if (holder.kind === 'job') return 'một lượt chạy test';
  if (holder.userId === ctx.identity.userId) return 'bạn';
  return (await ctx.repos.people?.displayName(holder.userId).catch(() => undefined))
    ?? 'một người dùng khác';
}

/**
 * "Máy đang có người giữ", nói được ba điều: máy NÀO, AI giữ, và KHI NÀO trống.
 *
 * Không đưa giờ hết hạn: lượt giữ tự gia hạn mỗi 30 giây khi người kia còn mở
 * trang, nên "giữ tới 09:26:29" không phải lúc máy trống — nó chỉ là nhịp gia
 * hạn kế tiếp. Điều thật là: trống khi họ nhả, hoặc chừng một phút sau khi họ
 * rời trang.
 */
async function leaseTakenMessage(ctx: RouteContext, deviceId: string, lease: Lease): Promise<string> {
  const device = await ctx.devices.find(deviceId, viewer(ctx),
    await ctx.grants.forUser(ctx.identity.orgId, ctx.identity.userId)).catch(() => undefined);
  const name = device?.label ?? deviceId;
  if (lease.holder.kind === 'job') {
    return `${name} đang chạy một lượt test. Máy sẽ trống khi lượt chạy xong — xem tiến độ ở màn Thiết bị & hàng đợi.`;
  }
  // Không có nhánh "chính bạn": cùng người bấm giữ lại là GIA HẠN (xem
  // `acquire`), không bao giờ tới được đây.
  const who = await holderName(ctx, lease.holder);
  return `${name} đang được ${who} giữ. Máy sẽ trống khi người đó bấm Nhả máy, `
    + 'hoặc khoảng 1 phút sau khi họ đóng trang.';
}

function view(lease: Lease, holderLabel?: string): DeviceLeaseView {
  return {
    id: lease.id,
    deviceId: lease.deviceId,
    holder: lease.holder,
    ...(holderLabel ? { holderLabel } : {}),
    acquiredAt: lease.acquiredAt,
    expiresAt: lease.expiresAt,
    renewedAt: lease.renewedAt,
  };
}

export const deviceRoutes: RouteTable = {
  /**
   * Cho một người cụ thể mượn một chiếc máy riêng.
   *
   * Ai được cho mượn: CHỦ chiếc máy, hoặc `admin`. Cùng hình dạng phân quyền
   * với lease và với token runner — vai ở cửa, quyền sở hữu trong handler. Hai
   * người cùng vai `runner_user` không được cho mượn máy của nhau, vì vai
   * không trả lời được câu "chiếc máy này của ai".
   *
   * Và chỉ cho mượn được thứ mình ĐANG THẤY: một người không nhìn thấy chiếc
   * máy ấy thì cũng không được làm nó hiện ra cho người khác.
   */
  'POST /api/device/share': async (req, res, _url, ctx) => {
    const body = await readJson<{ udid?: string; userId?: string }>(req);
    const udid = body.udid?.trim();
    const userId = body.userId?.trim();
    if (!udid || !userId) return json(res, 400, { error: 'Cần `udid` và `userId`.' });

    const device = await ctx.devices.find(udid, viewer(ctx),
      await ctx.grants.forUser(ctx.identity.orgId, ctx.identity.userId));
    // Không thấy và không có thật trả lời giống nhau, cố ý — cùng lý do với
    // chỗ tạo job: phân biệt chúng là nói cho người lạ biết máy nào có thật.
    if (!device) return json(res, 404, { error: 'Không có máy này trong danh sách của bạn.' });

    if (!mayShare(ctx, device.ownerUserId)) {
      return json(res, 403, { error: 'Chỉ chủ máy (hoặc admin) cho người khác mượn được.' });
    }
    if (userId === device.ownerUserId) {
      return json(res, 400, { error: 'Máy đã là của người này rồi.' });
    }

    const grant = await ctx.grants.grant({
      orgId: ctx.identity.orgId, udid, userId, grantedBy: ctx.identity.userId,
    });
    return json(res, 200, { grant });
  },

  /**
   * Thu lại.
   *
   * KHÔNG đụng tới lease: nếu người mượn đang cầm máy trong tay, họ giữ tới
   * hết lượt — cắt ngang giữa một thao tác trên điện thoại thật là cách làm
   * hỏng thứ họ đang làm mà không nói gì. Hết lease thì họ không lấy lại được
   * nữa, và đó là lúc việc thu hồi có hiệu lực.
   */
  'POST /api/device/unshare': async (req, res, _url, ctx) => {
    const body = await readJson<{ udid?: string; userId?: string }>(req);
    const udid = body.udid?.trim();
    const userId = body.userId?.trim();
    if (!udid || !userId) return json(res, 400, { error: 'Cần `udid` và `userId`.' });

    const device = await ctx.devices.find(udid, viewer(ctx),
      await ctx.grants.forUser(ctx.identity.orgId, ctx.identity.userId));
    if (!device) return json(res, 404, { error: 'Không có máy này trong danh sách của bạn.' });
    if (!mayShare(ctx, device.ownerUserId)) {
      return json(res, 403, { error: 'Chỉ chủ máy (hoặc admin) thu lại được.' });
    }

    const gone = await ctx.grants.revoke(ctx.identity.orgId, udid, userId);
    return json(res, 200, { revoked: gone });
  },

  /** Ai đang được mượn máy nào — để chủ máy soát lại thứ mình đã cho mượn. */
  'GET /api/device/shares': async (_req, res, url, ctx) => {
    const udid = url.searchParams.get('udid')?.trim();
    if (!udid) return json(res, 400, { error: 'Cần `udid`.' });

    const device = await ctx.devices.find(udid, viewer(ctx),
      await ctx.grants.forUser(ctx.identity.orgId, ctx.identity.userId));
    if (!device) return json(res, 404, { error: 'Không có máy này trong danh sách của bạn.' });

    const grants = await ctx.grants.forDevice(ctx.identity.orgId, udid);
    return json(res, 200, { grants });
  },

  /** Ai đang giữ máy nào. Đọc thì vô hại, và người đang chờ máy cần thấy. */
  'GET /api/device/leases': async (_req, res, _url, ctx) => {
    const leases = await ctx.repos.leases.list();
    const body: DeviceLeasesResponse = {
      leases: await Promise.all(leases.map(async (lease) => view(lease, await holderName(ctx, lease.holder)))),
    };
    return json(res, 200, body);
  },

  'POST /api/device/lease': async (req, res, _url, ctx) => {
    const body = await readJson<{ deviceId?: string; takeOver?: boolean }>(req);
    const deviceId = body.deviceId?.trim();
    if (!deviceId) return json(res, 400, { error: 'Thiếu deviceId.' });

    /**
     * Một lần bấm Giữ máy là MỘT lượt giữ — kể cả với cùng một người.
     *
     * Kho lease coi "cùng người giữ lại" là gia hạn. Đúng cho nhịp tim, sai cho
     * lần bấm Giữ máy thứ hai: hai máy tính đăng nhập cùng tài khoản đã cùng
     * cầm MỘT lượt giữ và cùng điều khiển một chiếc iPhone — người này chạm,
     * màn hình người kia nhảy theo. Nên ở đây, cùng người mà đã có lượt giữ còn
     * sống thì TỪ CHỐI, trừ khi họ chủ động chuyển sang chỗ mới (`takeOver`) —
     * cần cho lúc lỡ đóng tab hay tải lại trang, để khỏi chờ lượt cũ hết hạn.
     */
    const current = await ctx.repos.leases.find(deviceId);
    if (current?.holder.kind === 'human' && current.holder.userId === ctx.identity.userId) {
      if (!body.takeOver) {
        const device = await ctx.devices.find(deviceId, viewer(ctx),
          await ctx.grants.forUser(ctx.identity.orgId, ctx.identity.userId)).catch(() => undefined);
        return json(res, 409, {
          error: `Bạn đang giữ ${device?.label ?? deviceId} ở một tab hoặc máy tính khác. `
            + 'Bấm "Giữ ở đây" để chuyển sang đây — màn hình ở chỗ kia sẽ dừng.',
          sameUser: true,
        });
      }
      // Chuyển chỗ: nhả lượt cũ rồi giữ lượt MỚI, khác mã. Chỗ kia nhận ra ở
      // lần kiểm lease kế tiếp (mã đổi) và dừng màn hình của nó.
      await ctx.repos.leases.release(current.id);
    }

    try {
      return json(res, 200, { lease: view(await ctx.repos.leases.acquire(deviceId, me(ctx))) });
    } catch (err) {
      // 409 chứ không phải 403: người gọi CÓ quyền, chỉ là hiện giờ máy đang
      // có người. Trả 403 ở đây sẽ khiến họ đi xin quyền cho một việc không
      // liên quan gì tới quyền.
      if (err instanceof LeaseTakenError) {
        return json(res, 409, {
          error: await leaseTakenMessage(ctx, deviceId, err.current),
          holder: err.current.holder,
          expiresAt: err.current.expiresAt,
        });
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
