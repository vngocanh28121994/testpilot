# Môi trường thử cho chế độ `server`

Ba dịch vụ, dựng bằng một lệnh. **Chỉ để phát triển** — mọi mật khẩu ở đây đều
nằm trong git, cố tình, để không ai nhầm nó với một bản triển khai thật.

```bash
docker compose up -d
```

| Dịch vụ | Mở ở đâu | Đăng nhập |
|---|---|---|
| Keycloak | http://localhost:8080 | `admin` / `admin` |
| MinIO (giao diện) | http://localhost:9001 | `testpilot` / `testpilot-dev` |
| MinIO (API kiểu S3) | http://localhost:9000 | cùng khoá trên |
| Postgres | `localhost:5432` | `testpilot` / `testpilot-dev`, db `testpilot` |

## Bốn người dùng có sẵn

Realm `testpilot` được nhập lúc khởi động, kèm bốn tài khoản để thử bốn vai.
**Mật khẩu trùng tên đăng nhập.**

| Đăng nhập | Vai | Dùng để thử |
|---|---|---|
| `viewer` | viewer | chỉ đọc — mọi `POST` phải trả 403 |
| `runner` | runner_user | chạy test được, sửa kịch bản thì không |
| `maintainer` | maintainer | duyệt kịch bản, sửa element |
| `admin` | admin | cấu hình, khoá API, device pool |

Sửa `infra/keycloak/testpilot-realm.json` rồi `docker compose down -v && docker
compose up -d` là có lại đúng trạng thái đó. Không ai phải bấm lại hai mươi ô
trên giao diện Keycloak, và trạng thái ấy nằm trong git nên hai máy giống nhau.

## Vai nằm ở đâu

Keycloak trả lời **"người này là ai"**. Việc **"ai được làm gì"** là của
TestPilot, đọc từ bảng `membership` — xem `src/server/auth/policy.ts`.

Không phải vì Keycloak làm không được, mà vì thực tế: xin IT tạo một group mới
trong SSO của công ty có thể mất vài tuần, còn thêm một dòng vào `membership`
mất một giây. Token vẫn mang `roles` để P5 dựng đường ánh xạ tự động, nhưng
đường ấy là tiện ích, không phải điều kiện để hệ thống chạy.

## Chạy TestPilot ở chế độ server

```bash
cp .env.server.example .env.server
set -a && source .env.server && set +a
npm run ui
```

Không đặt `TESTPILOT_MODE=server` thì bản local chạy y như cũ: một người, một
máy, không đăng nhập, dữ liệu là file trên đĩa.

## Đưa dữ liệu hiện có vào Postgres

```bash
npx tsx scripts/migrate-json-to-db.ts            # chỉ xem, không ghi
npx tsx scripts/migrate-json-to-db.ts --apply    # ghi thật
```

Mặc định **không ghi gì**: một script di trú chạy nhầm trên đúng cơ sở dữ liệu
thật là loại nhầm không hoàn tác được bằng Ctrl-Z. Chạy lại nhiều lần an toàn —
registry ghi theo `(org, kind, key)`, job ghi theo id.

Lượt chạy local (`runs/`) **không** được di trú, có chủ ý: chúng mô tả thư mục
trên đĩa máy chạy test, và ở chế độ server thư mục ấy không nằm trên server.
Chúng đi lên cùng artifact khi runner đẩy kết quả.

## Dọn

```bash
docker compose down -v   # xoá cả dữ liệu Postgres và MinIO
```
