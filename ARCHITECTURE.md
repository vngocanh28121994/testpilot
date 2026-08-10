# TestPilot — kiến trúc

Tài liệu chuẩn → testcase Gherkin → chạy trên web (Playwright) + native (Appium/AWS Device Farm)
→ tự heal locator → phát hiện flaky → report.

## 0. Ràng buộc phải biết trước

| Điều bạn muốn | Sự thật | Hệ quả trong thiết kế |
|---|---|---|
| Playwright chạy trên AWS Device Farm | **Không.** Device Farm chỉ nhận Appium (Node/Python/Java/Ruby), XCUITest, Espresso; phần desktop-browser của nó là Selenium-only. | Web chạy Playwright ở nơi khác (local / EC2 grid / BrowserStack). Native chạy Appium trên Device Farm. Hai đường tách hẳn. |
| Playwright bắt element của native app | **Không.** Playwright chỉ nói chuyện với browser engine. | Cần 2 driver, chung một tầng intent. |
| Maestro chạy trên Device Farm | Không — Maestro có cloud riêng. | Không copy Maestro, **copy ý tưởng** của nó (mục 2). |

Vì vậy: **một bộ Gherkin duy nhất, hai driver phía dưới**. Đó là toàn bộ lý do tồn tại của tầng
`Intent` trong [src/core/types.ts](src/core/types.ts).

## 1. Luồng tổng thể

```
Confluence / Figma  ──MCP──►  SourceDoc
                                 │
                    (LLM pass 1) ├──►  registry/elements.json     ← element + N locator/platform
                                 │
                    (LLM pass 2) └──►  features/*.feature         ← Gherkin, vocabulary có kiểm soát
                                                │
                                          parse + bind            ← sai 1 step = fail ngay, 0đ chi phí
                                                │
                                          ScenarioSpec (Intent[])
                                    ┌───────────┴───────────┐
                              WebUiDriver             NativeUiDriver
                              (Playwright)            (Appium / WebdriverIO)
                                    └───────────┬───────────┘
                                          Resolver              ← auto-wait + heal locator
                                                │
                                          Executor              ← retry, screenshot, phân loại
                                                │
                                  FlakeDetector ──► report/index.html
```

## 2. Bốn thứ học từ maestro.dev

Maestro chống flaky không phải bằng "retry nhiều hơn", mà bằng 4 quyết định thiết kế. Đây là
những chỗ TestPilot copy:

**(a) Test viết bằng *ý định*, không bằng selector.**
Maestro viết `tapOn: "Sign in"`. TestPilot viết `I tap "Login button"` → `{kind:'tap', element:'login.submitButton'}`.
Selector nằm trong registry (data), không nằm trong test (code). Đây là điều kiện cần để một
scenario chạy được cả web lẫn native, và để healing có chỗ mà sửa.
→ [src/core/types.ts](src/core/types.ts) (`Intent`), [src/core/registry.ts](src/core/registry.ts)

**(b) Mọi lệnh đều tự chờ, và chờ trên *element* chứ không phải trên *selector*.**
Vòng lặp trong `Resolver.resolve()` mỗi tick quét **lại toàn bộ danh sách candidate**, thay vì khoá
vào một selector rồi đợi. Nhờ vậy một step sống sót qua re-render, hydrate muộn, hoặc testId bị đổi tên.
Driver **không** được tự thêm implicit wait — toàn bộ việc chờ nằm đúng một chỗ.
→ [src/runtime/resolver.ts](src/runtime/resolver.ts)

**(c) Không giữ element handle.**
Handle chỉ sống trong một action. Trước mỗi thao tác đều find lại → không có stale element exception.
→ [src/drivers/driver.ts](src/drivers/driver.ts)

**(d) Tập lệnh nhỏ và cố định.**
`Intent` chỉ có ~15 loại, mỗi loại phải diễn đạt được trên **cả** Playwright lẫn Appium và phải
retry được. Thêm một intent là một quyết định kiến trúc, không phải tiện tay. Bộ step Gherkin
tự do là thứ biến suite BDD sinh tự động thành bùn sau 3 tháng.
→ [src/steps/vocabulary.ts](src/steps/vocabulary.ts)

