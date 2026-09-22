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

# P3 — Hàng đợi và giữ chỗ thiết bị — ✅ XONG 2026-09-22 (14–19 ngày)

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

### P3.1 Job queue — ✅ xong 2026-09-22
- Bảng `job` là nguồn sự thật. **Không có Redis:** worker nối bằng WebSocket thì server đẩy thẳng,
  còn tranh job thì `SELECT … FOR UPDATE SKIP LOCKED` của Postgres làm đúng việc ấy. Thêm Redis là
  thêm một service phải vận hành và một nguồn sự thật thứ hai.
- `JobQueue` + hai hiện thực ([memoryQueue.ts](src/server/queue/memoryQueue.ts) cho embedded,
  [pgQueue.ts](src/server/queue/pgQueue.ts) cho server), đo bằng **một bộ khẳng định dùng chung**
  ([queueContract.ts](src/server/queue/__tests__/queueContract.ts)) — 18 bài chạy với bản bộ nhớ
  trong `npm test`, và chính chúng chạy lại với Postgres trong `npm run test:integration`.
- `POST /api/run` **đổi nghĩa mà KHÔNG đổi hình dạng đường dây**: nó tạo job rồi nối vào log của
  job, vẫn là SSE với `log` và `done`. Giao diện không phải sửa một dòng nào — đổi engine và đổi
  giao diện cùng lúc là cách chắc chắn để không biết cái nào làm hỏng. Việc chuyển sang
  tạo-rồi-`attach` ở phía UI để dành cho lúc có màn hàng đợi thật (P3.5).
- Worker ([src/runner/worker.ts](src/runner/worker.ts)) đòi job, chạy, báo kết quả. Nó chỉ bật ở
  chế độ `embedded` — bật trong control plane ở chế độ server nghĩa là máy chủ web chạy Appium và
  adb, đúng thứ kiến trúc này dựng lên để tránh. `noDeviceAccess.test.ts` canh điều đó.
- Route mới `GET /api/jobs` (66 route): cái gì đang chờ, cái gì đang chạy, cái gì vừa xong — câu hỏi
  mà bản cũ không trả lời được, vì lượt chạy chỉ tồn tại trên đường dây SSE của tab đã bấm nút.
  `spec` KHÔNG đi ra ngoài: nó mang snapshot registry.
- Migration 0003 thêm cột `job.error`: `result` chỉ có khi job ĐÃ ĐÓNG, còn một job bị trả về hàng
  đợi thì chưa đóng mà lý do lần trước hỏng vẫn phải còn.
- Hai người viết chung bảng `job` — hàng đợi ghi `JobSpec`, lịch sử ghi `WorkflowRun` — nên mỗi bên
  nhận ra dòng của mình qua `payload ? 'spec'`. Tạm thời, tới khi lịch sử cũng thành job.
- **Xong khi** (đo thật, không phải suy luận): job tạo lúc chưa có worker thì nằm `queued` và không
  tự đổi; bật worker lên thì nó chạy — đo ở [worker.test.ts](src/runner/__tests__/worker.test.ts).
  Trên server thật: bấm chạy → `[job] … đã vào hàng đợi` → `[job] runner local đã nhận` → log của
  lượt chạy → `done`, và `/api/jobs` ghi đủ `requestedAt`/`startedAt`/`finishedAt`/`runnerId`.
  **Và điều bản cũ không làm được: đóng tab sau 150ms thì job VẪN chạy xong** và vẫn nằm trong sổ.
- **Bản Postgres đã chạy thật** (22/09/2026, sau khi khởi động lại engine Docker đang treo): 16 bài
  xanh, gồm **"mười runner đòi cùng lúc: mỗi job chỉ một bên nhận"** — thứ mà bản bộ nhớ không
  chứng minh được, vì hai tiến trình khác nhau không có `Map` nào dùng chung. Migration 0003 áp lên
  một DB ĐANG CÓ 0001+0002, tức là đúng đường mà một bản đã triển khai sẽ đi. Cả nhóm tích hợp DB:
  37 bài xanh.
- Hai lỗi của giàn test, không phải của mã: bản bọc thêm tiền tố vào tên runner nên bộ khẳng định
  đỏ ở đúng chỗ nó nên đỏ (nó kiểm hàng đợi ghi lại ĐÚNG tên runner đã đòi); và `after` xoá `runner`
  trước khi xoá job của nó nên khoá ngoại từ chối, để lại dòng thừa làm mọi lần chạy sau đỏ vì
  "duplicate key" — một câu không nói gì về nguyên nhân thật. Giàn test giờ tự dọn dấu vết lần
  trước.

