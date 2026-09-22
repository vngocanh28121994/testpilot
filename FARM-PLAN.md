# TestPilot Farm — kế hoạch triển khai

Kiến trúc mục tiêu: [FARM-ARCHITECTURE.md](FARM-ARCHITECTURE.md).
Tài liệu này là **việc phải làm, theo thứ tự, gắn với file thật**.

## Nguyên tắc xuyên suốt

1. **Bản local không được vỡ, một ngày nào cũng không.** Sau mỗi giai đoạn, các lệnh sau vẫn phải
   chạy được trên máy không mạng: `npm run ui`, `npm run gen`, `npm run run:web`,
   `npm run run:android`, `npm test`, `npm run typecheck`.
2. **Mỗi giai đoạn tự đứng được.** Dừng ở cuối bất kỳ giai đoạn nào cũng phải có một hệ thống dùng
   được, không phải một công trình dở.
3. **Tách trước, tính năng sau.** Việc tách `server.ts` là thuần cơ học và không đổi hành vi. Đừng
   trộn nó với việc thêm hàng đợi.
4. **Không sửa tầng test.** `runtime/`, `drivers/`, `discovery/`, `healing/`, `genspec/` chỉ được
   sửa khi thật sự buộc phải. Phần giá trị nhất của project không nên bị lôi vào việc này.
5. **Mỗi task có một bài test là điều kiện hoàn thành.** `npm test` quét bằng glob
   (`src/**/!(*.integration).test.ts`) từ 2026-09-21, nên thêm file test là đủ — không phải sửa
   `package.json` nữa.

---

## Bức tranh các giai đoạn

| GĐ | Tên | Kết quả dùng được | Ước lượng |
|---|---|---|---|
| P0 | Chốt hợp đồng và khung | Chưa đổi hành vi; đã có `src/protocol`, DB schema, lớp repository | 3–5 ngày |
| P1 | Tách control plane và runner | `npm run ui` chạy qua kiến trúc mới ở chế độ embedded | 8–12 ngày |
| P2 | Đăng nhập, nhiều người dùng, lưu trữ | Mở được ra domain, an toàn, dữ liệu trong DB, artifact trên S3 | 8–12 ngày |
| P3 | Hàng đợi và giữ chỗ thiết bị | **Mini device farm** với runner lab | 8–12 ngày |
| P4 | Runner cá nhân từ xa | Người dùng cắm máy vào laptop của mình vẫn dùng được | 6–8 ngày |
| P5 | Nhiều tổ chức | `org_id`, quota, audit, secrets theo tổ chức | 5–8 ngày |
| P6 | Mạng theo tổ chức | proxy/gnirehtet/connector | tính sau |

Tổng phần cốt lõi (P0–P4): khoảng **6–8 tuần** cho một người làm liên tục.

---

# P0 — Chốt hợp đồng và khung (3–5 ngày) ✅ XONG 2026-09-21

Không đổi một hành vi nào. Mục tiêu là sau P0, P1 chỉ còn là việc chuyển code.

| Task | Kết quả |
|---|---|
| P0.1 | `src/protocol/` — `messages.ts`, `version.ts` |
| P0.2 | `src/server/db/repo.ts` + `fileRepo.ts`, 10 test parity |
| P0.2b | `src/core/stores.ts` — 13 store, 7 test |
| P0.3 | `migrations/0001_init.sql`, `dialect.ts`, `migrate.ts`, 11 test trên SQLite thật |
| P0.4 | [FARM-ROUTE-MAP.md](FARM-ROUTE-MAP.md) — 52 route |

Nhân tiện trả nợ `scripts.test`: từ 149 đường dẫn chép tay sang glob, và phát hiện 29 file test
chưa bao giờ được chạy. Số test mỗi lần chạy: 1281 → 1412.

### P0.1 `src/protocol/` — kiểu dữ liệu dùng chung
- Tạo `src/protocol/messages.ts`: `RunnerHello`, `DeviceReport`, `Heartbeat`, `JobSpec`, `JobEvent`,
  `JobResult`, `LeaseRenew`, `JobOffer`, `JobCancel`, `SecretGrant`, `ConfigPush`, `UpgradeRequired`.
- Tạo `src/protocol/version.ts`: `PROTOCOL_VERSION = '1.0.0'` và `isCompatible(server, runner)`.
- `JobSpec` phải phủ được **đúng** những gì `POST /api/run` đang nhận
  ([src/ui/server.ts:544](src/ui/server.ts)): `platform`, `tag`, `headed`, `includeQuarantined`,
  `devices[]` (dạng `platform:id`), `env`, `appSource`. Cộng thêm `orgId`, `jobId`, `timeoutMs`,
  `snapshot` (feature + registry), `network` (chừa chỗ cho P6).
- **Xong khi:** `src/protocol/__tests__/jobSpecCoversRunApi.test.ts` khẳng định mọi trường của body
  `POST /api/run` hiện tại đều có chỗ trong `JobSpec`.

### P0.2 Lớp repository, chưa đổi nơi lưu
- Tạo `src/server/db/repo.ts` định nghĩa các interface: `RegistryRepo`, `JobRepo`, `RunnerRepo`,
  `DeviceRepo`, `ArtifactRepo`, `OrgRepo`.
- Hiện thực đầu tiên là **file JSON đang dùng**: `src/server/db/fileRepo.ts` bọc quanh
  `Registry` ([src/core/registry.ts](src/core/registry.ts)),
  `History` ([src/core/history.ts](src/core/history.ts)),
  `runstore` ([src/core/runstore.ts](src/core/runstore.ts)).
