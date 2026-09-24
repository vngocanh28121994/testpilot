# TestPilot Farm — kiến trúc mục tiêu

Từ một app chạy trên máy local thành một **device farm thu nhỏ nhiều người dùng**, mà không làm mất
đường chạy local đang có.

Tài liệu này nói **hệ thống sẽ trông như thế nào**. Kế hoạch từng bước nằm ở
[FARM-PLAN.md](FARM-PLAN.md). Kiến trúc tầng test (Intent, Resolver, healing) không đổi và vẫn
được mô tả ở [ARCHITECTURE.md](ARCHITECTURE.md).

---

## 0. Sự thật phải biết trước

Bảng này là lý do của gần như mọi quyết định phía dưới. Tất cả đều lấy từ code hiện tại.

| Điều muốn làm | Sự thật | Hệ quả thiết kế |
|---|---|---|
| Đưa `src/ui/server.ts` lên domain là xong | Server hiện **vừa là web, vừa là runner**: nó `spawn` CLI, `appium`, `adb`, `xcrun`, `osascript`, `lsof`, `pgrep` ([src/ui/server.ts:3230](src/ui/server.ts), [:3891](src/ui/server.ts), [:4082](src/ui/server.ts)) | Phải tách thành **control plane** và **runner**. Đây là việc gốc, mọi thứ khác phụ thuộc vào nó |
| Trình duyệt của người dùng điều khiển điện thoại cắm vào máy họ | Không. Web không chạm được USB | Máy người dùng phải có **runner riêng**, kết nối ra server |
| Nhiều người cùng dùng bản hiện tại | Không có xác thực ở bất kỳ endpoint nào; config lấy theo `os.userInfo()` ([src/core/personalConfig.ts](src/core/personalConfig.ts)); secrets là một file dùng chung ([src/core/secrets.ts](src/core/secrets.ts)) | Cần đăng nhập, `org_id`, và secrets theo tổ chức |
| Nhiều người cùng sửa registry | `Registry.save()` và `History.save()` ghi đè **toàn bộ** file JSON, không khoá ([src/core/registry.ts:517](src/core/registry.ts), [src/core/history.ts:325](src/core/history.ts)) | Chuyển sang DB, và ghi có kiểm tra phiên bản |
| Restart server không ảnh hưởng lượt chạy | Lượt chạy sống trong RAM của web process (`runChildren`, [src/ui/activeRuns.ts](src/ui/activeRuns.ts)) | Cần hàng đợi bền và runner là process riêng |
| Một điện thoại chạy được nhiều test cùng lúc | Không | Cần **giữ chỗ thiết bị** (lease) và hàng chờ |
| Web test và native test giống nhau về hạ tầng | Web (Playwright) chạy headless ở đâu cũng được; native cần USB, và iOS cần macOS | Runner khai báo **năng lực**, scheduler định tuyến theo năng lực |

---

## 1. Ba chế độ, một mã nguồn

Mọi nơi chạy test đều là **runner**. Khác nhau chỉ ở cấu hình.

| Chế độ | Ai sở hữu | Thiết bị | Dùng để |
|---|---|---|---|
| `embedded` | chính người dùng | cắm vào máy họ | **Đường local như hiện tại.** `npm run ui` vẫn chạy được một mình, không cần server, không cần đăng nhập |
| `lab` | tổ chức | cắm vào máy lab / emulator | Thiết bị dùng chung, có hàng đợi |
| `personal` | một người dùng | cắm vào máy cá nhân | Máy riêng nhưng dữ liệu vẫn về server chung |
| `farm` | tổ chức | AWS Device Farm | Thiết bị thuê, tái dùng `src/farm/`, `src/aws/` |

`embedded` là điều kiện bắt buộc: nếu bản local vỡ thì bạn mất công cụ đang dùng hàng ngày trong lúc
xây phần farm.

---

## 2. Hình tổng thể

```
  Trình duyệt
      │  HTTPS, session người dùng
      ▼
┌──────────────────── Control plane (domain) ─────────────────────┐
│  Web UI (ui/)                                                   │
│  API  (src/server/)      Auth/RBAC │ Scheduler │ Lease manager  │
│  Postgres                S3/MinIO  │ Redis queue                │
└────────▲──────────────────────▲──────────────────────▲──────────┘
         │  WebSocket, runner chủ động kết nối ra (runner token)
    ┌────┴─────────┐   ┌────────┴────────┐   ┌─────────┴────────┐
    │ runner lab   │   │ runner personal │   │ runner farm      │
    │ Mac + iPhone │   │ máy người dùng  │   │ AWS Device Farm  │
    │ Linux + emu  │   │ (mode B)        │   │                  │
    └──────────────┘   └─────────────────┘   └──────────────────┘

  Chế độ embedded: cùng process, không WebSocket, không đăng nhập
  ┌──────────────────────────────────────────┐
  │ npm run ui → API + runner in-process     │
  │ SQLite hoặc file JSON như hiện tại       │
  └──────────────────────────────────────────┘
```

