# Kế hoạch lấp khoảng cách nghiệp vụ: UI Vanilla → UI React

Ngày lập: 2026-08-28 · Nhánh: `v2`

Tài liệu này **chỉ nói về khoảng cách nghiệp vụ** — thứ người dùng làm được trên
bản Vanilla mà chưa làm được trên bản React. Không bàn về design, token hay kiến
trúc; những phần đó đã xong ở [`UI-MIGRATION-PLAN.md`](UI-MIGRATION-PLAN.md).

---

## 0. Cách đối chiếu, và một cảnh báo về `PHASE-5-COMPARISON.md`

### 0.1 Nguồn của bản Vanilla

Bản Vanilla **đã bị xoá khỏi cây làm việc** ở commit `4a2b380` ("update"). Nó
vẫn còn nguyên trong git. Mọi tham chiếu `app.js:NNN` dưới đây trỏ vào bản tại
`4a2b380^`:

```bash
git show 4a2b380^:src/ui/public/app.js > /tmp/tp-vanilla/app.js
```

Ba file: `app.js` (5.826 dòng), `index.html` (1.042 dòng), `style.css` (2.018
dòng). Phía React: `ui/src/**` (~8.541 dòng TS/TSX kể cả test).

### 0.2 Ba phép đo đã chạy

1. **Tập endpoint.** Liệt kê mọi `/api/*` mà `app.js` gọi (36 route), mọi route
   mà `src/ui/server.ts` phục vụ (41 route), và mọi `ROUTES.*` / `STREAM_ROUTES.*`
   **thực sự được panel React dùng**. Đây là phép đo mạnh nhất: một endpoint
   không ai gọi thì tính năng đứng sau nó không tồn tại trên UI.
2. **Tập màn hình.** 12 `data-page` trong `index.html` ↔ 12 panel trong
   `ui/src/panels/`. Đọc song song từng cặp.
3. **Tập hook chết.** `useTagTaxonomy`, `useEnvBuilds` được khai báo trong
   `ui/src/hooks/useAppState.ts` nhưng **không có nơi nào gọi** — dấu hiệu của
   dữ liệu đã có sẵn mà UI chưa dùng.

### 0.3 Kết quả phép đo 1 — 13 route bị bỏ trống

`ui/src/api/routes.ts` khai báo đủ, nhưng các route sau **không được panel nào
gọi** (chỉ xuất hiện trong chính file khai báo, hoặc trong mock test):

| Route bị bỏ trống                 | Tính năng đứng sau nó                      |
| --------------------------------- | ------------------------------------------ |
| `GET /api/workflow/questions`     | Câu hỏi workflow cần người quyết           |
| `POST /api/workflow/answers`      | Gửi câu trả lời                            |
| `POST /api/workflow/complete`     | **Hoàn thành review → chạy tiếp workflow** |
| `POST /api/feature/normalize`     | Chuẩn hoá câu tự nhiên → step chạy được    |
| `GET /api/actions`                | Từ điển action đã học                      |
| `POST /api/actions/review`        | Duyệt/từ chối action AI đề xuất            |
| `GET /api/vocabulary`             | Bảng cú pháp Gherkin dùng được             |
| `GET /api/models`                 | Danh sách model từ nhà cung cấp            |
| `GET /api/prereq/adb`             | Kiểm tra thiết bị Android                  |
| `GET /api/prereq/xcode`           | Kiểm tra Xcode                             |
| `GET /api/prereq/ios-devices`     | Kiểm tra thiết bị iOS                      |
| `GET /api/prereq/appium/status`   | Sức khoẻ Appium (poll 5s)                  |
| `POST /api/prereq/appium/restart` | Khởi động lại Appium                       |
| `POST /api/prereq/driver`         | Cài/kiểm tra Appium driver                 |

`POST /api/prereq/appium` có được gọi, nhưng chỉ từ `panels/StreamProbe` — một
trang dò SSE của lập trình viên ở route `/probe/stream`, không phải màn Runner.

### 0.4 Cảnh báo: bảng đối chiếu Phase 5 đang lạc quan quá mức

[`ui/PHASE-5-COMPARISON.md`](ui/PHASE-5-COMPARISON.md) đánh dấu mọi bề mặt là
tương đương. Bảng đó đúng ở mức **"trang có tồn tại và render được"**, và nó tự
nói rõ bằng chứng của mình là "route/chunk `runner-*` tồn tại". Nó **không** đo
tới mức thao tác. Ví dụ cụ thể:

- Dòng "Scenario Review — lọc, review, bulk, editor" ✅. Thực tế bản React
  **không có** Workflow Gate, không thêm được kịch bản, không xoá được kịch bản,
  không chuẩn hoá được, và editor sửa **cả file** chứ không sửa một kịch bản.
- Dòng "Local Runner — run/stop/log/report" ✅. Thực tế **không có** một nút
  prereq nào, không chọn được nhiều thiết bị.

Đề nghị: sau khi làm xong kế hoạch này, viết lại `PHASE-5-COMPARISON.md` theo
đơn vị **thao tác**, không theo đơn vị **trang**.

---

## 1. Tóm tắt: 17 khoảng cách, chia 3 mức

Trạng thái: **Mốc 0 và Mốc 1 đã xong** (2026-08-28). Xem §6 và §9.

