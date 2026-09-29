# Chuẩn bị môi trường TestPilot

Một chỗ cho mọi việc phải làm để TestPilot chạy được: máy chủ, trình duyệt của người dùng, từng điện
thoại mới cắm vào, và bảng lỗi hay gặp. Phần lớn các bước cũng hiện trên giao diện (thẻ **Cắm máy
mới** ở màn *Thiết bị & hàng đợi*, phần **Trước khi chạy** ở *Local Runner*) — tài liệu này là bản
đầy đủ, đọc một lần từ trên xuống.

Mục lục:

1. [Máy chủ (máy Mac cắm điện thoại) — làm một lần](#1-máy-chủ--làm-một-lần)
2. [Bật máy chủ trên IP mạng nội bộ](#2-bật-máy-chủ-trên-ip-mạng-nội-bộ)
3. [Trình duyệt của người dùng](#3-trình-duyệt-của-người-dùng)
4. [Mỗi máy Android mới](#4-mỗi-máy-android-mới)
5. [Mỗi iPhone mới](#5-mỗi-iphone-mới)
6. [Runner trên laptop cá nhân](#6-runner-trên-laptop-cá-nhân)
7. [Lỗi hay gặp và cách xử lý](#7-lỗi-hay-gặp-và-cách-xử-lý)

---

## 1. Máy chủ — làm một lần

Máy Mac chạy server và cũng là máy cắm điện thoại (`TESTPILOT_HOST_DEVICES=1`).

| Việc | Lệnh / chỗ làm | Ghi chú |
|---|---|---|
| Node ≥ 20 | `node -v` | |
| Xcode **đầy đủ** | App Store | Command Line Tools không đủ — phải build WebDriverAgent |
| Xcode đăng nhập Apple ID của team ký | Xcode › Settings › Accounts | Tài khoản này dùng để **đăng ký iPhone mới** vào provisioning profile |
| Appium + driver | `npm install -g appium` · `appium driver install xcuitest` · `appium driver install uiautomator2` | |
| adb | `brew install --cask android-platform-tools` | |
| Postgres, Keycloak, MinIO | `docker compose up -d` | Chế độ server cần cả ba |
| File cấu hình server | `cp .env.server.example .env.server` | Không nằm trong git |
| **Tunnel iOS làm dịch vụ** | `sudo bash scripts/install-ios-tunnel-service.sh` | Xem giải thích dưới |
| Quyền camera cho “TestPilot Screen Capture” | Bấm **Cho phép** khi macOS hỏi lần đầu | Để màn Điều khiển có hình iPhone 30 khung/giây qua cáp. Lỡ từ chối: Cài đặt hệ thống › Quyền riêng tư & Bảo mật › Camera |

**Vì sao tunnel phải là dịch vụ.** Từ iOS 17, Appium cần một tunnel (chạy bằng root) để thấy WebView
của app hybrid. Mỗi máy Mac chỉ có **một** tunnel, giữ mọi iPhone cắm vào nó. Hai điều ít ai biết:

- Tunnel chỉ nhận những iPhone **cắm sẵn lúc nó khởi động**. Cắm thêm máy, hoặc cáp rớt một nhịp, là
  máy ấy rơi khỏi tunnel.
- Khi tunnel **đang chạy**, Appium (iOS 18+) chỉ tìm iPhone trong tunnel, bỏ qua USB. Máy không có
  trong tunnel thì *mọi thứ* với máy đó hỏng — kể cả app không hybrid và màn Điều khiển —
  với lỗi `Unknown device or simulator UDID`.

Cài làm dịch vụ thì: tunnel tự chạy khi bật máy, nút **Khởi động lại tunnel** trên web chạy không cần
mật khẩu, và máy chủ **tự khởi động lại tunnel** trong khoảng một phút khi thấy một iPhone cắm cáp mà
tunnel chưa giữ — chỉ lúc không có lượt iOS nào đang chạy (khởi động lại làm đứt lượt ấy), tối đa ba
lần mỗi máy. Log dòng `[tunnel]` ở tiến trình server. Gỡ:
`sudo bash scripts/install-ios-tunnel-service.sh --uninstall`.

Máy yếu hơn số điện thoại cắm vào thì đặt trần số job chạy cùng lúc trong `.env.server`:
`TESTPILOT_MAX_JOBS=2`. Mỗi thiết bị đang chạy test cần khoảng 0,5–1 nhân CPU và 0,8–1,5 GB RAM.

---

## 2. Bật máy chủ trên IP mạng nội bộ

Mỗi lần đổi mạng (IP đổi):

```bash
bash scripts/server-lan.sh --ip
```

Script viết lại các địa chỉ trong `.env.server`, cho Keycloak chấp nhận đăng nhập từ IP mới, và sửa
địa chỉ trong hướng dẫn cài runner. Mạng không chặn mDNS thì chạy `bash scripts/server-lan.sh` (không
`--ip`) **một lần** — dùng tên `<tên-máy>.local`, đổi Wi-Fi không phải chạy lại.

Rồi bật server (tắt bản đang chiếm cổng 4300 trước):

```bash
set -a && source .env.server && set +a && npm run ui
```

Kiểm tra: mở `http://<IP>:4300` từ một máy khác cùng mạng → trang **Đăng nhập TestPilot** → bấm Đăng
nhập phải sang trang Keycloak ở `http://<IP>:8080`, không báo `Invalid redirect_uri`.

Lưu ý:

- Người dùng phải **cùng mạng** với máy chủ. Tường lửa macOS bật thì phải cho `node` và Docker nhận
  kết nối.
- Runner đã nối trước đó phải đăng nhập lại với địa chỉ mới (xem [mục 6](#6-runner-trên-laptop-cá-nhân)).
- Đây là cách cho **thử nghiệm**. Dùng lâu dài cần địa chỉ cố định: VPN, hoặc tên miền + HTTPS — HTTPS
  cũng bỏ luôn được bước cờ Chrome ở mục 3.

---

## 3. Trình duyệt của người dùng

Màn Điều khiển giải mã video H.264 bằng WebCodecs. Trình duyệt **chỉ bật WebCodecs trên trang an
toàn**: HTTPS hoặc `localhost`. Mở qua `http://<IP>:4300` thì kể cả Chrome cũng không có bộ giải mã:

- Android: không xem được màn hình (báo “Trang đang mở qua HTTP thường…”).
- iPhone: vẫn xem được nhưng bằng JPEG — chậm và nặng hơn.

Cách tạm cho bản thử, **mỗi máy người dùng một lần**:

1. Mở `chrome://flags/#unsafely-treat-insecure-origin-as-secure` (Edge: `edge://flags/...` cùng tên).
2. Thêm `http://<IP>:4300` vào ô, chọn **Enabled**.
3. Bấm **Relaunch**.

Cờ này chỉ làm trình duyệt **có** bộ giải mã. Nó không liên quan tới lỗi `Decoder failure` — lỗi ấy
xảy ra khi bộ giải mã đã có và hỏng lúc giải mã một mảnh hình (xem [mục 7](#7-lỗi-hay-gặp-và-cách-xử-lý)).

---

## 4. Mỗi máy Android mới

**Trên điện thoại:**

1. Bật **Tuỳ chọn nhà phát triển**: Cài đặt › Giới thiệu về điện thoại › bấm 7 lần vào *Số bản dựng*
   (Samsung: Thông tin phần mềm › Số hiệu bản tạo; Xiaomi: Phiên bản MIUI/HyperOS).
2. Bật **Gỡ lỗi USB** trong Tuỳ chọn nhà phát triển.
   - Xiaomi / Redmi / POCO: bật thêm **Gỡ lỗi USB (Cài đặt bảo mật)** và **Cài đặt qua USB** — thiếu
     thì Appium không cài được app phụ và không chạm được.
   - Oppo / Realme / Vivo: tắt **Giám sát quyền** nếu có.
3. Cắm cáp (cáp truyền dữ liệu, không phải cáp chỉ sạc), mở khoá, bấm **Cho phép** ở “Cho phép gỡ lỗi
   USB?”, tick **Luôn cho phép từ máy tính này**.
4. Nên bật **Không khoá màn hình khi sạc** (Stay awake).

**Kiểm tra:** `adb devices -l` thấy máy ở trạng thái `device`; trên web, máy hiện **Rảnh** ở bảng
Thiết bị. Có dòng chữ vàng dưới tên máy thì làm đúng việc dòng ấy nói.

---

## 5. Mỗi iPhone mới

**Trên iPhone:**

1. Cắm cáp, mở khoá, bấm **Tin cậy** máy tính này, nhập mật mã.
   Lỡ bấm *Không tin cậy*: Cài đặt › Cài đặt chung › Chuyển hoặc Đặt lại iPhone › Đặt lại › Đặt lại
   Vị trí & Quyền riêng tư, rồi cắm lại.
2. **Chế độ nhà phát triển** (iOS 16+): Cài đặt › Quyền riêng tư & Bảo mật › Chế độ nhà phát triển →
   bật → máy khởi động lại → xác nhận **Bật**. Mục này chỉ xuất hiện sau khi máy đã cắm vào Mac có
   Xcode một lần.
3. **Tự động hoá giao diện**: Cài đặt › Nhà phát triển › Tự động hoá giao diện (UI Automation) → bật.
   Không bật thì máy hỏi mật mã ở **mỗi** lượt chạy.
4. **Web Inspector** (chỉ khi `ios.hybrid = true`): Cài đặt › Safari › Nâng cao › Web Inspector.

Hai bước đầu chưa làm thì bảng Thiết bị hiện máy kèm dòng chữ vàng nói đúng bước còn thiếu.

**Trên web** (Local Runner › chọn iOS › phần **Trước khi chạy**):

5. **Thêm máy vào danh sách** — máy mới hiện kèm nút thêm máy (hoặc `npm run devices:sync`). Chạy qua
   runner/máy chủ thì không cần: runner tự nhận máy đang cắm.
6. **Tunnel iOS** phải xanh. Đỏ vì “chưa có iPhone này” → bấm **Khởi động lại tunnel** (có dịch vụ thì
   máy chủ tự làm trong khoảng một phút).
7. **WebDriverAgent trên máy** phải xanh. Đỏ → bấm **Cài WebDriverAgent lên máy** (1–4 phút, giữ iPhone
   mở khoá). Nút tự làm trọn chuỗi:
   - máy chưa có trong provisioning profile → build WebDriverAgent một lần để Xcode **đăng ký máy với
     team** và cấp profile mới;
   - tải bản WebDriverAgent dựng sẵn, ký bằng chứng chỉ trong Keychain, cài lên máy;
   - mở thử, và nói bước còn lại.
   Bản dòng lệnh của cùng nút: `bash scripts/prepare-wda.sh --device <id hoặc udid>`.
8. **Tin cậy chứng chỉ nhà phát triển** trên iPhone: Cài đặt › Cài đặt chung › VPN & Quản lý thiết bị
   → chọn Apple ID nhà phát triển → **Tin cậy**. Mỗi máy một lần.

**Không tự làm được:**

- **File .ipa của app cần test**: IPA ký development/ad-hoc chỉ cài được lên máy có trong profile của
  nó. Gửi **UDID** (dòng xám dưới tên máy ở bảng Thiết bị) cho người build app để thêm vào, rồi build lại.
- **Apple ID miễn phí**: profile hết hạn sau 7 ngày — dòng WebDriverAgent lại đỏ, bấm lại nút cài.

**Lưu ý chế độ WebDriverAgent.** Lượt chạy từ web đọc cấu hình **cá nhân**
`.testpilot/users/<tên>/config.json`, không phải `testpilot.config.json` ở gốc repo. Với
`ios.usePreinstalledWDA = true`, lượt chạy **không tự cài** WebDriverAgent — máy mới bắt buộc qua bước 7.

---

## 6. Runner trên laptop cá nhân

Khi điện thoại cắm vào laptop của một người chứ không phải máy chủ. Chi tiết trong
`build/runner-handoff/HUONG-DAN.md`; tóm tắt:

1. Cài Node, Appium + driver, adb (và Xcode nếu có iPhone) như [mục 1](#1-máy-chủ--làm-một-lần).
2. `npm install -g <thư mục>/noi-bo-testpilot-runner-<phiên bản>.tgz`
3. Admin tạo token ở **Thiết bị & hàng đợi › Thêm máy**, rồi:
   `testpilot-runner-login --server http://<IP>:4300 --token <token>`
4. Bật Appium trong một cửa sổ riêng:
   `appium --allow-insecure='*:adb_shell,*:chromedriver_autodownload'`
5. Chạy runner từ thư mục có `testpilot.config.json`:
   `TESTPILOT_SERVER=http://<IP>:4300 testpilot-runner`

Laptop có iPhone cũng nên cài tunnel làm dịch vụ (mục 1) — runner tự khởi động lại tunnel như máy chủ.

---

## 7. Lỗi hay gặp và cách xử lý

| Thông báo | Nguyên nhân | Cách xử lý |
|---|---|---|
| “Điện thoại chưa cho phép gỡ lỗi USB…” (Android) | Chưa bấm Cho phép | Mở khoá, bấm Cho phép; không thấy hộp thoại thì rút cáp cắm lại |
| “iPhone chưa tin cậy máy tính này” | Chưa bấm Tin cậy | Mục 5, bước 1 |
| “iPhone chưa bật Chế độ nhà phát triển” | | Mục 5, bước 2 |
| “Máy này chưa được cài WebDriverAgent” / `…xctrunner is not installed` | iPhone mới, cấu hình dùng WDA cài sẵn | Mục 5, bước 7 |
| `xcodebuild failed with code 70` | Profile hết hạn (Apple ID miễn phí: 7 ngày) | Bấm lại **Cài WebDriverAgent lên máy** |
| `xcodebuild failed with code 65` / “chưa được tin cậy” | Chứng chỉ nhà phát triển chưa tin cậy trên máy | Mục 5, bước 8 (tắt VPN lúc bấm) |
| “Appium không thấy chiếc iPhone này” / `Unknown device or simulator UDID` | Tunnel đang chạy nhưng không giữ máy này (cắm sau, hoặc rớt cáp) | Bấm **Khởi động lại tunnel** ngay trong khung lỗi; cài tunnel làm dịch vụ để tự xử lý |
| “Thao tác vừa rồi không tới được máy … socket hang up” | WebDriverAgent trên iPhone đã tắt — thường vì vuốt đóng thẻ *WebDriverAgentRunner* trong **Đa nhiệm** | Tự hồi phục: thao tác kế tiếp mở lại WDA (vài giây). Vẫn lỗi: Nhả máy rồi Giữ máy lại. Đừng vuốt đóng thẻ đó |
| “Trang đang mở qua HTTP thường…” | Trang không an toàn → không có WebCodecs | Mục 3 (cờ Chrome), hoặc dùng HTTPS |
| `Decoder failure` | Một mảnh hình không giải mã được (mạng khựng giữa khung, khung nhiều slice) | Tự hồi phục ở khung khoá kế tiếp (≤ 2 giây). Chỉ báo khi hỏng 3 lần liền: Nhả máy rồi Giữ máy lại; dùng Chrome/Edge mới; vẫn lỗi thì tắt *Use graphics acceleration when available* |
| “Mất kết nối tới luồng màn hình” | Server khởi động lại, mạng rớt, hoặc hết lượt giữ | Bấm Giữ máy lại |
| `Invalid redirect_uri` khi đăng nhập | IP đổi mà chưa chạy `server-lan.sh` | Mục 2 |