### P3.2 Lease manager — ✅ xong 2026-09-22
- **Lỗ hổng đã bịt:** trước bước này worker chạy job mà KHÔNG lấy lease, nên một người đang cầm
  chiếc điện thoại qua màn Điều khiển vẫn bị job chạy đè lên — job không đỏ, nó chỉ chạy sai vì màn
  hình không ở nơi nó tưởng. Giờ worker dùng CHÍNH kho lease mà màn Điều khiển dùng.
- Giữ **tất cả hoặc không gì**: hỏng ở chiếc thứ hai thì nhả luôn chiếc thứ nhất, nếu không hai job
  khoá chéo nhau — mỗi bên cầm một chiếc máy bên kia cần.
- Gia hạn mỗi 30 giây trong lúc chạy (TTL 60). **Mất nhịp thì DỪNG lượt chạy** và job thành
  `interrupted`: chiếc máy ấy có thể đã được cấp cho người khác, và chạy tiếp là hai bên cùng bấm
  trên một màn hình. Nhả lease nằm trong `finally` — một job ném mà không nhả là chiếc điện thoại bị
  khoá 60 giây cho mỗi lần hỏng.
- **`defer` tách khỏi `release`, và đó là thứ lần chạy thật dạy ra.** Bản đầu trả job về hàng đợi
  bằng `release` mỗi khi máy bận, và kết quả đo được là `attempt = 33` trong tám giây cùng ba mươi
  ba dòng log giống hệt nhau. Máy đang có người cầm là chuyện TẠM THỜI, không phải một lần thử
  hỏng: `defer` giữ nguyên `attempt`, đặt mốc `not_before` (migration 0004) và chờ 5 giây, còn
  câu giải thích chỉ in một lần cho mỗi lý do.
- Bộ khẳng định dùng chung bắt được một chỗ hai hiện thực lệch nhau: `release` của bản Postgres xoá
  `not_before` còn bản bộ nhớ thì quên — một job bị hoãn rồi hỏng thật sẽ nằm chờ thêm vô cớ.
- **Xong khi** (đo thật trên server, không phải suy luận): giữ `sm-s918b` qua màn Điều khiển rồi bắn
  job vào đúng chiếc ấy → `[job] Thiết bị "sm-s918b" đang được local giữ tới … Job chờ tới lượt.`,
  `state=queued attempt=1`, và **không một lượt chạy nào được bắt đầu**. Nhả máy → trong một nhịp
  job lấy được lease (`[job] Đã giữ chỗ: sm-s918b.`) và chạy thật. Xong thì lease rỗng trở lại.
  5 bài trong [worker.test.ts](src/runner/__tests__/worker.test.ts) canh cả năm đường: máy bận, giữ
  rồi nhả, job ném vẫn nhả, tất-cả-hoặc-không-gì, và cưỡng chế nhả giữa chừng.
- **Chưa làm, và nói ra:** job KHÔNG nêu máy cụ thể thì không giữ chỗ được — biết chiếc máy thật mà
  một lượt chạy sẽ dùng khi người dùng không chọn là việc của P3.3, nơi danh tính thiết bị được
  phân giải đàng hoàng. Khoá một cái tên đoán được ở đây sẽ TRÔNG như bảo vệ mà không bảo vệ gì.

### P3.3 Ghép job với thiết bị — ✅ xong 2026-09-22
- **Lỗi im lặng đã sửa, và nó lớn hơn phần ghép:** cùng một chiếc điện thoại có `id` trong config
  (`sm-s918b`), `udid` mà adb trả về (`R5CW525G35Y`), và `deviceName` của Appium (`SM_S918B`). Màn
  Điều khiển giữ chỗ theo **udid**; job ở P3.2 giữ theo **id**. Hai cái tên khác nhau cho cùng một
  chiếc máy nghĩa là hai bên khoá hai thứ khác nhau — lá chắn dựng ở P3.2 chỉ hoạt động với config
  tình cờ đặt id trùng udid, và không có lỗi nào hiện ra. Giờ mọi đường quy về **udid**, vì đó là
  cái tên duy nhất cả ba bên đều gọi giống nhau.