| #   | Khoảng cách                                                        | Trang                  | Mức    |
| --- | ------------------------------------------------------------------ | ---------------------- | ------ |
| 1   | ~~Workflow Gate: coverage, câu hỏi, "Hoàn thành kịch bản"~~ ✅     | Kịch bản               | **P0** |
| 2   | ~~Studio không dẫn sang gate sau khi sinh xong~~ ✅                | Studio                 | **P0** |
| 3   | Chuẩn hoá kịch bản + AI hiểu kịch bản + duyệt action               | Kịch bản               | **P0** |
| 4   | Nút prereq (Xcode/Appium/adb/driver)                               | Local Runner           | **P0** |
| 5   | Trình soạn Môi trường (role→account, build theo env)               | Studio                 | **P1** |
| 6   | Thêm / Xoá kịch bản                                                | Kịch bản               | **P1** |
| 7   | Chọn nhiều thiết bị + "Máy đang cắm"                               | Local Runner           | **P1** |
| 8   | Chọn model từ `/api/models`                                        | Studio                 | **P1** |
| 9   | ~~Thanh tiến trình theo stage~~ ✅                                 | Studio · Farm · Gate   | **P1** |
| 10  | Tag picker đa tag + taxonomy alias                                 | Runner · Farm · Editor | **P2** |
| 11  | Bộ lọc lịch sử chạy (ngày, platform, phân trang, thời lượng)       | Runner · Farm          | **P2** |
| 12  | E2E History: tab platform, lọc tuần/máy, video có chương           | E2E History            | **P2** |
| 13  | Farm: lọc thiết bị, chỉ máy thật rảnh, lọc tag, hướng dẫn biến env | Device Farm            | **P2** |
| 14  | Bản build sẽ cài + cảnh báo build kế thừa                          | Local Runner           | **P2** |
| 15  | slowMo                                                             | Local Runner           | **P2** |
| 16  | `pomWarnings` sau khi duyệt kịch bản                               | Kịch bản               | **P2** |
| 17  | Bảng cú pháp Gherkin + chèn snippet + Tab thụt lề                  | Kịch bản               | **P2** |

**Điểm quan trọng nhất:** toàn bộ backend cho 17 mục **đã tồn tại và đang chạy**.
Không mục nào cần viết endpoint mới. Đây là công việc thuần front-end cộng với
việc bổ sung type vào `src/ui/contracts.ts`.

---

## 2. P0 — luồng nghiệp vụ đang đứt

### 2.1 Workflow Gate ở màn Kịch bản

**Bản cũ:** `index.html:174-215` (khối `#workflowGate`), `app.js:1908`
(`renderWorkflowGate`), `app.js:1837` (`renderWorkflowQuestions`), `app.js:1892`
(`collectAnswers`), `app.js:2001` (`submitWorkflowAnswers`), `app.js:2029`
(`completeActiveWorkflow`).

**Bản mới:** không có gì. `grep -rn "questions\|coverage\|waiting_review\|waiting_input" ui/src/panels ui/src/hooks ui/src/components` trả về **rỗng**.

Đây là khoảng cách nghiêm trọng nhất. Nó không phải một widget bị thiếu — nó là
**chỗ nối giữa bước sinh và bước chạy**. Workflow dừng ở `waiting_review`, và
trên bản React không có nút nào để nó chạy tiếp. Người dùng buộc phải quay ra
CLI.

Gate gồm năm phần, cả năm đều thiếu:

1. **Thanh stage** của lượt workflow đang chờ (`renderStageList`).
2. **Tóm tắt kết quả sinh**: `N testcase · M bước · K ảnh đã phân tích ·
X/Y yêu cầu bắt buộc đã có testcase · tên file`.
3. **Coverage cần bổ sung** — danh sách quy tắc chưa có testcase, đọc từ
   `feature.coverage.missing`. Type `CoverageView`/`CoverageMissing` **đã có**
   trong `contracts.ts:96-110`, và `FeatureSummary.coverage` đã được server trả
   về — React chỉ chưa render.
4. **Câu hỏi cần bạn quyết** — form động 3 kiểu (`text` / `radio` / `checkbox`),
   mỗi câu kèm `rationale` và `context.scenario`/`context.line`. Gửi lên
   `POST /api/workflow/answers`; server trả `{ remaining }` để nói còn thiếu
   bao nhiêu câu. Đây là chỗ workflow hỏi lại khi tài liệu mơ hồ, hoặc khi
   healing gặp giả thuyết không được phép tự thử trên account thật.
5. **Nút "Hoàn thành kịch bản và tiếp tục chạy"** — stream
   `POST /api/workflow/complete`, cập nhật stage theo từng khung `run`, rồi hiện
   link report. Điều kiện mở khoá: `status === 'waiting_review'` **và** không
   còn kịch bản `pending` **và** có ít nhất một kịch bản `approved`
   (`app.js:1966`). Dòng gợi ý dưới nút phải nói ra vì sao đang khoá.

**Việc cần làm**

- `src/ui/contracts.ts`: thêm `WorkflowQuestion` (re-export từ
  `core/history.ts:82`), `WorkflowAnswersRequest`, `WorkflowAnswersResponse`,
  `WorkflowQuestionsResponse`.
- `ui/src/panels/ScenarioReview/WorkflowGate.tsx` — component gate.
- `ui/src/panels/ScenarioReview/hooks/useWorkflowGate.ts` — chọn run đang chờ
  từ `state.runs`, mutation gửi answers, `useStreamJob` cho `workflowComplete`.
- Route `/scenarios` nhận thêm search param `runId` để Studio dẫn sang đúng gate.

**Nghiệm thu:** với `state` mock có một run `waiting_review` kèm 2 câu hỏi và 1
coverage thiếu — gate hiện, nút hoàn thành bị khoá; trả lời đủ câu hỏi →
`remaining: 0`; duyệt hết kịch bản → nút mở; bấm → SSE chạy, stage cập nhật.

### 2.2 Studio không dẫn sang gate

**Bản cũ:** `app.js:897-906` — khi `/api/gen` kết thúc với
`lastRun.status === 'waiting_review'`, tự động `navigate('scenario-review', runId)`.

**Bản mới:** `ui/src/panels/Studio/index.tsx:74` gọi `useStreamJob('studio-workflow', STREAM_ROUTES.gen)`
rồi in log. Hết. Người dùng nhìn log báo "chờ duyệt" và không biết đi đâu.

**Việc cần làm:** đọc khung `run` cuối từ `useStreamJob`; nếu
`status === 'waiting_review'` thì `navigate({ to: '/scenarios', search: { runId } })`.
Phụ thuộc 2.1.

### 2.3 Chuẩn hoá kịch bản, AI hiểu kịch bản, duyệt action

