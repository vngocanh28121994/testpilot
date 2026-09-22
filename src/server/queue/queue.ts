/**
 * Hàng đợi job: nơi một lượt chạy tồn tại TRƯỚC khi có ai chạy nó.
 *
 * Hôm nay `POST /api/run` chạy ngay trong tiến trình của server và stream log
 * về đúng cái tab đã bấm. Điều đó ổn khi server và thiết bị ở cùng một máy —
 * nhưng nó làm ba thứ trở thành không thể: bấm chạy khi chưa có máy nào rảnh,
 * chạy trên một runner ở máy khác, và biết được có bao nhiêu việc đang chờ.
 *
 * Nên bảng job là NGUỒN SỰ THẬT, và mọi thứ khác đọc từ đó:
 *
 *  - Route tạo job rồi nối vào log của nó. Nó không còn tự chạy gì cả.
 *  - Worker đòi job, chạy, rồi báo kết quả. Ở chế độ embedded worker nằm trong
 *    cùng tiến trình; ở chế độ server nó ở máy có thiết bị.
 *  - Job không ai nhận thì NẰM YÊN ở `queued`. Đó không phải lỗi — đó là câu
 *    trả lời đúng cho "chưa có máy nào rảnh", và là thứ hôm nay không nói được.
 *
 * **Không có Redis.** Kế hoạch ban đầu viết BullMQ để đánh thức worker, nhưng
 * worker nối bằng WebSocket thì server đẩy thẳng, còn tranh job thì
 * `SELECT … FOR UPDATE SKIP LOCKED` của Postgres làm đúng việc ấy. Thêm Redis
 * là thêm một service phải vận hành và một nguồn sự thật thứ hai.
 */
import type { JobKind, JobResult, JobSpec, JobState } from '../../protocol/messages.js';

/** Một job trong sổ. `spec` là thứ runner nhận; phần còn lại là sổ sách. */
export interface JobRecord {
  id: string;
  orgId: string;
  kind: JobKind;
  createdBy: string;
  state: JobState;
  spec: JobSpec;
  requestedAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** Runner đang giữ job. `undefined` khi còn `queued`. */
  runnerId?: string;
  /** Lần thử thứ mấy. Job bị trả lại hàng đợi thì tăng. */
  attempt: number;
  result?: JobResult;
  error?: string;
}

export interface NewJob {
  orgId: string;
  kind: JobKind;
  createdBy: string;
  /** Phần `JobSpec` chưa có `jobId` — kho tự sinh. */
  spec: Omit<JobSpec, 'jobId'>;
}

/** Runner tự giới thiệu lúc đòi job. */
export interface ClaimBy {
  runnerId: string;
  /**
   * Nền tảng runner chạy được, ĐO từ máy đang cắm — xem
   * [scheduler/match.ts](../scheduler/match.ts).
   *
   * Không lọc thì một runner chỉ chạy web sẽ nhận job Android rồi fail giữa
   * chừng, và job ấy quay lại hàng đợi để lại bị chính nó nhận.
   */
  platforms?: string[];
  /**
   * Một người được chạy tối đa bao nhiêu job cùng lúc. `undefined` là không hạn.
   *
   * Hạn mức là lớp thứ hai; lớp thứ nhất là THỨ TỰ (xem dưới). Hạn mức chỉ cần
   * khi một người muốn chiếm hết công suất bằng cách giữ job chạy thật lâu.
   */
  maxPerUser?: number;
}

export interface JobQueue {
  create(job: NewJob): Promise<JobRecord>;
  find(id: string): Promise<JobRecord | undefined>;
  list(filter?: { state?: JobState[]; limit?: number }): Promise<JobRecord[]>;

