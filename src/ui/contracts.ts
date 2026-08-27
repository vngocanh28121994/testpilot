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
import type { WorkflowRun } from '../core/history.js';
import type { HealingRecord } from '../healing/HealingStore.js';
import type { LocatorQuality } from '../core/locatorQuality.js';
import type { PreflightResult } from '../core/preflight.js';
import type { TagTaxonomyView } from '../core/tagTaxonomy.js';
import type { ScenarioReviewEntry } from '../core/scenarioReview.js';

export type {
  TestPilotConfig,
  Platform,
  ScenarioSpec,
  RunReport,
  LocatorCandidate,
  WorkflowRun,
  HealingRecord,
  LocatorQuality,
  PreflightResult,
  TagTaxonomyView,
  ScenarioReviewEntry,
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
/* GET /api/vocabulary                                                 */
/* ------------------------------------------------------------------ */

export interface VocabularyForm {
  id: string;
  group: string;
  doc: string;
  hint?: string;
}

export interface VocabularyResponse {
  forms: VocabularyForm[];
  actions: unknown[];
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