**Bản cũ:** `app.js:3218` (`rvNormalizePanel`), `app.js:3272`
(`rvRenderScenarioPlan`), `app.js:3344` (`rvRenderActionProposals`).

**Bản mới:** không có. `POST /api/feature/normalize` và `POST /api/actions/review`
không được gọi ở đâu.

Ba thứ gắn liền nhau trong một vòng:

- **✦ Chuẩn hoá** — người dùng viết câu tiếng Việt tự nhiên, bấm nút, server
  (có AI) đổi thành step chạy được. Không có nút này thì người dùng phải thuộc
  lòng cú pháp Gherkin của TestPilot mới viết được kịch bản.
- **AI hiểu kịch bản** (`scenarioPlan`) — bảng nói lại cách hệ thống hiểu:
  mục tiêu, màn hình, các bước phân loại theo `precondition` / `navigation` /
  `focusRegion` / `action` / `assertion`, kèm cờ `confidence < 0.8` → "Cần người
  dùng kiểm tra lại cách hiểu này". Đây là bề mặt kiểm soát AI duy nhất trước
  khi test được sinh.
- **Đề xuất action** (`actionProposals`) — khi AI gặp câu chưa có action tương
  ứng, nó đề xuất `macro` / `alias` / `capability mới`, kèm kế hoạch thực thi.
  Duyệt → `POST /api/actions/review` → tự chuẩn hoá lại. Action `primitive`
  chưa có adapter thì nút hiện "Cần adapter" và bị khoá.

Trạng thái nút Lưu phụ thuộc kết quả: `result.valid === false` → khoá nút Lưu
(`app.js:3244`). Bản React hiện luôn cho Lưu, nên có thể ghi xuống đĩa một file
mà runner không chạy được.

**Việc cần làm**

- `src/ui/contracts.ts`: `NormalizeRequest`, `NormalizeResponse`
  (`content`, `valid`, `changes`, `usedAi`, `discoveredLater`, `appliedActions`,
  `actionAnalysis`, `scenarioPlan`, `actionProposals`), `ScenarioPlanView`,
  `ActionProposalView`, `ActionsReviewRequest`. Dẫn xuất từ
  `src/steps/scenarioPlan.ts` và `src/actions/ActionRegistry.ts`, không chép tay.
- `ui/src/panels/ScenarioReview/ScenarioEditor.tsx` — sheet sửa **một kịch bản**
  (không phải cả file), có nút Chuẩn hoá.
- `ui/src/panels/ScenarioReview/ScenarioPlan.tsx`, `ActionProposals.tsx`.

**Nghiệm thu:** mock `normalize` trả `valid: false` + 1 proposal → nút Lưu khoá,
thẻ proposal hiện; duyệt proposal → gọi lại normalize → `valid: true` → nút Lưu mở.

### 2.4 Nút prereq ở Local Runner

**Bản cũ:** `index.html:419-535` (khối `#prereqBlock`), `app.js:4319-4470`.

**Bản mới:** `ui/src/panels/Runner/index.tsx:162` — `PreflightCard` **chỉ đọc**.
Nó nói "Chưa sẵn sàng chạy" và liệt kê mục đỏ, nhưng không có cách nào sửa từ UI.

Sáu hành động bị mất:

| Nút                    | Endpoint                                | Vì sao cần                                                                                                                                                              |
| ---------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ⟳ Kiểm tra Xcode       | `GET /api/prereq/xcode`                 | iOS cần Xcode đầy đủ, Command Line Tools không đủ                                                                                                                       |
| ▶ Khởi động Appium    | `POST /api/prereq/appium` (SSE)         | Không có nó thì phải mở terminal                                                                                                                                        |
| ↻ Khởi động lại Appium | `POST /api/prereq/appium/restart` (SSE) | Appium treo giữa lúc tải chromedriver **vẫn trả lời `/status`** — nút Khởi động báo "đang chạy" và không sửa gì. Đây chính là lý do nút restart tồn tại (`app.js:4318`) |
| ⟳ adb devices          | `GET /api/prereq/adb`                   | Phân biệt "không thấy máy" với "thấy nhưng chưa `device` state"                                                                                                         |
| ⟳ xctrace list devices | `GET /api/prereq/ios-devices`           | Như trên, cho iOS                                                                                                                                                       |
| Kiểm tra / Cài driver  | `POST /api/prereq/driver` (SSE)         | `uiautomator2` / `xcuitest`                                                                                                                                             |

Cộng thêm **poll sức khoẻ Appium mỗi 5 giây** (`app.js:4364`,
`GET /api/prereq/appium/status`) — chuyển nút về "✓ Đang chạy" hoặc cảnh báo
"⚠ Appium đã dừng" mà không cần bấm gì. Và **khối hướng dẫn iOS tĩnh**
(`index.html:466-490`): tin cậy máy tính, Chế độ nhà phát triển, Web Inspector,
ký WebDriverAgent — bốn thứ không lệnh nào trên máy này đọc được, nên chúng
được _nói ra_ thay vì _kiểm tra_, và chúng là nguyên nhân thường gặp nhất khiến
một máy cài đúng vẫn chạy fail.

**Việc cần làm**

- `src/ui/contracts.ts`: `AdbResponse`, `IosDevicesResponse`, `XcodeResponse`,
  `AppiumStatusResponse`.
- `ui/src/panels/Runner/Prereq.tsx` — các hàng theo platform, output SSE cho
  từng nút, poll status 5s qua `refetchInterval`.
- Giữ nguyên `PreflightCard` — hai thứ bổ sung cho nhau: preflight là _phán
  quyết_, prereq là _cách sửa_.

---

## 3. P1 — thao tác chính bị thiếu

### 3.1 Trình soạn Môi trường (Studio)

**Bản cũ:** `index.html:74-84`, `app.js:717` (`renderEnvEditor`), `app.js:691`
(`envSummary`), `app.js:3795` (`uploadEnvBuild`).

**Bản mới:** `ui/src/panels/Studio/index.tsx:322` — một `<select>` chỉ đọc, liệt
kê `Object.keys(cfg.environments)`. Không tạo, không sửa, không xoá được môi
trường từ UI.

