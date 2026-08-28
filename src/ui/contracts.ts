/**
 * Hợp đồng giữa `src/ui/server.ts` và app React ở `ui/`.
 *
 * Vì sao file này tồn tại: `server.ts` không `export` một ký hiệu nào, và mọi
 * handler đều trả về object literal ẩn danh. Nên từ phía `ui/` chỉ có đúng bốn
 * thứ có tên để `import type` — TestPilotConfig, ScenarioSpec, RunReport,
 * Platform — còn hình dạng phản hồi của 41 route thì không có gì để nhập.
 * Xem UI-MIGRATION-PLAN.md §6.1b.
 *
 * ---------------------------------------------------------------------------
 * BA RÀNG BUỘC, đừng phá:
 *
 * 1. KHÔNG import `node:*` ở đây. File này bị kéo vào TS program của trình
 *    duyệt. `src/config.ts` có import node:fs, và đó là lý do tsconfig.app.json
 *    phải khai `"types": ["vite/client", "node"]` (§6.1a) — đừng làm cho danh
 *    sách đó dài thêm.
 *
 * 2. KHÔNG có giá trị runtime — chỉ `type`/`interface`. Phía `ui/` chỉ được
 *    `import type` qua ranh giới này, và ESLint chặn cứng chiều còn lại (§6.1c).
 *
 * 3. Dẫn xuất từ type miền có sẵn, đừng chép tay. Nhiều handler trả về
 *    `{ ...record, thêm vài trường }`; viết lại HealingRecord ở đây là tạo ra
 *    một bản sao sẽ lệch đi trong im lặng ở lần sửa đầu tiên.
 * ---------------------------------------------------------------------------
 */

import type { TestPilotConfig } from '../config.js';
import type { Platform, ScenarioSpec, RunReport, LocatorCandidate } from '../core/types.js';
import type {
  QuestionKind,
  WorkflowQuestion,
  WorkflowRun,
  WorkflowStage,
} from '../core/history.js';
import type { AnswerSubmission } from '../core/questions.js';
import type { HealingRecord } from '../healing/HealingStore.js';
import type { LocatorQuality } from '../core/locatorQuality.js';
import type { PreflightResult } from '../core/preflight.js';
import type { TagTaxonomyView } from '../core/tagTaxonomy.js';
import type { ScenarioReviewEntry } from '../core/scenarioReview.js';
import type {
  ScenarioPlan,
  ScenarioPlanStep,
  ScenarioPlanStepKind,
} from '../steps/scenarioPlan.js';
import type {
  LearnedActionDef,
  LearnedActionKind,
  LearnedActionParameter,
  LearnedActionStatus,
} from '../actions/ActionRegistry.js';
import type { Chapter } from '../report/videoIndex.js';
import type {
  AwsLoginPlan,
  AwsStatus as FarmAwsStatus,
} from '../farm/devicefarm.js';

export type {
  TestPilotConfig,
  Platform,
  ScenarioSpec,
  RunReport,
  LocatorCandidate,
  WorkflowRun,
  WorkflowStage,
  WorkflowQuestion,
  QuestionKind,
  AnswerSubmission,
  HealingRecord,
  LocatorQuality,
  PreflightResult,
  TagTaxonomyView,
  ScenarioReviewEntry,
  ScenarioPlan,
  ScenarioPlanStep,
  ScenarioPlanStepKind,
  LearnedActionDef,
  LearnedActionKind,
  LearnedActionParameter,
  LearnedActionStatus,
  Chapter,
};

/* ------------------------------------------------------------------ */
/* Lỗi                                                                 */
/* ------------------------------------------------------------------ */

/** Hình dạng lỗi thường gặp: mọi route đều có thể trả về cái này. */
export interface ApiError {
  error: string;
}

/**
 * Lỗi validate của `PUT /api/config`, sinh từ zod ở server (server.ts:135).
 *
 * `issues` là thứ duy nhất nói được "trường nào sai và sai vì sao". Tầng client
 * phải ưu tiên nó hơn `error` — bỏ qua là toàn bộ màn hình config chỉ còn một
 * dòng "Config không hợp lệ" không hành động được.
 */
