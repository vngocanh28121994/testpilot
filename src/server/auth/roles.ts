/**
 * Bốn vai, và ranh giới giữa chúng là câu hỏi "làm hỏng được gì".
 *
 *  - `viewer` — đọc. Xem report, xem kịch bản, xem lịch sử. Không làm hỏng
 *    được gì, nên đây là vai mặc định của một người vừa được thêm vào tổ chức.
 *  - `runner_user` — chạy test, và đăng ký máy của mình. Tiêu tiền (phút thiết
 *    bị, token model) nhưng không đổi thứ người khác dựa vào.
 *  - `maintainer` — sửa dữ liệu dùng chung: element, kịch bản, duyệt healing.
 *    Một quyết định sai ở đây làm hỏng lượt chạy của cả đội, và đó chính xác
 *    là ranh giới đáng có một vai riêng.
 *  - `admin` — tổ chức, thành viên, khoá API, runner. Sai ở đây thì không ai
 *    làm việc được.
 *
 * Thứ tự là bao hàm: `admin` làm được mọi việc của `maintainer`, và cứ thế
 * xuống. Bao hàm chứ không phải tách rời, vì thực tế một người duyệt kịch bản
 * gần như luôn cũng là người chạy thử nó.
 */
export const ROLES = ['viewer', 'runner_user', 'maintainer', 'admin'] as const;

export type Role = (typeof ROLES)[number];

/** Càng cao càng làm được nhiều. Chỉ dùng để so sánh, không lưu xuống DB. */
const RANK: Record<Role, number> = {
  viewer: 0,
  runner_user: 1,
  maintainer: 2,
  admin: 3,
};

export function allows(actual: Role, required: Role): boolean {
  return RANK[actual] >= RANK[required];
}

/**
 * Ai đang gọi.
 *
 * `local` là danh tính của chế độ `embedded`: một người, một máy, không đăng
 * nhập. Nó mang vai `admin` vì trên máy của chính mình thì mọi giới hạn đều là
 * giả — người dùng sửa được file config bằng editor bất cứ lúc nào.
 */
export interface Identity {
  userId: string;
  orgId: string;
  email: string;
  role: Role;
}

export const LOCAL_IDENTITY: Identity = {
  userId: 'local',
  orgId: 'local',
  email: '',
  role: 'admin',
};