Mỗi môi trường trả lời đúng hai câu hỏi: **vai trò nào ứng với account nào**, và
**cài gói nào**. Bản cũ có:

- Thẻ thu gọn/mở, kèm dòng tóm tắt: `tcbs → user_a · ipa + apk · https://…`,
  và cảnh báo `⚠ chưa có build riêng` cho môi trường không phải mặc định.
- Radio "Mặc định", **đi theo khi đổi tên** — đổi tên môi trường mặc định thì
  `defaultEnv` được cập nhật theo, thay vì trỏ vào hư không (`app.js:754`).
- Hàng vai trò `role → <select account>`. Là `<select>` chứ không phải ô chữ:
  gõ sai tên account thì lượt chạy chỉ báo lỗi sau đó rất lâu. Account đã bị xoá
  vẫn hiện dưới dạng `label (không còn)` để nhìn thấy vấn đề (`app.js:788`).
- Upload `.ipa`/`.apk` **theo từng môi trường** — cùng endpoint
  `POST /api/app/upload` với `env=<tên>` và **không** có `persist=1`, vì trình
  soạn là form chưa lưu; ghi thẳng vào config từ một lần upload là lưu hộ những
  sửa đổi chưa ai xác nhận (`contracts.ts:UploadBuildQuery` đã ghi rõ điều này).
- `baseUrl` riêng cho từng môi trường.

Hợp đồng `StudioForm.environments` **đã có sẵn** ở `contracts.ts:225-232` — chỉ
là chưa ai gửi lên.

**Việc cần làm:** `ui/src/panels/Studio/EnvEditor.tsx`; ghép vào `makeForm()`
kèm `defaultEnv`. Tái dùng `uploadBuild` ở `ui/src/api/upload.ts` (bỏ `persist`).

### 3.2 Thêm và Xoá kịch bản

**Bản cũ:** `app.js:2873` (`rvOpenCreatePanel`), `app.js:2502` (`rvDeleteOne`),
`app.js:2510` (`rvBulkDelete`), `app.js:2574` (`askConfirm`).

**Bản mới:** `ui/src/panels/ScenarioReview/index.tsx` — bulk chỉ có
approve/reject. Không thêm, không xoá.

Không cần endpoint mới: cả hai thao tác sửa nội dung file rồi
`PUT /api/feature` với `baseRevision` (`app.js:2603`). Khi thêm, người dùng chọn
file đích từ danh sách **hoặc gõ tên feature mới** — bản cũ tự sinh tên file từ
tiêu đề (`rvFeatureFileName`, `app.js:2643`) và tự dựng khung nội dung
(`rvNewFeatureContent`, `app.js:2656`).

Xoá cần hộp xác nhận. Bản cũ dùng `<dialog>` riêng chứ không dùng `confirm()`
để thông điệp và hành vi bàn phím giống nhau trên mọi trình duyệt
(`index.html:322`). Bản React cần thêm primitive `alert-dialog` — gói
`radix-ui` v1.6.7 **đã có trong `package.json`**, không cần cài thêm.

### 3.3 Chọn nhiều thiết bị ở Local Runner

**Bản cũ:** `app.js:3976` (`renderDevicePicker`), `app.js:3842` (`detectDevices`),
`app.js:3869` (`selectAttached`).

**Bản mới:** `ui/src/panels/Runner/index.tsx:56` — gửi tối đa **một** thiết bị,
lấy từ `preflight.data.device`. Chạy song song trên nhiều máy là tính năng có
trong backend (`npm run run:parallel`, `src/cli/run-parallel.ts`) nhưng không
gọi được từ UI mới.

Bản cũ có: nhóm theo platform, ô tìm theo tên/id/udid, "Chọn tất cả (N)" theo
kết quả lọc, và nút **"⟳ Máy đang cắm"** — dò thiết bị thật đang kết nối rồi tự
tick đúng những máy đó. Chi tiết đáng giữ: danh sách bị lọc, chặn trần và cuộn
trong hộp riêng, vì một phòng lab 30 máy sẽ đẩy nút Chạy ra khỏi màn hình
(`app.js:4001`).

Picker chỉ hiện khi có **từ 2 thiết bị trở lên** trong config
(`app.js:3986`) — một máy thì không có gì để chọn.

### 3.4 Chọn model

**Bản cũ:** `app.js:870` (`loadModels`) — `<select>` nạp từ `GET /api/models`,
kèm dòng gợi ý `auto = claude-opus-5. Danh sách lấy trực tiếp từ nhà cung cấp.`
hoặc `… Đang dùng danh sách mặc định — <lý do>.`

**Bản mới:** `ui/src/panels/Studio/index.tsx:271` — `<Input>` chữ tự do. Gõ sai
tên model thì chỉ biết khi workflow chạy và gọi API thất bại.

Server đã có `FALLBACK_MODELS` và cờ `live`/`reason` (`src/ui/server.ts:100`).

### 3.5 Thanh tiến trình theo stage

**Bản cũ:** `app.js:937` (`renderStageList`) — dùng chung cho Studio
(`#stages`), Device Farm (`#fStages`, `app.js:5479`) và Workflow Gate
(`#workflowReviewStages`). Trạng thái pre-run vẽ sẵn 11 stage từ `IDLE_STAGES`
(`app.js:918`) để người dùng biết workflow sẽ đi qua những gì.

**Bản mới:** Studio và Farm chỉ in `<pre>` log thô. `panels/FarmDetail` và
`panels/History` **có** vẽ stage — nên component đã tồn tại dưới dạng inline;
cần tách ra dùng chung.

**Việc cần làm:** `ui/src/components/StageList.tsx`, nhận `stages` và `idle`.

---

## 4. P2 — chi tiết vận hành

### 4.1 Tag picker đa tag và taxonomy

**Bản cũ:** `app.js:4198` (`mountTagPicker`) dùng ở Runner (`app.js:4312`) và
Farm (`app.js:5163`); `app.js:2625` (`rvKnownTags`), `app.js:2696`
(`rvNormalizeTag`), `app.js:2793` (`rvRenderEditorTags`).