- [scheduler/match.ts](src/server/scheduler/match.ts) là hàm THUẦN, nên 13 bài đo nó không cần một
  chiếc máy nào. Bốn đường ra, và ba trong số đó là "chưa chạy": chạy được, **chờ** (máy chưa cắm),
  hoặc **hỏng** (spec mơ hồ). Phân biệt chờ với hỏng quyết định job nằm đợi hay đỏ lên, và phần lớn
  cái sai ở đây là "chưa đủ điều kiện" chứ không phải lỗi.
- Một mã thiết bị lạ là **chờ**, không phải hỏng: danh sách chọn máy lấy từ máy đang cắm, nên mã lạ
  gần như luôn là chiếc máy vừa bị rút ra. Câu trả lời nói cả khả năng kia, vì gõ sai nhìn từ đây
  giống hệt.
- Config một-máy không khai udid — mọi config chưa nâng cấp đều thế — thì lấy chiếc duy nhất đang
  cắm. Hai chiếc trở lên thì **không đoán**: đoán sai là chạy nhầm điện thoại, và sai ấy chỉ lộ ra
  sau khi báo cáo đã được đọc và tin.
- Năng lực runner ĐO từ máy đang cắm, không khai tay: job iOS rơi vào một máy không có iPhone nào
  sẽ fail sau ba phút chờ WebDriverAgent, và đó là ba phút thiết bị của cả đội bị giữ vô ích. Ảnh
  chụp thiết bị có đệm 10 giây — hỏi `adb` và `simctl` thật mất 200-500ms, còn nhịp đòi job là một
  phần tư giây.
- **Công bằng nằm trong `claim`, ở CẢ HAI kho:** người đang có ít job chạy nhất được xét trước, rồi
  mới tới `priority`, rồi mới tới thời điểm đặt. Thuần FIFO nghĩa là một người bắn năm mươi job làm
  người kế tiếp chờ hết năm mươi lượt — và họ không làm gì sai, họ chỉ bấm chậm hơn. `maxPerUser`
  là lớp thứ hai, tuỳ chọn.
- Job nằm `queued` quá năm giây thì route NÓI RA. Một job im lặng nhìn giống hệt một job bị treo.
- **Đo được:** 13 bài cho `match.ts`, 4 bài mới trong `worker.test.ts` (gồm bài dựng đúng config
  thật `id ≠ udid` và chứng minh người cầm máy theo udid chặn được job chọn theo id), 3 bài công
  bằng chạy ở cả bản bộ nhớ lẫn **Postgres thật** (22 bài tích hợp xanh). Trên server thật: job
  android khi không máy nào cắm → chờ kèm câu giải thích; job web → chạy ngay vì không cần thiết bị.
- **Đo trên máy thật (emulator Android, sau khi dọn đĩa):** khai `may-ao` trong config với
  `udid: emulator-5554`, rồi giữ chỗ `emulator-5554` qua màn Điều khiển — đúng cái tên mà màn ấy
  dùng. Job xin `android:may-ao` — đúng cái tên mà màn chạy dùng — bị CHẶN:
  `Thiết bị "emulator-5554" đang được local giữ… Job chờ tới lượt.` Trước P3.3 job này chạy đè lên.
  Nhả máy → `[job] Đã giữ chỗ: emulator-5554.` rồi `tsx src/cli/run.ts --device may-ao`, tức là
  lease dùng udid còn CLI nhận id — đúng hai vai của hai cái tên. Xong thì lease rỗng lại.
- Hai chỗ dễ mất thời gian, ghi lại để lần sau khỏi tìm: server đọc **config cá nhân**
  (`.testpilot/users/<user>/config.json`), không phải `testpilot.config.json` — bản kia chỉ là hạt
  giống; và server phải có `adb` trong PATH, nếu không danh sách máy rỗng và mọi job Android nằm
  chờ với câu "chưa cắm".

### P3.4 Runner lab chạy độc lập — ✅ xong 2026-09-22
- **HTTP, không WebSocket — đổi so với kế hoạch, và có lý do đo được.** Yêu cầu khó nhất của bước
  này là "rút mạng hai phút, không mất dòng log nào". Với POST gom lô và đánh số `seq`, điều đó là
  CẤU TRÚC: runner giữ đệm tới khi server xác nhận (`ack`), gửi lại thì trùng seq bị khoá chính
  `(job_id, seq)` nuốt. Với WebSocket ta phải dựng lại đúng cơ chế xác nhận ấy trên nền socket.
  Cộng thêm: không thêm phụ thuộc `ws`, đi qua đúng cấu hình nginx đã kiểm ở P2.6, và gỡ lỗi được
  bằng `curl` — thứ mà một runner đặt ở phòng máy người khác rất cần. Cái mất là độ trễ nhận job:
  một nhịp hỏi thay vì một cú đẩy, và với một phòng máy thì một giây không đáng kể.
