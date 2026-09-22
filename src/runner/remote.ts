/**
 * Control plane nhìn từ phía runner ở MÁY KHÁC.
 *
 * Nó hiện thực đúng interface `JobQueue` mà worker đã dùng, nên runner độc lập
 * chạy lại được toàn bộ hành vi của P3.2 và P3.3 — giữ chỗ thiết bị, ghép theo
 * udid, hoãn khi máy bận — mà không phải viết lại dòng nào. Khác biệt duy nhất
 * là những lời gọi ấy đi qua HTTP.
 *
 * **Phần khó nhất ở đây là mất mạng.** Một lượt chạy Android dài mười lăm phút
 * in ra hàng nghìn dòng; mạng chập ba mươi giây giữa chừng không được làm mất
 * dòng nào, vì log là thứ duy nhất nói vì sao lượt chạy ấy đỏ. Nên:
 *
 *  - Mỗi dòng có `seq` tăng đơn điệu trong phạm vi một job.
 *  - Dòng nằm trong đệm tới khi server XÁC NHẬN đã ghi (`ack`).
 *  - Gửi lại phần chưa xác nhận là chuyện bình thường; khoá chính
 *    `(job_id, seq)` của `job_event` nuốt trùng lặp.
 *
 * Nói cách khác: xác nhận, không phải "gửi rồi quên". Đó là khác biệt giữa
 * một đường dây tin được và một đường dây trông có vẻ chạy.
 */
import type { JobResult, JobSpec, JobState } from '../protocol/messages.js';
import type { ClaimBy, JobQueue, JobRecord, NewJob } from '../server/queue/queue.js';

export interface RemoteOptions {
  /** Gốc của control plane, ví dụ `https://testpilot.example.com`. */
  serverUrl: string;
  token: string;
  /** Tên máy này, chỉ để đọc log ở phía server. */
  name: string;
  /** Tiêm trong test. Mặc định là `fetch` của Node. */
  fetchImpl?: typeof fetch;
  /** Giữ tối đa bao nhiêu dòng chưa xác nhận trước khi buộc phải bỏ bớt. */
  maxBuffered?: number;
}

interface Pending {
  seq: number;
  line: string;
}

/** 50 nghìn dòng: một lượt Android dài nhất đã đo còn chưa tới một phần mười. */
const MAX_BUFFERED = 50_000;

/** Server và runner khác số MAJOR. Xem `runner/update.ts`. */
export class ProtocolMismatchError extends Error {
  constructor(message: string, readonly serverProtocolVersion: string) {
    super(message);
    this.name = 'ProtocolMismatchError';
  }
}

export class RemoteJobQueue implements JobQueue {
  private readonly buffers = new Map<string, Pending[]>();
  private readonly nextSeq = new Map<string, number>();
  private readonly dropped = new Map<string, number>();
  private flushing = false;

  constructor(private readonly options: RemoteOptions) {}

