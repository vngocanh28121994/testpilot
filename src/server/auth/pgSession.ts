/**
 * Phiên đăng nhập trong Postgres — chế độ `server`.
 *
 * Bản trong RAM đủ cho một máy và một tiến trình. Nó hỏng theo hai cách mà
 * không cấu hình nào sửa được: một lần deploy bình thường đăng xuất toàn bộ
 * người đang dùng, và chạy hai instance thì người đăng nhập ở instance này gọi
 * API rơi vào instance kia sẽ nhận 401 — không phải thỉnh thoảng, mà là một
 * nửa số request.
 *
 * Cùng một hợp đồng `SessionStore`, nên `authorize()` không biết mình đang hỏi
 * bên nào. Và chỉ giữ HASH của mã phiên, y như bản RAM: đây là thứ duy nhất
 * đứng giữa một người lạ và quyền chạy lệnh trên thiết bị thật.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import type { Identity } from './roles.js';
import { SESSION_TTL_MS, type Session, type SessionStore } from './session.js';

function hash(id: string): string {
  return createHash('sha256').update(id).digest('hex');
}

interface Row {
  identity: Identity;
  created_at: Date | string;
  expires_at: Date | string;
}

const ms = (value: Date | string): number =>
  value instanceof Date ? value.getTime() : Date.parse(value);

export class PgSessionStore implements SessionStore {
  constructor(private readonly pool: Pool) {}

  async create(identity: Identity, now = Date.now()): Promise<Session> {
    // 32 byte ngẫu nhiên từ hệ điều hành. Không dựng từ thời gian và không
    // dùng `Math.random()`: cả hai đoán được.
    const id = randomBytes(32).toString('base64url');
    const expiresAt = now + SESSION_TTL_MS;
    await this.pool.query(
      `INSERT INTO session (id_hash, user_id, org_id, identity, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        hash(id), identity.userId, identity.orgId, identity,
        new Date(now).toISOString(), new Date(expiresAt).toISOString(),
      ],
    );
    return { id, identity, createdAt: now, expiresAt };
  }

  async find(id: string, now = Date.now()): Promise<Session | undefined> {
    const { rows } = await this.pool.query<Row>(
      `SELECT identity, created_at, expires_at FROM session WHERE id_hash = $1`,
      [hash(id)],
    );
    const row = rows[0];
    if (!row) return undefined;

    const expiresAt = ms(row.expires_at);
    if (expiresAt <= now) {
      // Hết hạn thì xoá luôn, đừng để nó nằm lại chờ một lượt dọn nào đó. Xoá
      // trong nền: câu trả lời cho người đang gọi không phụ thuộc vào nó, và
      // một lỗi ghi lúc này không được biến "phiên hết hạn" thành "server lỗi".
      void this.pool
        .query('DELETE FROM session WHERE id_hash = $1', [hash(id)])
        .catch(() => undefined);
      return undefined;
    }
    return {
      id,
      identity: row.identity,
      createdAt: ms(row.created_at),
      expiresAt,
    };
  }

  async revoke(id: string): Promise<void> {
    await this.pool.query('DELETE FROM session WHERE id_hash = $1', [hash(id)]);
  }

  /**
   * Đuổi mọi phiên của một người.
   *
   * Đây là lý do cookie chỉ mang mã phiên chứ không mang một JWT tự chứa: một
   * token tự chứa thì không thu hồi được, và "đuổi khỏi tổ chức" sẽ chỉ có
   * hiệu lực khi token hết hạn — tức là vào một lúc ta đã chọn từ trước, chứ
   * không phải lúc cần.
   */
  async revokeUser(userId: string): Promise<void> {
    await this.pool.query('DELETE FROM session WHERE user_id = $1', [userId]);
  }

  /** Dọn phiên đã hết hạn. Trả về số dòng đã xoá. */
  async reapExpired(now = Date.now()): Promise<number> {
    const { rowCount } = await this.pool.query(
      'DELETE FROM session WHERE expires_at <= $1',
      [new Date(now).toISOString()],
    );
    return rowCount ?? 0;
  }
}