export interface ApiValidationError extends ApiError {
  issues: string[];
}

/* ------------------------------------------------------------------ */
/* Kiểu dùng chung                                                     */
/* ------------------------------------------------------------------ */

/**
 * Một file build trên đĩa. `null` = config không trỏ tới đâu cả.
 *
 * `own` tách "môi trường này có build riêng" khỏi "môi trường này thừa hưởng
 * build mặc định". Trên đĩa hai thứ trông y hệt nhau, nhưng runner từ chối
 * chạy cái thứ hai — nên thẻ trạng thái không được hiển thị nó là đã sẵn sàng.
 */
export type Build = { path: string; exists: boolean; sizeMb?: number; own?: boolean } | null;

/** Một lần chạy trong lịch sử, kèm số bước đã xong để vẽ thanh tiến trình. */
export type RunHistoryEntry = WorkflowRun & { stagesDone: number };

/* ------------------------------------------------------------------ */
/* Feature đã sinh — dùng ở Dashboard và Scenario Review               */
/* ------------------------------------------------------------------ */

export interface CoverageMissing {
  id: string;
  rule: string;
  sourceQuote: string;
}

export interface CoverageView {
  decision: string;
  total: number;
  covered: number;
  missing: CoverageMissing[];
  auditedAt: string;
}

export interface ScenarioSummary {
  name: string;
  tags: string[];
  platforms: Platform[];
  steps: number;
  stepTexts: string[];
  review: ScenarioReviewEntry | null;
}

/**
 * Một file .feature như server nhìn thấy nó (server.ts:1031).
 *
 * `error` khác null khi file không parse được. Server VẪN trả file đó về thay
 * vì bỏ qua — lỗi binding chính là thứ cần được sửa, giấu đi thì không ai biết
 * nó tồn tại. Khi ấy `scenarios` rỗng và `background` không có mặt, nên hai
 * trường đó phải chịu được nhánh lỗi.
 */
export interface FeatureSummary {
  name: string;
  content: string;
  revision: string;
  feature: string;
  background?: string[];
  scenarios: ScenarioSummary[];
  coverage: CoverageView | null;
  error: string | null;
}

/* ------------------------------------------------------------------ */
/* GET /api/state                                                      */
/* ------------------------------------------------------------------ */

export interface AccountView {
  label: string;
  username: string;
  /**
   * CHỈ có cờ, KHÔNG BAO GIỜ có mật khẩu. Bất biến này do server giữ
   * (server.ts:820) và là lý do R9 tồn tại. Nếu một ngày ai đó thêm trường
   * `password` vào đây, test ở ui/src/api/__tests__ phải đỏ.
   */
  hasPassword: boolean;
}

export interface StateResponse {
  config: TestPilotConfig;
  /** Khác null khi file config hỏng — UI vẫn render được với giá trị mặc định. */
  configError: string | null;
  configFile: string;
  features: FeatureSummary[];
  elements: number;
  reports: ReportView[];
  runs: RunHistoryEntry[];
  accounts: AccountView[];
  hasApiKey: boolean;
  modelKeys: { deepseek: boolean; gemini: boolean; anthropic: boolean };
  appBuilds: { android: Build; ios: Build };
  /** Khoá theo udid: máy này đang giữ build của môi trường nào. */
  deviceEnv: Record<string, unknown>;
  envBuilds: Record<string, { android: Build; ios: Build }>;
  tagTaxonomy: TagTaxonomyView;
}

/* ------------------------------------------------------------------ */
/* GET /api/history                                                    */
/* ------------------------------------------------------------------ */

export interface HistoryResponse {
  runs: RunHistoryEntry[];
}

/* ------------------------------------------------------------------ */
/* Reports, builds, Studio and Device Farm                             */
/* ------------------------------------------------------------------ */

