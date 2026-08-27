# TestPilot

Tài liệu nghiệp vụ → testcase Gherkin → chạy thật trên **web (Playwright)** và **native/hybrid
(Appium + AWS Device Farm)** → tự heal locator → chẩn đoán lỗi → phát hiện flaky → report.

Một bộ `.feature` duy nhất, hai driver phía dưới. Test viết bằng **ý định** (`I tap "Nút đăng nhập"`),
selector nằm trong registry (data) chứ không nằm trong test (code) — đó là điều kiện cần để cùng một
scenario chạy được cả web lẫn mobile, và để healing có chỗ mà sửa.

> Chi tiết kiến trúc và các quyết định thiết kế: [ARCHITECTURE.md](ARCHITECTURE.md).
> Hướng dẫn AWS Device Farm (IAM, SSO, chi phí): [farm/README.md](farm/README.md).

---

## 1. Luồng tổng thể

```
Confluence / Figma / docs/     ──MCP hoặc file──►  SourceDoc
                                                      │
                              (LLM pass 1)            ├──►  registry/elements.json   ← element + N locator/platform
                                                      │
                              (LLM pass 2)            └──►  features/*.feature       ← Gherkin, vocabulary đóng
                                                                    │
                                                          parse + bind               ← sai 1 step = fail ngay, 0đ chi phí
                                                                    │
                                                          ScenarioSpec (Intent[])
                                              ┌─────────────────────┴─────────────────────┐
                                        WebUiDriver                              NativeUiDriver
                                        (Playwright)                        (WebdriverIO + Appium 2)
                                              └─────────────────────┬─────────────────────┘
                                                          ElementDiscovery            ← known locator → deterministic → AI → vision
                                                                    │
                                                          Resolver                    ← auto-wait trên *element*, không phải selector
                                                                    │
                                                          Executor                    ← retry, screenshot, phân loại lỗi
                                                                    │
                                              HealingOrchestrator ─ FailureDiagnosis ─ FlakeDetector
                                                                    │
                                                          reports/**/index.html
```

## 2. Bắt đầu nhanh

```bash
npm install
npx playwright install chromium
cp testpilot.config.example.json testpilot.config.json   # sửa baseUrl, appPackage, farm ARN
mkdir -p docs && cp <tài-liệu>.md docs/                  # hoặc cấu hình khối "mcp" trong config
export ANTHROPIC_API_KEY=...
```

```bash
npm run ui        # build React rồi mở bảng điều khiển: http://localhost:4300
npm run ui:dev    # Vite + HMR cho phát triển giao diện: http://localhost:5173
```

`npm run ui` phục vụ đúng bundle production đã build ở `dist/ui/app`; dùng lệnh này khi
kiểm tra luồng gần với môi trường sử dụng thực tế. `ui:dev` chạy Vite, tự proxy API và
artifact về server cổng 4300 nên chỉ cần mở thêm một terminal chạy `npm run ui` (hoặc
`tsx src/ui/server.ts`) khi cần backend cục bộ.

Hoặc chạy từ terminal:

```bash
npm run gen                            # docs -> registry/elements.json + features/*.feature
npm run run:web                        # chạy web -> reports/web/index.html
npm run farm:bundle && npm run farm    # chạy native trên AWS Device Farm
```

Yêu cầu: **Node >= 20**. Native cần Appium 2 + `adb` / Xcode tuỳ platform.

## 3. Lệnh CLI

