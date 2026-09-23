-- Tổ chức mặc định của một bản triển khai.
--
-- Mọi bảng dùng chung đều có khoá ngoại tới `org`, và cho tới giờ không dòng
-- mã nào TẠO ra một dòng `org`. Hậu quả chỉ lộ ra khi chạy thật ở chế độ
-- server: đăng nhập được, gọi `GET` được, rồi lệnh GHI đầu tiên chết bằng
-- `runner_org_id_fkey`. Triệu chứng nói về khoá ngoại, nguyên nhân là một dòng
-- không ai chèn.
--
-- `default` là đúng chuỗi mà `routes/auth.ts` đặt vào `identity.orgId` khi một
-- người đăng nhập. Nhiều tổ chức là P5; tới lúc ấy dòng này vẫn đúng — nó trở
-- thành tổ chức của những người chưa được gán vào đâu.
--
-- `ON CONFLICT DO NOTHING` để migration chạy lại được nhiều lần, và để nó
-- không đè lên cái tên mà người quản trị đã đổi.
--
-- Mốc thời gian là một chuỗi ISO cố định, không phải `NOW()`: cột `created_at`
-- là TEXT ở cả hai DB và mọi mốc khác trong hệ thống do ứng dụng sinh ra dưới
-- dạng chuỗi ISO — xem `dialect.ts`. Thêm một token `{{now}}` là thêm một chỗ
-- hai DB có thể hiểu khác nhau, để đổi lấy một con số không ai đọc.
INSERT INTO org (id, name, created_at)
VALUES ('default', 'TestPilot', '2026-09-23T00:00:00.000Z')
ON CONFLICT DO NOTHING;
