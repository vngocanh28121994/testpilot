/**
 * Hợp đồng duy nhất giữa control plane và runner.
 *
 * Vì sao là một gói riêng chứ không nằm trong `src/server` hay `src/runner`:
 * hai bên được phát hành lệch nhau. Runner sống trên máy lab và trên máy cá
 * nhân của từng người, nên bất cứ thứ gì chỉ một bên biết đều trở thành thứ
 * bên kia đoán. Kiểu dữ liệu ở đây là nơi duy nhất nói ra sự thật, và
 * `PROTOCOL_VERSION` ([version.ts](./version.ts)) là thứ hai bên đối chiếu.
 *
 * Hai quy tắc khi sửa file này:
 *  1. Trường mới phải TUỲ CHỌN. Runner cũ bỏ qua được thì minor là đủ.
 *  2. Đổi nghĩa một trường đang có là đổi MAJOR, kể cả khi kiểu không đổi.
 *
 * Xem [FARM-ARCHITECTURE.md](../../FARM-ARCHITECTURE.md) mục 5 để biết luồng.
 */
import type { Platform } from '../core/types.js';

/** Mã job. Tập đóng — thêm một loại là một quyết định kiến trúc, không phải tiện tay. */
export type JobKind = 'run_suite' | 'gen' | 'workflow' | 'pom' | 'crawl' | 'prereq' | 'device_scan';

export type JobState =
  | 'queued' | 'assigned' | 'running'
  | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';

/** Runner chạy ở đâu và cho ai. `embedded` là bản local hôm nay. */
export type RunnerMode = 'embedded' | 'lab' | 'personal' | 'farm';

export type DeviceState = 'idle' | 'leased' | 'busy' | 'offline' | 'quarantined';

/* ------------------------------------------------------------------ */
/* Runner → server                                                     */
/* ------------------------------------------------------------------ */

/**
 * Lời chào, gửi một lần mỗi khi nối kết nối.
 *
 * `capabilities` là thứ scheduler dùng để ghép job, nên nó phải là điều runner
 * ĐO ĐƯỢC chứ không phải điều nó mong. Một runner nói mình có Xcode mà không
 * có thì job iOS vẫn rơi vào nó và fail giữa chừng — đắt hơn nhiều so với từ
 * chối ngay.
 */
export interface RunnerHello {
  type: 'hello';
  token: string;
  mode: RunnerMode;
  name: string;
  os: string;
  arch: string;
  protocolVersion: string;
  agentVersion: string;
  capabilities: RunnerCapabilities;
}

export interface RunnerCapabilities {
  platforms: Platform[];
  appium?: { version: string; drivers: string[] };
  xcode?: { version: string; sdk?: string };
  androidSdk?: { adb: string };
  playwright?: { version: string; browsers: string[] };
  /** Lối ra mạng runner áp dụng được (P6). Rỗng nghĩa là chỉ mạng của chính máy. */
  network?: string[];
}

/**
 * Toàn bộ thiết bị runner nhìn thấy, gửi lại mỗi khi có thay đổi.
 *
 * Gửi CẢ DANH SÁCH chứ không gửi delta: một chiếc máy bị rút ra giữa chừng là
 * sự vắng mặt, và sự vắng mặt không có sự kiện nào để gửi. Danh sách đầy đủ
 * làm cho "biến mất" trở thành một trạng thái quan sát được.
 */
export interface DeviceReport {
  type: 'devices';
  devices: DeviceInfo[];
}

export interface DeviceInfo {
  id: string;
  platform: Platform;
  name: string;
  udid?: string;
  osVersion?: string;
  state: DeviceState;
  /** Vì sao không dùng được. Bắt buộc khi `state` là `offline`/`quarantined`. */
  stateReason?: string;
}

export interface Heartbeat {
  type: 'heartbeat';
  at: string;
  runningJobIds: string[];
  /** 0..1. Scheduler dùng để không dồn hết job vào một máy đang ngộp. */
  load?: number;
}

export interface JobAccept {
  type: 'job.accept';
  jobId: string;
}

/**
 * Từ chối job, kèm lý do đọc được.
 *
 * `retryable` quyết định số phận của job: hết đĩa là chuyện của runner này
 * (job quay lại hàng đợi, máy khác nhận), còn thiếu Xcode thì gửi đi đâu cũng
 * thế — trả job vào hàng đợi lúc ấy chỉ tạo một vòng lặp bận rộn.
 */
export interface JobReject {
  type: 'job.reject';
  jobId: string;
  reason: string;
  retryable: boolean;
}

/**
 * Một dòng đời của job. `seq` tăng đơn điệu trong phạm vi một job.
 *
 * Có `seq` thì UI nối lại được sau khi server restart hoặc tab đóng — đó là
 * toàn bộ lý do nó tồn tại. Xem `GET /api/run/attach?since=<seq>`.
 */