| Lệnh | Việc nó làm |
|---|---|
| `npm run gen` | Chạy pipeline sinh: docs → registry → `.feature` → bind. CLI và UI dùng **chung** `src/genspec/pipeline.ts`. |
| `npm run run:web` | Chạy suite trên Playwright (chromium). |
| `npm run run:android` / `run:ios` | Chạy suite trên máy thật/emulator qua Appium. |
| `npm run run:parallel` | Một tiến trình con mỗi device, nhiều device / cả hai platform cùng lúc; merge file dùng chung đúng một lần ở cuối. |
| `npm run crawl` | Dựng registry **từ app đang chạy** thay vì từ văn bản; merge chứ không ghi đè locator do người sửa tay. |
| `npm run locators:import` | Nạp thư viện locator sinh từ source của app. Mọi candidate vào ở trạng thái *chưa duyệt*. |
| `npm run locators:verify` | Hỏi app đang chạy xem locator trong registry có tìm thấy gì không. Read-only, **tắt** healing/AI để không che mất câu trả lời. |
| `npm run pom` | Sinh Page Object Model có kiểu từ `.feature` + registry → `generated/`. Không gọi LLM. |
| `npm run farm` | Upload + schedule + chờ verdict trên Device Farm. |
| `npm run farm:pull` | Lấy lại kết quả một run đã schedule (khi laptop mất mạng / hết token SSO giữa chừng). |
| `npm run farm:bundle` | Build + zip `dist/ + features/ + registry/` cho farm (bỏ playwright, ~300MB). |
| `npm run devices:sync` | Thêm điện thoại đang cắm vào roster `devices` trong config. Chỉ thêm, không bao giờ sửa/xoá entry cũ. |
| `npm run flake` | Xoá lịch sử flaky của một scenario. |
| `npm run show:run` / `rerender` | Xem lại / render lại report của một run đã có. |
| `npm run typecheck` · `npm test` | Typecheck và bộ test đơn vị (`node --test`). |
| `npm run ui:lint` · `npm run ui:typecheck` · `npm run ui:build` | Lint, typecheck, hoặc build riêng giao diện React/Vite. |
| `npm run ui:test` · `npm run ui:test:e2e` | Unit/component test (Vitest) và browser test (Playwright) của **bảng điều khiển**, tách khỏi test sản phẩm chạy bằng `run:web`. |

Cờ hay dùng của `run`: `--tag @login`, `--feature <file>`, `--env sit`, `--device <id>`,
`--headed`, `--include-quarantined`, `--reinstall`, `--on-farm`.

## 4. Bản đồ thư mục

| Đường dẫn | Nội dung |
|---|---|
| `src/genspec/` | Sinh testcase từ tài liệu (2 lượt LLM, prompt caching, coverage, reconcile). `pipeline.ts` là bản duy nhất của luồng gen. |
| `src/ingest/` | Đọc nguồn: file local, Confluence/Figma qua MCP, media, strip HTML. TestPilot **không giữ credential** — chỉ cần một hàm `call(tool, args)`. |
| `src/steps/` | Vocabulary đóng (hơn 30 mẫu step), binding Gherkin → `Intent[]`, normalizer, scenario plan. |
| `src/core/` | `types.ts` (Intent), registry, secrets, history, run store, taxonomy tag, chất lượng locator, preflight. |
| `src/drivers/` | `web.ts` (Playwright), `native.ts` (Appium), `WebViewCdpDriver`, popup interceptor, date picker, accessible name. |
| `src/discovery/` | Pipeline tìm element: known locator → deterministic match → cổng ambiguity → cổng an toàn thao tác → verify. AI (`ai/`) và MCP (`mcp/`) là adapter tách riêng, chỉ gọi khi pipeline deterministic trả `failed`. |
| `src/runtime/` | `resolver.ts` (auto-wait, fallback candidate), `executor.ts` (retry, artifact), capabilities. |
| `src/execution/` | Chuẩn hoá lỗi, retry policy, thu artifact, anti-regression guard, healing orchestrator. |
| `src/healing/` | Heal locator và heal step, lưu telemetry vào `registry/healing.json`. |
| `src/diagnosis/` | Phân loại nguyên nhân fail: `PRODUCT_DEFECT` / `LOCATOR_FAILURE` / `AUTOMATION_DEFECT` / `TEST_DATA` / `ENVIRONMENT` / … Rule engine chạy **trước** AI. |
| `src/flaky/` | Cửa sổ trượt 30 run, key theo `scenario::platform::device`. |
| `src/report/` | Report HTML, executive report, traceability, healing report, index video. |
| `src/aws/`, `src/farm/` | Device Farm: chọn device, policy, ngân sách chi phí, lifecycle, resume run. |
| `src/pom/` | Sinh Page Object Model có kiểu (deterministic, không LLM). |
| `src/agent/`, `src/automation/` | State machine điều phối agent (analysis → test-design → gherkin → implementation → discovery → execution → diagnosis) và agent sinh automation artifact. |
| `src/ui/` + `ui/` | Server API `node:http` và bảng điều khiển React 19/Vite. `ui/src/` chứa router, panel, hook và test; bundle production ở `dist/ui/app`. |
| `src/cli/` | Front-end terminal cho từng luồng ở trên. |
| `features/` | File `.feature` (commit được — dùng placeholder cho secret). |
| `registry/` | `elements.json` (106 element / 8 screen), `flake.json`, `healing.json`, `runtime-registry.json`, `scenario-review.json`, `coverage/`. |
| `generated/` | Output của `npm run pom`: `pages/`, `tests/`, `support/`. |
| `skills/` | Skill Claude cho việc sinh/rà soát testcase TestPilot. |
| `scripts/`, `src/dev/`, `src/poc/`, `.probe/`, `artifact_work/` | Tiện ích, dev server, và các POC/scratch. |