**Bản mới:** Runner và Kịch bản dùng `<select>` **một tag**. Farm **không có ô
tag nào**. `useTagTaxonomy` được khai báo ở `hooks/useAppState.ts:40` và không
ai gọi.

Taxonomy làm hai việc mà `<select>` không làm được: **alias** (`state.tagTaxonomy.aliases`
đổi `dang_nhap` → `dang-nhap`) và **gợi ý tag đã biết** khi gõ tag mới.

### 4.2 Bộ lọc lịch sử chạy

**Bản cũ:** `index.html:545-575` (Runner) và `index.html:775-800` (Farm) — thanh
lọc giống nhau: chọn ngày (flatpickr), dải nút platform (Tất cả/Web/Android/iOS),
nút "✕ Xoá bộ lọc", phân trang 10 dòng (`app.js:1298`, `renderPager`).
Cột **Thời lượng** (`app.js:4679`, `runDuration`).

**Bản mới:** `panels/Runner/index.tsx:264` và `panels/Farm/index.tsx:411` — bảng
phẳng, không lọc, không phân trang, không cột thời lượng. Bảng Farm còn thiếu
cả cột Platform và Stages.

`ui/src/components/DateRangePicker.tsx` và `Pagination.tsx` **đã có** (đang dùng
ở `panels/History`) — chỉ cần lắp vào.

### 4.3 E2E History

**Bản cũ:** `app.js:4699` (`renderReports`), `app.js:4862` (`videoWithChapters`),
`app.js:4960` (`showLatestNetworkLog`), `app.js:5037` (`renderNetworkLines`).

**Bản mới:** `panels/RunnerHistory/index.tsx` — dãy nút chọn run, iframe report,
ảnh chụp, network log dạng chữ thô, log.

Thiếu:

- **Tab theo platform.** Bản cũ dùng tab cho 3 platform (tập cố định) và bảng
  cho các lượt chạy (tăng vô hạn). Bản mới đổ tất cả vào một dãy nút — chạy 50
  lượt thì dãy nút đó không còn là điều hướng nữa.
- **Lọc theo tuần và theo thiết bị.** Option chỉ sinh từ dữ liệu có thật, nên
  không bao giờ có lựa chọn trả về rỗng. Lọc theo máy là câu hỏi mà device pool
  sinh ra để trả lời: "máy nào fail".
- **Bảng lượt chạy 7 cột** (Thời gian · Kết quả · Pass · Fail · Thời lượng ·
  Tag · Thiết bị) thay cho dãy nút.
- **Video có chương** — nhảy tới đúng scenario, và tự tua qua phần cài app +
  tạo session Appium. Offset tính ở trình duyệt vì chỉ trình duyệt biết
  `video.duration`. **Ba trường `wholeVideoUrls`, `chapters`, `testSeconds`
  server đã trả về** (`src/ui/server.ts:1149-1151`) nhưng
  `ReportView` trong `contracts.ts:168-186` **thiếu cả ba** — nên phía React
  không nhìn thấy chúng. `panels/FarmDetail` hiện dùng `<video>` trần.
- **Network log tô màu** theo status code.

### 4.4 Device Farm

**Bản cũ:** `index.html:634-660`, `app.js:5341` (`renderDevices`).

Thiếu ở bản mới:

- **Ô lọc thiết bị** theo tên/hãng/phiên bản OS. Danh sách Device Farm dài hàng
  trăm dòng.
- **"Chỉ thiết bị thật đang rảnh"** — bỏ máy ảo và máy đang bận.
- **Lọc theo tag** cho lượt chạy farm (`#fTagPicker` → `TESTPILOT_TAG`). Không
  có nó thì mỗi lần chạy farm là chạy cả suite, mà **phút thiết bị là tiền thật**.
- **Hướng dẫn biến môi trường** (`index.html:690-730`) — bảng ba biến tích hợp
  sẵn, cộng cảnh báo: testspec được upload lên S3 **dưới dạng văn bản thuần**,
  đừng để password/token ở đó.
- **`fPoolNote`** — dòng mô tả pool đang chọn.

Ghi chú: cảnh báo dài về `sendSecrets` ở `index.html:748-753` đã bị rút thành
nhãn một dòng "Gửi secret đã cấu hình vào farm". Nội dung bị mất là nội dung
bảo mật (mật khẩu đi vào testspec, testspec lưu theo lịch sử run trên S3, nên
đổi mật khẩu sau khi test xong). Nên khôi phục.

#### 4.4b Kết nối AWS — ✅ **ĐÃ SỬA** (2026-08-28)

Phát hiện khi người dùng báo "không tìm thấy cách đăng nhập AWS" ở `/farm`. Ba
lỗi, hai trong số đó **không** phải hồi quy của bản React — bản Vanilla gác nút
y hệt ở `app.js:5107`.

1. **Màn hình không nói ra vì sao không có nút đăng nhập.** Ba nguyên nhân khác
   hẳn nhau — chưa cài AWS CLI, không có phiên nào để đăng nhập, phiên hết hạn —
   cùng rơi vào một câu lỗi tiếng Anh của AWS SDK và một nút "Kiểm tra lại" bấm
   bao nhiêu lần cũng ra đúng câu đó.
2. **`canLogin` bỏ rơi người dùng `AWS_PROFILE`.** `awsStatus()` đòi
   `source === '~/.aws hoặc IAM role của máy'`, mà `credentialSource()` trả
   `profile "xxx"` ngay khi biến đó được set — nên cách dựng IAM Identity Center
   phổ biến nhất không bao giờ thấy nút. Trong khi `awsLogin()` ở cùng file vẫn
   đọc `process.env.AWS_PROFILE` và dựng `aws sso login --profile xxx`.
3. **`keyHint` và hạn dùng bị đánh rơi.** Server luôn gửi `keyHint`,
   `expiresInMinutes`; bản React chỉ hiện `Nguồn: X`. Hạn dùng mới là thứ quyết
   định một lượt farm 20 phút có sống tới lúc thu artifact hay không.

