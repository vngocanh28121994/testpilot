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

/** Bộ repo mà một route nhận được. P2.4 thay nguyên bộ bằng bản Postgres. */
export interface Repos {
  registry: RegistryRepo;
  jobs: JobRepo;
  runs: RunRepo;
}