- **Xong khi:** `src/server/db/__tests__/fileRepoParity.test.ts` chứng minh đọc/ghi qua repo cho ra
  đúng kết quả như gọi trực tiếp các class cũ.

### P0.2b Phân loại registry: dùng chung và của riêng thiết bị
- Lập bảng phân loại theo mục 4b của tài liệu kiến trúc, và **đánh dấu ngay trong code**: mỗi store
  khai báo `scope: 'shared' | 'device'`.
- Dùng chung: `elements.json`, `features/*.feature`, `feature-sources.json`, `scenario-review.json`,
  `known-issues.json`, `actions.json`.
- Của riêng thiết bị, không bao giờ đồng bộ lên: `runtime-registry.json`, `device-env.json`.
- Sổ sự kiện, phải chuyển sang append/cộng dồn ở P2.4: `healing.json`, `flake.json`.
- **Xong khi:** `src/core/__tests__/registryScope.test.ts` — mọi store đều khai báo `scope`, và một
  store mới không khai báo thì test fail.

### P0.3 Schema SQL và migration
- `src/server/db/migrations/0001_init.sql` theo mục 4 của tài liệu kiến trúc.
- Chọn công cụ migration nhẹ (`node-pg-migrate` hoặc tự viết runner đọc thư mục `migrations/`).
- **Xong khi:** migration chạy được trên Postgres và SQLite (khác biệt cú pháp cô lập trong một file).

### P0.4 Bản đồ chia route
- Lập bảng: mỗi `case` trong `handle()` (khoảng 55 route, [src/ui/server.ts:228](src/ui/server.ts)
  trở đi) thuộc về **control plane** hay **runner**, và sẽ nằm ở file nào.
- Ghi bảng này vào `FARM-ROUTE-MAP.md`. Nó là danh sách công việc của P1, không phải tài liệu để đọc.
- Phân loại sơ bộ:
  - **Runner:** `prereq/*` (8 route), `builds/source`, `app/upload`, `run`, `run/stop`,
    `farm/run`, `farm/pull`, `aws/login`.
  - **Control plane:** `state`, `config`, `history`, `healing*`, `feature*`, `studio/save`,
    `workflow/*`, `gen`, `vocabulary`, `actions*`, `models`, `model-key`, `confluence-auth`,
    `run/active`, `run/attach`, `run/log`, `farm/projects|pools|devices|pool`.

---

# P1 — Tách control plane và runner (8–12 ngày)

Đây là giai đoạn nặng nhất và cũng là giai đoạn ít rủi ro nhất nếu làm đúng: **không thêm tính
năng nào**. Kết thúc P1, `npm run ui` vẫn cho ra trải nghiệm y như hôm nay, nhưng bên trong đã là
hai thành phần.

### P1.1 Dựng `src/server/http.ts`
- Chuyển phần khởi tạo server, bảng route và các helper (`json`, `readJson`, `stream`, `MIME`,
  phục vụ file tĩnh) từ `src/ui/server.ts` sang.
- Thêm cờ `mode: 'embedded' | 'server'` đọc từ biến môi trường `TESTPILOT_MODE`.
- Giữ nguyên `stream()` và định dạng SSE hai kênh `log`/`run`, để
  [ui/src/lib/streamJob.ts](ui/src/lib/streamJob.ts) không phải sửa.
- **Xong khi:** `npm run ui` khởi động qua file mới; test hiện có
  `src/ui/__tests__/statePayload.test.ts` và `activeRuns.test.ts` vẫn xanh.

### P1.2 Tách route theo miền
Chia `handle()` thành các file trong `src/server/routes/`, mỗi file dưới 400 dòng:
`state.ts`, `config.ts`, `feature.ts`, `registry.ts`, `healing.ts`, `workflow.ts`, `gen.ts`,
`run.ts`, `report.ts`, `device.ts`, `prereq.ts`, `farm.ts`, `admin.ts`.
- Làm **từng file một, mỗi file một commit**, chạy `npm run typecheck` và `npm test` sau mỗi bước.
- Không đổi đường dẫn URL, không đổi hình dạng response. `src/ui/contracts.ts` là hợp đồng, giữ nguyên.
- **Xong khi:** `src/ui/server.ts` không còn route nào, chỉ còn là shim gọi `src/server/http.ts`.

### P1.3 Dựng `src/runner/`
- `src/runner/prereq.ts`: chuyển toàn bộ hàm `prereqAppium`, `prereqAdb`, `prereqXcode`,
  `iosDevices`, `openIosTunnel` ([src/ui/server.ts:4062](src/ui/server.ts)), `openIosSettings`,
  `installDriver` ra khỏi server.
- `src/runner/devices.ts`: gộp `attachedDevices`, `iosDevices`, `parseDeviceToken`, `isNamedDevice`.
- `src/runner/execute.ts`: gọi `runSuite` / `runSuiteParallel` như hiện nay, nhưng nhận `JobSpec` và
  phát `JobEvent`.
- `src/runner/sandbox.ts`: bảng `kind` job được phép, kiểm tra tham số. Từ chối mọi thứ ngoài bảng.
- **Xong khi:** `grep -n "child_process" src/server/` không có kết quả nào.

### P1.4 Transport hai chế độ
- `src/runner/transport.ts` có hai hiện thực cùng một interface:
  - `InProcessTransport` — gọi hàm trực tiếp, dùng cho `embedded`;
  - `WebSocketTransport` — dùng cho `lab`, `personal` (hiện thực ở P3/P4, P1 chỉ cần khung).
