/**
 * Chỗ duy nhất control plane được phép chạm vào dữ liệu.
 *
 * Vì sao có lớp này trước khi có Postgres: nếu route gọi thẳng `Registry.load()`
 * và `History.load()` như hôm nay, thì việc đổi nơi lưu sẽ phải sửa trong hàng
 * chục route cùng lúc — một lần đổi lớn, không test được từng phần, đúng kiểu
 * thay đổi làm hỏng một công cụ đang dùng được.
 *
 * Nên thứ tự là: dựng interface, cho hiện thực ĐẦU TIÊN bọc quanh chính các
 * file JSON hiện tại (không đổi hành vi, có test parity chứng minh), rồi sau đó
 * P2.4 chỉ việc thêm hiện thực thứ hai đọc Postgres. Route không biết mình đang
 * nói chuyện với bên nào.
 *
 * Xem [FARM-PLAN.md](../../../FARM-PLAN.md) P0.2 và [FARM-ARCHITECTURE.md](../../../FARM-ARCHITECTURE.md) mục 4.
 */
import { createHash } from 'node:crypto';
import type { ElementRegistry } from '../../core/types.js';
import type { WorkflowRun } from '../../core/history.js';
import type { RunMeta } from '../../core/runstore.js';

/**
 * Phiên bản của một bản ghi: hash của NỘI DUNG, tính giống nhau ở mọi hiện thực.
 *
 * Phải dùng chung một hàm, không phải "cùng một ý tưởng". Bản đầu để mỗi bên
 * tự tính: bản file hash chuỗi JSON đã định dạng (thụt lề hai dấu cách, có
 * xuống dòng cuối), bản Postgres hash chuỗi JSON gọn. Cùng dữ liệu, hai phiên
 * bản khác nhau — nên một `baseRevision` lấy từ bên này không bao giờ khớp ở
 * bên kia, và mọi lệnh ghi có đối chiếu sẽ trả 409 mãi mãi sau khi chuyển kho.
 *
 * Test parity bắt được chuyện đó. Nó là lý do bộ test ấy tồn tại.
 */
