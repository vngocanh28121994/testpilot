/**
 * Ghi người vừa đăng nhập vào bảng `app_user`.
 *
 * Vì sao cần: nhiều bảng dùng chung trỏ vào `app_user` — ai duyệt một đề xuất,
 * ai được mượn chiếc máy nào. Cho tới giờ không dòng mã nào TẠO ra một dòng
 * `app_user`, nên ở chế độ server mọi thứ chạy được cho tới lệnh ghi đầu tiên
 * chạm vào một trong những khoá ngoại ấy — rồi chết bằng một câu lỗi nói về
 * khoá ngoại, không nói về việc chưa ai được ghi vào sổ.
 *
 * Danh tính đến từ id_token đã ký của nhà cung cấp, và vai đến từ sổ thành
 * viên — cả hai đã được quyết định TRƯỚC khi tới đây. Hàm này không quyết định
 * gì cả; nó chỉ chép lại. Đó là lý do nó dùng `DO NOTHING` chứ không `DO
 * UPDATE`: người đổi tên hiển thị ở nhà cung cấp không phải lý do để ghi đè
 * một dòng mà những bảng khác đang trỏ vào.
 */
import type { PoolProvider } from '../db/pool.js';
import type { Identity } from './roles.js';

export async function bootstrapUser(pool: PoolProvider, identity: Identity): Promise<void> {
  const db = await pool();
  await db.query(
    `INSERT INTO app_user (id, email, name, created_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [identity.userId, identity.email, identity.email, new Date().toISOString()],
  );
  // Tư cách thành viên cũng chép sang: `membership` là chỗ P5 đọc vai theo
  // từng tổ chức, và để nó rỗng nghĩa là bản nhiều tổ chức sau này khởi động
  // với một bảng trống mà không ai nhớ vì sao.
  await db.query(
    `INSERT INTO membership (org_id, user_id, role) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [identity.orgId, identity.userId, identity.role],
  );
}
