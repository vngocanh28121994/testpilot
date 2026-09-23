-- Phiên đăng nhập, để chúng sống lâu hơn một tiến trình.
--
-- Tới giờ phiên nằm trong RAM, và điều đó có hai hệ quả mà không cấu hình nào
-- sửa được. Restart server — kể cả một lần deploy bình thường — là đăng xuất
-- toàn bộ người đang dùng. Và chạy hai instance thì người đăng nhập ở instance
-- này gọi API rơi vào instance kia sẽ nhận 401: không phải lỗi thỉnh thoảng,
-- mà là một nửa số request.
--
-- Chỉ giữ HASH của mã phiên, không giữ mã. Một bảng có thể bị đọc: log truy
-- vấn, bản backup, một lần `SELECT *` chia sẻ nhầm. Mã phiên là thứ đăng nhập
-- được ngay, nên đối xử với nó như mật khẩu chứ không như một khoá chính.
--
-- `identity` là JSON chứ không phải khoá ngoại tới `app_user`: nó là ẢNH CHỤP
-- lúc đăng nhập — vai, email, tổ chức. Người dùng đổi vai thì phiên cũ vẫn
-- mang vai cũ cho tới khi hết hạn hoặc bị thu hồi, và đó là hành vi đúng:
-- `revokeUser` là đường để cắt ngay, chứ không phải một phép JOIN im lặng đổi
-- quyền của một phiên đang chạy giữa chừng.
CREATE TABLE IF NOT EXISTS session (
  id_hash     TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  org_id      TEXT NOT NULL,
  identity    {{json}} NOT NULL,
  created_at  {{timestamp}} NOT NULL,
  expires_at  {{timestamp}} NOT NULL
);

-- `revokeUser` chạy khi một người rời tổ chức hoặc báo mất máy, và lúc ấy tốc
-- độ là thứ người ta cần: quét cả bảng để tìm phiên của một người là chấp nhận
-- được với trăm dòng, không chấp nhận được với trăm nghìn.
CREATE INDEX IF NOT EXISTS session_by_user ON session (user_id);
-- Dọn phiên hết hạn theo lô.
CREATE INDEX IF NOT EXISTS session_by_expiry ON session (expires_at);
