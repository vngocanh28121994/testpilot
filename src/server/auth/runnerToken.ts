/**
 * Token của runner — cửa cho MÁY, không phải cho người.
 *
 * Mọi route khác của server hỏi "ai đang đăng nhập". Runner thì không đăng
 * nhập: nó là một tiến trình trên một máy khác, chạy suốt ngày, không có
 * trình duyệt và không có ai ngồi trước nó. Nên nó mang một bí mật dùng chung,
 * gửi trong `Authorization: Bearer`.
 *
 * Kiểm tra nằm trong `authorize()` chứ không rải vào từng handler, vì file ấy
 * có một lời hứa: **mọi request đi qua đúng một cửa**. Thêm một chỗ kiểm quyền
 * thứ hai là thêm một chỗ có thể quên kiểm, và cái quên ấy không tự lộ ra.
 *
 * Bản này dùng MỘT token cho cả tổ chức. Token riêng cho từng runner — cột
 * `runner.token_hash` đã có sẵn trong lược đồ — thuộc về P4, nơi người dùng tự
 * đăng ký máy cá nhân của họ; lúc ấy mỗi máy phải thu hồi được riêng.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Identity } from './roles.js';

/**
 * Bí mật dùng chung của P3.4.
 *
 * Từ P4.1 nó KHÔNG còn là đường xác thực: `MemoryRunnerRegistry.seedFromEnv()`
 * biến nó thành một dòng trong sổ, và cửa chỉ tra sổ. Giữ lại vì mọi cấu hình
 * đang chạy đều dùng nó, và một bản nâng cấp làm hỏng thứ đang dùng được là
 * một bản nâng cấp không ai cài.
 */
export function runnerToken(env = process.env): string | undefined {
  const token = env.TESTPILOT_RUNNER_TOKEN?.trim();
  return token ? token : undefined;
}

/** Tổ chức mà runner nối vào thuộc về. `local` là chế độ embedded. */
export function runnerOrg(env = process.env): string {
  return env.TESTPILOT_RUNNER_ORG?.trim() || 'local';
}

export function bearer(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return undefined;
  const value = header.slice('Bearer '.length).trim();
  return value ? value : undefined;
}

/**
 * So sánh trong thời gian KHÔNG phụ thuộc nội dung.
 *
 * `a === b` thoát ngay ở ký tự đầu khác nhau, nên thời gian trả lời rò rỉ số
 * ký tự đúng ở đầu chuỗi. Với một endpoint mà máy khác gọi được hàng nghìn lần
 * một giây, đó là đủ để dò ra token.
 *
 * Hash trước rồi mới so: `timingSafeEqual` đòi hai buffer DÀI BẰNG NHAU và ném
 * khi không — mà chính cú ném ấy lại rò rỉ độ dài token.
 */
export function tokenMatches(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Danh tính của một runner đã trình đúng token.
 *
 * Mọi trường lấy từ DÒNG TRONG SỔ, không từ thứ runner tự khai qua header: tổ
 * chức quyết định runner ấy thấy dữ liệu của ai, và để nó tự nhận nghĩa là
 * một máy bị chiếm tự chọn tổ chức để đọc.
 *
 * `role` là `runner_user`: nó chạy test và báo kết quả, nhưng KHÔNG sửa được
 * dữ liệu dùng chung. Một runner bị chiếm không được phép duyệt healing hay
 * đổi config — nó chỉ được làm đúng việc của một runner.
 */
export function runnerIdentity(runner: { id: string; orgId: string }): Identity {
  return {
    userId: runner.id,
    orgId: runner.orgId,
    email: '',
    role: 'runner_user',
  };
}
