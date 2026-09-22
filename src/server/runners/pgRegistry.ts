/**
 * Sổ runner trên Postgres — chế độ `server`.
 *
 * Cùng hợp đồng với bản bộ nhớ, và bộ khẳng định dùng chung chứng minh hai bên
 * nói cùng một câu. Khác biệt thật: ở đây token phải sống qua restart, và
 * nhiều control plane cùng đọc một sổ.
 */
import type { Pool } from 'pg';
import type { PrereqByPlatform } from '../../runner/prereqReport.js';
import { randomUUID } from 'node:crypto';
import {
  hashToken,
  mintToken,
  type NewRunner,
  type RunnerMode,
  type RunnerRecord,
  type RunnerRegistry,
  type RunnerState,
  type RunnerVisibility,
} from './registry.js';
import { PROTOCOL_VERSION } from '../../protocol/version.js';

interface RunnerRow {
  id: string;
  org_id: string;
  name: string;
  mode: RunnerMode;
  owner_user_id: string | null;
  visibility: RunnerVisibility;
  state: RunnerState;
  last_seen_at: string | null;
  created_at: string;
}

function toRecord(row: RunnerRow): RunnerRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    mode: row.mode,
    ...(row.owner_user_id ? { ownerUserId: row.owner_user_id } : {}),
    visibility: row.visibility,
    state: row.state,
    ...(row.last_seen_at ? { lastSeenAt: row.last_seen_at } : {}),
    createdAt: row.created_at,
  };
}

/**
 * Giá trị hash của một runner ĐÃ THU HỒI.
 *
 * Cột `token_hash` là `NOT NULL`, nên thu hồi không xoá được nó. Đặt một chuỗi
 * không phải hash sha256 hợp lệ thì không token nào khớp được — `hashToken`
 * luôn cho ra 64 ký tự hex.
 */
const REVOKED = 'revoked';

const PREREQ_KEY = 'prereq';

/** JSON hỏng thì coi như CHƯA ĐO, không coi như hỏng: xem `RunnerRecord.prereq`. */
function withPrereq(record: RunnerRecord, raw: string | null): RunnerRecord {
  if (!raw) return record;
  try {
    return { ...record, prereq: JSON.parse(raw) as PrereqByPlatform };
  } catch {
    return record;
  }
}

export class PgRunnerRegistry implements RunnerRegistry {
  constructor(
    private readonly pool: Pool,
    private readonly orgId: string,
  ) {}

  async create(runner: NewRunner): Promise<{ runner: RunnerRecord; token: string }> {
    const token = mintToken();
    const at = new Date().toISOString();
    const { rows } = await this.pool.query<RunnerRow>(
      `INSERT INTO runner (id, org_id, name, mode, owner_user_id, os, arch,
                           protocol_version, agent_version, token_hash,
                           visibility, state, created_at)
       VALUES ($1, $2, $3, $4, $5, '', '', $6, $6, $7, $8, 'offline', $9)
       RETURNING *`,
      [
        `runner:${randomUUID()}`, this.orgId, runner.name, runner.mode,
        runner.ownerUserId ?? null, PROTOCOL_VERSION, hashToken(token),
        runner.visibility, at,
      ],
    );
    return { runner: toRecord(rows[0]!), token };
  }

  async findByToken(token: string): Promise<RunnerRecord | undefined> {
    // Tra theo HASH, và không lọc theo tổ chức: lúc này ta còn chưa biết runner
    // thuộc tổ chức nào — chính dòng tìm được mới nói ra điều đó.
    const { rows } = await this.pool.query<RunnerRow>(
      'SELECT * FROM runner WHERE token_hash = $1',
      [hashToken(token)],
    );
    return rows[0] ? toRecord(rows[0]) : undefined;
  }

  async find(id: string): Promise<RunnerRecord | undefined> {
    const { rows } = await this.pool.query<RunnerRow & { prereq: string | null }>(
      `SELECT runner.*, cap.value AS prereq FROM runner
       LEFT JOIN runner_capability cap ON cap.runner_id = runner.id AND cap.key = $3
       WHERE runner.org_id = $1 AND runner.id = $2`,
      [this.orgId, id, PREREQ_KEY],
    );
    return rows[0] ? withPrereq(toRecord(rows[0]), rows[0].prereq) : undefined;
  }

  async list(): Promise<RunnerRecord[]> {
    const { rows } = await this.pool.query<RunnerRow & { prereq: string | null }>(
      `SELECT runner.*, cap.value AS prereq FROM runner
       LEFT JOIN runner_capability cap ON cap.runner_id = runner.id AND cap.key = $2
       WHERE runner.org_id = $1 ORDER BY runner.created_at DESC`,
      [this.orgId, PREREQ_KEY],
    );
    return rows.map((row) => withPrereq(toRecord(row), row.prereq));
  }

  /**
   * Tình trạng môi trường của máy, cất trong `runner_capability`.
   *
   * Dùng bảng đã có thay vì thêm cột: bảng ấy sinh ra đúng để mang "runner này
   * có gì", và một cột mới là một migration trên một bảng mà mọi request đều
   * đọc. Giá trị là JSON trong một cột TEXT — không cần truy vấn theo nội dung
   * của nó, chỉ cần đọc nguyên khối theo `runner_id`.
   */
  async reportPrereq(id: string, prereq: PrereqByPlatform): Promise<void> {
    await this.pool.query(
      `INSERT INTO runner_capability (runner_id, key, value) VALUES ($1, $2, $3)
       ON CONFLICT (runner_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [id, PREREQ_KEY, JSON.stringify(prereq)],
    );
  }

  async rotate(id: string): Promise<string | undefined> {
    const token = mintToken();
    const { rowCount } = await this.pool.query(
      'UPDATE runner SET token_hash = $3 WHERE org_id = $1 AND id = $2',
      [this.orgId, id, hashToken(token)],
    );
    return (rowCount ?? 0) > 0 ? token : undefined;
  }

  async revoke(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE runner SET token_hash = $3, state = 'offline' WHERE org_id = $1 AND id = $2`,
      [this.orgId, id, REVOKED],
    );
    return (rowCount ?? 0) > 0;
  }

  async touch(id: string, at = new Date()): Promise<void> {
    await this.pool.query(
      `UPDATE runner SET last_seen_at = $3, state = 'online' WHERE org_id = $1 AND id = $2`,
      [this.orgId, id, at.toISOString()],
    );
  }

  async reapSilent(olderThanMs: number, now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - olderThanMs).toISOString();
    const { rowCount } = await this.pool.query(
      `UPDATE runner SET state = 'offline'
       WHERE org_id = $1 AND state = 'online'
         AND (last_seen_at IS NULL OR last_seen_at < $2)`,
      [this.orgId, cutoff],
    );
    return rowCount ?? 0;
  }
}