**Quy tắc bất di bất dịch:** control plane **không bao giờ** chạy lệnh thiết bị. Nó chỉ đọc/ghi DB,
xếp hàng job và chuyển tiếp log. Mọi `spawn` đều nằm trong runner.

---

## 3. Bố cục mã nguồn mục tiêu

```
src/
  protocol/          ← MỚI. Kiểu dữ liệu dùng chung server ↔ runner.
    messages.ts        JobSpec, JobEvent, RunnerHello, DeviceReport…
    version.ts         PROTOCOL_VERSION và quy tắc tương thích
  server/            ← MỚI. Chỉ có API. Không child_process.
    http.ts            khởi tạo, route table
    auth/              OIDC, session, RBAC, runner token, job token
    routes/            tách theo miền: state, feature, registry, run, device,
                       runner, healing, report, admin
    scheduler/         queue.ts, lease.ts, match.ts
    db/                schema, migration, repository
    storage/           S3/MinIO, link có chữ ký
    relay.ts           WebSocket tới runner, chuyển log ra SSE
  runner/            ← MỚI. Phần biết về thiết bị.
    main.ts            vòng lặp: kết nối, heartbeat, nhận job
    transport.ts       WebSocket có kết nối lại; mode embedded thì gọi trực tiếp
    devices.ts         chuyển từ src/core/attachedDevices.ts + prereq*
    prereq.ts          chuyển từ src/ui/server.ts (appium/adb/xcode/tunnel/trust)
    execute.ts         gọi runSuite/runSuiteParallel như hiện nay
    upload.ts          đẩy artifact lên S3 bằng link có chữ ký
    sandbox.ts         danh sách job được phép — **không nhận lệnh shell tuỳ ý**
  core/ drivers/ runtime/ discovery/ healing/ genspec/ …   ← gần như không đổi
  ui/server.ts       ← còn lại một shim mỏng cho chế độ embedded
```

Các thư mục không nằm trong danh sách trên không bị đụng tới. Đó là chủ ý: phần đắt giá nhất của
project (resolver, healing, discovery) không nên bị lôi vào việc tái kiến trúc hạ tầng.

---

## 4. Mô hình dữ liệu

Postgres cho chế độ server, SQLite cho chế độ embedded. Cùng một lớp repository.

```
org(id, name, created_at)
user(id, org_id, email, name, role)                role: admin | maintainer | runner_user | viewer
membership(user_id, org_id, role)                  một người có thể ở nhiều tổ chức

runner(id, org_id, name, mode, owner_user_id, os, arch, protocol_version,
       agent_version, token_hash, visibility, state, last_seen_at)
       visibility: shared | private            state: online | offline | draining
runner_capability(runner_id, key, value)           appium, xcode, playwright, gnirehtet…

device(id, runner_id, org_id, platform, udid, name, os_version, visibility,
       state, state_reason, updated_at)
       state: idle | leased | busy | offline | quarantined
device_tag(device_id, key, value)                  ví dụ pool=regression, sim=true

job(id, org_id, created_by, kind, state, priority, requested_at, started_at,
    finished_at, runner_id, device_ids[], payload_json, result_json, attempt,
    cancel_requested_at)
    kind: run_suite | gen | pom | crawl | prereq | device_scan
    state: queued | assigned | running | succeeded | failed | cancelled | interrupted
job_event(job_id, seq, at, type, payload_json)     log, stage, artifact, warning
lease(id, device_id, job_id, acquired_at, expires_at, renewed_at)

artifact(id, job_id, org_id, kind, key, bytes, sha256, created_at, expires_at)
    kind: report | screenshot | video | trace | log | apk

registry_object(org_id, kind, key, revision, json, updated_by, updated_at)
    kind: element | feature | scenario_review | known_issue | action | coverage
registry_proposal(id, org_id, kind, key, base_revision, patch_json, source_job_id,
                  state, reviewed_by, reviewed_at)
    state: pending | accepted | rejected | superseded

secret_ref(org_id, name, backend, backend_key, updated_by, updated_at)
audit_log(id, org_id, actor, action, target, at, detail_json)
```

Ghi chú quan trọng:

- **`registry_object.revision` là khoá của toàn bộ chuyện nhiều người dùng.** Ghi phải kèm
  `base_revision`, lệch thì trả 409. `PUT /api/feature` đã có `baseRevision`
  ([src/ui/server.ts:593](src/ui/server.ts)) — mở rộng đúng ý đó ra mọi object.
- **`registry_proposal` là nơi runner ghi vào.** Runner không sửa trực tiếp registry. Healing và
  discovery gửi đề xuất, người duyệt hoặc chính sách tự nhận. Nếu bỏ bước này, mỗi runner sẽ có một
  bộ locator khác nhau và tính năng heal mất ý nghĩa.
- `job_event.seq` cho phép UI **nối lại** giữa lượt chạy. Đây là bản bền của
  [src/ui/activeRuns.ts](src/ui/activeRuns.ts).