export function revisionOf(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

/**
 * Ghi một bản có phiên bản mà không biết mình đang ghi đè ai.
 *
 * Đây là kiểu hỏng đắt nhất của nhiều người dùng, và nó im lặng: hôm nay hai
 * người sửa cùng một element thì bản sau thắng, bản trước biến mất, không ai
 * được báo. Lỗi này tồn tại để chuyện đó thành một câu trả lời nhìn thấy được.
 */
export class RevisionConflictError extends Error {
  constructor(
    readonly expected: string | undefined,
    readonly actual: string | undefined,
    message?: string,
  ) {
    super(
      message
        ?? `Dữ liệu đã đổi ở nơi khác kể từ lúc bạn đọc (bạn dựa trên ${expected ?? 'không có'}, `
          + `hiện tại là ${actual ?? 'không có'}). Đọc lại rồi ghi tiếp, để thay đổi kia không mất.`,
    );
    this.name = 'RevisionConflictError';
  }
}

/** Một bản đọc kèm phiên bản của chính nó, để lần ghi sau có cái mà đối chiếu. */
export interface Versioned<T> {
  data: T;
  /** `undefined` khi chưa từng có dữ liệu — ghi lần đầu không cần đối chiếu gì. */
  revision: string | undefined;
}

export interface RegistryRepo {
  read(): Promise<Versioned<ElementRegistry>>;
  /** Ghi đè toàn bộ. `baseRevision` lệch thì ném `RevisionConflictError`. */
  write(next: ElementRegistry, baseRevision?: string): Promise<Versioned<ElementRegistry>>;
  /**
   * Gộp phần một lượt chạy học được, thay vì ghi đè.
   *
   * Đây là đường mà runner dùng: `Registry.changesSinceLoad()` cho ra đúng
   * hình dạng này. Gộp thì không cần `baseRevision` — delta là "những thứ tôi
   * học thêm", cộng vào bản mới nhất vẫn đúng nghĩa.
   */
  merge(delta: ElementRegistry): Promise<Versioned<ElementRegistry>>;
}

export interface JobRepo {
  /** Mới nhất trước — thứ tự mà mọi màn hình lịch sử đang dựa vào. */
  list(): Promise<WorkflowRun[]>;
  find(id: string): Promise<WorkflowRun | undefined>;
  /** Đóng những lượt còn treo `running` sau khi tiến trình chết. Trả về số đã đóng. */
  closeInterrupted(): Promise<number>;
}

export interface RunRepo {
  list(): Promise<RunMeta[]>;
  find(id: string): Promise<RunMeta | undefined>;
}


/* ── Giữ chỗ thiết bị ─────────────────────────────────────────────────── */

/**
 * Ai đang giữ một chiếc máy, và tới khi nào.
 *
 * Một hợp đồng cho CẢ HAI loại người giữ: một job trong hàng đợi, và một con
 * người đang điều khiển tay từ web. Tách làm hai loại lease là tạo ra hai câu
 * trả lời cho "máy này có rỗi không" — xem migration 0002.
 */
export interface Lease {
  id: string;
  deviceId: string;
  orgId: string;
  holder: LeaseHolder;
  acquiredAt: string;
  expiresAt: string;
  renewedAt?: string;
}

export type LeaseHolder =
  | { kind: 'job'; jobId: string }
  | { kind: 'human'; userId: string };

/**
 * Máy đã có người giữ.
 *
 * Lỗi riêng chứ không phải `false`: người bấm "điều khiển" cần biết máy đang
 * bị AI giữ, và trong bao lâu nữa — "không lấy được" không trả lời được câu
 * nào trong hai câu đó.
 */
export class LeaseTakenError extends Error {
  constructor(readonly current: Lease) {
    super(
      `Thiết bị "${current.deviceId}" đang được `
        + `${current.holder.kind === 'job' ? `job ${current.holder.jobId}` : current.holder.userId}`
        + ` giữ tới ${current.expiresAt}.`,
    );
    this.name = 'LeaseTakenError';
  }
}

/** Mỗi lease sống 60 giây, người giữ gia hạn mỗi 30 giây. */
export const LEASE_TTL_MS = 60_000;

export interface LeaseRepo {
  /**
   * Giữ một máy, hoặc ném `LeaseTakenError`.
   *
   * Phép loại trừ do KHO bảo đảm, không do người gọi kiểm trước rồi ghi sau:
   * giữa "kiểm" và "ghi" luôn còn một khe, và hai người bấm cùng lúc là chuyện
   * bình thường ở một màn hình có danh sách thiết bị.
   */
  acquire(deviceId: string, holder: LeaseHolder, now?: Date): Promise<Lease>;
  /**
   * Đẩy hạn về sau. Chỉ người đang giữ mới gia hạn được.
   *
   * Trả `undefined` khi lease không còn của họ — đã hết hạn và bị người khác
   * lấy, hoặc bị admin cưỡng chế nhả. Người gọi thấy `undefined` thì phải
   * DỪNG dùng máy, chứ không phải lấy lại.
   */
  renew(leaseId: string, holder: LeaseHolder, now?: Date): Promise<Lease | undefined>;
  /** Nhả. `holder` là `undefined` nghĩa là cưỡng chế — chỉ `admin` gọi được. */
  release(leaseId: string, holder?: LeaseHolder): Promise<boolean>;
  /** Những lease còn hiệu lực của tổ chức này. Đã hết hạn thì không tính. */
  list(now?: Date): Promise<Lease[]>;
  find(deviceId: string, now?: Date): Promise<Lease | undefined>;
  /** Xoá lease hết hạn. Trả về số đã xoá. */
  reap(now?: Date): Promise<number>;
}

/** Bộ repo mà một route nhận được. P2.4 thay nguyên bộ bằng bản Postgres. */
export interface Repos {
  registry: RegistryRepo;
  jobs: JobRepo;
  runs: RunRepo;
  leases: LeaseRepo;
}