Đã sửa:

- `src/farm/devicefarm.ts`: thêm `AwsLoginPlan` (`kind`, `command`, `cliFound`,
  `profile`) và hàm `loginPlan()` thay cho phép so chuỗi. Profile có tên chỉ
  được chào mời khi nó **thật sự là profile SSO** — profile mang static key
  không có gì để đăng nhập, và `loginCommand` sẽ rơi về `aws login` vốn ghi
  `login_session` root đè lên cấu hình Identity Center.
- `src/ui/contracts.ts`: `AwsStatus` chuyển sang **dẫn xuất** từ
  `farm/devicefarm.ts` thay vì chép tay. Bản chép tay đã lệch đúng như ràng buộc
  3 cảnh báo — nó thiếu `expiresAt` và khai `canLogin` là tuỳ chọn.
- `ui/src/panels/Farm/index.tsx`: thêm `LoginHelp` nói ra nguyên nhân và lệnh sẽ
  chạy; `credentialLine()` khôi phục `key ABCD… · còn N phút`, đổi màu cảnh báo
  dưới 15 phút.
- `src/report/html.ts`: bỏ một import `Chapter` chết. Nó chỉ lộ ra vì
  `devicefarm.ts` nay nằm trong TS program của `ui/`, nơi bật `noUnusedLocals`.

Test: `ui/src/panels/Farm/__tests__/AwsConnection.test.tsx` — 6 test khoá cả bốn
trạng thái, gồm cả nhánh profile SSO không tái hiện được trên máy dev.

### 4.5 Bản build sẽ cài, ở Local Runner

**Bản cũ:** `index.html:396-418`, `app.js:3732` (`renderAppPaths`).

Thẻ **chỉ đọc** ngay trên màn Runner, đọc vài giây trước khi bấm chạy: đường dẫn
`.apk`/`.ipa` sẽ được cài, kích thước, và một cảnh báo cụ thể:

> ✕ Chưa có build riêng cho "uat" — đang trỏ về `build/sit/app.apk` của "sit".
> Chạy sẽ bị chặn; tải build lên ở màn hình Bản build.

File tồn tại và cài được — _đó mới là chỗ nguy hiểm_: mọi môi trường của app
dùng chung một bundle id, nên cài gói của môi trường mặc định ở đây nghĩa là
đăng nhập vào nó bằng account của môi trường này. Runner chặn; thẻ này nói ra
trước khi bấm. `state.envBuilds` đã có, `useEnvBuilds` đã khai báo và **không ai
gọi**.

### 4.6 slowMo

`index.html:540`, `app.js:4640` (`saveSlowMo`). Chỉ hiện khi `platform === 'web'`
**và** đã tick headed. Không có ở bản React.

### 4.7 `pomWarnings` sau khi duyệt

`app.js:5670` (`withPomWarnings`), dùng ở `app.js:2473` (duyệt một kịch bản) và
`app.js:2559` (duyệt hàng loạt). Khi binding phải đoán — ví dụ một nhãn khớp hai
control khác nhau — kết quả trả về `pomWarnings`. Bản cũ hiện chúng ở trạng thái
**trung tính, không phải xanh**: duyệt thì thành công thật, nhưng một step có thể
đang trỏ nhầm control, và dấu tick xanh là cách để chuyện đó trôi qua không ai
để ý.

**Đây còn là một lỗ hợp đồng, không chỉ là UI thiếu.** Server trả về **hai**
trường khác nhau: `pomWarnings` (mảng, khi đồng bộ POM thành công nhưng phải
đoán — `server.ts:420, 471, 538`) và `pomWarning` (chuỗi, khi đồng bộ POM hỏng
hẳn — `server.ts:433, 480, 545`). `FeatureMutationResponse` ở `contracts.ts:267`
**chỉ khai `pomWarning`**, nên `pomWarnings` vô hình với TypeScript phía React.
Phải thêm `pomWarnings?: string[]` vào contract ở Mốc 0, rồi hiển thị bằng toast
trung tính.

### 4.8 Bảng cú pháp Gherkin

`app.js:2924` (`rvToggleSyntax`), `app.js:2958` (`rvRenderSyntax`), `app.js:3051`
(`rvInsertSnippet`) — đọc `GET /api/vocabulary`, liệt kê những câu **chạy được**,
bấm vào một dòng để chèn vào editor, có ô tìm. Nạp lại mỗi lần mở (không cache
theo vòng đời trang), vì một element vừa được đăng ký lúc chuẩn hoá phải xuất
hiện ngay.

Kèm theo: `app.js:3415` (`rvEditorKeydown`) — Tab thụt lề, Shift+Tab bỏ thụt
lề, và xử lý `keyCode 229` để không nuốt phím Enter khi bộ gõ tiếng Việt
(Telex/VNI) đang ghép ký tự. **Chi tiết này phải giữ**: bỏ đi thì gõ tiếng Việt
trong editor bị nhân đôi từ đang gõ.

---

## 5. Việc phải làm trước: bổ sung `src/ui/contracts.ts`

Không panel nào ở mục 2-4 viết được cho tới khi có type. Làm một lượt, trước
mọi việc khác — đây cũng là chỗ TypeScript bắt lệch hợp đồng thay vì để nó nổ ở
trình duyệt.

| Nhóm       | Type cần thêm                                                                      | Dẫn xuất từ                                       |
| ---------- | ---------------------------------------------------------------------------------- | ------------------------------------------------- |
| Workflow   | `WorkflowQuestion`, `WorkflowAnswersRequest/Response`, `WorkflowQuestionsResponse` | `src/core/questions.ts`, `src/core/history.ts:82` |
| Normalize  | `NormalizeRequest/Response`, `ScenarioPlanView`, `ActionProposalView`              | `src/steps/scenarioPlan.ts`, `src/genspec/*`      |
| Actions    | `ActionsResponse`, `ActionsReviewRequest`                                          | `src/actions/ActionRegistry.ts`                   |
| Prereq     | `AdbResponse`, `IosDevicesResponse`, `XcodeResponse`, `AppiumStatusResponse`       | `src/ui/server.ts`                                |
| Models     | `ModelsResponse { models, live, reason, auto }`                                    | `src/llm/client.ts`                               |
| Report     | **Thêm 3 trường vào `ReportView`**: `wholeVideoUrls?`, `chapters?`, `testSeconds?` | `src/report/videoIndex.ts`                        |
| Feature    | **Thêm `pomWarnings?: string[]`** vào `FeatureMutationResponse` (xem 4.7)          | `src/ui/server.ts:420`                            |
| Vocabulary | Thay `actions: unknown[]` bằng type thật                                           | `src/steps/vocabulary.ts`                         |

