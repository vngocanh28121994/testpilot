/**
 * Hàng đợi trên Postgres: chế độ `server`.
 *
 * Điều bản bộ nhớ không làm được, và là lý do bản này tồn tại: nhiều runner
 * trên nhiều máy cùng đòi job. Hai tiến trình khác nhau thì không có `Map` nào
 * dùng chung, nên thứ duy nhất còn phân xử được là DB — và nó phân xử bằng
 * `FOR UPDATE SKIP LOCKED`, tức là bằng một khẳng định không mã nào lách được.
 *
 * `SKIP LOCKED` chứ không phải `FOR UPDATE` trần: runner thứ hai không được
 * XẾP HÀNG chờ dòng mà runner thứ nhất đang giữ — nó phải bỏ qua dòng ấy và
 * lấy job kế tiếp. Thiếu `SKIP LOCKED` thì mười runner đòi cùng lúc sẽ tuần tự
 * hoá thành mười lượt chờ nhau, và chín cái cuối nhận về "không có gì".
 */
import type { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import type { JobKind, JobResult, JobSpec, JobState } from '../../protocol/messages.js';
import type { ClaimBy, JobQueue, JobRecord, NewJob } from './queue.js';

interface JobRow {
  id: string;
  org_id: string;
  created_by: string;
  kind: JobKind;
  state: JobState;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  runner_id: string | null;
  payload: { v: number; spec: JobSpec };
  result: JobResult | null;
  attempt: number;
  error: string | null;
  not_before: string | null;
}

function toRecord(row: JobRow): JobRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    kind: row.kind,
    createdBy: row.created_by,
    state: row.state,
    spec: row.payload.spec,
    requestedAt: row.requested_at,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    runnerId: row.runner_id ?? undefined,
    attempt: row.attempt,
    result: row.result ?? undefined,
    error: row.error ?? undefined,
  };
}

export class PgJobQueue implements JobQueue {
  constructor(
    private readonly pool: Pool,
    private readonly orgId: string,
  ) {}

  async create(job: NewJob): Promise<JobRecord> {
    const id = randomUUID();
    const spec: JobSpec = { ...job.spec, jobId: id };
    const { rows } = await this.pool.query<JobRow>(
      `INSERT INTO job (id, org_id, created_by, kind, state, priority, requested_at,
                        payload, attempt)
       VALUES ($1, $2, $3, $4, 'queued', 0, $5, $6, 1)
       RETURNING *`,
      // `{ v: 1, spec }` chứ không phải spec trần: bảng này còn mang những dòng
      // lịch sử do `PgJobRepo` ghi với hình dạng khác, và một cái vỏ có số
      // phiên bản là cách phân biệt rẻ nhất — rẻ hơn nhiều so với đoán theo
      // trường nào có mặt.
      [id, this.orgId, job.createdBy, job.kind, new Date().toISOString(), { v: 1, spec }],
    );
    return toRecord(rows[0]!);
  }

  async find(id: string): Promise<JobRecord | undefined> {
    const { rows } = await this.pool.query<JobRow>(
      `SELECT * FROM job WHERE org_id = $1 AND id = $2 AND payload ? 'spec'`,
      [this.orgId, id],
    );
    return rows[0] ? toRecord(rows[0]) : undefined;
  }

  async list(filter?: { state?: JobState[]; limit?: number }): Promise<JobRecord[]> {
    const states = filter?.state ?? null;
    const { rows } = await this.pool.query<JobRow>(
      `SELECT * FROM job
       WHERE org_id = $1 AND payload ? 'spec'
         AND ($2::text[] IS NULL OR state = ANY($2))
       ORDER BY requested_at DESC
       LIMIT $3`,
      [this.orgId, states, filter?.limit ?? 500],
    );
    return rows.map(toRecord);
  }

  async claim(by: ClaimBy): Promise<JobRecord | undefined> {
    const platforms = by.platforms ?? null;
    const { rows } = await this.pool.query<JobRow>(
      `UPDATE job SET state = 'running', runner_id = $2, started_at = $3
       WHERE id = (
         SELECT j.id FROM job j
         WHERE j.org_id = $1 AND j.state = 'queued' AND j.payload ? 'spec'
           AND (j.not_before IS NULL OR j.not_before <= $5)
           AND (
             $4::text[] IS NULL
             OR j.payload -> 'spec' -> 'run' ->> 'platform' IS NULL
             OR j.payload -> 'spec' -> 'run' ->> 'platform' = ANY($4)
           )
           AND (
             $6::int IS NULL
             OR (SELECT COUNT(*) FROM job b
                 WHERE b.org_id = j.org_id AND b.created_by = j.created_by
                   AND b.state IN ('assigned', 'running')) < $6
           )
         -- Công bằng TRƯỚC, rồi mới tới ưu tiên và thời điểm đặt.
         --
         -- Người đang có ít job chạy nhất được xét trước. Thuần FIFO nghĩa là
         -- một người bắn năm mươi job làm người kế tiếp chờ hết năm mươi lượt
         -- — và họ không làm gì sai, họ chỉ bấm chậm hơn.
         ORDER BY
           (SELECT COUNT(*) FROM job b
            WHERE b.org_id = j.org_id AND b.created_by = j.created_by
              AND b.state IN ('assigned', 'running')),
           j.priority DESC,
           j.requested_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       RETURNING *`,
      [
        this.orgId, by.runnerId, new Date().toISOString(), platforms,
        new Date().toISOString(), by.maxPerUser ?? null,
      ],
    );
    return rows[0] ? toRecord(rows[0]) : undefined;
  }

