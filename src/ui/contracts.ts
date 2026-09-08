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
import type { WorkflowQuestion, WorkflowRun } from '../core/history.js';
import type { AnswerSubmission } from '../core/questions.js';
import type { HealingRecord } from '../healing/HealingStore.js';
import type { LocatorQuality } from '../core/locatorQuality.js';
import type {
  DeviceCandidate,
  PreflightCheck,
  PreflightFix,
  PreflightResult,
} from '../core/preflight.js';
import type { TagTaxonomyView } from '../core/tagTaxonomy.js';
import type { LearnedActionDef } from '../actions/ActionRegistry.js';
import type { ScenarioReviewEntry } from '../core/scenarioReview.js';
import type { KnownIssue } from '../core/knownIssues.js';

export type {
  TestPilotConfig,
  Platform,
  ScenarioSpec,
  RunReport,
  LocatorCandidate,
  WorkflowRun,
  WorkflowQuestion,
  AnswerSubmission,
  HealingRecord,
  LocatorQuality,
  PreflightResult,
  DeviceCandidate,
  PreflightCheck,
  PreflightFix,
  TagTaxonomyView,
  LearnedActionDef,
  ScenarioReviewEntry,
  KnownIssue,
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
  /** Khoá đi xuyên hệ thống: report, registry và POM đều gọi kịch bản bằng id này. */
  id: string;
  name: string;
  tags: string[];
  platforms: Platform[];
  steps: number;
  review: ScenarioReviewEntry | null;
  /** Nhãn "sản phẩm chưa đáp ứng", còn hiệu lực với đúng nội dung hiện tại. */
  knownIssue: KnownIssue | null;
  /**
   * Từng gắn nhãn, nhưng nội dung kịch bản đã đổi kể từ đó nên nhãn hết hiệu
   * lực. Nói ra thay vì lặng lẽ bỏ, để người gắn hiểu vì sao nó đỏ trở lại.
   */
  knownIssueStale: boolean;
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
  /**
   * Lượt chạy này có log không. Nội dung KHÔNG đi kèm — lấy qua /api/run/log
   * khi người dùng bung ra, vì log là thứ dài nhất mà lại ít được xem nhất.
   */
  hasLog: boolean;
  networkLogUrl: string | null;
  videoUrls?: string[];
  shotUrls?: Array<{ name: string; url: string; onFailure: boolean }>;
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

export interface FeatureMutationResponse {
  ok: true;
  revision?: string;
  content?: string;
  review?: ScenarioReviewEntry;
  reviewed?: number;
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
export interface AwsStatus { ok: boolean; source: string; reason?: string; keyHint?: string; expiresInMinutes?: number; canLogin?: boolean }

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
/* GET /api/vocabulary — bảng cú pháp cạnh ô sửa kịch bản              */
/* ------------------------------------------------------------------ */

export interface VocabularyForm {
  id: string;
  group: 'Thao tác' | 'Nhập liệu' | 'Di chuyển' | 'Kiểm tra' | 'Khác';
  /** Mẫu câu phải gõ. */
  doc: string;
  /** Khi nào thì dùng tới nó. */
  hint: string;
}

export interface VocabularyResponse {
  forms: VocabularyForm[];
  /** Chỉ những action đã được duyệt — cái chưa duyệt thì chưa gõ được. */
  actions: Array<{
    id: string;
    label: string;
    phraseTemplate: string;
    parameters: unknown[];
  }>;
  elements: Array<{ id: string; label: string; screen: string }>;
}

/* ------------------------------------------------------------------ */
/* POST /api/feature/normalize                                         */
/* ------------------------------------------------------------------ */

/**
 * Kết quả chuẩn hoá một bản nháp .feature.
 *
 * server.ts dùng đúng kiểu này (DraftNormalization) chứ không khai lại, để hai
 * đầu không thể trôi ra hai hình dạng khác nhau mà tsc vẫn im.
 */
export interface FeatureNormalizeResponse {
  content: string;
  changes: Array<{ line: number; from: string; to: string; reason: string }>;
  /** Những câu vẫn chưa ánh xạ được sang dạng chạy được. */
  unresolved: Array<{ line: number; text: string }>;
  valid: boolean;
  error?: string;
  usedAi: boolean;
  discoveredLater: Array<{ id: string; label: string; screen: string }>;
  /** Action do máy đề xuất, chờ người duyệt. */
  actionProposals: LearnedActionDef[];
  appliedActions: Array<{ id: string; label: string; line: number }>;
  actionAnalysis: { available: boolean; attempted: boolean; reason?: string };
}

/* ------------------------------------------------------------------ */
/* POST /api/actions/review                                            */
/* ------------------------------------------------------------------ */

export interface ActionReviewRequest {
  id: string;
  decision: 'approve' | 'reject';
}

export interface ActionReviewResponse {
  action: LearnedActionDef;
  actions: LearnedActionDef[];
}

/* ------------------------------------------------------------------ */
/* GET /api/prereq/*                                                   */
/* ------------------------------------------------------------------ */

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

export interface PrereqXcodeResponse {
  ok: boolean;
  version?: string;
  path?: string;
  sdk?: string;
  /** Vì sao chưa dùng được, viết cho người sẽ đi sửa nó. */
  reason?: string;
}

export interface PrereqIosDevicesResponse {
  /** Nguyên văn `xcrun xctrace list devices`, gồm cả tiêu đề mục. */
  devices: string[];
  /** Máy thật đang cắm, đã lọc khỏi phần simulator. */
  attached: string[];
}

export interface PrereqAppiumStatusResponse {
  running: boolean;
  /** true khi chính TestPilot đã bật tiến trình này, không phải người dùng. */
  managed: boolean;
}

/* ------------------------------------------------------------------ */
/* GET /api/models                                                     */
/* ------------------------------------------------------------------ */

export interface ModelChoice {
  id: string;
  display_name?: string;
}

export interface ModelsResponse {
  models: ModelChoice[];
  /** true khi danh sách lấy thẳng từ nhà cung cấp, false khi là danh sách mặc định. */
  live: boolean;
  /** Vì sao phải dùng danh sách mặc định. Chỉ có khi `live` là false. */
  reason?: string;
  /** "auto" trên máy chủ này thực ra là model nào. */
  auto?: string;
}

/* ------------------------------------------------------------------ */
/* Cổng duyệt workflow                                                 */
/* ------------------------------------------------------------------ */

/** GET /api/workflow/questions?runId= */
export interface WorkflowQuestionsResponse {
  status: WorkflowRun['status'];
  questions: WorkflowQuestion[];
  /** Số câu còn chờ người trả lời. 0 nghĩa là workflow chạy tiếp được. */
  pending: number;
}

/** POST /api/workflow/answers */
export interface WorkflowAnswersRequest {
  runId: string;
  answers: AnswerSubmission[];
}

export interface WorkflowAnswersResponse {
  remaining: number;
  status: WorkflowRun['status'];
}

/** POST /api/workflow/complete */
export interface WorkflowCompleteRequest {
  runId: string;
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
/* POST /api/feature/known-issue                                       */
/* ------------------------------------------------------------------ */

export interface KnownIssueRequest {
  scenarioId: string;
  /** Bắt buộc khi gắn; bỏ qua khi gỡ. */
  note?: string;
  remove?: boolean;
}

export interface KnownIssueResponse {
  ok: true;
  issue?: KnownIssue;
  removed?: boolean;
}
