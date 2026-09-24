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

Ngược lại, `TESTPILOT_MODE=server` mà **thiếu `TESTPILOT_DATABASE_URL` thì tiến
trình từ chối khởi động**. Đó là chủ ý: quay về file JSON ở chế độ server nghĩa
là mọi tổ chức đọc ghi cùng một chỗ trên đĩa máy chủ — một đường rò dữ liệu
không báo lỗi và không sửa được sau khi đã xảy ra. Thà chết lúc deploy.

Cùng luật ấy áp cho **phiên đăng nhập**: ở chế độ server chúng nằm trong bảng
`session`, không nằm trong RAM. Giữ trong RAM thì một lần deploy bình thường
đăng xuất toàn bộ người đang dùng, và chạy hai instance thì người đăng nhập ở
instance này gọi API rơi vào instance kia sẽ nhận 401 — không phải thỉnh
thoảng, mà là một nửa số request.

## Thử trên một laptop trong mạng nội bộ

Đổi Wi-Fi là đổi IP, và mọi địa chỉ người khác dùng — đăng nhập Keycloak, link
tải report, địa chỉ runner nối về — mang IP ấy. Sau mỗi lần đổi mạng:

```bash
bash scripts/server-lan.sh      # trỏ .env.server, Keycloak, hướng dẫn runner vào IP hiện tại
```

rồi khởi động lại server. Chỉ dành cho thử nghiệm: máy khác phải cùng mạng, và
runner đã nối phải đăng nhập lại cho địa chỉ mới. Bản triển khai thật cần một
địa chỉ cố định (VPN, hoặc máy chủ có tên miền và HTTPS).

## Máy chủ cũng cắm điện thoại (device farm nhỏ)

Đặt `TESTPILOT_HOST_DEVICES=1` khi chính máy chạy server cũng là máy cắm điện
thoại. Điện thoại cắm vào đó hiện với **cả tổ chức** như thiết bị dùng chung —
không ai phải tạo token hay chạy runner riêng trên máy chủ, và màn Điều khiển
thiết bị điều khiển được chúng.

Để tắt khi server nằm trong container hay trên cloud: lúc ấy máy chủ web không
được chạy Appium hay adb, và thiết bị nối vào qua runner (`Thêm máy`). Runner
cá nhân trên laptop từng người vẫn dùng được song song, cho ai muốn cắm thêm
máy ở chỗ mình.

### Tunnel iOS trên máy chủ: cài làm dịch vụ, một lần

iPhone iOS 17+ cần một tunnel chạy bằng quyền root cho WebView. Mở Terminal và gõ
mật khẩu thì được với laptop của một người — không được với máy chủ, vì mọi người
làm việc từ xa và không ai ngồi ở máy chủ. Admin cài một lần trên máy chủ:

```bash
sudo bash scripts/install-ios-tunnel-service.sh
```

Tunnel thành dịch vụ hệ thống: tự chạy khi máy khởi động, tự dựng lại khi chết.
Nút trên web đổi thành "Khởi động lại tunnel" và chạy không cần mật khẩu, nhờ một
quy tắc sudoers cho ĐÚNG MỘT lệnh (`launchctl kickstart -k` dịch vụ ấy). Gỡ:
`sudo bash scripts/install-ios-tunnel-service.sh --uninstall`. Log:
`/Library/Logs/testpilot-ios-tunnel.log`.

## Artifact: report, ảnh, video

Ở chế độ `server`, bằng chứng của một lượt chạy **không ở lại trên máy runner**
— người đọc report ngồi ở chỗ khác với chiếc máy đã chạy test. Đặt
`TESTPILOT_S3_BUCKET` (và ba biến `TESTPILOT_S3_*` còn lại) là bật đường ấy;
không đặt thì server in một cảnh báo lúc khởi động và file nằm lại chỗ cũ.

**Runner không cầm khoá bucket.** Nó xin server một link có chữ ký cho từng
file rồi ghi thẳng lên S3. Lý do rất cụ thể: runner chạy trên laptop của một
người, và hai mươi bản sao của một khoá ghi được vào kho của cả tổ chức là hai
mươi chỗ để mất nó — không thu lại được cái nào khi một máy bị mất cắp.

Đường đọc cũng không đi qua server: `GET /api/artifact?key=…` trả 302 sang một
link có hạn. Một video hàng chục MB đi qua server là trả tiền băng thông hai
lần rồi giữ một kết nối mở suốt thời gian đó.

Dọn theo tuổi chạy một giờ một lần, lấy số ngày từ `retention.keepFailedDays`
trong `testpilot.config.json`.

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

## Đưa lên máy chủ thật

- `Dockerfile` ở gốc repo dựng ảnh control plane — **chỉ phần server**, không có
  Appium/adb/Xcode. Phần chạm tới thiết bị sống trong `src/runner/`, trên máy có
  thiết bị cắm vào.
- `infra/nginx/testpilot.conf` là cấu hình reverse proxy mẫu. **Đọc phần SSE
  trong đó trước khi sửa**: cấu hình proxy mặc định của nginx làm hỏng stream
  log theo cách không báo lỗi — log không hiện, hoặc hiện dồn một cục, hoặc đứt
  giữa lượt chạy, và server không có dòng lỗi nào.
- `GET /api/health` trả đúng một chữ `ok` cho load balancer. Chi tiết
  (`?deep=1`) đòi vai `admin`: đây là điểm duy nhất người lạ chạm được trước
  khi đăng nhập, nên nó không kể phiên bản, không kể tên máy.

## Dọn

```bash
docker compose down -v   # xoá cả dữ liệu Postgres và MinIO
```