  private get fetchImpl(): typeof fetch {
    return this.options.fetchImpl ?? fetch;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.options.serverUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.options.token}`,
        'x-runner-name': this.options.name,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      throw new Error(`Server trả về thứ không phải JSON: ${text.slice(0, 200)}`);
    }
    if (!res.ok) {
      const message = String(parsed.error ?? `HTTP ${res.status}`);
      // 409 kèm phiên bản giao thức của server là MỘT tình huống, không phải
      // một lỗi chung: nó có đường xử lý riêng (tự cập nhật), và phân biệt nó
      // bằng cách dò chuỗi lỗi là thứ sẽ hỏng ngay lần đầu ai đó sửa câu chữ.
      if (res.status === 409 && typeof parsed.serverProtocolVersion === 'string') {
        throw new ProtocolMismatchError(message, parsed.serverProtocolVersion);
      }
      throw new Error(message);
    }
    return parsed as T;
  }

  /** Chào server và đối chiếu giao thức. Ném khi hai bên không hiểu nhau. */
  async hello(capabilities: { platforms: string[]; mode?: string }): Promise<{
    runnerId: string; orgId: string; protocolVersion: string;
  }> {
    const { PROTOCOL_VERSION } = await import('../protocol/version.js');
    return this.post('/api/runner/hello', {
      name: this.options.name,
      mode: capabilities.mode ?? 'lab',
      os: process.platform,
      arch: process.arch,
      protocolVersion: PROTOCOL_VERSION,
      agentVersion: PROTOCOL_VERSION,
      capabilities: { platforms: capabilities.platforms },
    });
  }

  /**
   * Báo danh sách máy đang cắm. Gửi CẢ danh sách, không gửi phần đổi.
   *
   * Một chiếc máy bị rút ra là một sự vắng mặt, và sự vắng mặt không có sự
   * kiện nào để gửi — gửi cả danh sách làm "biến mất" thành một trạng thái
   * quan sát được ở phía server.
   */
  async reportDevices(
    devices: Array<{ platform: string; udid: string; label: string }>,
    prereq?: unknown,
  ): Promise<void> {
    // Tình trạng môi trường đi CÙNG chuyến, không có nhịp riêng: hai nhịp
    // nghĩa là hai thời điểm, và màn hình sẽ ghép "máy này đang cắm" với
    // "Appium chạy hồi nãy" thành một câu không đúng lúc nào cả.
    await this.post('/api/runner/devices', { devices, ...(prereq ? { prereq } : {}) });
  }

  async claim(by: ClaimBy): Promise<JobRecord | undefined> {
    const answer = await this.post<{ job: { id: string; spec: JobSpec } | null }>(
      '/api/runner/claim',
      { platforms: by.platforms, maxPerUser: by.maxPerUser },
    );
    if (!answer.job) return undefined;
    // Dựng lại một `JobRecord` đủ dùng cho worker. Những trường chỉ có nghĩa ở
    // phía server — `requestedAt`, `attempt` — không đi qua dây, và worker
    // không đọc chúng.
    return {
      id: answer.job.id,
      orgId: answer.job.spec.orgId,
      kind: answer.job.spec.kind,
      createdBy: answer.job.spec.createdBy,
      state: 'running',
      spec: answer.job.spec,
      requestedAt: new Date().toISOString(),
      runnerId: this.options.name,
      attempt: 1,
    };
  }

  /**
   * Đưa một dòng vào đệm. KHÔNG gửi ngay.
   *
   * Gửi từng dòng nghĩa là một request cho mỗi dòng log — với một lượt chạy in
   * ra hàng nghìn dòng thì đó là hàng nghìn request, và phần lớn thời gian
   * chúng chờ nhau. Gom lô rồi đẩy theo nhịp là đường duy nhất dùng được.
   */
  async appendLog(id: string, line: string): Promise<void> {
    const buffer = this.buffers.get(id) ?? [];
    const seq = (this.nextSeq.get(id) ?? 0) + 1;
    this.nextSeq.set(id, seq);
    buffer.push({ seq, line });

    const max = this.options.maxBuffered ?? MAX_BUFFERED;
    if (buffer.length > max) {
      // Bỏ phần CŨ NHẤT và ĐẾM lại. Bỏ im lặng thì người đọc log thấy một
      // khoảng trống mà không biết là có khoảng trống — tệ hơn nhiều so với
      // một dòng nói "đã mất N dòng".
      const lost = buffer.length - max;
      buffer.splice(0, lost);
      this.dropped.set(id, (this.dropped.get(id) ?? 0) + lost);
    }
    this.buffers.set(id, buffer);
  }

  /**
   * Đẩy mọi thứ đang chờ. Thất bại thì GIỮ NGUYÊN đệm để gửi lại.
   *
   * Không ném: người gọi là một vòng lặp theo nhịp, và một lần mạng chập không
   * được làm chết vòng lặp ấy. Trả về số dòng còn lại để nơi gọi biết đường
   * dây đang tắc.
   */
  async flush(): Promise<number> {
    if (this.flushing) return this.waiting();
    this.flushing = true;
    try {
      for (const [jobId, buffer] of [...this.buffers]) {
        if (buffer.length === 0) continue;
        const lost = this.dropped.get(jobId) ?? 0;
        const events = lost > 0
          ? [{ seq: buffer[0]!.seq - 1, line: `[runner] ⚠ mất ${lost} dòng log vì đệm đầy.` },
            ...buffer]
          : buffer;
        try {
          const { ack } = await this.post<{ ack: number }>('/api/runner/events', {
            jobId, events,
          });
          this.dropped.delete(jobId);
          // Chỉ quên phần ĐÃ được xác nhận. Server nhận một nửa lô rồi đứt thì
          // nửa còn lại vẫn nằm đây.
          const kept = buffer.filter((item) => item.seq > ack);
          if (kept.length === 0) this.buffers.delete(jobId);
          else this.buffers.set(jobId, kept);
        } catch {
          // Giữ nguyên đệm. Lần sau gửi lại từ đúng chỗ này.
        }
      }
    } finally {
      this.flushing = false;
    }
    return this.waiting();
  }

  /** Số dòng đang chờ xác nhận. `0` nghĩa là mọi thứ đã tới nơi. */
  waiting(): number {
    let total = 0;
    for (const buffer of this.buffers.values()) total += buffer.length;
    return total;
  }

  async finish(id: string, result: JobResult): Promise<JobRecord | undefined> {
    // Đẩy nốt log TRƯỚC khi báo xong: báo xong trước nghĩa là giao diện thấy
    // job kết thúc rồi mới nhận những dòng giải thích vì sao.
    await this.flush();
    await this.post('/api/runner/result', { jobId: id, result });
    return undefined;
  }

  async defer(id: string, reason: string): Promise<JobRecord | undefined> {
    await this.post('/api/runner/reject', { jobId: id, reason, retryable: true });
    return undefined;
  }

  async release(id: string, reason: string): Promise<JobRecord | undefined> {
    await this.post('/api/runner/reject', { jobId: id, reason, retryable: true });
    return undefined;
  }

  /* ── Những việc chỉ server làm ────────────────────────────────────────
   *
   * Runner KHÔNG đọc hàng đợi và không dọn job treo: nó chỉ biết job mà nó
   * đang giữ. Ném rõ ràng thay vì trả về rỗng, vì trả rỗng sẽ làm nơi gọi
   * tưởng hàng đợi trống.
   */
  private notMine(what: string): never {
    throw new Error(`Runner không làm được "${what}" — đó là việc của control plane.`);
  }

  async create(_job: NewJob): Promise<JobRecord> {
    this.notMine('create');
  }

  async find(_id: string): Promise<JobRecord | undefined> {
    this.notMine('find');
  }

  async list(_filter?: { state?: JobState[]; limit?: number }): Promise<JobRecord[]> {
    this.notMine('list');
  }

  async interruptStale(): Promise<number> {
    this.notMine('interruptStale');
  }

  async onLog(): Promise<() => void> {
    this.notMine('onLog');
  }

  async onState(): Promise<() => void> {
    this.notMine('onState');
  }
}
