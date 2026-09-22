# Đóng gói runner (P4.3)

Runner sống trên máy người khác — phòng lab ở tầng dưới, laptop của một người
đang đi công tác. Nên câu hỏi của thư mục này không phải "chạy nó thế nào" mà
**"cập nhật nó thế nào khi không ai ngồi trước máy ấy"**.

## Ba mảnh

1. **Gói phát hành.** `npm run build:runner` dựng `dist-runner/` — mã đã biên
   dịch cộng một `package.json` chỉ có `bin` và phần phụ thuộc lúc chạy. Phát
   hành bằng `npm publish` từ trong thư mục ấy, vào registry nội bộ của đội.
2. **Bộ giám sát.** systemd (Linux) hoặc launchd (macOS), cấu hình khởi động
   lại khi tiến trình thoát. File mẫu ở `packaging/`.
3. **Tự cập nhật.** Runner chào server mỗi lần khởi động. Lệch số MAJOR của
   giao thức thì nó cài bản mới rồi **thoát với mã 75**, và bộ giám sát dựng
   bản vừa cài dậy. Xem [src/runner/update.ts](../src/runner/update.ts).

## Vì sao thoát chứ không tự khởi động lại

Tự `exec` lấy nghe gọn hơn và hỏng theo những cách rất khó gỡ từ xa: tiến
trình cũ còn giữ cổng, bản mới chết ngay lúc khởi động, và không còn ai dựng
nó dậy nữa. Bộ giám sát đã làm đúng việc ấy hàng chục năm rồi.

Ba mã thoát, ba chuyện khác nhau với người đọc log từ xa:

| Mã | Nghĩa |
|---|---|
| 75 | Đã cài bản mới, dựng tôi dậy. **Không phải lỗi.** |
| 2  | Máy này không được cấu hình để tự cập nhật — cần người vào. |
| 3  | Đã thử cập nhật và hỏng. |

## Vì sao server không nói cho runner biết phải chạy lệnh gì

Server chỉ nói phiên bản giao thức của nó. Tên gói cần cài nằm trong biến môi
trường **của chính chiếc máy ấy** (`TESTPILOT_RUNNER_PACKAGE`), không đến từ
mạng. Một server bị chiếm mà sai khiến được câu lệnh cài đặt trên hai mươi
chiếc máy có Xcode và keychain thì đã không còn là chuyện cập nhật nữa.

Không đặt biến ấy thì runner **không** tự cập nhật, và đó là mặc định: một
runner chạy từ mã nguồn mà tự `npm install -g` lên chính nó sẽ cài đè bản đang
phát triển bằng bản đã phát hành, và người ngồi đó mất một buổi để hiểu vì sao
sửa mã không có tác dụng.

## Đăng nhập một lần, không dán token vào `~/.zshrc`

```sh
npx testpilot-runner login --server https://testpilot.example.com --token <token>
npx testpilot-runner login --server https://testpilot.example.com --show    # đã đăng nhập chưa
npx testpilot-runner login --server https://testpilot.example.com --forget  # quên đi
```

Token vào **keychain của macOS**, một mục cho mỗi server — một người có thể nối
máy mình vào cả staging lẫn production, và hai bản ấy cấp hai token khác nhau.

`--show` KHÔNG in token ra: câu hỏi thật là "máy này đã đăng nhập chưa", và in
token ra để trả lời câu ấy là đặt nó vào lịch sử shell — đúng chỗ ta vừa lôi nó
ra khỏi.

Trên máy chủ (Linux, container) thì vẫn dùng biến môi trường: ở đó không có
phiên đăng nhập nào để mở keychain. **Biến môi trường luôn thắng keychain**, nên
cùng một bản runner chạy được ở cả hai chỗ.

## Biến môi trường

| Biến | Bắt buộc | Nghĩa |
|---|---|---|
| `TESTPILOT_SERVER` | ✓ | URL control plane |
| `TESTPILOT_RUNNER_TOKEN` | ✓* | Token riêng của máy này; server chỉ giữ hash. *Không bắt buộc nếu đã `login` vào keychain |
| `TESTPILOT_RUNNER_NAME` | | Tên hiện trong danh sách máy. Mặc định là hostname |
| `TESTPILOT_RUNNER_MODE` | | `lab` (mặc định) hoặc `farm` |
| `TESTPILOT_RUNNER_PACKAGE` | | Gói npm để tự cập nhật. Bỏ trống là tắt tự cập nhật |
| `TESTPILOT_RUNNER_CHANNEL` | | Thẻ phiên bản, mặc định `latest` |
| `TESTPILOT_CONFIG` | | Đường dẫn config, mặc định `testpilot.config.json` |

Token nằm trong file môi trường `chmod 600`, không nằm trong unit file — unit
file thường được commit, file môi trường thì không.

## Cài trên macOS

```sh
npm install -g @noi-bo/testpilot-runner       # tên gói của đội bạn
sudo cp packaging/com.testpilot.runner.plist /Library/LaunchDaemons/
sudo launchctl load /Library/LaunchDaemons/com.testpilot.runner.plist
```

## Cài trên Linux

```sh
npm install -g @noi-bo/testpilot-runner
sudo cp packaging/testpilot-runner.service /etc/systemd/system/
sudo systemctl enable --now testpilot-runner
```

## Chưa làm

**Chưa phát hành lên registry nào cả.** Việc ấy cần registry nội bộ của đội và
quyền phát hành — không phải thứ dựng được từ đây. Thứ ở đây là mọi mảnh còn
lại: bản dựng, file dịch vụ, và cơ chế tự cập nhật đã có bài test.
