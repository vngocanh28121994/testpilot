/**
 * Vai tối thiểu để gọi từng route. Mỗi route phải có mặt ở đây.
 *
 * **Lệch có chủ ý so với FARM-PLAN P2.2.** Kế hoạch viết "khai báo quyền ngay
 * cạnh định nghĩa route, không nằm ở file rời", và lý do khi ấy là chống trôi.
 * Làm tới nơi thì một bảng tập trung tốt hơn, vì hai điều:
 *
 *  1. Quyền là thứ người ta đọc để RÀ SOÁT, không phải để sửa hằng ngày. Một
 *     người kiểm tra "ai gọi được gì" cần một trang đọc hết trong ba phút, chứ
 *     không phải mở mười bốn file và tự ghép lại trong đầu.
 *  2. Nguy cơ trôi được chặn bằng test chứ không bằng vị trí: `policyGuard`
 *     đỏ khi có route thiếu khai báo, VÀ khi có khai báo thừa cho một route
 *     không còn tồn tại.
 *
 * Nguyên tắc khi thêm dòng: chọn vai THẤP NHẤT mà việc đó vẫn an toàn, và nếu
 * phải phân vân giữa hai vai thì chọn vai cao hơn — nới ra sau là một dòng
 * code, thu lại sau là một cuộc trò chuyện khó với người đang quen dùng.
 */
import type { Role } from './roles.js';

/**
 * Route gọi được khi CHƯA có phiên. Đúng bốn cái, và không thêm nữa.
 *
 * Mỗi route ở đây là một phần bề mặt mà người lạ chạm được, nên danh sách này
 * phải ngắn tới mức đọc hết trong một giây: hai cái để đăng nhập, một cái để
 * đăng xuất, một cái để giao diện biết nên vẽ màn đăng nhập hay vẽ ứng dụng.
 */
export const PUBLIC_ROUTES: ReadonlySet<string> = new Set([
  // Load balancer không có phiên. Một health check trả 401 nghĩa là mọi
  // instance bị coi là chết, và hệ thống tự gỡ chính nó khỏi mạng.
  'GET /api/health',
  'GET /api/auth/login',
  'GET /api/auth/callback',
  'POST /api/auth/logout',
  'GET /api/auth/me',
]);

export const ROUTE_POLICY: Record<string, Role> = {
  /* ── Công khai: xem PUBLIC_ROUTES ở trên ─────────────────────────────── */
  // Bản nông trả đúng một chữ `ok`; bản `?deep=1` tự kiểm vai `admin` bên
  // trong handler, vì một route không thể vừa công khai vừa đòi admin.
  'GET /api/health': 'viewer',
  'GET /api/auth/login': 'viewer',
  'GET /api/auth/callback': 'viewer',
  'POST /api/auth/logout': 'viewer',
  'GET /api/auth/me': 'viewer',

  /* ── Đọc: ai trong tổ chức cũng xem được ─────────────────────────────── */
  'GET /api/state': 'viewer',
  'GET /api/history': 'viewer',
  'GET /api/healing': 'viewer',
  'GET /api/vocabulary': 'viewer',
  'GET /api/actions': 'viewer',
  'GET /api/builds': 'viewer',
  'GET /api/models': 'viewer',
  'GET /api/run/active': 'viewer',
  'GET /api/run/attach': 'viewer',
  'GET /api/run/log': 'viewer',
  'GET /api/workflow/questions': 'viewer',
  'GET /api/aws': 'viewer',
  'GET /api/farm/projects': 'viewer',
  'GET /api/farm/pools': 'viewer',
  'GET /api/farm/devices': 'viewer',
  // Trạng thái máy và driver: đọc thì vô hại, và người sắp chạy test cần thấy
  // nó TRƯỚC khi họ có quyền chạy — nếu không thì lời khuyên "máy chưa sẵn
  // sàng" chỉ đến sau khi đã bấm.
  'GET /api/preflight': 'viewer',
  'GET /api/prereq/adb': 'viewer',
  'GET /api/prereq/xcode': 'viewer',
  'GET /api/prereq/appium/status': 'viewer',
  'GET /api/prereq/ios-devices': 'viewer',
  'GET /api/prereq/ios-names': 'viewer',
  // Chỉ trả boolean "đã cấu hình chưa", không trả giá trị. Xem `config.ts`.
  'GET /api/confluence-auth': 'viewer',

  /* ── Chạy test: tiêu tiền, nhưng không đổi thứ người khác dựa vào ────── */
  'POST /api/run': 'runner_user',
  'POST /api/run/stop': 'runner_user',
  'POST /api/gen': 'runner_user',
  'POST /api/studio/save': 'runner_user',
  'POST /api/workflow/answers': 'runner_user',
  'POST /api/workflow/complete': 'runner_user',
  'POST /api/workflow/abandon': 'runner_user',
  'POST /api/farm/run': 'runner_user',
  'POST /api/farm/pull': 'runner_user',
  'POST /api/feature/normalize': 'runner_user',
  'POST /api/mcp/tools': 'runner_user',
  // Dựng môi trường trên máy runner. Ở chế độ server những route này chỉ chủ
  // runner gọi được — kiểm tra ấy nằm ở tầng thiết bị (P4.2), không ở đây.
  'POST /api/prereq/appium': 'runner_user',
  'POST /api/prereq/appium/restart': 'runner_user',
  'POST /api/prereq/driver': 'runner_user',
  'POST /api/prereq/ios-trust': 'runner_user',
  'POST /api/prereq/ios-tunnel': 'runner_user',
  // Tải build lên và chọn nguồn app: ảnh hưởng tới lượt chạy của người khác
  // trong cùng môi trường, nhưng nó là việc thường ngày của người chạy test.
  'POST /api/app/upload': 'runner_user',
  'POST /api/builds/source': 'runner_user',

  /* ── Sửa dữ liệu dùng chung ──────────────────────────────────────────── */
  'PUT /api/feature': 'maintainer',
  'POST /api/feature/review': 'maintainer',
  'POST /api/feature/review-bulk': 'maintainer',
  'POST /api/feature/known-issue': 'maintainer',
  'POST /api/actions/review': 'maintainer',
  'POST /api/healing/review': 'maintainer',
  'POST /api/healing/duplicate': 'maintainer',

  /* ── Quản trị ────────────────────────────────────────────────────────── */
  'PUT /api/config': 'admin',
  'POST /api/model-key': 'admin',
  'POST /api/confluence-auth': 'admin',
  'POST /api/farm/pool': 'admin',
  'POST /api/aws/login': 'admin',
};

/** Không có trong bảng nghĩa là CHƯA quyết định — và chưa quyết định thì cấm. */
export function requiredRole(route: string): Role | undefined {
  return ROUTE_POLICY[route];
}