/** One report directory rendered by the local runner or Device Farm. */
export interface ReportView {
  id: string;
  /** Bản ghi cũ có thể mang platform do runner bên ngoài đặt, nên không ép literal ở boundary. */
  platform: string;
  status: string;
  kind: string;
  startedAt: string;
  finishedAt?: string;
  device?: string;
  tag?: string;
  counters?: { passed: number; failed: number; total: number };
  url: string;
  log?: string;
  networkLogUrl: string | null;
  videoUrls?: string[];
  shotUrls?: Array<{ name: string; url: string; onFailure: boolean }>;
  /**
   * Tập con của `videoUrls` là bản ghi CẢ lượt chạy, không phải từng scenario
   * (server.ts:1149). Chỉ những file này mới có chương và mới cần tua qua phần
   * cài app — bản ghi từng scenario đã bắt đầu đúng chỗ rồi.
   */
  wholeVideoUrls?: string[];
  /** Mốc thời gian từng scenario, tính từ scenario đầu tiên chứ không từ đầu file. */
  chapters?: Chapter[];
  /**
   * Độ dài phần TEST trong bản ghi cả lượt, tính bằng giây.
   *
   * Offset để nhảy qua phần cài app + tạo session Appium phải tính ở trình
   * duyệt (`video.duration - testSeconds`), vì file không mang timestamp tuyệt
   * đối nào để căn, và chỉ trình duyệt biết duration sau `loadedmetadata`.
   */
  testSeconds?: number;
}

export interface BuildInventoryRow {
  env: string;
  isDefault: boolean;
  android: Build;
  ios: Build;
  missing: Array<{ platform: 'android' | 'ios'; path: string }>;
}

export interface BuildsResponse {
  root: string;
  environments: BuildInventoryRow[];
}

export interface StudioAccountInput {
  label: string;
  username: string;
  password?: string;
  previousLabel?: string;
}

export interface StudioForm {
  sources?: string[];
  baseUrl?: string;
  targetFeature?: string;
  accounts?: StudioAccountInput[];
  model?: string;
  note?: string;
  defaultEnv?: string;
  environments?: Record<string, {
    accounts?: Record<string, string>;
    ios?: { app?: string };
    android?: { app?: string };
    web?: { baseUrl?: string };
  }>;
  workflowPlatforms?: Array<'web' | 'android' | 'ios'>;
  workflowEnv?: string;
  workflowHeaded?: boolean;
  workflowDeviceFarm?: { platform: 'android' | 'ios' } | null;
  workflowDevices?: { android?: string; ios?: string } | null;
}

export interface StudioSaveResponse {
  ok: true;
  accounts: AccountView[];
}

export interface FeatureSaveRequest {
  filename: string;
  content: string;
  create?: boolean;
  baseRevision?: string;
}

export interface FeatureReviewRequest {
  filename: string;
  scenarioName: string;
  decision: 'approve' | 'reject';
}

export interface FeatureReviewBulkRequest {
  items: Array<Pick<FeatureReviewRequest, 'filename' | 'scenarioName'>>;
  decision: 'approve' | 'reject';
}

/**
 * Hai trường cảnh báo POM là HAI thứ khác nhau, không phải một trường viết sai
 * số nhiều — cả hai đều do server trả về và cả hai đều phải hiện ra:
 *
 * - `pomWarnings` (mảng): đồng bộ POM THÀNH CÔNG nhưng binding phải đoán, ví dụ
 *   một nhãn khớp hai control (server.ts:420, 471, 538). Hiện ở tông TRUNG TÍNH,
 *   không phải xanh: thao tác thành công thật, nhưng có step có thể đang trỏ
 *   nhầm control, và dấu tick xanh là cách để chuyện đó trôi qua không ai để ý.
 * - `pomWarning` (chuỗi): đồng bộ POM HỎNG HẲN (server.ts:433, 480, 545).
 */
export interface FeatureMutationResponse {
  ok: true;
  revision?: string;
  content?: string;
  review?: ScenarioReviewEntry;
  reviewed?: number;
  pomWarnings?: string[];
  pomWarning?: string;
}