## 5. Bốn ý tưởng cốt lõi

**(a) Intent thay cho selector.** `I tap "Nút đăng nhập"` → `{kind:'tap', element:'login.submitButton'}`.
Bộ Intent cố ý giữ nhỏ (~30 loại), mỗi loại phải diễn đạt được trên **cả** Playwright lẫn Appium và phải retry
được. Thêm một intent là quyết định kiến trúc, không phải tiện tay.
→ [src/core/types.ts](src/core/types.ts), [src/steps/vocabulary.ts](src/steps/vocabulary.ts)

**(b) Chờ trên element, không chờ trên selector.** Mỗi tick, resolver quét **lại toàn bộ** danh sách
candidate thay vì khoá vào một selector rồi đợi — nhờ vậy một step sống sót qua re-render, hydrate
muộn, hoặc testId bị đổi tên. Driver không được tự thêm implicit wait; toàn bộ việc chờ nằm đúng một chỗ.
→ [src/runtime/resolver.ts](src/runtime/resolver.ts)

**(c) Không giữ element handle.** Handle chỉ sống trong một action; trước mỗi thao tác đều find lại →
không có stale element exception. → [src/drivers/driver.ts](src/drivers/driver.ts)

**(d) Healing có chốt chặn.** Registry giữ nhiều candidate xếp theo `weight`; candidate #1 miss thì rơi
xuống #2. Ba lớp an toàn: `verifyHealedMatch` (khớp lỏng text với `label` trước khi chấp nhận — chặn
đúng failure mode kinh điển là "tự chữa" bằng cách bấm nhầm nút khác); **không tự sửa file** (healing
chỉ ghi telemetry, đề xuất nằm trong report để người review quyết); và ngưỡng (heal 1 lần là race
condition, heal *mọi lần* mới là app đã đổi testId).

## 6. Flaky là thuộc tính của lịch sử

Một build đỏ không nói lên gì. Cùng scenario đỏ 3/40 lần trên cùng dải commit mới là flaky.

| Trạng thái | Điều kiện | Xử lý |
|---|---|---|
| `passed` | lần đầu xanh | — |
| `flaky` | xanh–đỏ lẫn lộn trong cửa sổ, tỉ lệ ≥ 15% | quarantine khỏi suite chặn build |
| `failed` (broken) | đỏ ≥ 95% | **không** quarantine — đây là bug thật |