- Năm route `/api/runner/*` (71 route). Cửa của chúng là **token dùng chung**, kiểm trong
  `authorize()` cùng chỗ với mọi cửa khác — và đòi token ở CẢ chế độ embedded, vì mở chúng ra nghĩa
  là bất kỳ trang web nào trong cùng trình duyệt cũng đòi được job và trả về kết quả bịa.
- `RemoteJobQueue` đội đúng hình dạng `JobQueue`, nên runner độc lập chạy lại **toàn bộ** hành vi
  của P3.2 và P3.3 — giữ chỗ thiết bị, ghép theo udid, hoãn khi máy bận — mà không viết lại dòng
  nào.
- `PgJobQueue.appendLog/onLog/onState` nối vào bảng `job_event`, nên **chế độ server giờ stream
  được log thật**. Hỏi lại mỗi nửa giây thay vì `LISTEN/NOTIFY`: thông báo của Postgres đi theo KẾT
  NỐI, mà pool thì đổi kết nối giữa các truy vấn — một `LISTEN` có thể nằm trên một kết nối lát sau
  không ai dùng, và log im lặng ngừng chảy.
- **Xong khi** — đo thật, hai lớp:
  1. `reconnectBuffer.test.ts`: rút mạng 240 nhịp (hai phút), 240 dòng sinh ra trong lúc đứt, nối
     lại → **241/241 dòng tới nơi, đúng thứ tự**. Cộng: chỉ quên phần đã được `ack`; đệm đầy thì bỏ
     phần CŨ và NÓI RA số dòng đã mất.
  2. Chạy thật: server ở **chế độ server + Postgres** (`/api/jobs` trả 401 khi chưa đăng nhập),
     runner ở **tiến trình riêng** nối bằng token → nó đòi job, chạy trên máy của nó, gửi log về, và
     Postgres ghi `state=succeeded`, `runner_id=runner:lab-01`, **6 dòng trong `job_event`** kèm
     `seq` tăng dần.
- `scripts/bundle-runner.sh` (gói 880 KB, không có secret, không có phần web, không có node_modules
  vì nó phụ thuộc kiến trúc máy), `infra/runner/com.testpilot.runner.plist` (launchd) và
  `testpilot-runner.service` (systemd). 12 phép đo canh những dòng mà xoá đi thì vẫn chạy: `-lc` để
  có PATH của người dùng, `RestartSec` để một runner hỏng cấu hình không thành vòng lặp đốt CPU,
  token đi qua `EnvironmentFile` chứ không nằm trong file unit ai cũng đọc được.
- **Chưa làm:** cài dịch vụ nền lên máy này — đó là sửa cấu hình máy của người dùng, nên hai file
  kia được viết ra và kiểm bằng test, không được `launchctl load`.

### P3.5 Màn quản lý thiết bị trên web — ✅ xong 2026-09-22
- `/devices`: thiết bị, chỗ giữ, và hàng đợi — **ghép với nhau**, không xếp cạnh nhau. Một danh
  sách máy không nói ai đang cầm, cạnh một danh sách job không nói chạy trên máy nào, thì người đọc
  phải tự nối bằng mắt; mà câu hỏi thật của một phòng máy chỉ có một: "chiếc này đang bận vì ai".
- **Không thêm route nào:** màn hình ghép ba nguồn đã có (`/api/device/targets`,
  `/api/device/leases`, `/api/jobs`) bằng `deviceId` và `jobId`. Ba hình dạng ấy chuyển vào
  [contracts.ts](src/ui/contracts.ts), vì phép ghép hỏng IM LẶNG khi một bên đổi tên trường: bảng
  vẫn vẽ ra, chỉ là mọi máy đều "rảnh".
- Thu hồi bắt buộc có lý do, và nút xác nhận khoá tới khi có — nếu không người dùng bấm rồi nhận
  một lỗi 400 không giải thích gì.
