/**
 * Hiện thực repo thứ hai: Postgres.
 *
 * Cùng interface với `fileRepo.ts`, và đó là toàn bộ điểm của P0.2 — route
 * không biết mình đang nói chuyện với bên nào. Bộ test parity chạy với CẢ HAI,
 * nên "hai bên nói cùng một câu" là thứ được chứng minh chứ không phải hy vọng.
 *
 * Một điều khác biệt thật so với bản file, và nó là lý do chính để đổi: `WHERE
 * revision = $base` trong một câu UPDATE là phép loại trừ do DB bảo đảm. Bản
 * file đọc-rồi-ghi, nên giữa hai bước ấy vẫn còn một khe hở; hai tiến trình
 * ghi đúng lúc thì cả hai đều thấy "revision khớp". Khe hở ấy nhỏ tới mức
 * không ai gặp trên một máy, và đủ lớn khi có hai mươi người dùng chung.
 */
import type { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import type { ElementRegistry } from '../../core/types.js';
import type { WorkflowRun } from '../../core/history.js';
import type { RunMeta } from '../../core/runstore.js';
import {
  revisionOf,
  RevisionConflictError,
  LEASE_TTL_MS,
  LeaseTakenError,
  type JobRepo,
  type Lease,
  type LeaseHolder,
  type LeaseRepo,
  type RegistryRepo,
  type Repos,
  type RunRepo,
  type Versioned,
} from './repo.js';

/** Registry của một tổ chức là MỘT bản ghi có phiên bản. */
const REGISTRY_KIND = 'elements';
const REGISTRY_KEY = 'default';

const EMPTY_REGISTRY: ElementRegistry = { version: 1, screens: {}, elements: {} };

export class PgRegistryRepo implements RegistryRepo {
  constructor(
    private readonly pool: Pool,
    private readonly orgId: string,
  ) {}

  async read(): Promise<Versioned<ElementRegistry>> {
    const { rows } = await this.pool.query<{ body: ElementRegistry; revision: string }>(
      'SELECT body, revision FROM registry_object WHERE org_id = $1 AND kind = $2 AND key = $3',
      [this.orgId, REGISTRY_KIND, REGISTRY_KEY],
    );
    const row = rows[0];
    // Chưa có gì KHÔNG phải là lỗi: một tổ chức mới chưa học được element nào.
    // Trả registry rỗng với `revision: undefined` — đúng như bản file làm khi
    // file chưa tồn tại, nên lần ghi đầu không cần đối chiếu gì.
    if (!row) return { data: structuredClone(EMPTY_REGISTRY), revision: undefined };
    return { data: row.body, revision: row.revision };
  }

  async write(next: ElementRegistry, baseRevision?: string): Promise<Versioned<ElementRegistry>> {
    const revision = revisionOf(next);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await this.currentRevision(client);

      if (baseRevision && current !== baseRevision) {
        await client.query('ROLLBACK');
        throw new RevisionConflictError(baseRevision, current);
      }
      if (current === undefined) {
        await client.query(
          `INSERT INTO registry_object (org_id, kind, key, revision, body, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [this.orgId, REGISTRY_KIND, REGISTRY_KEY, revision, next, new Date().toISOString()],
        );
      } else {
        // `WHERE revision = $base` là phép loại trừ thật: nếu một tiến trình
        // khác vừa ghi xong giữa lúc ta đọc và ta ghi, câu này cập nhật 0 dòng
        // và ta biết mình đã thua — thay vì ghi đè im lặng.
        const { rowCount } = await client.query(
          `UPDATE registry_object SET revision = $4, body = $5, updated_at = $6
           WHERE org_id = $1 AND kind = $2 AND key = $3 AND revision = $7`,
          [this.orgId, REGISTRY_KIND, REGISTRY_KEY, revision, next,
           new Date().toISOString(), current],
        );
        if (rowCount === 0) {
          await client.query('ROLLBACK');
          throw new RevisionConflictError(baseRevision, await this.currentRevision());
        }
      }
      await client.query('COMMIT');
      return { data: next, revision };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Gộp delta của một lượt chạy.
   *
   * Đọc và ghi trong CÙNG một transaction, và khoá dòng bằng `FOR UPDATE`. Hai
   * runner kết thúc cùng lúc là chuyện bình thường — đó chính là điều cả hệ
   * thống này hướng tới — nên phép gộp phải tuần tự hoá được, nếu không phần
   * học được của một bên biến mất mà không ai biết.
   */
  async merge(delta: ElementRegistry): Promise<Versioned<ElementRegistry>> {
    const { Registry } = await import('../../core/registry.js');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ body: ElementRegistry }>(
        `SELECT body FROM registry_object
         WHERE org_id = $1 AND kind = $2 AND key = $3 FOR UPDATE`,
        [this.orgId, REGISTRY_KIND, REGISTRY_KEY],
      );
      const base = rows[0]?.body ?? structuredClone(EMPTY_REGISTRY);

      // Phép gộp đi qua chính `Registry.mergeFrom()`, không viết lại: nó có
      // luật riêng cho từng loại trường (ứng viên hợp nhất, bộ đếm cộng dồn,
      // `lastHealedAt` lấy mốc mới hơn). Bản thứ hai sẽ lệch dần khỏi bản gốc.
      const registry = Registry.fromData(base);
      registry.mergeFrom(delta);
      const merged = registry.raw;
      const revision = revisionOf(merged);
      const at = new Date().toISOString();

      if (rows[0]) {
        await client.query(
          `UPDATE registry_object SET revision = $4, body = $5, updated_at = $6
           WHERE org_id = $1 AND kind = $2 AND key = $3`,
          [this.orgId, REGISTRY_KIND, REGISTRY_KEY, revision, merged, at],
        );
      } else {
        await client.query(
          `INSERT INTO registry_object (org_id, kind, key, revision, body, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [this.orgId, REGISTRY_KIND, REGISTRY_KEY, revision, merged, at],
        );
      }
      await client.query('COMMIT');
      return { data: merged, revision };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  private async currentRevision(client?: PoolClient): Promise<string | undefined> {
    const runner = client ?? this.pool;
    const { rows } = await runner.query<{ revision: string }>(
      `SELECT revision FROM registry_object
       WHERE org_id = $1 AND kind = $2 AND key = $3${client ? ' FOR UPDATE' : ''}`,
      [this.orgId, REGISTRY_KIND, REGISTRY_KEY],
    );
    return rows[0]?.revision;
  }
}

/**
 * Lịch sử workflow, trong bảng `job`.
 *
 * `WorkflowRun` giữ nguyên hình dạng trong cột `payload` (jsonb), thay vì tách
 * ra hai chục cột. Đây là một đánh đổi có chủ ý: hình dạng ấy còn đang đổi
 * (stage, câu hỏi, liên kết report), và mỗi lần đổi mà phải kèm một migration
 * là mỗi lần người ta chọn cách không đổi. Những trường mà SCHEDULER cần —
 * trạng thái, thời điểm, tổ chức — là cột thật, có index.
 */
export class PgJobRepo implements JobRepo {
  constructor(
    private readonly pool: Pool,
    private readonly orgId: string,
  ) {}

  async list(): Promise<WorkflowRun[]> {
    const { rows } = await this.pool.query<{ payload: WorkflowRun }>(
      `SELECT payload FROM job WHERE org_id = $1 ORDER BY requested_at DESC`,
      [this.orgId],
    );
    return rows.map((row) => row.payload);
  }

  async find(id: string): Promise<WorkflowRun | undefined> {
    const { rows } = await this.pool.query<{ payload: WorkflowRun }>(
      `SELECT payload FROM job WHERE org_id = $1 AND id = $2`,
      [this.orgId, id],
    );
    return rows[0]?.payload;
  }

  async save(run: WorkflowRun, createdBy: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO job (id, org_id, created_by, kind, state, priority, requested_at,
                        finished_at, payload, attempt)
       VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, 1)
       ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state,
                                      finished_at = EXCLUDED.finished_at,
                                      payload = EXCLUDED.payload`,
      [
        run.id, this.orgId, createdBy,
        run.kind === 'workflow' ? 'workflow' : 'run_suite',
        jobState(run.status), run.startedAt, run.finishedAt ?? null, run,
      ],
    );
  }

  async closeInterrupted(): Promise<number> {
    // Cùng ý nghĩa với bản file: một dòng còn `running` sau khi tiến trình
    // chết là một dòng nói dối. Ở đây nó còn quan trọng hơn, vì nhiều người
    // cùng nhìn vào bảng ấy.
    const { rows } = await this.pool.query<{ id: string; payload: WorkflowRun }>(
      `SELECT id, payload FROM job WHERE org_id = $1 AND state IN ('running', 'assigned')`,
      [this.orgId],
    );
    for (const row of rows) {
      // `WorkflowRun.status` không có `interrupted` — nó chỉ có ở tầng `job`
      // của schema. Nên payload ghi `failed` kèm lý do, còn cột `state` ghi
      // `interrupted`: người đọc lịch sử thấy một lượt hỏng CÓ NGUYÊN NHÂN,
      // còn scheduler phân biệt được "hỏng vì test" với "hỏng vì tiến trình
      // chết" — hai thứ cần cách xử lý khác nhau.
      const payload = {
        ...row.payload,
        status: 'failed' as const,
        error: row.payload.error ?? 'Tiến trình chạy lượt này đã chết; lượt chạy bị bỏ dở.',
        finishedAt: new Date().toISOString(),
      };
      await this.pool.query(
        `UPDATE job SET state = 'interrupted', finished_at = $3, payload = $4
         WHERE org_id = $1 AND id = $2`,
        [this.orgId, row.id, payload.finishedAt, payload],
      );
    }
    return rows.length;
  }
}

/**
 * `WorkflowRun.status` → `job.state` của schema.
 *
 * Hai tập trạng thái không trùng nhau, và đó là đúng: `WorkflowRun` mô tả một
 * quy trình có chặng chờ người duyệt, còn `job` mô tả một đơn vị công việc
 * trong hàng đợi. `waiting_review` là "đang chạy" với scheduler — nó chưa xong
 * và chưa hỏng — nhưng là "đang chờ bạn" với người dùng.
 */
function jobState(status: WorkflowRun['status']): string {
  switch (status) {
    case 'running':
    case 'waiting_review':
    case 'waiting_input':
      return 'running';
    case 'passed': return 'succeeded';
    case 'failed': return 'failed';
    default: return 'queued';
  }
}

/**
 * Lượt chạy local.
 *
 * Ở chế độ server, `RunMeta` đến từ runner qua `job.result` chứ không từ việc
 * quét một thư mục trên đĩa server — server không có thư mục ấy.
 */
export class PgRunRepo implements RunRepo {
  constructor(
    private readonly pool: Pool,
    private readonly orgId: string,
  ) {}

  async list(): Promise<RunMeta[]> {
    const { rows } = await this.pool.query<{ result: RunMeta[] | null }>(
      `SELECT result FROM job WHERE org_id = $1 AND result IS NOT NULL
       ORDER BY requested_at DESC`,
      [this.orgId],
    );
    return rows.flatMap((row) => row.result ?? []);
  }

  async find(id: string): Promise<RunMeta | undefined> {
    return (await this.list()).find((run) => run.id === id);
  }
}


/* ── Giữ chỗ thiết bị ─────────────────────────────────────────────────── */

interface LeaseRow {
  id: string;
  device_id: string;
  org_id: string;
  holder_kind: 'job' | 'human';
  job_id: string | null;
  holder_user_id: string | null;
  acquired_at: string;
  expires_at: string;
  renewed_at: string | null;
}

function toLease(row: LeaseRow): Lease {
  return {
    id: row.id,
    deviceId: row.device_id,
    orgId: row.org_id,
    holder: row.holder_kind === 'job'
      ? { kind: 'job', jobId: row.job_id! }
      : { kind: 'human', userId: row.holder_user_id! },
    acquiredAt: row.acquired_at,
    expiresAt: row.expires_at,
    renewedAt: row.renewed_at ?? undefined,
  };
}

function sameHolder(a: LeaseHolder, b: LeaseHolder): boolean {
  if (a.kind === 'job' && b.kind === 'job') return a.jobId === b.jobId;
  if (a.kind === 'human' && b.kind === 'human') return a.userId === b.userId;
  return false;
}

/**
 * Lease trên Postgres. Phép loại trừ là `UNIQUE (device_id)`, không phải mã ta viết.
 *
 * Điều bản bộ nhớ không làm được, và là lý do bản này tồn tại: hai control
 * plane chạy song song sau load balancer. Hai tiến trình khác nhau thì không có
 * `Map` nào dùng chung, nên thứ duy nhất còn lại để phân xử là DB — và nó phân
 * xử bằng một chỉ mục, tức là bằng một khẳng định không mã nào lách được.
 */
export class PgLeaseRepo implements LeaseRepo {
  constructor(
    private readonly pool: Pool,
    private readonly orgId: string,
  ) {}

  async acquire(deviceId: string, holder: LeaseHolder, now = new Date()): Promise<Lease> {
    const at = now.toISOString();
    const expires = new Date(now.getTime() + LEASE_TTL_MS).toISOString();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Dọn hạn CÙNG transaction với việc giữ. Tách làm hai lệnh nghĩa là giữa
      // chúng có một khoảng mà lease đã hết hạn vẫn còn chặn chỉ mục, và người
      // bấm đúng lúc đó nhận "máy đang bị giữ" bởi một người đã đi khỏi.
      await client.query('DELETE FROM lease WHERE org_id = $1 AND expires_at <= $2',
        [this.orgId, at]);

      // `DO NOTHING` chứ không phải `DO UPDATE`: người thua cuộc phải ĐỌC xem
      // ai thắng, vì câu trả lời cho họ là "ai đang giữ", không phải "không".
      const inserted = await client.query<LeaseRow>(
        `INSERT INTO lease (id, device_id, org_id, holder_kind, job_id, holder_user_id,
                            acquired_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (device_id) DO NOTHING
         RETURNING *`,
        [randomUUID(), deviceId, this.orgId, holder.kind,
         holder.kind === 'job' ? holder.jobId : null,
         holder.kind === 'human' ? holder.userId : null, at, expires],
      );
      if (inserted.rows[0]) {
        await client.query('COMMIT');
        return toLease(inserted.rows[0]);
      }

      const { rows } = await client.query<LeaseRow>(
        'SELECT * FROM lease WHERE org_id = $1 AND device_id = $2',
        [this.orgId, deviceId],
      );
      const current = rows[0];
      if (!current) {
        // Chỉ mục từ chối nhưng không đọc được dòng nào: dòng ấy thuộc tổ chức
        // khác. Một thiết bị chỉ thuộc một tổ chức, nên đây là dữ liệu đã lệch,
        // và im lặng cấp lease thì hai tổ chức dùng chung một chiếc máy.
        await client.query('ROLLBACK');
        throw new Error(`Thiết bị "${deviceId}" đang bị giữ bởi một tổ chức khác.`);
      }
      const existing = toLease(current);
      if (!sameHolder(existing.holder, holder)) {
        await client.query('ROLLBACK');
        throw new LeaseTakenError(existing);
      }
      // Chính người đang giữ bấm lại: gia hạn, không xung đột. Một cú F5 không
      // nên làm mất quyền điều khiển của người vừa lấy nó.
      const renewed = await client.query<LeaseRow>(
        `UPDATE lease SET expires_at = $3, renewed_at = $4
         WHERE org_id = $1 AND id = $2 RETURNING *`,
        [this.orgId, existing.id, expires, at],
      );
      await client.query('COMMIT');
      return toLease(renewed.rows[0]!);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async renew(leaseId: string, holder: LeaseHolder, now = new Date()): Promise<Lease | undefined> {
    const at = now.toISOString();
    // `expires_at > $at` nằm trong chính câu UPDATE: một lease đã hết hạn thì
    // không gia hạn được, kể cả bởi người từng giữ nó. Cho phép thì thành một
    // đường lấy lại máy mà người khác có thể đã giữ trong lúc đó.
    const { rows } = await this.pool.query<LeaseRow>(
      `UPDATE lease SET expires_at = $4, renewed_at = $3
       WHERE org_id = $1 AND id = $2 AND expires_at > $3
         AND holder_kind = $5
         AND (($5 = 'job' AND job_id = $6) OR ($5 = 'human' AND holder_user_id = $6))
       RETURNING *`,
      [this.orgId, leaseId, at, new Date(now.getTime() + LEASE_TTL_MS).toISOString(),
       holder.kind, holder.kind === 'job' ? holder.jobId : holder.userId],
    );
    return rows[0] ? toLease(rows[0]) : undefined;
  }

  async release(leaseId: string, holder?: LeaseHolder): Promise<boolean> {
    if (!holder) {
      const forced = await this.pool.query(
        'DELETE FROM lease WHERE org_id = $1 AND id = $2',
        [this.orgId, leaseId],
      );
      return (forced.rowCount ?? 0) > 0;
    }
    const { rowCount } = await this.pool.query(
      `DELETE FROM lease
       WHERE org_id = $1 AND id = $2 AND holder_kind = $3
         AND (($3 = 'job' AND job_id = $4) OR ($3 = 'human' AND holder_user_id = $4))`,
      [this.orgId, leaseId, holder.kind, holder.kind === 'job' ? holder.jobId : holder.userId],
    );
    return (rowCount ?? 0) > 0;
  }

  async list(now = new Date()): Promise<Lease[]> {
    const at = now.toISOString();
    await this.reap(now);
    const { rows } = await this.pool.query<LeaseRow>(
      'SELECT * FROM lease WHERE org_id = $1 AND expires_at > $2 ORDER BY acquired_at',
      [this.orgId, at],
    );
    return rows.map(toLease);
  }

  async find(deviceId: string, now = new Date()): Promise<Lease | undefined> {
    const at = now.toISOString();
    await this.reap(now);
    const { rows } = await this.pool.query<LeaseRow>(
      'SELECT * FROM lease WHERE org_id = $1 AND device_id = $2 AND expires_at > $3',
      [this.orgId, deviceId, at],
    );
    return rows[0] ? toLease(rows[0]) : undefined;
  }

  async reap(now = new Date()): Promise<number> {
    const { rowCount } = await this.pool.query(
      'DELETE FROM lease WHERE org_id = $1 AND expires_at <= $2',
      [this.orgId, now.toISOString()],
    );
    return rowCount ?? 0;
  }
}

export function pgRepos(pool: Pool, orgId: string): Repos {
  return {
    registry: new PgRegistryRepo(pool, orgId),
    jobs: new PgJobRepo(pool, orgId),
    runs: new PgRunRepo(pool, orgId),
    leases: new PgLeaseRepo(pool, orgId),
  };
}

export { randomUUID as newJobId };