- `src/server/relay.ts` biết chuyển `JobEvent` từ runner thành khung SSE, và ghi vào `job_event`.
- **Xong khi:** `src/runner/__tests__/inProcessRoundtrip.test.ts` chạy một job giả từ API tới runner
  và nhận lại log đúng thứ tự `seq`.

### P1.5 Bền hoá log của lượt chạy
- `src/ui/activeRuns.ts` chuyển thành `JobEventRepo`: log ghi vào store thay vì chỉ RAM và `log.txt`.
- `GET /api/run/attach` nhận thêm `since=<seq>`.
- **Xong khi:** đang chạy một lượt, restart server, mở lại UI thì **log cũ hiện lại và lượt chạy
  không bị mất** (job vẫn chạy ở runner). Viết `src/server/__tests__/attachResume.test.ts`.

### Rủi ro của P1
- `server.ts` khoảng 5.200 dòng, nhiều hàm dùng chung `CONFIG_FILE` và state ở cấp module. Cần đưa
  vào một object `ServerContext` truyền xuống, đừng dùng biến toàn cục.
- Dễ mắc lỗi khi chuyển các hàm dài. Chống lại bằng cách commit nhỏ và giữ hợp đồng
  `src/ui/contracts.ts` bất động — nó chính là bộ test tương thích.

---

# P2 — Đăng nhập, nhiều người dùng, lưu trữ (8–12 ngày)

Sau giai đoạn này mới được phép mở ra domain.

### P2.1 Xác thực
- `src/server/auth/oidc.ts`: OIDC authorization code + PKCE (Google Workspace hoặc Azure AD).
- Session cookie `HttpOnly` `Secure` `SameSite=Lax`, lưu trong DB, có hạn và có đường thu hồi.
- Middleware chặn **toàn bộ** `/api/*` trừ `/api/health` và đường dẫn đăng nhập.
- Chế độ `embedded` bỏ qua middleware, người dùng là `local`.
- **Xong khi:** `src/server/auth/__tests__/allRoutesGuarded.test.ts` liệt kê bảng route và fail nếu
  có route mới nào không khai báo quyền. Bài test này là cái chặn hồi quy quan trọng nhất của P2.

### P2.2 RBAC
- Bốn vai: `admin`, `maintainer`, `runner_user`, `viewer`.
- Khai báo quyền ngay cạnh định nghĩa route, không nằm ở file rời.
- **Xong khi:** `viewer` bị 403 khi gọi `POST /api/run`; `runner_user` bị 403 khi gọi
  `POST /api/feature/review`.

### P2.3 Secrets
- `src/server/auth/secrets.ts` đọc secret theo tổ chức từ backend (AWS Secrets Manager, hoặc
  Postgres có mã hoá cho bản tự host).
- API không bao giờ trả secret; chỉ trả boolean "đã có" như `src/core/secrets.ts` đang làm.
- Bỏ `process.env.CONFLUENCE_API_TOKEN = token` ([src/ui/server.ts:307](src/ui/server.ts)) — ghi vào
  `process.env` của web server là biến một token của một người thành token của cả hệ thống.
- **Xong khi:** hai tổ chức cấu hình hai key khác nhau, log và SSE không chứa key nào. Viết test
  quét toàn bộ khung SSE của một job tìm chuỗi bí mật.

### P2.4 Chuyển dữ liệu sang DB
- Hiện thực `pgRepo.ts` cho các interface ở P0.2.
- Script `scripts/migrate-json-to-db.ts` nhập `registry/*.json`, `registry/history.json`,
  `runs/*/meta.json` vào DB, chạy lại được nhiều lần (idempotent).
- Mọi lệnh ghi registry đều yêu cầu `baseRevision`; lệch thì 409 kèm diff. Mở rộng cách
  `PUT /api/feature` đã làm.
- **Xong khi:** `src/server/db/__tests__/concurrentWrite.test.ts` — hai lệnh ghi song song vào cùng
  một element: một thành công, một nhận 409. Hôm nay bản thua bị mất im lặng.

### P2.4b Sổ sự kiện thay cho ghi đè
- `healing.json` → bảng append-only theo `org_id`; không còn thao tác ghi đè cả tệp.
- `flake.json` → **cộng dồn delta**, không ghi đè. Hai runner ghi đè lẫn nhau là mất số liệu và
  tính năng phát hiện flaky sẽ nói sai.
- `runtime-registry.json`, `device-env.json` ở lại máy runner, không lên DB.
- **Xong khi:** `flakeConcurrentMerge.test.ts` — hai runner báo kết quả cùng lúc, tổng số lần chạy
  bằng tổng thật, không bên nào mất số.

### P2.5 Artifact lên object storage
- `src/server/storage/s3.ts` (dùng MinIO khi tự host), upload bằng link có chữ ký do server phát.
- Report, ảnh, video, trace đi lên S3; DB chỉ giữ metadata. Bỏ giới hạn `MAX_REPORTS = 50`
  ([src/ui/server.ts:1645](src/ui/server.ts)), thay bằng retention theo tổ chức.
- Kiểm tra chống path traversal ở mọi endpoint phục vụ file.
- **Xong khi:** `src/server/storage/__tests__/pathTraversal.test.ts` xanh, và report mở được qua
  link có chữ ký hết hạn được.

