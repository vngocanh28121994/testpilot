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
         SELECT id FROM job
         WHERE org_id = $1 AND state = 'queued' AND payload ? 'spec'
           AND (
             $4::text[] IS NULL
             OR payload -> 'spec' -> 'run' ->> 'platform' IS NULL
             OR payload -> 'spec' -> 'run' ->> 'platform' = ANY($4)
           )
         -- Ưu tiên cao trước, rồi tới cũ nhất: không ai phải chờ vô hạn chỉ vì
         -- có người liên tục bắn job mới.
         ORDER BY priority DESC, requested_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       RETURNING *`,
      [this.orgId, by.runnerId, new Date().toISOString(), platforms],
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
           attempt = attempt + 1, error = $3
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

  /* ── Log sống ─────────────────────────────────────────────────────────
   *
   * Chưa hiện thực, và KHÔNG im lặng giả vờ đã làm. Ở chế độ server log đi từ
   * runner qua transport rồi vào bảng `job_event` với `seq` để nối lại được —
   * cả đường ấy là P3.4. Một bản rỗng trả về "không có dòng nào" sẽ làm màn
   * hình trống mà không ai biết vì sao, nên nó ném.
   */
  async appendLog(): Promise<void> {
    throw new Error('Log của chế độ server đi qua job_event ở P3.4, chưa nối.');
  }

  async onLog(): Promise<() => void> {
    throw new Error('Log của chế độ server đi qua job_event ở P3.4, chưa nối.');
  }

  async onState(): Promise<() => void> {
    throw new Error('Theo dõi trạng thái ở chế độ server đi qua transport ở P3.4, chưa nối.');
  }
}

export type { PoolClient };