---

## 4b. Cơ chế registry: local khác server ở đâu

Mô hình dữ liệu là một. Khác nhau đúng ba chỗ: **nơi lưu, ai được ghi trực tiếp, và ghi ngay hay
qua đề xuất**.

Code đã có sẵn nền: `Registry.changesSinceLoad()` ([src/core/registry.ts:414](src/core/registry.ts))
trả về **delta** "lượt chạy này học được gì", và `mergeFrom` + `deferSharedWrites` đã dùng cho lượt
chạy song song nhiều thiết bị. Đề xuất (proposal) chính là delta đó, gửi qua mạng thay vì ghi xuống
file.

| | Người dùng local (`embedded`) | Người thao tác trên server |
|---|---|---|
| Nguồn sự thật | file `registry/*.json` trên máy họ | DB của control plane |
| Đọc | `Registry.load(path)` | API đọc DB; runner nhận **snapshot** trong `JobSpec` |
| Sửa tay | ghi thẳng | ghi kèm `baseRevision`, lệch thì 409 kèm diff |
| Healing / discovery | `registry.save()` ngay | gửi delta lên thành `registry_proposal` |
| Ai nhìn thấy | chỉ mình | cả tổ chức, theo `org_id` |
| Xung đột | không có | được phát hiện, không mất im lặng |
| Lịch sử | git, nếu commit tay | `revision` + `audit_log` |

### Ba loại ghi, ba chính sách

Hôm nay cả ba đều gọi `save()` như nhau. Trên server phải tách ra:

| Loại | Nguồn | Server xử lý |
|---|---|---|
| Người sửa tay | UI sửa element, feature, known-issue | **ghi trực tiếp**, kèm `baseRevision` |
| Máy học được, **đã verify** | healing đã verify, locator đạt ngưỡng chất lượng | **tự nhận** theo chính sách (`retainVerifiedHealing`, `AntiRegressionGuard` đã là logic này) |
| Máy đoán, **chưa verify** | discovery AI, candidate runtime, duplicate | **chờ duyệt**, hiện ở màn healing/duplicate đang có |

### Cái gì dùng chung, cái gì ở lại máy

Nguyên tắc: **cái gì mô tả ý định thì dùng chung; cái gì mô tả một thiết bị cụ thể thì ở lại máy
đó.** Hôm nay hai loại này bị trộn trong cùng thư mục `registry/`.

| File | Tính chất | Local | Server |
|---|---|---|---|
| `elements.json` | dùng chung, quý nhất | ghi thẳng | DB + `revision` + đề xuất |
| `features/*.feature`, `feature-sources.json` | dùng chung | ghi thẳng | DB + `revision` (đã có `baseRevision`) |
| `scenario-review.json`, `known-issues.json`, `actions.json` | người quyết định | ghi thẳng | ghi trực tiếp, cần vai `maintainer` |
| `healing.json` | **sổ sự kiện** | ghi đè cả file | **append-only** theo `org_id` |
| `flake.json` | số liệu cộng dồn | ghi đè cả file | **cộng dồn delta**; ghi đè là hai runner xoá số của nhau |
| `runtime-registry.json` | cache theo thiết bị cụ thể | ở máy | **của riêng runner**, không đồng bộ lên |
| `device-env.json` | trạng thái máy đang cắm | ở máy | của riêng runner |
| `coverage/` | suy ra được | tính lại | tính trên server từ DB |
| `history.json` | lịch sử lượt chạy | file local | bảng `job` + `job_event` |

### Đi lại giữa hai thế giới

Người làm offline một tuần phải có đường mang kết quả về, nếu không họ sẽ copy file bằng tay và dữ
liệu bắt đầu lệch:

```bash
testpilot registry pull   # kéo bản server về file local để làm offline
testpilot registry push   # đẩy thay đổi local lên thành đề xuất, có kiểm tra revision
```

### Vì sao bắt buộc phải qua đề xuất

Nếu để runner ghi thẳng vào registry dùng chung: máy A heal ra `#login-btn`, máy B heal ra
`[data-test=submit]`, bản ghi sau xoá bản trước; một locator học từ app phiên bản cũ trên máy ai đó
phá lượt chạy của cả team; `flake.json` bị ghi đè làm tính năng phát hiện flaky nói sai.
Với đề xuất, trường hợp xấu nhất chỉ là **có việc phải duyệt**, không phải mất dữ liệu.

---

## 5. Giao thức runner ↔ server

> **Sửa ngày 2026-09-22 (P3.4): đường truyền là HTTP, không phải WebSocket.**
>
> Mục này viết WebSocket. Làm tới nơi thì HTTP hợp hơn với đúng cái yêu cầu khó nhất — "rút mạng
> hai phút, không mất dòng log nào". Với POST gom lô kèm `seq` và một `ack` trả về, điều đó là cấu
> trúc chứ không phải cố gắng: runner giữ đệm tới khi được xác nhận, và gửi lại là vô hại nhờ khoá
> chính `(job_id, seq)`. Trên WebSocket ta vẫn phải dựng lại đúng cơ chế ấy, cộng thêm một phụ
> thuộc và một lớp khó gỡ lỗi. Cái đánh đổi: nhận job chậm hơn một nhịp hỏi.
>
> Hình dạng thông điệp trong `src/protocol/messages.ts` KHÔNG đổi — chỉ đường truyền đổi.