### P2.6 Hạ tầng — ✅ xong 2026-09-22
- `docker-compose.yml`: Keycloak + Postgres + MinIO, một lệnh là có đủ. Realm nhập tự động từ
  `infra/keycloak/testpilot-realm.json` (client, bốn người dùng, bốn vai) nên hai máy giống nhau
  và không ai phải bấm tay trên giao diện Keycloak.
- `.env.server.example` + [infra/README.md](infra/README.md).
- **Đóng luôn một khoảng trống của P0.3:** migration giờ đã chạy THẬT trên Postgres 16, không chỉ
  trên SQLite. 16 bảng dựng đúng, `UNIQUE (device_id)` của `lease` từ chối lease thứ hai, `CHECK`
  chặn `state` sai chính tả, cột `payload` đúng kiểu `jsonb`.
- `GET /api/health`: nông thì công khai (`{"ok":true}`), `?deep=1` đòi vai `admin` — kiểm NGAY TRONG
  handler, vì một route không thể vừa công khai vừa đòi quyền ở cửa.
- `Dockerfile` hai tầng, 464 MB, chạy bằng `USER node`, `HEALTHCHECK` gọi đúng endpoint mà load
  balancer gọi. `.dockerignore` giữ `.testpilot.secrets.json` và `testpilot.config.json` ở ngoài mọi
  layer. `infra/nginx/testpilot.conf`: `proxy_buffering off`, `gzip off`, `proxy_read_timeout 3600s`
  cho SSE.
- **Ba lỗi chỉ CHẠY THẬT mới thấy**, và cả ba đều xanh ở build lẫn typecheck trước đó:
  1. `npm ci --omit=dev` chết exit 127 vì `prepare` gọi `husky` (devDependency) → `--ignore-scripts`;
  2. `tsx` nằm ở devDependencies nhưng `CMD` gọi nó → chuyển sang `dependencies`;
  3. `/app` thuộc root nên `USER node` không tạo được `.testpilot` → tạo sẵn và `chown`, kèm `VOLUME`
     cho registry/runs/artifacts.
  Hai phép đo mới trong [deployConfig.test.ts](src/server/__tests__/deployConfig.test.ts) canh (1)
  và (2); (3) thì chỉ có việc chạy container mới bắt được — nên đó là bước bắt buộc của P2.6.
- `lazyRepos`: `dispatch` dựng kho ở LỜI GỌI ĐẦU TIÊN, không ở lúc điều phối. Trước đó
  `/api/health` trong container trả về "No config at /app/.testpilot/..." — endpoint để biết tiến
  trình còn sống lại phụ thuộc vào cấu hình đã đúng, và load balancer đọc câu ấy rồi kết luận sai
  theo cả hai hướng.

---

# P3 — Hàng đợi và giữ chỗ thiết bị (14–19 ngày)

Đây là lúc hệ thống thành device farm.

**Quyết định ngày 2026-09-22 — có điều khiển thiết bị từ web.** Kéo theo P3.7, và kéo theo một
thay đổi phải làm TRƯỚC scheduler: lease mang cả người giữ, không chỉ job. Đã xong ở bước 1 (xem
P3.7). Đổi ước lượng 8–12 → 14–19 ngày.

**Đã khảo sát và KHÔNG lấy GADS.** Nó có sẵn stream màn hình và điều khiển tay, nhưng provider
đồng bộ với hub qua MongoDB nên "chỉ lấy provider" không phải một chế độ được hỗ trợ — muốn có
stream thì phải dựng cả Mongo + hub + provider, rồi bỏ không dùng hub UI (phần đóng gói kín, giấy
phép riêng) và ghép reservation của họ vào lease của ta, tức là hai nguồn sự thật cho "ai đang giữ
máy này". Nó cũng không có hàng đợi job, nên ba mục đắt nhất về nghiệp vụ (P3.1–P3.3) không được
đỡ dòng nào. STF/DeviceFarmer loại thẳng: chỉ Android, cần RethinkDB, và tài liệu của chính họ nói
giữa các tiến trình "gần như không có bảo mật". Đường được chọn cho phần video:
[ws-scrcpy](https://github.com/NetrisTV/ws-scrcpy) (MIT, chạy Node, cần `adb` — đúng hai thứ
runner đã có) cho Android, và MJPEG của WebDriverAgent cho iOS, vì `prereq.ts` vốn đã dựng và dọn
WDA. Đầu vào thì không cần ai cho: Appium/WDA theo W3C, mà webdriverio đã nói thứ tiếng đó.

### P3.1 Job queue
- Bảng `job` là nguồn sự thật. Redis (BullMQ) chỉ để đánh thức worker, không giữ trạng thái — nếu
  Redis mất, job vẫn còn.
- `POST /api/run` đổi nghĩa: **tạo job và trả `jobId`**, thay vì chạy ngay và stream. UI chuyển sang
  tạo job rồi `attach` — `streamJob()` đã hỗ trợ `method: 'GET'` cho việc nối lại
  ([ui/src/lib/streamJob.ts](ui/src/lib/streamJob.ts)).
- **Xong khi:** tạo job trong lúc không có runner nào online, job nằm `queued`; bật runner lên thì
  job tự chạy.

### P3.2 Lease manager
- **Đã có sẵn từ P3.7 bước 1:** `LeaseRepo` (hợp đồng), `MemoryLeaseRepo` (embedded) và
  `PgLeaseRepo` (server) — giữ, gia hạn, nhả, cưỡng chế nhả, thu hồi hạn. Phần còn lại của P3.2 là
  *người gọi*: scheduler lấy lease `holder_kind='job'` thay vì người, và vòng lặp chuyển job quá
  hạn sang `interrupted`.