## 3. Sinh testcase từ tài liệu

Hai lượt gọi LLM (`claude-opus-5`), dùng chung phần document context:

1. **Pass 1 — model**: doc → screens + elements + candidate locators mỗi platform, có `weight` 0..1.
   Dùng structured output (`output_config.format` + JSON schema) nên không phải parse text tự do.
2. **Pass 2 — feature**: doc + danh sách element → file `.feature`, bị ép dùng đúng vocabulary ở (2d).

Hai chi tiết đáng chú ý trong [src/genspec/generate.ts](src/genspec/generate.ts):

- **Document context đứng đầu `system[]`, cache breakpoint đặt ở đó.** Prompt caching là so khớp
  *prefix*; nếu để instruction riêng của từng pass lên trước thì hai lần gọi có prefix khác nhau và
  cache không bao giờ được đọc. Đảo thứ tự là mất trắng phần tiết kiệm ~90% cho phần tài liệu.
- **Gherkin sinh ra được parse + bind ngay trong `npm run gen`.** Một step không khớp vocabulary là
  lỗi sinh code, và phải nổ ở đây — chứ không phải 20 phút sau trên device farm.

MCP: TestPilot không giữ credential nào. Nó chỉ cần một hàm `call(tool, args)`
([src/ingest/types.ts](src/ingest/types.ts)). Trong CI, dùng `docs/` đã export sẵn — vì fetch
Confluence live làm build hôm qua không tái lập được.

## 4. Self-healing locator (mức an toàn)

Registry giữ nhiều candidate cho mỗi element, sắp theo `weight` giảm dần:

```json
"login.submitButton": {
  "label": "Đăng nhập",
  "candidates": {
    "web": [
      { "strategy": "testId", "value": "login-submit", "weight": 0.95 },
      { "strategy": "role",   "value": "button", "name": "Đăng nhập", "weight": 0.8 },
      { "strategy": "label",  "value": "Đăng nhập", "weight": 0.6 }
    ],
    "android": [ { "strategy": "testId", "value": "login_submit", "weight": 0.95 } ]
  }
}
```

Khi candidate #1 miss, resolver rơi xuống #2. Ba cơ chế an toàn:

1. **`verifyHealedMatch`** — trước khi chấp nhận một fallback, kiểm tra text của element có khớp
   lỏng với `label` không. Đây là chốt chặn cho failure mode kinh điển của self-healing: framework
   "tự chữa" bằng cách bấm nhầm sang nút khác.
2. **Không tự sửa file.** Healing chỉ ghi telemetry. Đề xuất sửa nằm trong report kèm lý do và số
   lần heal — người review quyết định.
3. **Ngưỡng.** Heal 1 lần thường là race condition. Heal *mọi lần resolve* mới là app team đã đổi
   testId — chỉ trường hợp thứ hai mới đáng làm phiền người.

→ [src/flaky/detector.ts](src/flaky/detector.ts) (`collectHealSuggestions`)

## 5. Flaky: là thuộc tính của lịch sử, không phải của một lần chạy

Một build đỏ chẳng nói lên gì. Cùng một scenario đỏ 3/40 lần trên cùng dải commit mới là flaky.
`FlakeDetector` giữ cửa sổ trượt 30 lần chạy trên đĩa (`registry/flake.json`), key theo
`scenario::platform::device` — vì một scenario có thể flaky trên Pixel 7 và ổn định trên iPhone.

Ba trạng thái, và việc **tách bạch chúng** mới là điểm chính:

| | Điều kiện | Xử lý |
|---|---|---|
| `passed` | lần đầu xanh | — |
| `flaky` | xanh–đỏ lẫn lộn trong cửa sổ, tỉ lệ ≥ 15% | quarantine khỏi suite chặn build |
| `failed` (broken) | đỏ ≥ 95% | **không** quarantine — đây là bug thật |