export interface FarmForm {
  region?: string;
  projectArn?: string;
  devicePoolArn?: string;
  platform?: 'android' | 'ios';
  testPackagePath?: string;
  testSpecPath?: string;
  runName?: string;
  jobTimeoutMinutes?: number;
  videoCapture?: boolean;
  sendSecrets?: boolean;
  env?: Record<string, string>;
  bundle?: boolean;
}

export interface FarmApiResponse<T> { ok: boolean; data?: T; error?: string; hint?: string }
export interface FarmProject { arn: string; name: string }
export interface FarmPool { arn: string; name: string; type: string; platforms?: Array<'android' | 'ios'> }
export interface FarmDevice {
  arn: string;
  name: string;
  manufacturer: string;
  os: string;
  formFactor: string;
  availability: string;
}
/**
 * Dẫn xuất, KHÔNG chép tay — đúng ràng buộc 3 ở đầu file.
 *
 * Bản chép tay trước đây đã lệch đúng như ràng buộc đó cảnh báo: nó thiếu
 * `expiresAt`, và khai `canLogin` là tuỳ chọn trong khi server luôn gửi. Màn
 * Device Farm vì thế không đọc được hạn dùng của credential — thứ quyết định
 * một lượt chạy 20 phút có sống nổi tới lúc thu artifact hay không.
 */
export type { AwsLoginPlan };
export type AwsStatus = FarmAwsStatus;

/* ------------------------------------------------------------------ */
/* GET /api/healing · POST /api/healing/review                         */
/* ------------------------------------------------------------------ */

export type HealingRecordView = HealingRecord & {
  /**
   * Candidate đang thực sự đứng đầu registry HÔM NAY.
   *
   * Khác với `current` trong bản ghi healing, vốn là ảnh chụp tại thời điểm
   * sự cố. Bảng duyệt không được trình bày ảnh chụp như thể là trạng thái
   * sống — đó là cách người duyệt chấp nhận một thay đổi đã lỗi thời.
   */
  primary: LocatorCandidate | null;
  quality: LocatorQuality;
};

export interface HealingResponse {
  policy: { minSuccesses: number; minRuns: number };
  records: HealingRecordView[];
  summary: {
    total: number;
    proposed: number;
    watching: number;
    applied: number;
    rejected: number;
  };
}

export interface HealingReviewRequest {
  id: string;
  action: 'apply' | 'reject';
}

/* ------------------------------------------------------------------ */
/* PUT /api/config                                                     */
/* ------------------------------------------------------------------ */

export interface SaveConfigResponse {
  ok: true;
  /** Config đã qua zod — có đủ giá trị mặc định mà form không gửi lên. */
  config: TestPilotConfig;
}

/* ------------------------------------------------------------------ */
/* POST /api/model-key                                                 */
/* ------------------------------------------------------------------ */

export type ModelProvider = 'anthropic' | 'deepseek' | 'gemini';

export interface ModelKeyRequest {
  provider: ModelProvider;
  key: string;
}

/* ------------------------------------------------------------------ */
/* Confluence auth · MCP — cả hai đều chạm bí mật                       */
/* ------------------------------------------------------------------ */

/**
 * Token ĐÃ LƯU không bao giờ được gửi ngược về trình duyệt (server.ts:198) —
 * chỉ có `hasToken`. Nên ô nhập token luôn bắt đầu rỗng kể cả khi đã cấu hình,
 * và dòng trạng thái là thứ duy nhất nói ra điều đó. Xem R9.
 */
export interface ConfluenceAuthResponse {
  email: string;
  hasToken: boolean;
}

export interface ConfluenceAuthRequest {
  email: string;
  token: string;
}

export interface McpTool {
  name: string;
  description?: string;
}

export interface McpToolsResponse {
  tools: McpTool[];
  /** Tên tool server đoán được, dùng để điền hộ các ô còn trống. */
  guess: {
    confluencePage?: string;
    figmaFile?: string;
    confluenceAttachments?: string;
    figmaImage?: string;
  };
}

