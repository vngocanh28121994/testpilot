# scrcpy-server

Đây là file NHỊ PHÂN của bên thứ ba, nằm trong repo chứ không tải lúc cài.

| | |
|---|---|
| nguồn | https://github.com/Genymobile/scrcpy/releases/tag/v4.1 |
| file | `scrcpy-server-v4.1` (733.706 byte) |
| SHA-256 | `deacb991ed2509715160ffdc7907e47b4160eb30d1566217e9047fd5b8850cae` |
| giấy phép | Apache-2.0 — xem [LICENSE](./LICENSE) |

SHA-256 ở trên là con số Genymobile công bố trong `SHA256SUMS.txt` của chính
bản phát hành ấy, và `scripts/check-vendor.mjs` đối chiếu lại mỗi lần chạy test.

## Vì sao nằm trong repo

Runner chạy trên laptop của người khác, có khi sau proxy của công ty, có khi
lần đầu khởi động là lúc không có mạng ra ngoài. Tải lúc cài nghĩa là thêm một
cách hỏng mà người gặp nó không sửa được, để đổi lấy 717 KB trong repo.

Nó cũng khoá phiên bản: server và client PHẢI cùng số hiệu, và đây là chỗ duy
nhất số ấy được quyết định.

## Nó được dùng thế nào

`src/runner/scrcpy/` đẩy file này lên `/data/local/tmp/scrcpy-server.jar` mỗi
lần mở một phiên điều khiển — không phải mỗi lần cắm máy, và không cache.

Đẩy lại mỗi lần nghe như phí, nhưng đã đo trên emulator: đẩy hết 62 ms, còn đi
hỏi xem máy đã có đúng bản chưa hết 77-117 ms, vì `adb push` là truyền file
thẳng còn `adb shell` phải dựng một tiến trình trên máy. Cái kiểm tra đắt hơn
thứ nó định tránh.

## Nâng phiên bản thì làm gì

1. Tải file mới và `SHA256SUMS.txt` của bản ấy, đối chiếu tay.
2. Thay file, sửa bảng trên, sửa `SCRCPY_VERSION` trong `src/runner/scrcpy/protocol.ts`.
3. Đọc lại `ControlMessageReader.java` của tag mới: định dạng lệnh điều khiển
   KHÔNG ổn định giữa các bản, và một trường đổi kiểu thì cú chạm rơi sai chỗ
   chứ không báo lỗi.

Phần chào hỏi thì có báo: server so số hiệu client gửi lên với số của chính nó
và chết ngay với câu "does not match" nếu lệch. Nên quên bước 2 là hỏng to và
rõ, không phải hỏng ngầm.
