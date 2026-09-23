/**
 * Quyền mượn máy trong bộ nhớ — chế độ `embedded`.
 *
 * Ở bản local chỉ có một người, nên bảng này gần như luôn rỗng. Nó vẫn tồn tại
 * để route và phép lọc có đúng một đường đi ở cả hai chế độ: một nhánh `if
 * (mode === 'server')` quanh phép kiểm quyền là chỗ mà lần sửa sau sẽ quên.
 */
import type { DeviceGrant, DeviceGrants } from './grants.js';

/**
 * Khoá dựng bằng `JSON.stringify` chứ không nối chuỗi bằng một dấu phân cách.
 *
 * `udid` do thiết bị đặt tên và ta không kiểm soát nó; một dấu phân cách tự
 * chọn là một giả định về thứ mà udid không chứa, và giả định ấy sai ở đúng
 * chiếc máy khó gỡ nhất.
 */
const key = (orgId: string, udid: string, userId: string) =>
  JSON.stringify([orgId, udid, userId]);

export class MemoryDeviceGrants implements DeviceGrants {
  private readonly grants = new Map<string, DeviceGrant>();

  async grant(grant: Omit<DeviceGrant, 'createdAt'>, now = new Date()): Promise<DeviceGrant> {
    const id = key(grant.orgId, grant.udid, grant.userId);
    // Cho mượn lần thứ hai không tạo dòng thứ hai, và KHÔNG đổi `createdAt`:
    // câu "từ bao giờ" là thứ người ta hỏi khi soát lại quyền.
    const existing = this.grants.get(id);
    if (existing) return { ...existing };
    const record: DeviceGrant = { ...grant, createdAt: now.toISOString() };
    this.grants.set(id, record);
    return { ...record };
  }

  async revoke(orgId: string, udid: string, userId: string): Promise<boolean> {
    return this.grants.delete(key(orgId, udid, userId));
  }

  async forUser(orgId: string, userId: string): Promise<Set<string>> {
    const mine = new Set<string>();
    for (const grant of this.grants.values()) {
      if (grant.orgId === orgId && grant.userId === userId) mine.add(grant.udid);
    }
    return mine;
  }

  async forDevice(orgId: string, udid: string): Promise<DeviceGrant[]> {
    return [...this.grants.values()]
      .filter((grant) => grant.orgId === orgId && grant.udid === udid)
      .map((grant) => ({ ...grant }));
  }
}

/** MỘT sổ cho cả tiến trình — cùng lý do với `localLeases`, `localProposals`. */
export const localDeviceGrants = new MemoryDeviceGrants();