- **Xong khi** (đo trong trình duyệt thật, emulator đang cắm): màn hình hiện
  `emulator-5554 · emulator` — `người dùng local đang điều khiển` — `45s`, và job `@dang-cho` nằm ở
  "Đang chờ" kèm đúng lý do. Bấm **Thu hồi** + nhập lý do → máy về `rảnh`, job tự lấy máy và chạy,
  rồi chuyển sang "Vừa xong". 9 bài test cho màn này.
- **Chưa làm, và nói ra:** `quarantine`, `drain runner`, đổi `visibility` cần SỔ runner và thiết bị
  ở phía server — thứ chỉ tồn tại khi runner nối vào qua transport (P3.4). Màn prereq đổi nghĩa
  thành "báo cáo do runner gửi lên" cũng thuộc P3.4.

### P3.6 Nối AWS Device Farm thành một runner — ✅ xong 2026-09-22
- Ý tưởng gọn trong một câu: **Device Farm là một runner nữa.** Nó nhận job từ cùng hàng đợi, báo
  log về cùng đường, đóng job bằng cùng `JobResult`. `TESTPILOT_RUNNER_MODE=farm npm run runner` —
  cùng tiến trình, cùng worker, chỉ đổi `Runner` bên dưới.
- Khác biệt thật, và là lý do có cờ `managesOwnDevices`: **Device Farm tự quản thiết bị.** Không có
  gì để `adb devices` nhìn thấy, không udid để giữ chỗ, và việc xếp hàng đợi máy xảy ra bên trong
  AWS. Giữ chỗ ở phía ta cho một chiếc máy ta không sở hữu là khoá một thứ không tồn tại — và nó
  chặn chính job kế tiếp.
- `farmReadiness()` kiểm **trước khi đòi job**, không phải lúc chạy. Bản không kiểm đã có lịch sử:
  job được nhận, 216 MB bundle tải lên, thiết bị khởi động, rồi vòng lặp chết vì thiếu credential —
  sau khi tiền đã tiêu.
- Nền tảng khai tay cho farm chứ không đo từ `control.devices()`: danh sách ấy rỗng theo đúng nghĩa
  đen. Không khai thì worker tự đo ra `['web']` và mọi job Android nằm chờ mãi — một lỗi đã xảy ra
  thật trong lúc làm bước này.
- **Lệch có chủ ý so với kế hoạch:** `POST /api/aws/login` **không bị bỏ**. Nó là route `LOCAL`,
  chỉ có nghĩa ở chế độ embedded, và là cách người dùng trên máy mình lấy phiên SSO. Runner farm thì
  không bao giờ gọi nó — nó dùng credential của máy đang chạy, đúng như kế hoạch muốn. Bỏ route ấy
  chỉ làm hỏng một thứ đang dùng được mà không đổi lại gì.
- **Đo được:** 6 bài với AWS được tiêm — chạy được, test đỏ, job sai nền tảng bị từ chối TRƯỚC khi
  tải gì lên, config thiếu ARN thì nói rõ, và job farm chạy qua worker mà **không giữ chỗ chiếc máy
  nào**. Chạy thật: `TESTPILOT_RUNNER_MODE=farm npm run runner` nối được vào control plane và khai
  đúng nền tảng `android` đọc từ device pool.
- **Chưa làm:** một lượt `run_suite` THẬT đi qua Device Farm. Nó tốn tiền của người dùng và mất
  khoảng mười phút, nên nó là quyết định của họ, không phải của tôi. Mọi thứ trước lúc bấm — đọc
  credential, kiểm pool, đóng gói, khai nền tảng — đã chạy thật.

### P3.7 Điều khiển thiết bị từ web — ✅ xong cả ba bước 2026-09-22

Làm **sau** P3.1–P3.3, vì lease là phần dùng chung. Nhưng bước 1 phải đi TRƯỚC scheduler, vì nó đổi
lược đồ mà scheduler sẽ đọc.

Hai nền tảng đi hai đường hoàn toàn khác nhau — `adb` + H.264 cho Android, WebDriverAgent + MJPEG
cho iOS — và [src/runner/control.ts](src/runner/control.ts) là chỗ duy nhất biết điều đó. Phần còn
lại của hệ thống chỉ thấy một bộ việc, và nền tảng đi kèm trong `ControlTarget` chứ không đoán từ
hình dạng `udid`.

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