export interface OkResponse {
  ok: true;
}

/* ------------------------------------------------------------------ */
/* GET /api/preflight                                                  */
/* ------------------------------------------------------------------ */

export type PreflightResponse = PreflightResult;

export interface PreflightQuery {
  platform: Platform;
  device?: string;
}

/* ------------------------------------------------------------------ */
/* GET /api/vocabulary                                                 */
/* ------------------------------------------------------------------ */

export interface VocabularyForm {
  id: string;
  group: string;
  doc: string;
  hint?: string;
}

/** Một action đã duyệt, đúng hình dạng route vocabulary trả về. */
export interface VocabularyAction {
  id: string;
  label: string;
  phraseTemplate: string;
  parameters: LearnedActionParameter[];
}

/** Element có thể chèn vào step dưới dạng tham chiếu `"id"`. */
export interface VocabularyElement {
  id: string;
  label: string;
  screen: string;
}

export interface VocabularyResponse {
  forms: VocabularyForm[];
  actions: VocabularyAction[];
  elements: VocabularyElement[];
}

/* ------------------------------------------------------------------ */
/* POST /api/app/upload                                                */
/* ------------------------------------------------------------------ */

/**
 * Tham số đi ở QUERY STRING, còn body của request CHÍNH LÀ nội dung file
 * (server.ts:558 — `pipeline(req, createWriteStream(temp))`).
 *
 * Đây không phải multipart. Bọc vào FormData sẽ ghi cả boundary vào file .apk
 * và Appium từ chối bản build bằng một thông báo không nhắc gì tới nguyên nhân.
 * Xem UI-MIGRATION-PLAN.md §6.6.
 */
export interface UploadBuildQuery {
  platform: 'android' | 'ios';
  filename: string;
  env?: string;
  /** '1' để ghi luôn vào config. Trình soạn môi trường KHÔNG đặt cờ này. */
  persist?: '1';
}

export interface UploadBuildResponse {
  path: string;
  versionName?: string;
  versionCode?: string;
}

/* ------------------------------------------------------------------ */
/* SSE over POST — 9 route                                             */
/* ------------------------------------------------------------------ */

/**
 * Bốn loại khung mà `stream()` phát ra (server.ts:2668).
 *
 * Dùng POST nên EventSource không dùng được — đây là ràng buộc của thiết kế
 * hiện có, không phải một lựa chọn còn mở. Xem §6.2.
 */
export type JobFrame =
  | { type: 'log'; line: string }
  | { type: 'run'; run: WorkflowRun }
  | { type: 'error'; message: string }
  | { type: 'done'; ok: boolean };

/* ------------------------------------------------------------------ */
/* Workflow gate — questions · answers · complete                      */
/* ------------------------------------------------------------------ */

/**
 * GET /api/workflow/questions?runId= (server.ts:271).
 *
 * `pending` là số câu CHƯA trả lời, không phải tổng số câu: câu đã trả lời vẫn
 * được giữ lại vì chúng chính là hồ sơ giải thích vì sao lượt chạy làm những
 * gì nó đã làm.
 */
export interface WorkflowQuestionsResponse {
  status: WorkflowRun['status'];
  questions: WorkflowQuestion[];
  pending: number;
}

export interface WorkflowAnswersRequest {
  runId: string;
  answers: AnswerSubmission[];
}

/**
 * POST /api/workflow/answers (server.ts:284).
 *
 * Trả lời và chạy tiếp là HAI lời gọi tách nhau, cố ý: câu trả lời được ghi
 * xuống ngay khi tới, nên người điền được nửa form rồi bỏ đi không mất gì, và
 * lượt chạy chỉ nhúc nhích khi `remaining === 0`.
 */
export interface WorkflowAnswersResponse {
  remaining: number;
  status: WorkflowRun['status'];
}

export interface WorkflowCompleteRequest {
  runId: string;
}

/* ------------------------------------------------------------------ */
/* POST /api/feature/normalize                                         */
/* ------------------------------------------------------------------ */

