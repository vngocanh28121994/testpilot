/**
 * Sổ thiết bị trong Postgres — chế độ `server`.
 *
 * Bản trong bộ nhớ đủ khi web server và thiết bị nằm trên cùng một máy. Nó
 * hỏng ngay khi có hai instance web: runner chỉ báo cáo về MỘT instance (nó
 * gọi qua load balancer), nên instance kia không biết chiếc máy nào tồn tại —
 * và người dùng thấy danh sách máy đổi theo từng lần bấm F5.
 *
 * Báo cáo THAY THẾ toàn bộ phần của một runner, y như bản bộ nhớ: một chiếc
 * máy bị rút ra là một sự VẮNG MẶT, và sự vắng mặt không có sự kiện nào để
 * gửi. Nên ghi là xoá-rồi-chèn trong một transaction, không phải upsert từng
 * dòng — upsert thì máy đã rút vẫn nằm lại mãi.
 */
import type { PoolProvider } from '../db/pool.js';
import {
  maySee,
  type DeviceRecord,
  type DeviceRegistry,
  type DeviceVisibility,
  type ReportedDevice,
  type Viewer,
} from './registry.js';

interface Row {
  runner_id: string;
  org_id: string;
  platform: 'android' | 'ios';
  name: string;
  udid: string | null;
  visibility: DeviceVisibility;
  state: string;
  updated_at: Date | string;
  owner_user_id: string | null;
}

function hydrate(row: Row): DeviceRecord {
  return {
    platform: row.platform,
    udid: row.udid ?? '',
    label: row.name,
    runnerId: row.runner_id,
    orgId: row.org_id,
    ...(row.owner_user_id ? { ownerUserId: row.owner_user_id } : {}),
    visibility: row.visibility,
    // Bảng biết thêm `leased` và `busy`; sổ này chỉ nói ba trạng thái, và hai
    // cái kia thuộc về LEASE — một chiếc máy đang bị giữ vẫn là một chiếc máy
    // đang cắm. Gộp về `idle` để hai nguồn không nói hai chuyện khác nhau.
    state: row.state === 'offline' || row.state === 'quarantined' ? row.state : 'idle',
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

/** Khoá chính của bảng: một chiếc máy là một udid TRÊN MỘT runner. */
const idOf = (runnerId: string, udid: string) => `${runnerId}::${udid}`;

export class PgDeviceRegistry implements DeviceRegistry {
  constructor(private readonly pool: PoolProvider) {}

  async report(
    runner: { id: string; orgId: string; ownerUserId?: string; visibility: DeviceVisibility },
    devices: ReportedDevice[],
    now = new Date(),
  ): Promise<void> {
    const client = await (await this.pool()).connect();
    try {
      await client.query('BEGIN');
      // CẬP NHẬT máy còn cắm, chỉ XOÁ máy không còn được báo — trong MỘT
      // transaction, nên không ai nhìn thấy một danh sách dở dang.
      //
      // Từng là "xoá hết rồi chèn lại". Nghe gọn, nhưng `lease.device_id` trỏ
      // vào dòng này với ON DELETE CASCADE: mỗi nhịp báo máy (10 giây) xoá sạch
      // mọi lượt giữ. Người bấm Giữ máy nhận "Chưa giữ chỗ thiết bị này" trước
      // cả khi màn hình kịp hiện, và job chạy trên máy của runner ở xa mất lease
      // giữa chừng. Máy đã rút ra thì mất lượt giữ theo — đó là đúng.
      const ids = devices.map((device) => idOf(runner.id, device.udid));
      await client.query(
        'DELETE FROM device WHERE runner_id = $1 AND NOT (id = ANY($2::text[]))',
        [runner.id, ids],
      );
      for (const device of devices) {
        await client.query(
          `INSERT INTO device
             (id, runner_id, org_id, platform, name, udid, visibility, state, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'idle', $8)
           ON CONFLICT (id) DO UPDATE SET
             org_id = EXCLUDED.org_id, platform = EXCLUDED.platform, name = EXCLUDED.name,
             udid = EXCLUDED.udid, visibility = EXCLUDED.visibility,
             updated_at = EXCLUDED.updated_at,
             -- Báo lên nghĩa là đang cắm: một máy từng bị đánh dấu tắt thì sống
             -- lại. Trạng thái khác (cách ly) là quyết định của người, giữ nguyên.
             state = CASE WHEN device.state = 'offline' THEN 'idle' ELSE device.state END`,
          [
            idOf(runner.id, device.udid), runner.id, runner.orgId, device.platform,
            device.label, device.udid, runner.visibility, now.toISOString(),
          ],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async list(viewer: Viewer, granted?: Set<string>): Promise<DeviceRecord[]> {
    // `owner_user_id` lấy từ RUNNER, không từ dòng thiết bị: máy thừa hưởng
    // quyền nhìn của máy tính nó cắm vào, và nhân đôi trường ấy sang bảng
    // `device` là hai chỗ để lệch nhau khi một runner đổi chủ.
    const { rows } = await (await this.pool()).query<Row>(
      `SELECT device.*, runner.owner_user_id
       FROM device JOIN runner ON runner.id = device.runner_id
       WHERE device.org_id = $1
       ORDER BY device.name`,
      [viewer.orgId],
    );
    // Lọc bằng CHÍNH hàm mà bản bộ nhớ dùng, không viết lại thành SQL: hai
    // bản chép tay của một luật quyền sẽ lệch, và bên lỏng hơn là bên quyết
    // định. Một tổ chức có hàng trăm máy, không hàng triệu.
    return rows.map(hydrate).filter((device) => maySee(device, viewer, granted));
  }

  async find(
    udid: string, viewer: Viewer, granted?: Set<string>,
  ): Promise<DeviceRecord | undefined> {
    return (await this.list(viewer, granted)).find((device) => device.udid === udid);
  }

  async markRunnerOffline(runnerId: string, now = new Date()): Promise<number> {
    // KHÔNG xoá: một chiếc máy biến mất khỏi danh sách và một chiếc máy đang
    // tắt là hai câu khác nhau, và người dùng cần câu thứ hai.
    const { rowCount } = await (await this.pool()).query(
      `UPDATE device SET state = 'offline', updated_at = $2 WHERE runner_id = $1`,
      [runnerId, now.toISOString()],
    );
    return rowCount ?? 0;
  }
}
