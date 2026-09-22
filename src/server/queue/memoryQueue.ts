/**
 * Hàng đợi trong bộ nhớ: chế độ `embedded`.
 *
 * Vì sao không ghi xuống đĩa: một job chỉ có nghĩa khi có tiến trình chạy nó.
 * Job ghi xuống đĩa rồi tiến trình chết là một việc "đang chạy" mà không ai
 * chạy, và lần khởi động sau phải đi dọn. Ở chế độ embedded, tiến trình chết
 * nghĩa là lượt chạy ấy đã chết thật — `interruptStale()` của bản Postgres tồn
 * tại chính vì ở chế độ server điều đó KHÔNG đúng.
 *
 * Nhưng ngữ nghĩa thì giữ nguyên từng điểm, để test hợp đồng chạy được với cả
 * hai hiện thực: một job chỉ một runner nhận, trả lại hàng đợi thì tăng
 * `attempt`, job đã đóng thì không đòi lại được.
 */
import { randomUUID } from 'node:crypto';
import type { JobResult, JobState } from '../../protocol/messages.js';
import type { ClaimBy, JobQueue, JobRecord, NewJob } from './queue.js';

/** Bao nhiêu dòng log giữ lại cho người nối vào muộn. Đủ cho một lượt Android dài. */
const MAX_LOG_LINES = 8_000;

const OPEN: JobState[] = ['queued', 'assigned', 'running'];

export class MemoryJobQueue implements JobQueue {
  private readonly jobs = new Map<string, JobRecord>();
  /** Thứ tự tạo, để `claim` lấy job cũ nhất trước — không ai phải chờ vô hạn. */
  private readonly order: string[] = [];
  private readonly logs = new Map<string, string[]>();
  private readonly logListeners = new Map<string, Set<(line: string) => void>>();
  private readonly stateListeners = new Map<string, Set<(record: JobRecord) => void>>();

  async create(job: NewJob): Promise<JobRecord> {
    const id = randomUUID();
    const record: JobRecord = {
      id,
      orgId: job.orgId,
      kind: job.kind,
      createdBy: job.createdBy,
      state: 'queued',
      spec: { ...job.spec, jobId: id },
      requestedAt: new Date().toISOString(),
      attempt: 1,
    };
    this.jobs.set(id, record);
    this.order.push(id);
    this.logs.set(id, []);
    return { ...record };
  }

  async find(id: string): Promise<JobRecord | undefined> {
    const record = this.jobs.get(id);
    return record ? { ...record } : undefined;
  }

  async list(filter?: { state?: JobState[]; limit?: number }): Promise<JobRecord[]> {
    // Mới nhất trước: cùng thứ tự mà mọi màn hình lịch sử đang dùng.
    const all = [...this.order].reverse()
      .map((id) => this.jobs.get(id)!)
      .filter((record) => !filter?.state || filter.state.includes(record.state));
    return (filter?.limit ? all.slice(0, filter.limit) : all).map((record) => ({ ...record }));
  }

  async claim(by: ClaimBy): Promise<JobRecord | undefined> {
    for (const id of this.order) {
      const record = this.jobs.get(id);
      if (!record || record.state !== 'queued') continue;
      if (!this.suits(record, by)) continue;

      const claimed: JobRecord = {
        ...record,
        state: 'running',
        runnerId: by.runnerId,
        startedAt: new Date().toISOString(),
      };
      this.jobs.set(id, claimed);
      this.announce(claimed);
      return { ...claimed };
    }
    return undefined;
  }

  /**
   * Job này chạy được trên runner ấy không — chỉ theo nền tảng.
   *
   * Job không nói nền tảng nào (`gen`, `workflow`) thì runner nào cũng nhận
   * được: chúng không chạm tới thiết bị.
   */
  private suits(record: JobRecord, by: ClaimBy): boolean {
    const wanted = record.spec.run?.platform;
    if (!wanted || !by.platforms) return true;
    return by.platforms.includes(wanted);
  }

  async finish(id: string, result: JobResult): Promise<JobRecord | undefined> {
    const record = this.jobs.get(id);
    if (!record) return undefined;
    const closed: JobRecord = {
      ...record,
      state: result.state,
      finishedAt: new Date().toISOString(),
      result,
      ...(result.error ? { error: result.error } : {}),
    };
    this.jobs.set(id, closed);
    this.announce(closed);
    return { ...closed };
  }

  async release(id: string, reason: string): Promise<JobRecord | undefined> {
    const record = this.jobs.get(id);
    if (!record || !OPEN.includes(record.state)) return undefined;
    const back: JobRecord = {
      ...record,
      state: 'queued',
      runnerId: undefined,
      startedAt: undefined,
      attempt: record.attempt + 1,
      // Lý do GIỮ LẠI dù job quay về hàng đợi: nếu lần sau cũng hỏng, người
      // đọc cần thấy lần trước đã hỏng vì gì.
      error: reason,
    };
    this.jobs.set(id, back);
    this.announce(back);
    return { ...back };
  }

  async interruptStale(): Promise<number> {
    let closed = 0;
    for (const [id, record] of this.jobs) {
      if (record.state !== 'assigned' && record.state !== 'running') continue;
      this.jobs.set(id, {
        ...record,
        state: 'interrupted',
        finishedAt: new Date().toISOString(),
        error: 'Tiến trình chạy job này đã chết; job bị bỏ dở.',
      });
      closed += 1;
    }
    return closed;
  }

  async appendLog(id: string, line: string): Promise<void> {
    const lines = this.logs.get(id);
    if (!lines) return;
    lines.push(line);
    if (lines.length > MAX_LOG_LINES) lines.splice(0, lines.length - MAX_LOG_LINES);
    for (const listener of this.logListeners.get(id) ?? []) listener(line);
  }

  async onLog(id: string, listener: (line: string) => void): Promise<() => void> {
    // Phần đã có gửi TRƯỚC khi đăng ký nghe, đúng thứ tự: đổi thứ tự lại thì
    // một dòng đến đúng lúc ấy sẽ hiện ra trước những dòng cũ hơn nó.
    for (const line of this.logs.get(id) ?? []) listener(line);
    let set = this.logListeners.get(id);
    if (!set) {
      set = new Set();
      this.logListeners.set(id, set);
    }
    set.add(listener);
    return () => set.delete(listener);
  }

  async onState(id: string, listener: (record: JobRecord) => void): Promise<() => void> {
    let set = this.stateListeners.get(id);
    if (!set) {
      set = new Set();
      this.stateListeners.set(id, set);
    }
    set.add(listener);
    return () => set.delete(listener);
  }

  private announce(record: JobRecord): void {
    for (const listener of this.stateListeners.get(record.id) ?? []) listener({ ...record });
  }
}

/**
 * MỘT hàng đợi cho cả tiến trình.
 *
 * Cùng lý do với `localLeases`: `fileRepos()` được dựng lại ở mỗi request, nên
 * một hàng đợi mới mỗi lần nghĩa là job vừa tạo biến mất ở request kế tiếp.
 * Đây là lần thứ ba của cùng một lỗi trong dự án, nên nó được viết ra ngay từ
 * đầu thay vì chờ chạy thật mới lộ.
 */
export const localQueue = new MemoryJobQueue();