  async defer(id: string, reason: string, delayMs: number): Promise<JobRecord | undefined> {
    const { rows } = await this.pool.query<JobRow>(
      `UPDATE job
       SET state = 'queued', runner_id = NULL, started_at = NULL,
           error = $3, not_before = $4
       WHERE org_id = $1 AND id = $2
         AND state IN ('queued', 'assigned', 'running')
       RETURNING *`,
      // `attempt` không đụng tới: máy bận không phải một lần thử hỏng.
      [this.orgId, id, reason, new Date(Date.now() + delayMs).toISOString()],
    );
    return rows[0] ? toRecord(rows[0]) : undefined;
  }

  async finish(id: string, result: JobResult): Promise<JobRecord | undefined> {
    const { rows } = await this.pool.query<JobRow>(
      `UPDATE job SET state = $3, finished_at = $4, result = $5, error = $6
       WHERE org_id = $1 AND id = $2
       RETURNING *`,
      [this.orgId, id, result.state, new Date().toISOString(), result, result.error ?? null],
    );
    return rows[0] ? toRecord(rows[0]) : undefined;
  }

  async release(id: string, reason: string): Promise<JobRecord | undefined> {
    const { rows } = await this.pool.query<JobRow>(
      `UPDATE job
       SET state = 'queued', runner_id = NULL, started_at = NULL,
           attempt = attempt + 1, error = $3, not_before = NULL
       WHERE org_id = $1 AND id = $2
         AND state IN ('queued', 'assigned', 'running')
       RETURNING *`,
      [this.orgId, id, reason],
    );
    return rows[0] ? toRecord(rows[0]) : undefined;
  }

  async interruptStale(): Promise<number> {
    const { rowCount } = await this.pool.query(
      `UPDATE job SET state = 'interrupted', finished_at = $2, error = $3
       WHERE org_id = $1 AND state IN ('assigned', 'running') AND payload ? 'spec'`,
      [
        this.orgId,
        new Date().toISOString(),
        'Tiến trình chạy job này đã chết; job bị bỏ dở.',
      ],
    );
    return rowCount ?? 0;
  }

  /* ── Log sống, qua bảng `job_event` ─────────────────────────────────── */

  /**
   * Một dòng log là một DÒNG TRONG BẢNG, không phải một sự kiện trong RAM.
   *
   * Đó là khác biệt thật giữa hai chế độ: ở embedded người xem và người chạy ở
   * cùng tiến trình, còn ở server họ cách nhau một mạng và một lần restart.
   * Log phải sống qua cả hai, nếu không một tab mở lại sau khi server khởi
   * động lại sẽ thấy một job "đang chạy" mà không có dòng nào.
   *
   * `ON CONFLICT DO NOTHING` là thứ cho phép runner gửi lại: mất mạng thì nó
   * giữ đệm và gửi lại từ chỗ chưa được xác nhận, và những dòng đã tới nơi bị
   * bỏ qua thay vì nhân đôi.
   */
  async appendLog(id: string, line: string, seq?: number): Promise<void> {
    const next = seq ?? await this.nextSeq(id);
    await this.pool.query(
      `INSERT INTO job_event (job_id, seq, at, type, payload)
       VALUES ($1, $2, $3, 'log', $4)
       ON CONFLICT (job_id, seq) DO NOTHING`,
      [id, next, new Date().toISOString(), { kind: 'log', line }],
    );
  }

  private async nextSeq(id: string): Promise<number> {
    const { rows } = await this.pool.query<{ seq: number | null }>(
      'SELECT MAX(seq) AS seq FROM job_event WHERE job_id = $1',
      [id],
    );
    return (rows[0]?.seq ?? 0) + 1;
  }

  /**
   * Đọc phần đã có, rồi hỏi lại mỗi nửa giây.
   *
   * Hỏi lại chứ không `LISTEN/NOTIFY`: thông báo của Postgres đi theo KẾT NỐI,
   * mà pool thì đổi kết nối giữa các truy vấn — nên một `LISTEN` đặt đúng lúc
   * có thể nằm trên một kết nối mà lát sau không ai dùng nữa, và log im lặng
   * ngừng chảy. Nửa giây là độ trễ người đọc log không nhận ra.
   */
  async onLog(id: string, listener: (line: string) => void): Promise<() => void> {
    let seen = 0;
    const pump = async (): Promise<void> => {
      const { rows } = await this.pool.query<{ seq: number; payload: { line?: string } }>(
        'SELECT seq, payload FROM job_event WHERE job_id = $1 AND seq > $2 ORDER BY seq',
        [id, seen],
      );
      for (const row of rows) {
        seen = row.seq;
        if (typeof row.payload.line === 'string') listener(row.payload.line);
      }
    };
    await pump();
    const timer = setInterval(() => { void pump().catch(() => undefined); }, 500);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  /** Cùng cách với `onLog`: hỏi lại, và chỉ báo khi trạng thái ĐỔI. */
  async onState(id: string, listener: (record: JobRecord) => void): Promise<() => void> {
    let last: JobState | undefined = (await this.find(id))?.state;
    const timer = setInterval(() => {
      void this.find(id).then((record) => {
        if (!record || record.state === last) return;
        last = record.state;
        listener(record);
      }).catch(() => undefined);
    }, 500);
    timer.unref?.();
    return () => clearInterval(timer);
  }
}

export type { PoolClient };