WebSocket, JSON, runner luôn là bên mở kết nối. Máy người dùng không mở port nào.

**Runner → server**

| Thông điệp | Nội dung |
|---|---|
| `hello` | runner token, mode, os/arch, `protocol_version`, `agent_version`, danh sách năng lực |
| `devices` | toàn bộ thiết bị nhìn thấy, kèm `state` và lý do; gửi lại khi có thay đổi |
| `heartbeat` | mỗi 10s, kèm job đang chạy và mức tải |
| `job.accept` / `job.reject` | kèm lý do khi từ chối (thiếu Xcode, thiết bị bận, hết đĩa) |
| `job.event` | `{seq, type: log \| stage \| artifact \| warning, payload}` |
| `job.result` | trạng thái cuối, số scenario, con trỏ tới artifact |
| `lease.renew` | gia hạn giữ chỗ trong lúc chạy |

**Server → runner**

| Thông điệp | Nội dung |
|---|---|
| `job.offer` | `JobSpec` đầy đủ: feature snapshot, registry snapshot, thiết bị, env, giới hạn thời gian |
| `job.cancel` | huỷ |
| `secret.grant` | secret **ngắn hạn**, chỉ cho job đó, chỉ những tên mà job cần |
| `config.push` | cấu hình do server quản lý (mức log, retention, endpoint upload) |
| `upgrade.required` | lệch phiên bản giao thức; runner tự cập nhật rồi kết nối lại |

Quy tắc:

- **Sandbox theo danh sách cho phép.** Runner chỉ thực thi các `kind` job đã biết, với tham số đã
  kiểm tra. Server không có cách nào bảo runner chạy một chuỗi shell tuỳ ý. Đây là điều kiện để một
  người dám cài runner lên máy làm việc của mình.
- **Tương thích phiên bản.** Cùng major thì chạy; lệch major thì server gửi `upgrade.required`.
- **Không tin runner về quyền.** Runner nói nó thấy thiết bị nào; server quyết định ai được dùng.
- **`job.offer` mang theo snapshot**, không phải con trỏ. Nhờ vậy job lặp lại được, và hai job song
  song không đọc hai phiên bản registry khác nhau.

  **Cập nhật 24/09/2026 — runner nay thật sự đọc snapshot.** Trường này đã có trong `JobSpec` từ P1
  nhưng chưa runner nào dùng tới, nên hàng đợi chỉ chạy được feature có sẵn trên đĩa runner. Nay job
  mang snapshot được chạy trong một thư mục riêng (`.testpilot/jobs/<id>/`, xem
  [jobWorkspace.ts](src/runner/jobWorkspace.ts)): feature và registry dựng từ snapshot, một config dẫn
  xuất chỉ ghi đè ba đường dẫn, và một cơ sở duyệt kịch bản TRỐNG — vì cơ sở của runner sẽ kéo một
  file trùng tên đã sửa về "chờ duyệt" và kịch bản ấy biến khỏi lượt chạy không một lời. Phần học
  được luôn đi về qua `registryProposal`, vì registry trong thư mục job bị xoá khi xong.

  Người dùng đầu tiên là workflow của App Automation Studio: máy chọn cắm ở runner khác thì workflow
  đặt job lên hàng đợi thay vì `runSuite` tại chỗ ([remoteRuns.ts](src/server/remoteRuns.ts)).

  Giới hạn còn lại: job mang snapshot **chưa chạy song song** được — worker từ chối rõ ràng thay vì
  lặng lẽ chạy song song trên `features/` của máy ấy.

  **"Bản đã tải lên" đi sang runner ở xa (24/09/2026).** Trước đó runner ở xa cài bản build nằm trên
  đĩa của CHÍNH nó — có thể là bản cũ — rồi báo kết quả như thể đã chạy trên bản vừa tải lên. Nay:

  - Lúc đặt job, máy chủ tính bản build bằng đúng phép `run.ts` dùng (`applyEnv` rồi `<platform>.app`,
    kèm cả phép chặn "môi trường không có bản riêng thì không rơi về bản mặc định"), gói thành
    `RunSuiteParams.appBuild` kèm SHA-256 ([appBuilds.ts](src/server/appBuilds.ts)).
  - Runner tải về qua `GET /api/runner/build?job=<id>` — nó chỉ đưa MÃ JOB, không đưa đường dẫn, và chỉ
    runner đang giữ job mới lấy được. Kiểm hash, giữ đệm theo hash, trần ba bản
    ([appBuild.ts](src/runner/appBuild.ts)). Đo qua loopback: 205 MB tải và kiểm trong 0,6 giây; lần
    hai lấy từ đệm.
  - Config dẫn xuất trỏ bản build vào file ấy ở MỌI môi trường — chỉ trỏ bản gốc thì một
    `environments.sit.android.app` riêng của laptop vẫn thắng.
  - Chốt cuối ở phía runner: runner đứng riêng KHÔNG BAO GIỜ tự cài bản trên đĩa của nó cho một job
    "bản đã tải lên" không kèm bản build — nó dừng bằng một câu.
  - Worker nhúng trong máy chủ bỏ qua `appBuild`: nó chung đĩa và chung config với máy chủ, nên bản
    trong config của nó đã là bản đúng. Đường chạy tại chỗ dùng hằng ngày không đổi gì.

  Chưa gửi được: bản `.app` của simulator iOS (một THƯ MỤC, cần đóng gói), và lượt song song bắc cả
  Android lẫn iOS (một trường không chứa được hai bản build). Cả hai dừng bằng câu nói rõ lý do khi máy
  nằm ở runner khác; máy cắm ở chính máy chủ thì chạy như trước.