- `src/server/scheduler/lease.ts`: lấy lease trong một transaction (`SELECT … FOR UPDATE`), TTL 60s,
  runner gia hạn mỗi 30s.
- Job nhiều thiết bị: lấy tất cả lease cùng lúc hoặc không lấy gì, để tránh chờ chéo.
- Vòng lặp thu hồi lease hết hạn → job `interrupted`, thiết bị `idle`. Tái dùng
  `closeInterruptedRuns` và `OrphanTracker`.
- **Xong khi:** `src/server/scheduler/__tests__/leaseExclusive.test.ts` — 20 job tranh 1 thiết bị,
  không bao giờ có 2 job cùng nắm; `leaseExpiry.test.ts` — runner chết, thiết bị được nhả trong 90s.

### P3.3 Ghép job với thiết bị
- `src/server/scheduler/match.ts`: lọc theo tổ chức, quyền nhìn thấy, platform, năng lực runner,
  điều kiện thiết bị (`os>=13`), tag pool.
- Công bằng: hàng đợi theo tổ chức, quota số job đồng thời, `priority`.
- **Xong khi:** `matchCapability.test.ts` — job iOS không bao giờ được gửi cho runner Linux;
  `fairness.test.ts` — một người bắn 50 job không làm người khác chờ vô hạn.

### P3.4 Runner lab chạy độc lập
- `src/runner/main.ts` + script `npm run runner`, đóng gói qua `scripts/bundle-runner.sh`
  (theo mẫu `scripts/bundle-farm.sh` đã có).
- Chạy nền bằng `launchd` (macOS) hoặc `systemd` (Linux), có log riêng và tự khởi động lại.
- `WebSocketTransport` với kết nối lại theo backoff, hàng đợi event cục bộ khi mất mạng.
- **Xong khi:** rút mạng runner 2 phút, log không mất một dòng nào sau khi nối lại. Viết
  `src/runner/__tests__/reconnectBuffer.test.ts`.

### P3.5 Màn quản lý thiết bị trên web
- Trang mới: danh sách thiết bị theo runner, trạng thái, đang chạy job nào, hàng chờ.
- Hành động: `quarantine`, `release lease`, `drain runner`, đổi `visibility`.
- Màn prereq hiện có đổi nghĩa: **báo cáo do runner gửi lên**, không phải server tự chạy `xcrun`.
- **Xong khi:** thấy được ai đang giữ thiết bị nào, và huỷ được một lease đang treo từ trên web.

### P3.6 Nối AWS Device Farm thành một runner
- Bọc `src/farm/`, `src/aws/` thành runner `mode=farm`, khai báo thiết bị ảo từ pool.
- Bỏ endpoint `POST /api/aws/login` tương tác; dùng IAM role của máy chạy runner.
- **Xong khi:** một job `run_suite` đi qua Device Farm mà UI không cần biết nó khác gì runner khác.

### P3.7 Điều khiển thiết bị từ web

Làm **sau** P3.1–P3.3, vì lease là phần dùng chung. Nhưng bước 1 phải đi TRƯỚC scheduler, vì nó đổi
lược đồ mà scheduler sẽ đọc.

**Bước 1 — lease của người — ✅ xong 2026-09-22**
- Migration `0002_human_lease.sql`: `lease.job_id` cho phép NULL, thêm `holder_kind`
  (`job` | `human`), `holder_user_id`, `org_id`. `UNIQUE (device_id)` của 0001 trở thành phép loại
  trừ cho CẢ HAI loại người giữ — một chiếc máy, một người giữ, bất kể đó là người hay job.
  Ràng buộc `lease_holder_matches` chặn dòng nói "human" mà không nói ai: một chiếc máy bị giữ bởi
  không ai thì không ai thu hồi được bằng tay.
- Bảng được **dựng lại** chứ không `ALTER COLUMN`, vì SQLite không bỏ được `NOT NULL`. Dữ liệu lease
  đang chạy được mang sang kèm `org_id` suy từ thiết bị.
- `LeaseRepo` + hai hiện thực. TTL 60s, nhịp tim 30s, thu hồi lúc ĐỌC chứ không bằng vòng lặp nền —
  nên một chiếc máy mà người giữ đã gập laptop trở lại rỗi ngay khi có người hỏi tới nó.
- Năm route (xem [FARM-ROUTE-MAP.md](FARM-ROUTE-MAP.md)) với hình dạng quyền mới: vai ở cửa,
  "ai đang giữ" ở tầng kho. `force-release` đòi `admin` **và** một lý do.
- **Đã đo:** 20 bên đòi cùng một máy trong cùng phần nghìn giây trên Postgres thật → đúng 1 thắng,
  19 nhận `LeaseTakenError` kèm tên người giữ, và bảng chỉ có 1 dòng cho chiếc máy ấy
  ([pgLease.integration.test.ts](src/server/db/__tests__/pgLease.integration.test.ts)). Cùng bộ
  khẳng định chạy lại với bản bộ nhớ, nên hai hiện thực không lệch nhau.
- **Một lỗi chỉ Postgres thấy:** đặt tên khoá chính là `lease_pkey` cho bảng mới làm cả migration
  chết với 42P07, vì bảng `lease` của 0001 vẫn giữ tên ấy ở đúng lúc đó — tên chỉ mục ở Postgres là
  toàn cục, còn SQLite không có không gian tên chung nên nó xanh. Thứ bắt được là bài test chạy
  migration trên Postgres thật.