**Bước 3 — iOS — ✅ xong 2026-09-22**
- Video: MJPEG của WebDriverAgent ở cổng 9100. Input: `execute/sync` với `mobile:` script —
  **`/wda/keys` và `/appium/device/press_button` đã bị bỏ ở xcuitest 12.5**, cả hai trả
  "unknown command", một câu không nói gì về việc route đã dời chỗ.
- **Ba con số đo được** (simulator iPhone 17 Pro, iOS 26.5): dựng phiên lần đầu **184 giây** (Appium
  build rồi cài WDA), lần sau **4 giây** — nên phiên được GIỮ LẠI giữa các lần xem, và giao diện nói
  "đang dựng WebDriverAgent" thay vì đứng im. MJPEG **900–1200 KB/s**, gấp hơn trăm lần luồng H.264
  của Android vì MJPEG không nén liên khung.
- **Và con số thứ tư quyết định thiết kế: màn hình đứng yên cho 47 khung GIỐNG HỆT NHAU từng byte.**
  Nên `FrameDeduper` bỏ khung trùng, và 900 KB/s thành gần như không tốn gì trong đúng tình huống
  thường gặp nhất — người ta đang nhìn màn hình để quyết định chạm vào đâu. Đo lại trên máy thật:
  5 giây ra dưới 20 khung thay vì 47.
- Toạ độ iOS là **điểm**, không phải pixel: `window/rect` cho 402x874 còn ảnh chụp là 1206x2622.
  Nhầm sang pixel làm mọi cú chạm lệch đúng ba lần, và lệch đều thì trông như "ứng dụng hỏng".
- Mặt tiền runner lên **bảy việc**: thêm `devices()` trả cả Android lẫn simulator iOS trong MỘT danh
  sách. Trước đó giao diện phải gộp hai nguồn khác hình dạng, và **không nguồn nào liệt kê simulator
  đang bật** — thứ dùng nhiều nhất lúc phát triển. Route mới `GET /api/device/targets` (65 route).
- Phím theo nền tảng: iOS chỉ có `home`, `enter`, `delete`. iPhone không có nút Quay lại, nên giao
  diện KHÔNG vẽ nút ấy, và nếu vẫn gọi thì câu từ chối nói rõ phím nào có.
- **Đo trong trình duyệt thật:** chọn "iPhone 17 Pro · iOS 26.5 · simulator" → Giữ máy → video chảy,
  header hiện "402×874 · JPEG"; bấm Safari **trên canvas** → Safari mở; gõ chữ vào ô nhập → chữ hiện
  trên thanh địa chỉ; `back` → 400 kèm danh sách phím có. 10 test tích hợp trên simulator thật
  ([iosControl.integration.test.ts](src/runner/__tests__/iosControl.integration.test.ts)) và 8 test
  đơn cho phép cắt luồng ([mjpeg.test.ts](src/runner/__tests__/mjpeg.test.ts)).
- **Một lỗi của chính công cụ sinh mã:** bản viết đầu ghi **ký tự U+E007/U+E003 THẬT** vào nguồn
  thay vì chuỗi escape. Chúng vô hình khi đọc file, nên bản vá sau đó không khớp mà không nói vì
  sao — mất một lượt sửa để hiểu tại sao "đã sửa rồi" mà hành vi không đổi. Đây là lần thứ hai cùng
  kiểu hỏng (trước là NUL byte), nên `sourceIntegrity.test.ts` giờ canh luôn cả vùng dùng riêng, và
  mã viết `String.fromCharCode(0xe007)`.

---

# P4 — Runner cá nhân từ xa (6–8 ngày)

Mục tiêu: người dùng cắm điện thoại vào laptop của mình và dùng được như hôm nay, nhưng dữ liệu về
server chung.

### P4.1 Đăng ký runner — ✅ phần server xong 2026-09-22
- **Vì sao phải bỏ token dùng chung của P3.4:** nó đủ cho một phòng lab mà người quản trị tự cắm
  máy, và hỏng ngay khi tới việc của P4 — người dùng cắm điện thoại vào laptop CỦA HỌ. Một bí mật
  dùng chung nghĩa là không thu hồi được một máy mà không làm chết mọi máy khác, và không biết job
  nào chạy trên máy nào ngoài cái tên mà chính máy ấy tự khai.
- Mỗi runner một token, server chỉ giữ **hash sha256**. Token hiện đúng một lần trong phản hồi tạo
  máy; không route nào đọc lại được. Mất thì `rotate`, và token cũ chết ngay.
