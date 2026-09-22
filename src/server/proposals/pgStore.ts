/**
 * Đề xuất trong Postgres — chế độ `server`.
 *
 * Giới hạn theo `org_id` ngay trong constructor, giống mọi repo khác: một đề
 * xuất là dữ liệu của tổ chức, và cách chắc chắn nhất để không lộ nó sang tổ
 * chức khác là không có đường nào hỏi mà không kèm `org_id`.
 */
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type {
  NewProposal, Proposal, ProposalState, ProposalStore, ProposalSummary,
} from './store.js';

interface Row {
  id: string;
  org_id: string;
  kind: string;
  key: string;
  base_revision: string | null;
  patch: unknown;
  source_job_id: string | null;
  created_by: string | null;
  state: ProposalState;
  reviewed_by: string | null;
  reviewed_at: Date | string | null;
  created_at: Date | string;
  summary: ProposalSummary | null;
}

const COLUMNS = `id, org_id, kind, key, base_revision, patch, source_job_id,
                 created_by, state, reviewed_by, reviewed_at, created_at, summary`;

function hydrate(row: Row): Proposal {
  return {
    id: row.id,
    orgId: row.org_id,
    kind: row.kind,
    key: row.key,
    ...(row.base_revision ? { baseRevision: row.base_revision } : {}),
    patch: row.patch,
    ...(row.source_job_id ? { sourceJobId: row.source_job_id } : {}),
    createdBy: row.created_by ?? 'unknown',
    state: row.state,
    ...(row.reviewed_by ? { reviewedBy: row.reviewed_by } : {}),
    ...(row.reviewed_at ? { reviewedAt: iso(row.reviewed_at) } : {}),
    createdAt: iso(row.created_at),
    ...(row.summary ? { summary: row.summary } : {}),
  };
}

/** `pg` trả `timestamptz` thành `Date`; phần còn lại của hệ thống nói ISO. */
function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export class PgProposalStore implements ProposalStore {
  constructor(
    private readonly pool: Pool,
    private readonly orgId: string,
  ) {}

  async create(proposal: NewProposal): Promise<Proposal> {
    const { rows } = await this.pool.query<Row>(
      `INSERT INTO registry_proposal
         (id, org_id, kind, key, base_revision, patch, source_job_id,
          created_by, state, created_at, summary)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $10)
       RETURNING ${COLUMNS}`,
      [
        randomUUID(), this.orgId, proposal.kind, proposal.key,
        proposal.baseRevision ?? null, proposal.patch, proposal.sourceJobId ?? null,
        proposal.createdBy, new Date().toISOString(), proposal.summary ?? null,
      ],
    );
    return hydrate(rows[0]!);
  }

  async list(filter?: { state?: ProposalState[] }): Promise<Proposal[]> {
    const states = filter?.state;
    const { rows } = await this.pool.query<Row>(
      `SELECT ${COLUMNS} FROM registry_proposal
       WHERE org_id = $1 AND ($2::text[] IS NULL OR state = ANY ($2::text[]))
       ORDER BY created_at DESC`,
      [this.orgId, states && states.length > 0 ? states : null],
    );
    return rows.map(hydrate);
  }

  async find(id: string): Promise<Proposal | undefined> {
    const { rows } = await this.pool.query<Row>(
      `SELECT ${COLUMNS} FROM registry_proposal WHERE org_id = $1 AND id = $2`,
      [this.orgId, id],
    );
    return rows[0] ? hydrate(rows[0]) : undefined;
  }

  async decide(
    id: string,
    state: 'accepted' | 'rejected',
    reviewer: string,
    now = new Date(),
  ): Promise<Proposal | undefined> {
    // `AND state = 'pending'` trong câu UPDATE là phép loại trừ do DB bảo đảm,
    // cùng kiểu với `WHERE revision = $base` ở registry: hai người duyệt cùng
    // một đề xuất trong cùng một giây thì đúng một người thắng, và người kia
    // được biết thay vì ghi đè im lặng.
    const { rows } = await this.pool.query<Row>(
      `UPDATE registry_proposal
       SET state = $3, reviewed_by = $4, reviewed_at = $5
       WHERE org_id = $1 AND id = $2 AND state = 'pending'
       RETURNING ${COLUMNS}`,
      [this.orgId, id, state, reviewer, now.toISOString()],
    );
    return rows[0] ? hydrate(rows[0]) : undefined;
  }
}