- **Nối nốt phần P2.6 còn treo:** `src/ui/server.ts` trước đó dùng `fileRepos` ở CẢ HAI chế độ, nên
  `pgRepos` là mã chết. Giờ có `repoFactory` ([db/wiring.ts](src/server/db/wiring.ts)): embedded →
  file JSON dùng chung một kho lease trong bộ nhớ; server → `pgRepos` theo `orgId`, một pool cho cả
  tiến trình. Chế độ server mà thiếu `TESTPILOT_DATABASE_URL` thì **từ chối khởi động** — quay về
  file ở chế độ server là đường rò dữ liệu giữa các tổ chức, im lặng và không sửa được sau đó.
  Đã đo: không có DB → chết lúc khởi động kèm câu chỉ cách sửa, cổng không phục vụ gì; có DB →
  `/api/health` 200 còn ba route lease đều 401 khi chưa đăng nhập.
- **Một lỗi nữa chỉ chạy thật mới thấy:** `fileRepos()` được dựng lại ở mỗi request, nên
  `MemoryLeaseRepo` mới mỗi lần — lấy máy xong hỏi lại thì máy rỗi, và lần lấy thứ hai sinh lease
  thứ hai cho cùng chiếc máy. Mọi test đơn lẻ đều xanh vì mỗi bài dùng một repo. Đây là lần thứ hai
  cùng một lỗi (trước là `OrphanTracker` bị dựng hai bản), nên nó thành `localLeases` ở tầm module
  kèm một test dựng hai bộ repo rồi tranh nhau một chiếc máy.
- **Còn lại của bước 1:** ghi `audit_log` cho phiên điều khiển và cho mỗi lần cưỡng chế nhả. Hôm nay
  chỉ có một dòng log kèm ai thu hồi của ai; nối vào bảng cùng lúc với phần video, vì lúc ấy mới có
  chỗ xem. Và một mắt nối chỉ được đo THEO PHẦN chứ chưa đo liền mạch: route → `repoFactory` →
  `PgLeaseRepo` → Postgres, vì đầu vào cần một phiên Keycloak thật. Đo liền mạch cùng lúc với màn
  điều khiển ở bước 2.

**Bước 2 — Android: xem và chạm — ✅ phần server + runner xong 2026-09-22**
- Nguồn video là `adb exec-out screenrecord --output-format=h264`, **không phải scrcpy**. Đo trên
  emulator API 36: một khung `screencap -p` mất 1,9–2,6 giây và nặng 1,39 MB, còn năm giây
  `screenrecord` ở 720x1600 nặng 37 KB — hai mươi lần băng thông cho một phần tư số khung. Và
  `screenrecord` có sẵn trong Android, nên không phải đẩy jar nào lên máy người dùng. scrcpy là
  bước sau, nếu độ trễ thành vấn đề.
- Kênh là **SSE, không WebSocket**: 6 KB/s đo được → 8 KB/s sau base64, không thêm phụ thuộc `ws`,
  và đi qua đúng cấu hình nginx đã kiểm ở P2.6. Hai header `Upgrade`/`Connection` vẫn được thêm vào
  [testpilot.conf](infra/nginx/testpilot.conf) kèm hai phép đo, để khi đổi sang scrcpy thì không
  phải đi tìm vì sao nginx trả 400.
- `src/runner/control.ts`: một tiến trình `screenrecord` cho một chiếc máy, nhiều người xem dùng
  chung (một người mở hai tab là đủ), tự khởi động lại ở mốc 180 giây kèm sự kiện `restart` để bộ
  giải mã dựng lại. Facade lên **năm nhóm**: `RunnerControlApi` với đúng sáu việc, và
  `noDeviceAccess.test.ts` canh danh sách ấy đóng.
- Protocol lên **1.1.0** (thêm, tương thích). Danh sách phím nằm ở `src/protocol/control.ts` chứ
  không ở runner: nó là HỢP ĐỒNG, control plane kiểm để từ chối sớm và runner kiểm lại để không tin
  phía bên kia. Không có POWER/SLEEP — một cái nút trên web khoá màn hình chiếc máy ở phòng khác là
  thứ không ai gỡ được từ xa.
- Hai route (`GET /api/device/control/stream`, `POST /api/device/control/input`), và cả hai đứng
  trên cùng một câu hỏi: người gọi có đang giữ lease của chiếc máy này. Lease được kiểm **lại mỗi 5
  giây** trong lúc video đang chảy, không chỉ lúc mở — nếu chỉ kiểm lúc mở thì một tab bị bỏ quên
  vẫn xem được màn hình của người tiếp theo, và admin cưỡng chế nhả cũng không cắt được hình.
- **Đo trên emulator thật:** luồng qua HTTP ra H.264 hợp lệ (SPS+PPS+IDR, giải ngược bằng ffmpeg ra
  đúng ảnh màn hình 720x1600); chạm ở toạ độ màn hình 1080x2400 quy đổi từ khung 720 đúng vị trí;
  bấm `home` về launcher; toạ độ ngoài màn hình → 400 kèm kích thước thật; `power` → 400; `leaseId`
  cũ → 409; lease hết hạn sau 60 giây không gia hạn → 409. 13 test tích hợp trên máy thật
  ([control.integration.test.ts](src/runner/__tests__/control.integration.test.ts)) và 14 test đơn
  cho cửa lease ([controlGate.test.ts](src/server/routes/__tests__/controlGate.test.ts)).