- Thu hồi **không xoá dòng**: `job.runner_id` trỏ vào đây, và "job này chạy ở máy nào" là câu mà
  một cuộc điều tra sau sự cố cần.
- `authorize()` giờ tra SỔ thay vì so chuỗi, và **danh tính lấy từ dòng trong sổ** — runner khai gì
  trong header cũng không đổi được nó thuộc tổ chức nào. Token dùng chung cũ vẫn chạy: nó được nạp
  thành một dòng trong sổ, nên cửa quyền chỉ có một đường tra.
- Hình dạng phân quyền của P3.7 lặp lại: vai ở cửa, **quyền sở hữu trong handler**. Hai người cùng
  vai `runner_user` nhưng chỉ chủ máy (hoặc `admin`) đổi/thu hồi được token máy ấy. Máy dùng chung
  thì chỉ `admin` tạo — một người tự biến laptop mình thành máy chung rồi tắt đi là cách làm hỏng
  hàng đợi của cả đội mà không cố ý.
- Danh sách máy đã LỌC: laptop riêng của người khác không hiện.
- **Đo được:** 13 bài cho sổ (bộ khẳng định dùng chung cho cả hai hiện thực), 9 bài cho route, 4 bài
  mới ở cửa quyền. Chạy thật: thêm máy → token hiện một lần → token ấy đòi job được (200) → thu hồi
  → chính token ấy nhận 401.
- **Chưa làm:** `npx testpilot-runner login --token …` lưu token vào keychain của OS. Hôm nay runner
  đọc token từ biến môi trường, nên nó nằm trong file dịch vụ nền (systemd đọc từ
  `EnvironmentFile` chmod 600). Keychain là bước tiếp theo, và nó cần một lệnh CLI riêng.

### P4.2 Quyền nhìn thấy thiết bị — ✅ xong 2026-09-22
- **Sổ thiết bị ở phía server**, nguồn là BÁO CÁO TỪ RUNNER chứ không phải server tự hỏi `adb`: ở
  chế độ server máy chủ web không cắm thiết bị nào (FARM-ARCHITECTURE mục 12). Runner gửi cả danh
  sách mỗi mười giây — một chiếc máy bị rút ra là một sự VẮNG MẶT, và sự vắng mặt không có sự kiện
  nào để gửi.
- **Cả chế độ embedded cũng đi qua sổ ấy:** host tự báo cáo máy của nó theo nhịp, y như runner ở xa.
  Hai đường đọc — một hỏi sổ, một hỏi `adb` — sẽ lệch nhau ở đúng phần khó thấy nhất là phép lọc
  quyền.
- Máy **thừa hưởng quyền nhìn từ runner**: điện thoại cắm vào laptop riêng thì cũng riêng. Luật gọn
  trong bốn dòng (`maySee`) và là hàm thuần xuất ra ngoài, vì cùng luật ấy phải áp ở hai chỗ — lúc
  liệt kê, và lúc ai đó nhắm một chiếc máy bằng tên. Hai bản chép tay sẽ lệch, và bên lỏng hơn
  thắng.
- Máy tắt **vẫn hiện, kèm chữ "đang tắt"**: biến mất khỏi danh sách và đang tắt là hai câu khác
  nhau, và người dùng cần câu thứ hai.
- Chặn job ở lúc **TẠO**, không lúc chạy: một job đã vào hàng đợi là một job người khác nhìn thấy
  trong danh sách chờ, kèm tên chiếc máy riêng của người ta — đã là rò rỉ dù nó không bao giờ chạy.
  Câu từ chối không phân biệt "máy của người khác" với "máy không có thật", cố ý.
- **Xong khi** — cả hai nửa đã đo: 8 bài cho sổ (gồm cả `maySee` bốn dòng), 3 bài cho việc chặn tạo
  job. Chạy thật: runner cá nhân báo hai máy lên qua `POST /api/runner/devices`, và chủ của nó thấy
  đúng hai máy ấy trong `/api/device/targets`.
- **Chưa đo được trên server thật:** phần "người B không thấy máy của A" cần hai phiên đăng nhập
  khác nhau, tức là Keycloak — ảnh của nó đã bị xoá lúc dọn đĩa. Luật lọc thì đã đo ở tầng đơn vị
  và ở tầng route.
- **Chưa làm:** đường chia sẻ một chiếc máy riêng cho một người cụ thể. Hôm nay chỉ có hai mức
  `private`/`shared` thừa hưởng từ runner; chia sẻ lẻ cần một bảng quyền riêng.

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