---

## 6. Hàng đợi và giữ chỗ thiết bị

**Một chiếc máy đang bị giữ hay không được TÍNH từ bảng `lease`, không đọc từ một cột.** Cột
`device.state` chỉ còn nói về tình trạng vật lý và hành chính: `idle`, `offline`, `quarantined`.
Hai giá trị `leased` và `busy` còn trong `CHECK` của migration 0001 nhưng không dòng code nào ghi
chúng, và không nên — một cột mirror là nguồn sự thật thứ hai, và nó sẽ lệch khỏi bảng `lease` vào
đúng lúc tệ nhất: khi một tiến trình chết giữa hai lệnh ghi.

Thuật toán ghép job với thiết bị:

1. Job vào `queued` kèm **yêu cầu**: platform, tag, thiết bị cụ thể hoặc điều kiện
   (`android, os>=13`), tổ chức, người tạo.
2. Scheduler chỉ xét thiết bị mà người tạo được phép dùng:
   - `visibility=private` → chỉ chủ runner và người được chia sẻ;
   - `visibility=shared` → mọi thành viên trong tổ chức.
3. Chọn thiết bị `idle` và runner `online` có năng lực phù hợp. Lấy lease trong **một transaction**
   (`SELECT … FOR UPDATE`), nên hai scheduler chạy song song không thể cấp cùng một máy.
4. Gửi `job.offer`. Runner không `accept` trong 30s → nhả lease, job về `queued`, runner bị trừ điểm
   tin cậy.
5. Trong lúc chạy, runner `lease.renew` mỗi 30s. Quá hạn (mất mạng, gập máy) → lease hết hiệu lực,
   job thành `interrupted`, thiết bị về `idle`. Logic này khớp với phần đã có:
   `closeInterruptedRuns` ([src/core/runstore.ts:130](src/core/runstore.ts)) và
   `OrphanTracker` ([src/core/orphans.ts](src/core/orphans.ts)).
6. Công bằng: hàng đợi theo tổ chức, quota số job chạy đồng thời, ưu tiên theo `priority`, chống một
   người chiếm hết máy.

Job nhiều thiết bị (`runSuiteParallel`, [src/ui/server.ts:559](src/ui/server.ts)) giữ nguyên tinh
thần: **lấy tất cả lease cùng lúc, hoặc không lấy gì cả**, để tránh hai job chờ chéo nhau.

---

## 6b. Người giữ máy, không chỉ job

Điều khiển thiết bị từ trình duyệt — xem màn hình trực tiếp, tự chạm để dò một bước hỏng — là một
yêu cầu đã chốt (2026-09-22). Nó đổi một điều trong mục 6, và đổi ở chỗ sâu nhất:

**Một con người đang cầm máy chiếm chỗ trong CÙNG bảng `lease` mà scheduler đọc.** Nếu việc giữ ấy
dùng một cơ chế riêng, sẽ có hai câu trả lời cho "ai đang giữ máy này", và scheduler — vốn chỉ đọc
một câu — sẽ giao máy cho một job trong lúc có người đang bấm trên màn hình. Kiểu hỏng đó không báo
lỗi: job chỉ đơn giản chạy sai, vì màn hình không ở nơi nó tưởng. Nên `lease.holder_kind` có đúng
hai giá trị `job` | `human`, và `UNIQUE (device_id)` phân xử cả hai.

Ba hệ quả:

1. **Nhịp tim, không phải "nhả khi đóng tab".** Tab bị gập laptop, mất mạng, hay bị kill thì không
   gửi được gì. Thứ duy nhất chịu được cả ba là im lặng thì mất quyền: lease sống 60s, tab gia hạn
   mỗi 30s, nên một chiếc máy bị bỏ rơi rỗi lại trong ≤90s.