- **Màn điều khiển trên web — ✅ xong 2026-09-22.** `/control` trong menu "Chạy và sửa". Chọn máy →
  Giữ máy → xem và chạm. Khung H.264 giải mã bằng `VideoDecoder` (WebCodecs) và vẽ lên `<canvas>`;
  chuỗi codec đọc từ chính SPS chứ không đặt cứng, vì một chuỗi đặt cứng đúng cho phần lớn máy và
  sai lặng lẽ cho máy mã hoá ở profile khác.
- Hai phần thuần được tách ra để đo được mà không cần trình duyệt:
  [h264.ts](ui/src/lib/h264.ts) ghép byte SSE thành đơn vị truy cập trọn vẹn — SSE mang về từng
  mảnh theo bộ đệm của ống `adb`, không theo ranh giới khung, và đưa nửa khung vào `VideoDecoder`
  thì nó không ném, nó vẽ hình vỡ; và [deviceScale.ts](ui/src/lib/deviceScale.ts) quy đổi toạ độ
  canvas → màn hình, chỗ mà nhầm giữa "khung 720" và "màn 1080" làm mọi cú chạm lệch đều 1,5 lần
  nên người ta đi tìm lỗi trong ứng dụng đang test.
- **Đo trong trình duyệt thật** (emulator API 36, server ở cổng 4399): chọn máy →
  "sdk_gphone64_arm64 · Android 16 · emulator"; bấm Giữ máy → video chảy, header hiện
  "1080×2400 · lease tự gia hạn mỗi 30 giây"; bấm Home → launcher; **bấm vào biểu tượng Chrome
  TRÊN CANVAS → Chrome mở trên máy**, tức là phép quy đổi toạ độ đúng; `/api/device/leases` cho
  thấy `renewedAt` đúng 30 giây sau `acquiredAt`; bấm Nhả máy → lease rỗng và số tiến trình
  `screenrecord` về 0. Không một lỗi nào trong console.
- **Lần thứ tư một phép đo mã nguồn đỏ vì chính chú thích của nó** (`effectBody.test.ts` đọc dòng
  giải thích có ví dụ `useEffect(() => () => …)`). Lần này sửa PHÉP ĐO chứ không sửa chú thích:
  `codeOnly()` lọc chú thích trước, áp cho cả ba khẳng định trong file.

**Bước 3 — iOS (≈2–3 ngày)**
- Video: MJPEG server của WebDriverAgent. Input: Appium/WDA theo W3C, qua webdriverio.
- **Xong khi:** giữ được một chiếc iPhone từ web, thấy màn hình, chạm được, và job không chen vào.

---

# P4 — Runner cá nhân từ xa (6–8 ngày)

Mục tiêu: người dùng cắm điện thoại vào laptop của mình và dùng được như hôm nay, nhưng dữ liệu về
server chung.

### P4.1 Đăng ký runner
- Web: "Thêm máy của tôi" → sinh token, hiện **một lần**, lưu hash. Có thu hồi và đổi token.
- `npx testpilot-runner login --token …` lưu token vào keychain của OS, không để trong file phẳng.
- **Xong khi:** máy thứ hai đăng ký được và thiết bị của nó hiện trên web với `visibility=private`.

### P4.2 Quyền nhìn thấy thiết bị
- `private` chỉ chủ runner thấy; có đường chia sẻ cho người khác hoặc cho cả tổ chức.
- **Xong khi:** `deviceVisibility.test.ts` — người B không tạo được job trên thiết bị private của A,
  và cũng **không thấy** nó trong danh sách.

### P4.3 Đóng gói và tự cập nhật
- Phát hành runner lên npm (nội bộ) hoặc bản cài `.pkg` cho macOS.
- Kiểm tra phiên bản giao thức lúc `hello`; lệch major thì tự tải bản mới và khởi động lại.
- **Xong khi:** nâng server lên `2.x` thì runner `1.x` tự cập nhật, không cần ai vào máy đó.

### P4.4 Đề xuất registry từ runner
- Kết quả healing và discovery gửi lên dạng `registry_proposal`, kèm `source_job_id` và bằng chứng
  (ảnh, locator cũ/mới).
- Màn duyệt: mở rộng trang healing đang có (`GET /api/healing`,
  `POST /api/healing/review` — [src/ui/server.ts:322](src/ui/server.ts)).
- Chính sách tự nhận: chỉ nhận tự động khi đã verify và đạt ngưỡng tin cậy; còn lại chờ người duyệt.
- **Xong khi:** heal trên máy cá nhân xuất hiện thành đề xuất trên web, duyệt xong thì runner lab
  dùng được locator mới.

### P4.4b Đường đi lại giữa local và server
- `testpilot registry pull` — kéo bản server về file local để làm offline.
- `testpilot registry push` — đẩy thay đổi local lên thành đề xuất, kiểm tra `revision`, xung đột thì
  in diff chứ không ghi đè.
- Không có hai lệnh này, người làm offline sẽ copy file bằng tay và dữ liệu bắt đầu lệch.
- **Xong khi:** `registryRoundtrip.test.ts` — pull, sửa offline, push, và thay đổi hiện ra thành đề
  xuất đúng nội dung; push lần hai trên bản cũ thì bị từ chối kèm diff.

