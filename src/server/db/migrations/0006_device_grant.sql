-- Cho một người cụ thể mượn một chiếc máy riêng.
--
-- `visibility` chỉ có hai mức, và hai mức ấy trả lời sai câu hỏi hay gặp nhất.
-- "Riêng" là chỉ mình tôi, "chung" là cả tổ chức; còn việc thật nằm ở giữa:
-- chiếc iPhone 12 duy nhất của đội đang cắm ở máy tôi, và người đang sửa bug
-- trên iOS 15 cần nó trong hai tiếng. Không có mức giữa thì người ta chọn
-- "chung" — rồi để nguyên như thế mãi mãi.
--
-- Bảng riêng chứ không phải một mức thứ ba của `visibility`: cho mượn không
-- giống với đổi bản chất chiếc máy, và thứ phải thu lại được thì phải có tên
-- người trong đó.
--
-- KHÔNG có khoá ngoại tới `device`: sổ thiết bị là thứ runner báo lên mỗi mười
-- giây, nên một chiếc máy rút ra rồi cắm lại là một dòng mới. Quyền mượn thì
-- bền hơn thế — nó phải sống qua một lần đóng nắp laptop. Khoá theo `udid`, và
-- một quyền trỏ vào chiếc máy đang không cắm đơn giản là chưa dùng tới.
CREATE TABLE IF NOT EXISTS device_grant (
  org_id      TEXT NOT NULL REFERENCES org (id),
  udid        TEXT NOT NULL,
  user_id     TEXT NOT NULL REFERENCES app_user (id),
  granted_by  TEXT NOT NULL,
  created_at  {{timestamp}} NOT NULL,
  PRIMARY KEY (org_id, udid, user_id)
);

-- Đường đọc nóng là "người này được mượn những máy nào", chạy ở MỖI lần liệt
-- kê thiết bị. Khoá chính bắt đầu bằng `org_id, udid` nên nó không phục vụ
-- được câu ấy.
CREATE INDEX IF NOT EXISTS device_grant_by_user ON device_grant (org_id, user_id);