export interface JobEvent {
  type: 'job.event';
  jobId: string;
  seq: number;
  at: string;
  event:
    | { kind: 'log'; line: string }
    | { kind: 'stage'; run: unknown }
    | { kind: 'artifact'; artifact: ArtifactRef }
    | { kind: 'warning'; message: string };
}

export interface ArtifactRef {
  kind: 'report' | 'screenshot' | 'video' | 'trace' | 'log' | 'apk';
  /** Khoá trong object storage, không phải đường dẫn trên máy runner. */
  key: string;
  bytes?: number;
  sha256?: string;
}

/**
 * Kết thúc job.
 *
 * `registryProposal` là thứ runner ĐỀ XUẤT, không phải thứ nó đã ghi. Runner
 * không bao giờ ghi thẳng vào registry dùng chung — xem mục 4b của tài liệu
 * kiến trúc. Nội dung chính là `Registry.changesSinceLoad()` đã có sẵn.
 */
export interface JobResult {
  type: 'job.result';
  jobId: string;
  state: Extract<JobState, 'succeeded' | 'failed' | 'cancelled' | 'interrupted'>;
  error?: string;
  scenarios?: { total: number; passed: number; failed: number; skipped: number };
  artifacts?: ArtifactRef[];
  registryProposal?: unknown;
}

export interface LeaseRenew {
  type: 'lease.renew';
  jobId: string;
  deviceIds: string[];
}

export type RunnerMessage =
  | RunnerHello | DeviceReport | Heartbeat
  | JobAccept | JobReject | JobEvent | JobResult | LeaseRenew;

/* ------------------------------------------------------------------ */
/* Server → runner                                                     */
/* ------------------------------------------------------------------ */

/**
 * Mọi thứ cần để chạy job, mang theo SNAPSHOT chứ không phải con trỏ.
 *
 * Con trỏ nghĩa là runner tự đi đọc registry, và hai runner chạy song song sẽ
 * đọc hai phiên bản khác nhau — đủ để hai lượt chạy "cùng một suite" không so
 * sánh được với nhau. Snapshot cũng là thứ làm cho một job lặp lại được.
 *
 * Các trường của `run` phủ đúng body mà `POST /api/run` đang nhận hôm nay
 * ([src/ui/server.ts:544](../ui/server.ts)); `protocol/__tests__/jobSpecCoversRunApi.test.ts`
 * giữ cho điều đó không trôi.
 */
export interface JobSpec {
  jobId: string;
  orgId: string;
  kind: JobKind;
  createdBy: string;
  timeoutMs: number;
  /** `platform:id`, vì một id trần không nói được nó là máy nào khi cả hai nền tảng cùng có mặt. */
  deviceTokens: string[];
  run?: RunSuiteParams;
  snapshot?: JobSnapshot;
  /** Lối ra mạng runner phải dựng TRƯỚC và dọn SAU, kể cả khi job bị huỷ (P6). */
  network?: { profile: string; config?: Record<string, unknown> };
}

export interface RunSuiteParams {
  platform: string;
  tag?: string;
  headed?: boolean;
  includeQuarantined?: boolean;
  env?: string;
  appSource?: 'device' | 'upload';
  /** Build cần tải về trước khi chạy; khoá trong object storage. */
  appKey?: string;
}

export interface JobSnapshot {
  registryRevision: string;
  /** Nội dung registry và feature tại đúng thời điểm job được tạo. */
  registry: unknown;
  features: Array<{ name: string; content: string }>;
}

export interface JobOffer {
  type: 'job.offer';
  spec: JobSpec;
  /** Runner không `accept` trong khoảng này thì lease bị thu hồi. */
  acceptWithinMs: number;
}

export interface JobCancel {
  type: 'job.cancel';
  jobId: string;
  reason: string;
}

/**
 * Secret cấp cho ĐÚNG một job, sống trong RAM của runner.
 *
 * Không ghi xuống đĩa và không đi vào log hay artifact. Runner cá nhân là máy
 * làm việc của người khác: thứ duy nhất nên còn lại trên đó sau một job là kết
 * quả của job ấy.
 */
export interface SecretGrant {
  type: 'secret.grant';
  jobId: string;
  /** Chỉ những tên job thật sự cần, không phải cả túi. */
  secrets: Record<string, string>;
  expiresAt: string;
}

export interface ConfigPush {
  type: 'config.push';
  logLevel?: 'quiet' | 'normal' | 'verbose';
  uploadEndpoint?: string;
  heartbeatMs?: number;
}

export interface UpgradeRequired {
  type: 'upgrade.required';
  serverProtocol: string;
  reason: string;
  /** Nơi tải bản mới; rỗng nghĩa là người dùng phải tự cập nhật. */
  downloadUrl?: string;
}

export type ServerMessage = JobOffer | JobCancel | SecretGrant | ConfigPush | UpgradeRequired;