export interface NormalizeRequest {
  content: string;
}

export interface NormalizeChange {
  line: number;
  from: string;
  to: string;
  reason: string;
}

/**
 * Phản hồi của normalizer (server.ts:1287, `DraftNormalization`).
 *
 * `DraftNormalization` là interface CỤC BỘ trong server.ts và server.ts không
 * export gì cả, nên hình dạng bao ngoài phải khai lại ở đây. Các type con thì
 * dẫn xuất — `ScenarioPlan` và `LearnedActionDef` là type miền thật.
 *
 * `valid === false` là điều kiện KHOÁ nút Lưu (app.js:3244). Ghi xuống đĩa một
 * file mà runner không chạy được thì lỗi chỉ lộ ra ở lượt chạy sau đó rất lâu.
 */
export interface NormalizeResponse {
  content: string;
  changes: NormalizeChange[];
  unresolved: Array<{ line: number; text: string }>;
  valid: boolean;
  error?: string;
  /** Có gọi model hay chỉ chạy luật cục bộ. */
  usedAi: boolean;
  /** Element chưa có trong registry; Playwright sẽ tự tìm lúc chạy. */
  discoveredLater: Array<{ id: string; label: string; screen: string }>;
  /** Action AI đề xuất, đang ở trạng thái `proposed` — cần người duyệt. */
  actionProposals: LearnedActionDef[];
  /** Action đã duyệt từ trước và được áp dụng trong lượt chuẩn hoá này. */
  appliedActions: Array<{ id: string; label: string; line: number }>;
  actionAnalysis: { available: boolean; attempted: boolean; reason?: string };
  scenarioPlan: ScenarioPlan;
}

/* ------------------------------------------------------------------ */
/* GET /api/actions · POST /api/actions/review                         */
/* ------------------------------------------------------------------ */

export interface ActionsResponse {
  actions: LearnedActionDef[];
}

export interface ActionsReviewRequest {
  id: string;
  decision: 'approve' | 'reject';
}

export interface ActionsReviewResponse {
  action: LearnedActionDef;
  actions: LearnedActionDef[];
}

/* ------------------------------------------------------------------ */
/* GET /api/models                                                     */
/* ------------------------------------------------------------------ */

/**
 * `auto` là thứ mà lựa chọn "auto" thực sự phân giải ra TRÊN SERVER NÀY — nó
 * phụ thuộc key mà server có, nên trang không thể hardcode (server.ts:models()).
 * `live: false` nghĩa là đang dùng danh sách mặc định, và `reason` nói vì sao.
 */
export interface ModelsResponse {
  models: Array<{ id: string; display_name?: string }>;
  live: boolean;
  reason?: string;
  auto: string;
}

/* ------------------------------------------------------------------ */
/* GET /api/prereq/*                                                   */
/* ------------------------------------------------------------------ */

/** `state` là chuỗi thô của adb: `device`, `unauthorized`, `offline`… */
export interface PrereqAndroidDevice {
  id: string;
  state: string;
  manufacturer?: string;
  model?: string;
  androidVersion?: string;
  kind: 'physical' | 'emulator';
}

export interface PrereqAdbResponse {
  devices: PrereqAndroidDevice[];
}

/** `devices` là các dòng người đọc được; `attached` là máy thật đang cắm. */
export interface PrereqIosDevicesResponse {
  devices: string[];
  attached: string[];
}

export interface PrereqXcodeResponse {
  ok: boolean;
  version?: string;
  path?: string;
  sdk?: string;
  reason?: string;
}

/**
 * `managed` = tiến trình Appium do CHÍNH server này khởi động.
 *
 * Khác `running`: một Appium chạy sẵn từ terminal vẫn `running` nhưng không
 * `managed`, nên nút "Khởi động lại" không có gì để dừng.
 */
export interface PrereqAppiumStatusResponse {
  running: boolean;
  managed: boolean;
  pid?: number;
  lastExit?: { code: number | null; signal: string | null; at: string };
}

export interface PrereqDriverRequest {
  driver: string;
}