Gộp flaky với failed là cách nhanh nhất khiến cả team bỏ qua toàn bộ suite.

## 6. Chạy ở đâu

| | Web | Native |
|---|---|---|
| Driver | Playwright (`chromium`) | WebdriverIO + Appium 2 |
| Hạ tầng | local / EC2 / BrowserStack | **AWS Device Farm** |
| Gói lên farm | — | `npm run farm:bundle` → zip `dist/ + features/ + registry/` (bỏ playwright, ~300MB) |
| Điều khiển | `npm run run:web` | `npm run farm` (upload + schedule + chờ verdict) |

Trên Device Farm, Appium server do farm tự khởi động; `farm/testspec.yml` chỉ chờ nó lên rồi
`node dist/cli/run.js --platform $DEVICEFARM_DEVICE_PLATFORM_NAME --on-farm`. Cờ `--on-farm` bỏ
capability `app` — farm đã cài app rồi, truyền thêm sẽ lỗi.

`isIdle()` trên native không có `networkidle`: nó băm page source hai lần liên tiếp và so sánh.
Rẻ, và bắt đúng nguyên nhân flaky phổ biến nhất — assert vào giữa một transition.

## 7. Bắt đầu

```bash
cd /Users/tuoiha17/projects/testpilot
npm install
npx playwright install chromium
cp testpilot.config.example.json testpilot.config.json   # sửa baseUrl, appPackage, ARN
mkdir -p docs && cp <tài-liệu>.md docs/                  # hoặc cấu hình "mcp"
export ANTHROPIC_API_KEY=...

npm run gen        # docs -> registry/elements.json + features/*.feature
npm run run:web    # chạy web, ra reports/web/index.html
npm run farm:bundle && npm run farm   # chạy native trên Device Farm

npm run ui         # bảng điều khiển ở http://localhost:4300
```

## 8. Bảng điều khiển (Horus / Scenario Studio)

`npm run ui` mở một `node:http` server không framework, không bundler. Nó ghi
đúng cái `testpilot.config.json` mà CLI đọc, nên mọi thứ cấu hình trong trình
duyệt đều chạy lại được từ terminal và review được trong diff.

Điểm đáng nói:

- **Pipeline chỉ có một bản.** `src/genspec/pipeline.ts` là nơi duy nhất chứa
  luồng docs → registry → .feature → bind. CLI và UI cùng gọi nó, nên chạy từ
  trình duyệt và chạy từ terminal không thể lệch nhau.
- **Stage thay cho một trạng thái.** Mỗi workflow lưu 7 stage
  (`GEN_STAGES`). Sau một lần fail, câu hỏi có ích không phải "fail hay không"
  mà là "đi được tới đâu": 3/7 nghĩa là chưa kịp sinh Gherkin, 6/7 nghĩa là sinh
  xong và chết ở bước bind. Cột "Stages" trong *My Recent Scenarios* đọc đúng số đó.
- **Mật khẩu không nằm trong config.** `testpilot.config.json` để commit và để
  đọc trong container Device Farm; một mật khẩu ở đó là mật khẩu nằm trong git
  vĩnh viễn. Chúng đi vào `.testpilot.secrets.json` (gitignore, chmod 600), và
  server chỉ trả về cho trình duyệt một cờ `hasPassword`, không bao giờ trả giá trị.
- **Gherkin dùng placeholder.** LLM được yêu cầu viết
  `{{account.maker.password}}` chứ không viết giá trị thật; executor thay ở thời
  điểm chạy. Nhờ vậy file `.feature` commit được, và đổi mật khẩu SIT không phải
  sửa test. Thông báo lỗi của `assertText` cố ý in lại chuỗi *chưa* thay thế để
  secret không rơi vào report HTML.