2. **Một hình dạng phân quyền mới.** Tới trước mục này, mọi quyền đều quyết định được bằng VAI, nên
   `authorize()` ở cửa là đủ. Ở đây không: `runner_user` được giữ một chiếc máy rỗi, nhưng không ai
   — kể cả `maintainer` — nhả được lease của người khác, vì thứ quyết định là *ai đang giữ*, một
   thuộc tính của dữ liệu chứ không của người gọi. Nên vai kiểm ở cửa, quyền-của-người-giữ kiểm ở
   tầng kho, và việc lấy máy khỏi tay người đang dùng là một route RIÊNG đòi `admin` kèm lý do —
   để cái quyền ấy đọc được từ bảng policy, không phải từ thân một handler.
3. **Video không đi qua kênh log.** `JobEvent` có `seq` để nối lại log sau khi mất mạng; khung hình
   thì vô nghĩa khi phát lại, và một hàng đợi có thứ tự cho chúng chỉ làm độ trễ dồn lại. Nên
   stream là một kênh RIÊNG, và mỗi khung chỉ đi khi người gọi đang giữ lease.

**Phần thực thi Android, đã đo ngày 22/09/2026 trên emulator API 36.** Nguồn video là
`adb exec-out screenrecord --output-format=h264`, không phải scrcpy và không phải chụp ảnh theo
nhịp:

| Cách | Một khung | Năm giây | Tốc độ |
|---|---|---|---|
| `screencap -p` theo nhịp | 1,39 MB, 1,9–2,6 giây | ~7 MB | 0,5 khung/giây |
| `screenrecord` H.264 720x1600 | — | **37 KB** | tốc độ khung của máy |

Tức là chụp ảnh liên tục không phải "chậm hơn một chút" mà là một thứ khác hẳn: hai mươi lần băng
thông cho một phần tư số khung.

**Cập nhật 23/09/2026: scrcpy đi trước, `screenrecord` thành đường lui.** Độ trễ đã thành vấn đề, và
phần đắt nhất không phải hình mà là ĐẦU VÀO: mỗi cú chạm ở đường cũ là một lần `adb shell input`,
tức dựng cả một cái shell trên máy. Đo trên emulator API 36:

| | `adb shell input` | socket scrcpy |
|---|---|---|
| một cú chạm | p50 **74 ms**, p90 85 ms | p50 **0 ms**, p90 1 ms |
| tốc độ khung lúc vuốt | 3,6–5,9 /giây | 4,8–7,5 /giây |

Một cú quét ở đường cũ là MỘT lệnh rồi máy tự nội suy; ở đường mới là một chuỗi điểm cách nhau
16 ms, nên ứng dụng nhận được vận tốc thật và tính được quán tính sau khi nhấc tay.

Giá phải trả, nói thẳng: một file jar 717 KB nằm trong repo
([vendor/scrcpy](vendor/scrcpy/README.md)) và được đẩy lên `/data/local/tmp` mỗi phiên. Đó là điều
trước đây ta tránh — "không đẩy nhị phân nào lên máy người dùng". Nó vẫn là một sự đánh đổi thật,
nên `screenrecord` KHÔNG bị gỡ: scrcpy cần `adb reverse` và quyền chạy `app_process`, và khi một
trong hai thứ ấy bị chặn thì hệ thống tụt về đường cũ chứ không báo lỗi không xem được màn hình.

Kênh truyền là **SSE, không WebSocket**, và đó là lựa chọn theo con số: 6 KB/s đo được, base64 làm
nó thành 8 KB/s — SSE tải thoải mái, không thêm phụ thuộc `ws` nào, và đi qua đúng cấu hình nginx đã
kiểm cho SSE ở P2.6. Khi đổi sang scrcpy thì kênh ấy là nhị phân và lúc ấy mới cần WebSocket; hai
header `Upgrade`/`Connection` đã có sẵn trong [infra/nginx/testpilot.conf](infra/nginx/testpilot.conf)
để lúc đó không phải đi tìm vì sao nginx trả 400.

**Phần thực thi iOS** đi đường khác hẳn, và đó là sự thật của nền tảng chứ không phải một thiếu
sót cần gộp lại: iOS không có `adb`, và không lệnh nào trên máy chủ chạm được vào màn hình một
chiếc iPhone. Đường duy nhất là WebDriverAgent — một ứng dụng chạy TRÊN máy ấy, do Appium dựng và
cài. Video là MJPEG ở cổng 9100; đầu vào là W3C actions và `mobile:` script qua `execute/sync`.

Ba con số định hình thiết kế ấy (simulator iPhone 17 Pro, iOS 26.5, 22/09/2026):

| Đo | Giá trị | Hệ quả |
|---|---|---|
| Dựng phiên lần đầu | 184 giây | Phiên được GIỮ LẠI giữa các lần xem; giao diện nói "đang dựng WebDriverAgent" |
| Dựng phiên lần sau | 4 giây | Người thứ hai không phải chờ |
| MJPEG | 900–1200 KB/s | Gấp trăm lần H.264 — MJPEG không nén liên khung |
| Màn hình đứng yên | **47 khung giống hệt nhau** | Bỏ khung trùng: 900 KB/s thành gần như không tốn gì |