Ba ràng buộc ở đầu `contracts.ts` vẫn áp dụng: không `node:*`, không giá trị
runtime, dẫn xuất chứ không chép tay.

---

## 6. Thứ tự thực thi

Chia theo **luồng nghiệp vụ đóng được**, không theo trang — để mỗi mốc là một
thứ dùng được, không phải một nửa màn hình.

### Mốc 0 — Hợp đồng · ~0,5 ngày · ✅ **ĐÃ XONG** (2026-08-28)

Toàn bộ mục 5. Cộng `ui/src/test/mocks/handlers/` cho các route mới.

**Xong khi:** `npm run typecheck` xanh, mock trả đúng hình dạng.

Đã làm:

- `src/ui/contracts.ts`: thêm 23 type mới cho workflow gate, normalize, actions,
  models và prereq; re-export `WorkflowQuestion`, `WorkflowStage`, `QuestionKind`,
  `AnswerSubmission`, `ScenarioPlan(+Step,+StepKind)`, `LearnedActionDef(+Kind,
+Parameter,+Status)`, `Chapter`.
- `ReportView` nhận ba trường video mà server vẫn trả về nhưng contract không có:
  `wholeVideoUrls`, `chapters`, `testSeconds`.
- `FeatureMutationResponse` nhận `pomWarnings?: string[]` — lỗ hợp đồng ở §4.7.
- `ui/src/test/mocks/handlers/workflow.ts` cho ba route của gate; `fixtures.ts`
  thêm `gateState()` và `gateQuestions`.
- `fixtures.ts` còn thiếu bốn khoá config mà server LUÔN gửi (`sources`,
  `targetFeature`, `workflow`, `llm`); Studio đọc thẳng `cfg.workflow.platforms`
  nên fixture cũ làm panel ném TypeError trước cả assertion đầu tiên.

### Mốc 1 — Đóng vòng workflow · ~3–4 ngày · ✅ **ĐÃ XONG** (2026-08-28)

Mục 2.1 + 2.2 + 3.5. Sau mốc này, một người có thể: sinh kịch bản ở Studio →
được dẫn sang gate → thấy coverage và câu hỏi → trả lời → duyệt → bấm hoàn thành
→ test chạy. **Đây là mốc quan trọng nhất; trước nó, bản React không thay thế
được bản Vanilla cho công việc thật.**

**Xong khi:** một E2E Playwright đi hết luồng trên mock. ✅
`ui/e2e/workflow-gate.spec.ts` đi đúng luồng đó với state thay đổi được — duyệt
một kịch bản THỰC SỰ mở khoá nút hoàn thành, chứ không phải một nút cố định.

File mới:

| File                                                    | Vai trò                                                                                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `ui/src/lib/stages.ts`                                  | Tên stage lúc chưa chạy + nhãn trạng thái. Phải CHÉP vì `WORKFLOW_STAGES` là giá trị runtime, không qua được ranh giới `import type` |
| `ui/src/components/StageList.tsx`                       | Danh sách stage dùng chung cho Studio, Farm, FarmDetail và Gate — đúng như `renderStageList` của bản cũ                              |
| `ui/src/panels/ScenarioReview/WorkflowGate.tsx`         | Gate: stage, coverage, form câu hỏi 3 kiểu, nút hoàn thành, link report                                                              |
| `ui/src/panels/ScenarioReview/hooks/useWorkflowGate.ts` | Chọn run, đếm review, chuẩn hoá coverage từ hai nguồn, mutation answers, stream complete                                             |

Hai chỗ cố ý làm KHÁC bản cũ, cả hai đều là cải thiện:

1. **Gate tự tìm lượt đang chờ.** Bản cũ chỉ hiện gate khi tới bằng
   `#scenario-review:<runId>` (app.js:1806) — mở thẳng trang Kịch bản thì gate
   không bao giờ xuất hiện, kể cả khi có workflow đang đợi. Nay không có `runId`
   thì tự chọn lượt `waiting_review`/`waiting_input` gần nhất.
2. **Studio truyền cả `file` lẫn `runId`** khi điều hướng, thay vì ép bộ lọc file
   từ bên trong như bản cũ. Cùng kết quả, nhưng không có coupling ẩn giữa gate và
   thanh lọc — và URL nói ra được nó đang lọc gì.

Nghiệm thu đã chạy: `npm run typecheck`, `npm run ui:lint` (0 lỗi), `npm run
ui:test` (96 test), `npm run ui:test:e2e` (12 test), `npm run ui:build`.

### Mốc 2 — Sửa được kịch bản · ~4–5 ngày · ✅ **ĐÃ XONG** (2026-08-28)

Mục 2.3 + 3.2 + 4.7 + 4.8. Editor một-kịch-bản trong sheet, chuẩn hoá, plan,
duyệt action, thêm/xoá, hộp xác nhận, bảng cú pháp, Tab thụt lề + xử lý IME.

**Xong khi:** unit test cho vòng normalize → proposal → duyệt → normalize lại;
E2E cho thêm và xoá. ✅

Đã làm: sheet sửa đúng một kịch bản, khoá Lưu khi normalizer báo không hợp lệ,
hiển thị plan/action proposal và chuẩn hoá lại sau khi duyệt; thêm/xoá (có hộp
xác nhận); vocabulary nạp lại mỗi lần mở, chèn snippet, Tab/Shift+Tab và bảo vệ
IME. Cảnh báo `pomWarnings`/`pomWarning` hiện trung tính sau review, bulk,
lưu và xoá. Nghiệm thu: `npm run ui:test` (97 test) và `npm run ui:test:e2e`
(13 test).