Gộp flaky với failed là cách nhanh nhất khiến cả team bỏ qua toàn bộ suite.

## 7. Cấu hình & secret

- `testpilot.config.json` (**gitignore**) — sinh từ `testpilot.config.example.json`. UI ghi đúng file
  này, nên mọi thứ cấu hình trong trình duyệt đều chạy lại được từ terminal và review được trong diff.
  Schema đầy đủ ở [src/config.ts](src/config.ts) (zod): `web`, `android`, `ios`, `devices`, `paths`,
  `resolve`, `executor`, `flake`, `discovery`, `llm`, `farm`, `environments`, `accounts`, `mcp`.
- **Mật khẩu không nằm trong config.** Config được commit và được đọc trong container Device Farm; một
  mật khẩu ở đó là mật khẩu nằm trong git vĩnh viễn. Secret đi vào `.testpilot.secrets.json`
  (gitignore, chmod 600); server chỉ trả về cho trình duyệt cờ `hasPassword`, không bao giờ trả giá trị.
- **Gherkin dùng placeholder**: `{{account.tcbs.password}}`, executor thay lúc chạy. Nhờ vậy `.feature`
  commit được và đổi mật khẩu SIT không phải sửa test. Thông báo lỗi của `assertText` cố ý in lại chuỗi
  *chưa* thay thế để secret không rơi vào report HTML.
- **Nhiều environment.** Khối `environments` khai báo prod/sit/…; `--env <tên>` chọn một, `applyEnv()`
  áp baseUrl / app / account tương ứng vào lúc chạy.

## 8. Bảng điều khiển React (`npm run ui`)

Bảng điều khiển là một React 19 SPA (TanStack Router/Query, Tailwind) do server `node:http`
cùng repo phục vụ trên cổng `4300` (`TESTPILOT_UI_PORT` để đổi). API `/api/*`, report và
artifact vẫn ở cùng origin; deep link như `/scenarios` hoặc `/farm/<run-id>` được server trả
lại `index.html` để React định tuyến. `index.html` không cache, còn bundle đã hash trong
`/assets/` được cache dài hạn.

Các trang đã có thể dùng:

| Đường dẫn | Chức năng |
|---|---|
| `/` | Dashboard: tổng quan workflow, run và trạng thái cấu hình. |
| `/studio` | App Automation Studio: nguồn tài liệu, environment, account (mật khẩu không đọc lại), model và chạy workflow sinh testcase. |
| `/scenarios` · `/scenarios/history` | Duyệt/sửa `.feature`, lọc bằng URL, duyệt hàng loạt và xem lịch sử testcase. |
| `/healing` | Xem và duyệt đề xuất locator healing. |
| `/builds` | Kiểm tra, tải lên hoặc thay thế `.apk`/`.ipa` theo environment. |
| `/runner` · `/runner/history` | Chạy web/Android/iOS ở local, theo dõi log, dừng run và mở report lịch sử. |
| `/farm` · `/farm/<run-id>` | Kiểm tra AWS credential, chọn/tạo device pool, cấu hình và theo dõi AWS Device Farm. |
| `/settings` | Cấu hình cá nhân, model key và kết nối nguồn. |

Sidebar vẫn hiển thị các mục sản phẩm chưa được TestPilot hỗ trợ (DB Sources, Repositories,
Team Configs, Zephyr, Job Management và Gen History gộp). Chúng dẫn đến trang giải thích rõ
phạm vi thay vì tạo cảm giác đã có tích hợp.

Điểm vận hành cần biết:

- **Stage thay cho một trạng thái.** Mỗi workflow lưu 7 stage. Sau một lần fail, câu hỏi có ích không
  phải "fail hay không" mà là "đi được tới đâu": 3/7 = chưa kịp sinh Gherkin, 6/7 = sinh xong và chết ở
  bước bind.