Toạ độ iOS là **điểm** (402x874) chứ không phải pixel (1206x2622); W3C actions đi theo điểm, nên đó
là hệ mà control plane công bố. Nhầm sang pixel làm mọi cú chạm lệch đúng ba lần — lệch đều đặn thì
trông như "ứng dụng hỏng" chứ không như "toạ độ sai".

Và phím thì khác nhau theo nền tảng: iPhone không có nút Quay lại, nên `CONTROL_KEYS_BY_PLATFORM`
cho iOS chỉ có `home`, `enter`, `delete`. Giao diện không vẽ nút không tồn tại, thay vì vẽ rồi để
nó báo lỗi khi bấm.

Xem [FARM-PLAN.md](FARM-PLAN.md) P3.7 về lý do không lấy GADS làm hub.

---

## 7. Log, artifact và báo cáo

Hôm nay: log đi trực tiếp từ `spawn` ra SSE ([src/ui/server.ts:3477](src/ui/server.ts)), report nằm
trên đĩa local, `MAX_REPORTS = 50`.

Mục tiêu:

```
runner --(job.event, có seq)--> server --(ghi job_event)--> Postgres
                                   └----(SSE như hiện tại)--> trình duyệt
runner --(link có chữ ký)--> S3/MinIO        (ảnh, video, trace, report)
```

- **UI không phải sửa nhiều.** `streamJob()` ([ui/src/lib/streamJob.ts](ui/src/lib/streamJob.ts)) vẫn
  đọc SSE với hai kênh `log` và `run`. Chỉ thay nguồn phát.
- Nối lại bằng `GET /api/run/attach?since=<seq>`, mở rộng từ endpoint đã có
  ([src/ui/server.ts:522](src/ui/server.ts)).
- Artifact có retention theo tổ chức; `DEFAULT_RETENTION`
  ([src/core/runstore.ts:51](src/core/runstore.ts)) thành giá trị mặc định cấp tổ chức.
- Reverse proxy phải **tắt buffering** và nới timeout cho đường SSE.

---

## 8. Xác thực và phân quyền

Ba loại danh tính, không trộn lẫn:

| Loại | Cấp cho | Cách cấp | Thời hạn |
|---|---|---|---|
| Session người dùng | người | OIDC / SSO, cookie `HttpOnly` `Secure` `SameSite=Lax` | theo phiên |
| Runner token | một runner | tạo trên web, hiện một lần, lưu dạng hash | dài, có thể thu hồi và đổi |
| Job token | một job | server sinh khi cấp job | bằng thời gian job |

Vai trò: `admin` (tổ chức, runner, quota) · `maintainer` (registry, feature, duyệt đề xuất) ·
`runner_user` (chạy job, đăng ký runner của mình) · `viewer` (chỉ đọc report).

Secrets: mỗi tổ chức có secret riêng, lưu trong secret manager, **không nằm trên đĩa runner**.
Job chỉ nhận đúng những tên nó cần, qua `secret.grant`, giữ trong RAM. `.testpilot.secrets.json`
([src/core/secrets.ts](src/core/secrets.ts)) chỉ còn dùng cho chế độ `embedded`.

Phiên đăng nhập trình duyệt (`.testpilot/sessions/`) có giá trị như credential: mã hoá, tách theo
tổ chức, không bao giờ đưa vào artifact.

---

## 9. Chế độ embedded — bản local không được vỡ

Chế độ này là **cùng một code, nhét vào một process**:

- `src/server/http.ts` bật cờ `mode=embedded`: bỏ auth, người dùng mặc định là `local`, tổ chức
  mặc định là `local`;
- transport của runner là gọi hàm trực tiếp thay vì WebSocket;
- lưu trữ là SQLite, hoặc giữ nguyên các file JSON hiện tại trong giai đoạn chuyển tiếp;
- artifact vẫn ghi vào `runs/`, `reports/`.

Nhờ vậy `npm run ui`, `npm run run:web`, `npm run gen` và toàn bộ CLI vẫn chạy trên máy không mạng.

---

## 9b. Thiết bị cắm vào máy người dùng (`personal`)

Người dùng vẫn làm việc **hoàn toàn trên web**; chỉ phần chạy test diễn ra trên máy họ. Trình duyệt
không chạm được USB, nên không có cách nào tránh việc cài một tiến trình nền:

```bash
npx @testpilot/runner login --token <token lấy trên web>
npx @testpilot/runner start
```

Một lượt chạy:

```
Bấm "Chạy" trên web → server tạo job, thấy thiết bị private của chính người đó
   → job.offer qua WebSocket runner đã mở sẵn từ máy user
   → runner nhận snapshot feature+registry, secret ngắn hạn, tải build nếu cần
   → chạy Appium/Playwright ngay trên máy đó
   → stream log theo seq, upload artifact lên S3, gửi delta registry làm đề xuất
   → web hiển thị giống hệt khi chạy ở lab
```