  /**
   * Đòi MỘT job, và không hai runner nào đòi được cùng một job.
   *
   * Phép loại trừ do KHO bảo đảm, không do người gọi kiểm trước rồi ghi sau:
   * bản Postgres dùng `FOR UPDATE SKIP LOCKED`, bản bộ nhớ chạy trong một
   * tiến trình nên bản thân nó đã tuần tự. Trả `undefined` khi không có gì
   * hợp — không phải lỗi, chỉ là hàng đợi rỗng.
   *
   * **Thứ tự là công bằng, không phải đến-trước-lấy-trước.** Người đang có ít
   * job chạy nhất được xét trước, rồi mới tới `priority`, rồi mới tới thời
   * điểm đặt. Thuần FIFO nghĩa là một người bắn năm mươi job làm người kế tiếp
   * chờ hết năm mươi lượt — và họ không làm gì sai, họ chỉ bấm chậm hơn.
   */
  claim(by: ClaimBy): Promise<JobRecord | undefined>;

  /** Job xong: thành công, hỏng, hay bị huỷ. Trả về bản ghi đã đóng. */
  finish(id: string, result: JobResult): Promise<JobRecord | undefined>;

  /**
   * Hoãn job lại một lúc, KHÔNG tính là một lần thử.
   *
   * Dùng khi việc chưa làm được là chuyện tạm thời và không phải lỗi của ai:
   * chiếc máy job cần đang có người cầm. Job về `queued` nhưng không được đòi
   * lại trước `delayMs`, nên worker không quay vòng bận rộn — đo được ở lần
   * chạy thật đầu tiên: `attempt` lên 33 trong tám giây.
   */
  defer(id: string, reason: string, delayMs: number): Promise<JobRecord | undefined>;

  /**
   * Trả job về hàng đợi để máy khác nhận.
   *
   * Dùng khi runner từ chối vì lý do CỦA RIÊNG NÓ — hết đĩa, mất mạng. Lý do
   * gửi đi đâu cũng thế (thiếu Xcode) thì phải `finish` với `failed`, vì trả
   * lại hàng đợi lúc ấy chỉ tạo một vòng lặp bận rộn.
   */
  release(id: string, reason: string): Promise<JobRecord | undefined>;

  /**
   * Đóng những job còn treo `assigned`/`running` sau khi tiến trình chết.
   *
   * Gọi lúc khởi động. Một job còn `running` mà không tiến trình nào chạy nó
   * là một dòng nói dối, và nó khoá luôn thiết bị trong mắt scheduler.
   */
  interruptStale(): Promise<number>;

  /* ── Log sống ───────────────────────────────────────────────────────
   *
   * Tách khỏi phần sổ sách ở trên vì nó có vòng đời khác: sổ sách phải sống
   * qua lần restart, còn log sống chỉ có nghĩa khi có người đang xem. Bản bộ
   * nhớ giữ trong RAM; bản Postgres ghi vào `job_event` với `seq` để nối lại
   * được — phần ấy đi cùng transport của runner ở P3.4.
   */

  /**
   * Worker đẩy một dòng log của job.
   *
   * `Promise` chứ không phải đồng bộ, dù bản bộ nhớ xong ngay: ở chế độ server
   * một dòng log là một lệnh ghi vào `job_event`. Khai báo đồng bộ rồi sau này
   * đổi là đổi chữ ký ở mọi nơi gọi — và những nơi ấy sẽ quên `await`.
   */
  appendLog(id: string, line: string): Promise<void>;

  /**
   * Nghe log của một job, và nhận luôn phần đã có.
   *
   * Nhận phần đã có là điều kiện, không phải tiện nghi: giữa lúc route tạo
   * job và lúc nó kịp nghe, worker đã có thể in ra vài chục dòng — và những
   * dòng ấy là phần nói vì sao job hỏng, nếu nó hỏng ngay.
   */
  onLog(id: string, listener: (line: string) => void): Promise<() => void>;

  /** Nghe job đổi trạng thái. Dùng để biết khi nào job được nhận, và khi nào xong. */
  onState(id: string, listener: (record: JobRecord) => void): Promise<() => void>;
}
