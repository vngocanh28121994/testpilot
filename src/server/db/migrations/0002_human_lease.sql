-- Lease của NGƯỜI, không chỉ của job.
--
-- Vì sao phải đổi trước khi viết scheduler: điều khiển tay từ web nghĩa là một
-- con người giữ một chiếc máy trong lúc họ đang chạm vào nó. Nếu việc giữ ấy
-- dùng một cơ chế khác với lease của job, thì có HAI câu trả lời cho "ai đang
-- giữ máy này" — và scheduler, vốn chỉ đọc một câu, sẽ giao máy cho một job
-- trong lúc có người đang bấm trên màn hình. Kiểu hỏng ấy không báo lỗi: job
-- chỉ đơn giản chạy sai, vì màn hình không ở nơi nó tưởng.
--
-- Nên bảng `lease` giữ CẢ HAI loại người giữ, và `UNIQUE (device_id)` — thứ đã
-- có từ 0001 — trở thành phép loại trừ cho cả hai. Một chiếc máy, một người
-- giữ, bất kể người ấy là con người hay một job.
--
-- Bảng dựng lại chứ không `ALTER COLUMN`: SQLite không bỏ được `NOT NULL` khỏi
-- một cột đã có, và `job_id` phải bỏ được NOT NULL. Dựng lại thì chạy giống
-- nhau ở cả hai DB, và không cần thêm token nào vào dialect.ts.
--
-- Một điều CỐ TÌNH không làm: không ghi 'leased'/'busy' vào `device.state`.
-- Hai giá trị ấy còn trong CHECK của 0001, nhưng không dòng code nào viết
-- chúng, và không nên. Việc một máy có đang bị giữ hay không được TÍNH từ bảng
-- này, vì một cột mirror là nguồn sự thật thứ hai — đúng thứ migration này tồn
-- tại để dẹp. `device.state` chỉ còn nói về tình trạng vật lý và hành chính:
-- idle, offline, quarantined.

-- Hai ràng buộc CHECK được ĐẶT TÊN, vì bảng này sinh ra dưới tên `lease_v2`
-- rồi mới đổi tên: tên mặc định sẽ theo tên lúc sinh, nên một lần vi phạm sẽ
-- báo "lease_v2_check" và gửi người đọc đi tìm một bảng không tồn tại.
--
-- Nhưng khoá chính thì KHÔNG đặt tên, và đó là một lỗi đã xảy ra: ở Postgres
-- tên chỉ mục là toàn cục, còn bảng `lease` của 0001 vẫn đang giữ tên
-- `lease_pkey` ở đúng lúc bảng này được dựng — nên đặt tên ấy làm cả migration
-- chết với 42P07. SQLite không có không gian tên chung cho ràng buộc, nên nó
-- xanh; thứ bắt được là bài test chạy migration trên Postgres THẬT.
CREATE TABLE IF NOT EXISTS lease_v2 (
  id              TEXT PRIMARY KEY,
  device_id       TEXT NOT NULL REFERENCES device (id) ON DELETE CASCADE,
  -- Tổ chức nằm ngay trên dòng lease, không chỉ suy ra qua `device`: mọi truy
  -- vấn lọc theo tổ chức phải lọc được TRỰC TIẾP. Một câu SQL phải join mới
  -- biết tổ chức là một câu có thể quên join.
  org_id          TEXT NOT NULL REFERENCES org (id),
  holder_kind     TEXT NOT NULL CONSTRAINT lease_holder_kind
                    CHECK (holder_kind IN ('job', 'human')),
  job_id          TEXT REFERENCES job (id) ON DELETE CASCADE,
  holder_user_id  TEXT REFERENCES app_user (id),
  acquired_at     {{timestamp}} NOT NULL,
  expires_at      {{timestamp}} NOT NULL,
  renewed_at      {{timestamp}},
  -- `holder_kind` và cột người giữ phải khớp nhau. Không có ràng buộc này thì
  -- một dòng `holder_kind='human'` với `holder_user_id` rỗng là hợp lệ, và nó
  -- là một chiếc máy bị giữ bởi không ai — không thu hồi được bằng tay, vì
  -- không có ai để hỏi.
  CONSTRAINT lease_holder_matches CHECK (
    (holder_kind = 'job'   AND job_id IS NOT NULL AND holder_user_id IS NULL)
    OR
    (holder_kind = 'human' AND holder_user_id IS NOT NULL AND job_id IS NULL)
  )
);

INSERT INTO lease_v2 (id, device_id, org_id, holder_kind, job_id,
                      acquired_at, expires_at, renewed_at)
SELECT l.id, l.device_id, d.org_id, 'job', l.job_id,
       l.acquired_at, l.expires_at, l.renewed_at
  FROM lease l JOIN device d ON d.id = l.device_id;

DROP TABLE lease;
ALTER TABLE lease_v2 RENAME TO lease;

CREATE UNIQUE INDEX IF NOT EXISTS lease_one_per_device ON lease (device_id);
CREATE INDEX IF NOT EXISTS lease_expiry ON lease (expires_at);
-- "Tôi đang giữ những máy nào" là câu màn thiết bị hỏi ở mỗi lần tải trang.
CREATE INDEX IF NOT EXISTS lease_by_holder ON lease (holder_user_id);