### P4.5 Preflight của máy cá nhân — ✅ phần từ chối xong 2026-09-23
- **Vì sao máy cá nhân cần cái này mà máy lab thì không:** máy lab do người quản trị dựng một lần
  rồi để yên; laptop của một người thì hôm nay có Xcode, tuần sau nâng cấp macOS và Appium mất
  driver, tháng sau cài lại máy. Runner cứ nhận job rồi hỏng ở phút thứ ba thì người đặt job nhận
  một câu lỗi của Appium — thứ không nói được rằng chiếc máy ở đầu kia thiếu gì.
- `measurePrereq()` đo theo nhịp 30 giây (không đo mỗi lần đòi job: `xcode-select` và lời gọi Appium
  mất vài trăm mili giây, mà nhịp đòi job là một phần tư giây). `web` luôn sẵn sàng; `android` cần
  Appium; `ios` cần cả Appium lẫn Xcode — và Xcode chỉ được hỏi khi Appium đã chạy, vì nó là lời
  gọi đắt nhất và không có Appium thì câu trả lời của nó không đổi được kết luận.
- Job bị từ chối là **`failed`, không phải `defer`**: thiếu driver không tự khỏi, nên trả job về
  hàng đợi chỉ tạo một vòng lặp bận rộn — ở một phòng máy một runner thì nó là vòng lặp vô tận.
- Chưa đo bao giờ thì KHÔNG từ chối: thà chạy rồi hỏng còn hơn từ chối một máy hoàn toàn tốt vì
  phép đo chưa kịp chạy lần đầu.
- **Xong khi:** 8 bài cho phép đo và 2 bài ở worker — Appium tắt thì job Android hỏng ngay kèm câu
  "mở màn Local Runner rồi bấm khởi động Appium", và không một lượt chạy nào được bắt đầu; job web
  trên chính máy ấy vẫn chạy.
- **Chưa làm:** hiện trạng thái môi trường của từng máy LÊN WEB. Phép đo và đường báo cáo đã có
  (`POST /api/runner/devices` gửi kèm được), còn màn hiển thị thì đi cùng P4.4 để không phải sửa
  cùng một màn hai lần.

### P4.6 Nói thật về máy có thể tắt — ✅ xong 2026-09-23
- **Máy cá nhân tắt lúc nào cũng được — đó là sự thật của P4, không phải lỗi.** Laptop đóng nắp lúc
  18h, mất wifi trong thang máy, hết pin. Cái sai không phải chuyện máy tắt, mà là hệ thống VỜ NHƯ
  nó còn sống: job nằm chờ một chiếc máy đã đi về từ lâu, và người đặt job không có cách nào biết.
- Nhịp tim **đi kèm việc đòi job**, không phải một endpoint riêng: runner nào còn hỏi là runner còn
  sống. Một endpoint riêng thì sẽ có lúc runner gửi nhịp đều mà không đòi job nữa — sống theo sổ,
  chết theo thực tế.
- Vòng dọn ([runners/reaper.ts](src/server/runners/reaper.ts)) làm ba việc theo thứ tự: runner im
  lặng quá 90 giây → `offline`; máy của nó → `offline` nhưng **KHÔNG biến mất** ("không có máy nào"
  và "máy của bạn đang tắt" là hai câu khác nhau, và người dùng cần câu thứ hai); job nó đang chạy
  → `interrupted` kèm tên máy, và lease được **nhả ngay** thay vì chờ TTL — chờ hết hạn nghĩa là
  chiếc máy bị khoá thêm một phút sau khi ai cũng đã biết nó không còn chạy gì.
- Job của runner KHÁC không bị đụng tới: một máy tắt không được kéo theo việc của máy đang chạy tốt.
- **Xong khi** — đo thật trên server (hạn im lặng hạ xuống 15 giây qua `TESTPILOT_RUNNER_SILENT_MS`):
  runner cá nhân nối vào, báo máy lên, bị giết → sau 25 giây sổ ghi `offline` và danh sách máy hiện
  `emulator-5554 · emulator · đang tắt`, trong khi máy của host vẫn nguyên. 7 bài cho vòng dọn.
- **Chưa làm:** chặn đặt lịch chạy định kỳ trên máy `private` (chưa có lịch chạy định kỳ), và tắt
  quay video để giảm băng thông từ mạng nhà.

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
