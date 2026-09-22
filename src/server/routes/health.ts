/**
 * `GET /api/health` — câu trả lời cho load balancer, không phải cho con người.
 *
 * Nó phải thoả ba điều, và điều thứ ba là điều người ta thường bỏ:
 *
 *  1. **Gọi được khi chưa đăng nhập.** Load balancer không có phiên, và một
 *     health check trả 401 nghĩa là mọi instance bị coi là chết.
 *  2. **Rẻ.** Nó bị gọi vài lần mỗi giây, mãi mãi. Mọi thứ đắt đặt vào đây là
 *     một khoản thuế thu liên tục.
 *  3. **KHÔNG nói gì thêm.** Đây là điểm duy nhất người lạ chạm được trước khi
 *     đăng nhập, nên nó không được kể phiên bản, không kể tên máy, không kể có
 *     kết nối được DB hay không. Những thứ ấy hữu ích cho người vận hành và
 *     cũng hữu ích y như thế cho người đang dò tìm.
 *
 * Người vận hành cần chi tiết thì dùng `?deep=1` — và đường đó đòi vai `admin`.
 */
import { json, serverMode } from '../http.js';
import { allows } from '../auth/roles.js';
import type { RouteTable } from './types.js';

/** Lúc tiến trình này bắt đầu. Dùng để nói nó vừa khởi động lại hay đã chạy lâu. */
const STARTED_AT = Date.now();

export const healthRoutes: RouteTable = {
  'GET /api/health': async (_req, res, url, ctx) => {
    const deep = url.searchParams.get('deep') === '1';

    // Bản nông: đúng một chữ. Đủ cho load balancer quyết định tiếp nhận lưu
    // lượng hay không, và không đủ cho ai đó lập bản đồ hệ thống.
    if (!deep) return json(res, 200, { ok: true });

    // Bản sâu đòi `admin`. Kiểm ở đây chứ không ở `policy.ts`, vì cùng một
    // route có hai mức: nếu bắt cả route phải là `admin` thì load balancer
    // không gọi được; nếu để cả route công khai thì bản sâu lộ ra ngoài.
    if (!allows(ctx.identity.role, 'admin')) {
      return json(res, 403, { error: 'Chi tiết health cần vai "admin".' });
    }

    return json(res, 200, {
      ok: true,
      mode: serverMode(),
      uptimeSeconds: Math.round((Date.now() - STARTED_AT) / 1000),
      node: process.version,
      pid: process.pid,
    });
  },
};