- **Tab Device Farm.** Chọn region → project → hệ điều hành → device pool, hoặc
  tự lọc thiết bị rồi tạo pool mới (`CreateDevicePool` với rule `ARN IN [...]`,
  ghim đúng máy đã chọn — pool theo rule sẽ âm thầm đổi thành viên khi AWS thanh
  lý phần cứng). Upload `.apk`/`.ipa` thẳng từ trình duyệt, đặt biến môi trường,
  giới hạn phút mỗi job, bật/tắt quay video, rồi chạy và xem log stream về.
  Không có ô nhập AWS key: server dùng credential chain mặc định của SDK, key
  không đi qua trình duyệt.
- **Biến môi trường chèn vào testspec.** `farm/testspec.yml` trong repo không có
  block env, vì mỗi team cần thứ khác nhau. Lúc chạy, các biến đã cấu hình được
  chèn thành `export` ở đầu phase `test` (một bản tạm trong tmp, có quote theo
  POSIX sh). Không cấu hình biến nào thì file gốc được upload nguyên văn.
- **Sidebar theo đúng design.** Các mục chưa có gì đứng sau (DB Sources,
  Repositories, Team Configs, Zephyr, Job Management, History gộp) vẫn hiện đúng
  thứ tự nhưng dẫn tới một trang nói rõ là chưa nối — dễ hiểu hơn là link chết
  hoặc là ẩn đi.

## 9. App hybrid (Capacitor / Cordova / Ionic)

Giả định ban đầu của tài liệu này — app native — sai với một lớp app khá phổ
biến. TCInvest là app Capacitor: toàn bộ giao diện là một trang web chạy trong
WebView, nên dưới mắt Appium cả màn hình chỉ là một node
`android.webkit.WebView`. Locator native (`~content-desc`,
`UiSelector().className(...)`) không chạm được vào cái gì bên trong.

Bật `android.hybrid` / `ios.hybrid` thì driver:

- Sau `start()` và mỗi `launch()`, chờ context `WEBVIEW_*` xuất hiện rồi
  `switchContext` vào đó. `launch()` xoá handle cũ trước, vì kích hoạt lại app
  dựng WebView mới.
- Dịch locator sang DOM bằng `domSelector()` — **bám sát cách web.ts gọi
  Playwright**, vì cùng một element registry chạy cả hai. `testId` →
  `[data-testid=...]`, `role` → role tường minh hoặc tag ngụ ý nó, `label` →
  aria-label rồi mới tới text. Nhánh text bị giới hạn ở node lá; không có
  `not(*)` thì mọi tổ tiên tới `<body>` đều "chứa" chuỗi đó.
- Gọi `chromedriverAutodownload` để Appium tự lấy chromedriver khớp WebView.
- Chạy gesture native (`mobile: *Gesture`, phím back) qua `asNative()` — tạm
  chuyển về `NATIVE_APP` rồi quay lại. Element id **không** dùng chéo context
  được, nên long-press trong WebView đi bằng W3C pointer actions, còn cuộn thì
  bằng JS thay vì fling native.
- Chụp màn hình luôn ở context native: chromedriver chỉ chụp phần web, mà đúng
  cái ảnh cần để hiểu lỗi lại thường là ảnh có hộp thoại quyền native đè lên.
- `find()` bắt lỗi mất context (WebView điều hướng hoặc reload) và lấy lại
  context thay vì để hỏng cả scenario.

**Điều kiện tiên quyết không nằm ở code:** Appium chỉ nhìn thấy WebView nếu app
bật `setWebContentsDebuggingEnabled(true)` (Android) hoặc `isInspectable`
(iOS 16.4+). Bản release thường tắt. Thông báo lỗi khi không tìm thấy context
nói thẳng điều này, vì đây mới là nguyên nhân thật, không phải chờ chưa đủ lâu.

## 10. Còn thiếu (cố ý)

- **Test data / auth fixture** — chưa có. Sẽ cần trước khi scenario thứ hai xuất hiện.
- **Vision pass cho Figma** — hiện chỉ đọc tên layer. Ảnh màn hình cần một lượt vision riêng.
- **Sharding** — hiện chạy tuần tự một device. Song song hoá theo device pool là bước sau.
- **Visual regression** — screenshot mới chỉ dùng để debug, chưa so sánh baseline.
