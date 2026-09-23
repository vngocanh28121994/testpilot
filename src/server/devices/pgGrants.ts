/**
 * Quyền mượn máy trong Postgres — chế độ `server`.
 *
 * Vì sao quyền mượn nằm trong DB trong khi chính sổ THIẾT BỊ thì chỉ nằm trong
 * bộ nhớ: hai thứ có tuổi thọ khác hẳn nhau. Danh sách máy là ảnh chụp mười
 * giây một lần, dựng lại được từ báo cáo của runner ngay sau khi khởi động
 * lại. Một quyết định cho mượn thì không dựng lại được từ đâu cả — mất nó
 * nghĩa là người đang mượn máy bỗng thôi nhìn thấy nó, giữa buổi làm việc, mà
 * không ai đụng vào cái gì.
 */
import type { Pool } from 'pg';
import type { DeviceGrant, DeviceGrants } from './grants.js';

interface Row {
  org_id: string;
  udid: string;
  user_id: string;
  granted_by: string;
  created_at: Date | string;
}

function hydrate(row: Row): DeviceGrant {
  return {
    orgId: row.org_id,
    udid: row.udid,
    userId: row.user_id,
    grantedBy: row.granted_by,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

export class PgDeviceGrants implements DeviceGrants {
  constructor(private readonly pool: Pool) {}

  async grant(grant: Omit<DeviceGrant, 'createdAt'>, now = new Date()): Promise<DeviceGrant> {
    // `DO NOTHING` rồi đọc lại, chứ không `DO UPDATE`: cho mượn lần thứ hai
    // không được đổi `createdAt`, vì "từ bao giờ" là thứ người ta hỏi khi soát
    // lại quyền, và một lần bấm nhầm không được làm mới cái mốc ấy.
    await this.pool.query(
      `INSERT INTO device_grant (org_id, udid, user_id, granted_by, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (org_id, udid, user_id) DO NOTHING`,
      [grant.orgId, grant.udid, grant.userId, grant.grantedBy, now.toISOString()],
    );
    const { rows } = await this.pool.query<Row>(
      `SELECT * FROM device_grant WHERE org_id = $1 AND udid = $2 AND user_id = $3`,
      [grant.orgId, grant.udid, grant.userId],
    );
    return rows[0] ? hydrate(rows[0]) : { ...grant, createdAt: now.toISOString() };
  }

  async revoke(orgId: string, udid: string, userId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM device_grant WHERE org_id = $1 AND udid = $2 AND user_id = $3`,
      [orgId, udid, userId],
    );
    return (rowCount ?? 0) > 0;
  }

  async forUser(orgId: string, userId: string): Promise<Set<string>> {
    const { rows } = await this.pool.query<{ udid: string }>(
      `SELECT udid FROM device_grant WHERE org_id = $1 AND user_id = $2`,
      [orgId, userId],
    );
    return new Set(rows.map((row) => row.udid));
  }

  async forDevice(orgId: string, udid: string): Promise<DeviceGrant[]> {
    const { rows } = await this.pool.query<Row>(
      `SELECT * FROM device_grant WHERE org_id = $1 AND udid = $2 ORDER BY created_at`,
      [orgId, udid],
    );
    return rows.map(hydrate);
  }
}