### Mốc 3 — Chạy được trên máy thật · ~3–4 ngày · ✅ **ĐÃ XONG** (2026-08-28)

Mục 2.4 + 3.3 + 4.5 + 4.6. Prereq, poll Appium, chọn nhiều thiết bị, "Máy đang
cắm", thẻ bản build, slowMo.

**Xong khi:** mock trả `ok: false` cho preflight → hiện đúng nút sửa; chọn 2
thiết bị → body gửi lên có 2 phần tử. ✅

Đã làm: panel prerequisite theo platform (Appium có poll 5 giây, khởi động lại,
adb/Xcode/xctrace, driver và hướng dẫn iOS); picker nhiều máy có tìm, chọn tất
cả và “Máy đang cắm”; thẻ build theo môi trường, và slowMo chỉ hiện ở web
headed rồi lưu trước lượt chạy. Nghiệm thu: `npm run ui:test` (99 test) và
`npm run ui:test:e2e` (14 test), gồm body chạy có hai token thiết bị.

### Mốc 4 — Cấu hình môi trường · ~2–3 ngày · ✅ **ĐÃ XONG** (2026-08-28)

Mục 3.1 + 3.4. Trình soạn môi trường, upload build theo env, chọn model.

**Xong khi:** thêm môi trường + gán vai trò + upload → `POST /api/studio/save`
gửi đúng `environments` và `defaultEnv`. ✅

Đã làm: editor môi trường (role → account, URL, default, đổi tên/xoá), upload
APK/IPA theo env không tự persist, và model selector dùng `/api/models` với lý
do fallback. E2E xác minh body lưu có environment, gán role và build env.

### Mốc 5 — Đọc được kết quả · ~3–4 ngày · ✅ **ĐÃ XONG** (2026-08-28)

Mục 4.2 + 4.3. Bộ lọc lịch sử, tab platform, lọc tuần/máy, video có chương,
network log tô màu. ✅

Đã làm: lọc ngày/platform/phân trang cho lịch sử local và farm; E2E History có
tab platform, lọc tuần/thiết bị, bảng lượt chạy, video chapter và network log
tô màu. Nghiệm thu: `npm run ui:test` (99 test), `npm run ui:test:e2e` (15
test), typecheck và build.

### Mốc 6 — Farm và tag · ~2–3 ngày · ✅ **ĐÃ XONG** (2026-08-28)

Mục 4.1 + 4.4. Tag picker đa tag + taxonomy, lọc thiết bị farm, lọc tag farm,
hướng dẫn biến env, khôi phục cảnh báo `sendSecrets`. ✅

Đã làm: picker đa tag tái sử dụng taxonomy/alias ở Runner, Farm và bộ lọc
kịch bản; Farm lọc theo tên/hãng/OS và chỉ máy thật đang sẵn sàng, mô tả pool
đang chọn, tự gửi tag qua `TESTPILOT_TAG`, hướng dẫn ba biến tích hợp và cảnh
báo S3 plaintext khi bật `sendSecrets`. Nghiệm thu: `npm run ui:typecheck`,
`npm run ui:test` (99 test), `npm run ui:test:e2e` (15 test) và build.

**Tổng: ~18–24 ngày công.** Còn lại sau Mốc 0+1: ~14–19 ngày.

---

## 7. Rủi ro

| Rủi ro                                                       | Cách chặn                                                                                                                                                                                    |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PHASE-5-COMPARISON.md` nói đã xong → dễ bỏ qua kế hoạch này | Viết lại bảng đó theo đơn vị thao tác ngay sau Mốc 1                                                                                                                                         |
| Bản Vanilla đã bị xoá, mất tham chiếu                        | Mọi mục ở đây đã ghi `app.js:NNN` tại `4a2b380^`. Cân nhắc giữ một bản chỉ-đọc ở `docs/legacy-ui/` trong lúc migrate                                                                         |
| Editor sửa cả file (React) vs sửa một kịch bản (Vanilla)     | Đây là **khác biệt hành vi**, không chỉ khác giao diện: `baseRevision` bảo vệ ghi đè, nhưng hai người sửa hai kịch bản trong cùng file sẽ chặn nhau. Chuyển sang editor một-kịch-bản ở Mốc 2 |
| Bộ gõ tiếng Việt trong editor Gherkin                        | Port nguyên `keyCode 229` từ `app.js:3415`. Test thủ công bằng Telex — jsdom không mô phỏng IME                                                                                              |
| Video chapters phụ thuộc `video.duration`                    | Chỉ tính trong `loadedmetadata`, `{ once: true }`. Không tin `duration` trước đó                                                                                                             |
| Poll Appium 5s có thể gây nhiễu khi UI server hot-reload     | Bản cũ nuốt lỗi và giữ trạng thái cuối (`app.js:4390`). Giữ nguyên cách đó: `retry: false`, không hiện lỗi giả                                                                               |

---

## 8. Những gì **không** thiếu

Ghi lại để khỏi làm lại:

- **Healing Center** — ngang bằng, hơn ở phần thẻ thống kê. Chỉ mất nút "Xem đủ"
  để mở rộng locator dài (nay là cắt chữ + tooltip). Không đáng làm riêng.
- **Dashboard** — ngang bằng, hơn ở thanh tiến độ duyệt.
- **Personal Settings** — ngang bằng. Chỉ thiếu `<datalist>` gợi ý tên tool MCP
  sau khi probe; bản React đã bù bằng cách tự điền các ô còn trống.
- **Điều hướng** — đủ 14 mục, 6 placeholder giữ nguyên `why`. Bản mới nhóm lại
  theo công việc, tốt hơn danh sách phẳng.
- **Bản build** — ngang bằng, hơn ở thanh tiến trình upload.
- **Workflow History** (`/scenarios/history`) — ngang bằng, hơn ở lọc ngày và
  phân trang.