**Chạy ở đâu:**

| Thành phần | Nơi chạy |
|---|---|
| Web UI, đăng nhập, hàng đợi, DB, artifact | server |
| Appium, adb, Xcode, Playwright, WebDriverAgent, điện thoại | máy user |
| `runtime-registry.json`, `device-env.json` | máy user |
| API key, mật khẩu tài khoản test | server cấp theo job, giữ trong RAM runner, không ghi xuống đĩa |
| Build APK/IPA | server giữ bản dùng chung; runner tải về, hoặc user trỏ file trên máy mình |

**Khác thiết bị lab ở những điểm sau, và UI phải nói ra:**

| | Thiết bị lab | Thiết bị máy user |
|---|---|---|
| Điều kiện chạy | luôn sẵn sàng | **máy phải bật và runner đang chạy** |
| Ai thấy | cả tổ chức | mặc định chỉ mình (`private`), chia sẻ được |
| Hàng chờ | có thể phải chờ | gần như chạy ngay |
| Chạy đêm / CI | được | chỉ khi máy còn bật — không nên đặt lịch đêm |
| Gián đoạn | hiếm | gập máy, hết pin, đổi Wi-Fi → `interrupted`, lease được nhả |
| Mạng tới app cần test | theo cấu hình lab | theo mạng của máy user — **lợi thế: khỏi cần gateway ở P6** |
| Băng thông | trong lab | video/trace đi qua mạng nhà họ; cần nén và cho tắt quay video |
| iOS | lab lo ký và trust | **user tự ký WebDriverAgent và trust chứng chỉ** |

**Điều kiện để người ta dám cài runner lên máy làm việc:** chỉ nhận các `kind` job đã định nghĩa,
không nhận shell tuỳ ý; chỉ mở kết nối ra, không mở port; chỉ đọc trong thư mục làm việc đã khai
báo; có nút tạm dừng ở cả hai phía và thu hồi token bất cứ lúc nào; audit log ghi rõ job nào đã
chạy trên máy họ.

**Hỗn hợp:** một lượt chạy có thể dùng web test ở lab và native test ở máy user cùng lúc —
scheduler cấp hai lease ở hai runner rồi gộp report, đúng như `runSuiteParallel` đang làm với nhiều
thiết bị trên một máy.

---

## 10. Phần mạng (làm sau, nhưng chừa chỗ sẵn)

Chưa làm bây giờ, nhưng kiến trúc phải chừa chỗ, nếu không sau này phải sửa lại scheduler:

- `org_network_profile(org_id, kind, config)` với `kind`: `none | proxy | gnirehtet | connector | vpn_gateway`;
- `job.offer` mang theo `network` mà runner phải áp dụng trước khi chạy và **dọn sau khi chạy**, kể cả
  khi job bị huỷ (nếu để sót proxy, điện thoại mất mạng);
- preflight của runner phải kiểm tra thật: gọi một URL staging trước khi bắt đầu.

Chi tiết các lựa chọn (gnirehtet, `adb reverse` + proxy, connector kiểu BrowserStack Local, VLAN
riêng cho lab) sẽ viết thành tài liệu riêng khi tới giai đoạn đó.

---

## 11. Các kiểu hỏng và cách xử lý

| Hỏng | Hôm nay | Sau khi làm |
|---|---|---|
| Web server restart giữa lượt chạy | mất lượt chạy, history treo `running` | job vẫn chạy trên runner; UI nối lại theo `seq` |
| Runner mất mạng | không có khái niệm này | lease hết hạn → job `interrupted`, thiết bị được nhả |
| Hai người sửa cùng element | bản sau ghi đè bản trước, im lặng | 409 kèm diff |
| Điện thoại rút ra giữa lượt | Appium lỗi, thiết bị vẫn hiện | runner báo `devices`, thiết bị thành `offline`, job fail có lý do rõ |
| Runner phiên bản cũ | không phát hiện | `upgrade.required` |
| Một người chiếm hết máy | không chặn được | quota và hàng đợi theo tổ chức |
| Job treo vô hạn | chỉ có cách kill tay | timeout ở cả hai phía, huỷ có thứ tự |

---

## 12. Những điều cố tình không làm

- **Server không chạy lệnh thiết bị.** Nếu cần thêm một lệnh mới, nó thành một `kind` job, không
  thành một endpoint `spawn`.
- **Không có shell tuỳ ý từ server xuống runner.** Cả khi tiện. Đây là điều kiện để người ta dám cài
  runner lên máy làm việc.
- **Không để runner ghi trực tiếp vào registry dùng chung.** Chỉ gửi đề xuất.
- **Không phát Appium với `--allow-insecure` ra ngoài localhost.** Cờ này ở
  [src/ui/server.ts:3891](src/ui/server.ts) chỉ được tồn tại bên trong runner.
- **Không bắt buộc phải có server để làm việc.** Chế độ embedded là tính năng, không phải di sản.
