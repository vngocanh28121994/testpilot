/**
 * Đường dây giữa control plane và runner.
 *
 * Hôm nay hai bên nằm trong cùng một tiến trình và gọi nhau bằng lời gọi hàm.
 * Ngày mai runner ở máy khác và cùng những việc ấy đi qua WebSocket. Interface
 * này là chỗ khác biệt ấy được nói ra MỘT LẦN, thay vì rải khắp nơi gọi.
 *
 * Vì sao không chờ tới P3 rồi hẵng làm: nếu route quen gọi thẳng `localRunner`,
 * thì mỗi route là một chỗ phải sửa khi runner đi xa — và "mỗi chỗ một ít" là
 * cách một cuộc chuyển đổi chết giữa đường. Có interface từ bây giờ thì phần
 * việc còn lại của P3 là viết MỘT hiện thực, không phải sửa hai mươi nơi gọi.
 *
 * Điểm khác nhau thật giữa hai chế độ, và là lý do interface này bất đối xứng
 * với `Runner`: qua mạng thì **mọi thứ đều có thể hỏng vì mạng**, và mọi câu
 * trả lời đều đến muộn. Nên transport nói bằng thông điệp (`JobSpec` vào,
 * `JobEvent` ra), không nói bằng "gọi hàm rồi chờ giá trị trả về".
 *
 * Xem [FARM-ARCHITECTURE.md](../../FARM-ARCHITECTURE.md) mục 5 và
 * [FARM-PLAN.md](../../FARM-PLAN.md) P1.4.
 */
import type { JobEvent, JobResult, JobSpec } from '../protocol/messages.js';
import { PROTOCOL_VERSION } from '../protocol/version.js';
import { localRunner, type Runner } from './index.js';

/** Người nhận dòng đời của job: UI qua SSE, và (từ P2) bảng `job_event`. */
export type JobEventSink = (event: JobEvent) => void;

export interface RunnerTransport {
  /** Runner ở phía bên kia dùng giao thức nào. */
  readonly protocolVersion: string;
  /** Gửi một job đi và nhận về kết quả cuối; dòng đời chảy qua `onEvent`. */
  submit(spec: JobSpec, onEvent: JobEventSink): Promise<JobResult>;
  /** Yêu cầu dừng. Không hứa dừng ngay — chỉ hứa đã nói. */
  cancel(jobId: string, reason: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * Runner trong cùng tiến trình — chế độ `embedded`.
 *
 * Cố tình mỏng: nó chỉ đánh số `seq` và gọi `Runner`. Mọi logic đặt ở đây sẽ
 * KHÔNG tồn tại ở bản chạy qua mạng, nên chỗ này không được có logic nào.
 */
export class InProcessTransport implements RunnerTransport {
  readonly protocolVersion = PROTOCOL_VERSION;
  private seq = 0;
  private readonly cancelled = new Set<string>();

  /**
   * `configFile` là hồ sơ cấu hình của tiến trình đang chạy.
   *
   * Nó là tham số chứ không đọc từ `JobSpec`: ở chế độ server, runner dùng cấu
   * hình CỦA NÓ, không dùng cấu hình của người gửi job. Bản nháp đầu của file
   * này truyền nhầm `spec.orgId` vào đây — một chuỗi không phải đường dẫn, nên
   * `isNamedDevice` lặng lẽ trả `false` và mọi thiết bị đều bị coi là không có
   * tên. Không lỗi, không log; chỉ thư mục lượt chạy đặt sai tên.
   */
  constructor(
    private readonly configFile: string,
    private readonly runner: Runner = localRunner,
  ) {}

  async submit(spec: JobSpec, onEvent: JobEventSink): Promise<JobResult> {
    const emit = (line: string) => {
      this.seq += 1;
      onEvent({
        type: 'job.event',
        jobId: spec.jobId,
        seq: this.seq,
        at: new Date().toISOString(),
        event: { kind: 'log', line },
      });
    };

    try {
      switch (spec.kind) {
        case 'run_suite': {
          const run = spec.run;
          if (!run) throw new Error('JobSpec kind=run_suite mà thiếu phần `run`.');
          const tokens = spec.deviceTokens;
          // Một thiết bị là đường chạy đơn — KHÔNG phải "chạy song song cỡ 1".
          // Đường song song đặt hậu tố vào tên thư mục và hoãn ghi dữ liệu
          // dùng chung; với một máy thì cả hai đều là giá phải trả mà không
          // đổi lại được gì.
          if (tokens.length > 1) {
            const platforms = [...new Set(tokens.map((t) => t.split(':')[0]))].join(',');
            await this.runner.run.startParallel(
              platforms, tokens, run.tag, Boolean(run.includeQuarantined),
              emit, run.env, run.appSource,
            );
          } else {
            const picked = tokens[0] ? this.runner.run.parseDeviceToken(tokens[0]) : null;
            const named = picked ? await this.runner.run.isNamedDevice(picked, this.configFile) : false;
            await this.runner.run.startSuite(
              picked?.platform ?? run.platform, run.tag, Boolean(run.headed),
              Boolean(run.includeQuarantined), emit,
              named && picked ? picked.id : undefined,
              run.env, undefined, undefined, run.appSource,
            );
          }
          break;
        }
        default:
          // Danh sách đóng, giống `RunnerPrereqApi`: một `kind` lạ là lỗi cấu
          // hình hoặc một server nói giao thức khác — không phải thứ để đoán.
          throw new Error(`Runner không nhận job kind="${spec.kind}".`);
      }
    } catch (err) {
      return {
        type: 'job.result',
        jobId: spec.jobId,
        state: this.cancelled.has(spec.jobId) ? 'cancelled' : 'failed',
        error: (err as Error).message,
      };
    }

    return {
      type: 'job.result',
      jobId: spec.jobId,
      state: this.cancelled.has(spec.jobId) ? 'cancelled' : 'succeeded',
    };
  }

  async cancel(jobId: string, _reason: string): Promise<void> {
    this.cancelled.add(jobId);
    await this.runner.run.stop();
  }

  async close(): Promise<void> {
    // Không có kết nối nào để đóng. Vẫn hiện diện để nơi gọi không phải biết
    // mình đang nói chuyện với bản nào.
  }
}

/**
 * Runner ở máy khác, qua WebSocket. **Chưa dựng** — P3.4.
 *
 * Để ở đây thay vì để trống, vì hai lý do. Thứ nhất, nó nói ra đúng những gì
 * còn thiếu, ở chỗ người đọc sẽ tìm. Thứ hai, nó bắt `InProcessTransport` phải
 * vừa với một interface được viết cho cả hai — nếu chỉ có một hiện thực thì
 * interface luôn "vừa", và cái vừa ấy không chứng minh được gì.
 */
export class WebSocketTransport implements RunnerTransport {
  readonly protocolVersion = PROTOCOL_VERSION;

  constructor(private readonly url: string) {}

  private notYet(): never {
    throw new Error(
      `Runner qua WebSocket (${this.url}) chưa dựng — đó là P3.4. `
      + 'Chế độ embedded dùng InProcessTransport.',
    );
  }

  submit(): Promise<JobResult> {
    this.notYet();
  }

  cancel(): Promise<void> {
    this.notYet();
  }

  async close(): Promise<void> {
    // Chưa có kết nối nào để đóng, và đóng một thứ chưa mở không phải lỗi.
  }
}