### P4.5 Preflight của máy cá nhân
- Runner tự kiểm tra Xcode, Appium, adb, driver và **hiện lên web** kèm hướng dẫn sửa.
- Từ chối job kèm lý do thay vì fail giữa lượt chạy.
- **Xong khi:** máy thiếu driver `xcuitest` thì job bị từ chối ngay với thông báo nói rõ việc cần làm.

### P4.6 Nói thật về máy có thể tắt
- Thiết bị `private` mất heartbeat → `offline`; job đang chờ nó hiện rõ **"đang chờ máy của bạn
  online"**, kèm đề nghị chuyển sang thiết bị lab.
- Chặn đặt lịch chạy định kỳ trên thiết bị `private`, hoặc cảnh báo rõ khi người dùng vẫn muốn.
- Cho phép tắt quay video để giảm băng thông upload từ mạng nhà.
- **Xong khi:** tắt runner giữa lượt chạy → job thành `interrupted`, có report gián đoạn
  (`recoverInterruptedRunReports`), thiết bị được nhả trong 90s, UI nói đúng lý do.

---

# P5 — Nhiều tổ chức (5–8 ngày)

- `org_id` xuyên suốt mọi truy vấn; bài test chặn hồi quy: quét mọi hàm repo, hàm nào thiếu điều
  kiện `org_id` thì fail.
- Quota và hạn mức: số job đồng thời, phút thiết bị, chi phí LLM theo tổ chức.
- `audit_log`: ai chạy gì, trên thiết bị nào, lúc nào.
- Dọn thiết bị giữa hai tổ chức: gỡ app, xoá dữ liệu, đăng xuất, xoá clipboard, gỡ proxy/profile.
  iPhone thật khó xoá sạch Keychain, nên **mặc định dành riêng iPhone cho từng tổ chức**.
- Đo dung lượng và lưu lượng theo tổ chức.

---

# P6 — Mạng theo tổ chức (tính sau)

Chừa sẵn ở P0: `org_network_profile` và trường `network` trong `JobSpec`. Khi làm sẽ theo thứ tự:
proxy qua `adb reverse` → gnirehtet → connector (kiểu BrowserStack Local) → VLAN riêng cho lab.
Bắt buộc: **dọn cấu hình mạng sau mỗi job**, kể cả khi job bị huỷ hay runner chết.

---

## Điều kiện không được phá (kiểm tra ở cuối mỗi giai đoạn)

```bash
npm run typecheck && npm test && npm run ui:test
```

Cộng thêm một bài kiểm tra tay, ghi lại kết quả:

1. `npm run ui` trên máy không mạng → tạo feature, chạy web suite, xem report.
2. `npm run run:android` với một máy cắm USB.
3. Một lượt chạy song song hai thiết bị.
4. Restart server giữa lượt chạy → log nối lại được (từ P1.5 trở đi).

---

## Quyết định cần chốt trước khi bắt đầu

| Việc | Lựa chọn | Đề xuất |
|---|---|---|
| Nhà cung cấp SSO | Google Workspace / Azure AD / tự quản | **Chốt 2026-09-21: Keycloak để phát triển.** Code đọc issuer/clientId/secret từ biến môi trường nên đổi sang SSO công ty chỉ là đổi cấu hình. Vai lưu trong bảng `membership` của TestPilot, KHÔNG lấy từ group của SSO: xin IT tạo group mới mất vài tuần, thêm một dòng vào `membership` mất một giây |
| DB | Postgres tự host / RDS | Postgres trong Docker trước, RDS khi lên production |
| Object storage | S3 / MinIO | **Chốt 2026-09-21: MinIO.** Nói đúng API S3 nên lên AWS chỉ là đổi endpoint và khoá |
| Driver SQLite cho chế độ embedded | `node:sqlite` / `better-sqlite3` | **Chưa chốt.** `node:sqlite` có sẵn trong Node 22 nên không thêm dependency, và migration test đang chạy trên nó — nhưng nó còn là API thử nghiệm (`ExperimentalWarning`) và có thể đổi. Dùng cho test thì được; trước khi chế độ embedded ghi dữ liệu thật của người dùng lên nó thì phải quyết |
| Queue | BullMQ+Redis / chỉ dùng bảng Postgres | Chỉ Postgres ở P3 (ít thành phần hơn), thêm Redis khi thật cần |
| Máy lab | Mac mini / Linux + Mac | Linux cho Android và emulator, Mac riêng cho iOS |
| Nơi bắt đầu | P0 → P1 | Đúng. Không được nhảy vào P3 trước khi tách xong runner |

---

## Nợ kỹ thuật nên trả nhân lúc làm

- ~~`package.json` liệt kê tay hơn 150 file test.~~ **Xong ở P0 (2026-09-21).** Hoá ra 29 file test
  trên đĩa chưa bao giờ được chạy: 24 file xanh mà không ai biết còn xanh hay không, 5 file
  `*.integration.test.ts` cần máy Android thật (giờ có `npm run test:integration` riêng).
- `registry/*.json` đang nằm trong git và bị UI ghi vào. Sau P2.4 thì bỏ khỏi git, giữ DB làm nguồn
  sự thật và có đường export ra file cho CI.
- `src/ui/server.ts` 5.200 dòng và `src/ui/contracts.ts` 26KB: P1 sẽ tự giải quyết `server.ts`;
  `contracts.ts` nên chia theo miền đúng lúc chia route.
- `.testpilot.secrets.json` chỉ còn hợp lệ ở chế độ embedded — ghi rõ điều đó trong file khi làm P2.3.