- **Log streaming không mất khi đổi trang.** Các job `POST` stream (workflow, local runner, Device
  Farm, AWS login) được giữ trong store dùng chung; panel chỉ subscribe nên điều hướng không abort job.
  Log có giới hạn bộ đệm để một farm run dài không làm trình duyệt chậm dần.
- **Cùng một nguồn dữ liệu.** React gọi chính các route `/api/*` mà CLI dùng, và ghi lại
  `testpilot.config.json`/secret store qua server. UI không tạo một config hoặc credential store thứ hai.
- **Tab Device Farm.** Chọn region → project → OS → device pool, hoặc tự lọc thiết bị rồi tạo pool mới
  (ghim đúng ARN đã chọn — pool theo rule sẽ âm thầm đổi thành viên khi AWS thanh lý phần cứng). Upload
  `.apk`/`.ipa` thẳng từ trình duyệt, đặt biến môi trường, giới hạn phút mỗi job, xem log stream.
  **Không có ô nhập AWS key** — server dùng credential chain mặc định của SDK.

### Phát triển giao diện

```bash
# terminal 1: API + bundle production, cổng 4300
npm run ui

# terminal 2: Vite HMR, cổng 5173; /api, /runs, /reports và /artifacts proxy về 4300
npm run ui:dev

npm run ui:lint
npm run ui:test
npm run ui:test:e2e
npm run ui:build
```

`ui:test:e2e` kiểm tra bảng điều khiển bằng Playwright với API giả lập, không phải lệnh chạy testcase
của sản phẩm và không tiêu tốn phút AWS Device Farm. Một farm run thật chỉ nên khởi động khi đã có
AWS credential và được chấp nhận chi phí.

## 9. App hybrid (Capacitor / Cordova / Ionic)

Với app Capacitor, dưới mắt Appium cả màn hình chỉ là một node `android.webkit.WebView` — locator
native không chạm được vào gì bên trong. Bật `android.hybrid` / `ios.hybrid` thì driver tự chờ context
`WEBVIEW_*`, `switchContext`, dịch locator sang DOM bằng `domSelector()` (bám sát cách `web.ts` gọi
Playwright, vì cùng một registry chạy cả hai), và chạy gesture native qua `asNative()`.

**Điều kiện tiên quyết không nằm ở code:** app phải bật `setWebContentsDebuggingEnabled(true)` (Android)
hoặc `isInspectable` (iOS 16.4+). Bản release thường tắt — thông báo lỗi nói thẳng điều này vì đây mới
là nguyên nhân thật, không phải chờ chưa đủ lâu.

## 10. Chạy ở đâu

| | Web | Native |
|---|---|---|
| Driver | Playwright (`chromium`) | WebdriverIO + Appium 2 |
| Hạ tầng | local / EC2 / BrowserStack | **AWS Device Farm** (chỉ có endpoint `us-west-2`) |
| Điều khiển | `npm run run:web` | `npm run farm:bundle && npm run farm` |

Device Farm **không** chạy Playwright (chỉ nhận Appium / XCUITest / Espresso; phần desktop-browser là
Selenium-only), và Playwright **không** bắt được element của app native. Đó là toàn bộ lý do tồn tại của
tầng `Intent`.

## 11. Test

```bash
npm run typecheck
npm test                # test đơn vị backend qua node --test
npm run ui:test         # unit/component test React (Vitest)
npm run ui:test:e2e     # browser test React (Playwright)
npm run ui:lint         # lint giao diện
```

## 12. Còn thiếu (cố ý)

- **Test data / auth fixture** — chưa có.
- **Vision pass cho Figma** — hiện chỉ đọc tên layer; ảnh màn hình cần một lượt vision riêng.
- **Visual regression** — screenshot mới chỉ dùng để debug, chưa so baseline.
- **Dọn dẹp** — `scratch-trace.ts`, `artifact_work/`, `.probe/`, `src/poc/` và
  `testpilot.config.json.bak-194030` là scratch/POC, không thuộc luồng chạy chính.
