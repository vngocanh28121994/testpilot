/**
 * Sổ thiết bị trong bộ nhớ — chế độ `embedded`, và là nguồn sự thật cho mọi
 * đường đọc danh sách máy.
 *
 * Ngay cả ở chế độ embedded, danh sách KHÔNG được hỏi thẳng `adb` từ route:
 * host tự báo cáo máy của nó vào sổ này theo nhịp, y như một runner ở xa làm.
 * Nhờ vậy màn hình thiết bị có đúng MỘT đường đọc ở cả hai chế độ — và hai
 * đường thì sớm muộn lệch nhau ở đúng chỗ khó thấy nhất, phần lọc quyền.
 */
import {
  maySee,
  type DeviceRecord,
  type DeviceRegistry,
  type ReportedDevice,
  type Viewer,
} from './registry.js';

export class MemoryDeviceRegistry implements DeviceRegistry {
  /** Khoá theo `runnerId`: báo cáo thay thế TOÀN BỘ phần của runner ấy. */
  private readonly byRunner = new Map<string, DeviceRecord[]>();

  async report(
    runner: { id: string; orgId: string; ownerUserId?: string; visibility: 'shared' | 'private' },
    devices: ReportedDevice[],
    now = new Date(),
  ): Promise<void> {
    this.byRunner.set(runner.id, devices.map((device) => ({
      ...device,
      runnerId: runner.id,
      orgId: runner.orgId,
      ...(runner.ownerUserId ? { ownerUserId: runner.ownerUserId } : {}),
      // Máy thừa hưởng quyền nhìn của runner: một chiếc điện thoại cắm vào
      // laptop riêng thì cũng riêng. Cho một người cụ thể mượn là một bảng
      // quyền RIÊNG chồng lên trên — xem `grants.ts`; nó chỉ thêm quyền, và
      // không đổi dòng này.
      visibility: runner.visibility,
      state: 'idle' as const,
      updatedAt: now.toISOString(),
    })));
  }

  async list(viewer: Viewer, granted?: Set<string>): Promise<DeviceRecord[]> {
    const all = [...this.byRunner.values()].flat();
    return all.filter((device) => maySee(device, viewer, granted));
  }

  async find(
    udid: string, viewer: Viewer, granted?: Set<string>,
  ): Promise<DeviceRecord | undefined> {
    return (await this.list(viewer, granted)).find((device) => device.udid === udid);
  }

  async markRunnerOffline(runnerId: string, now = new Date()): Promise<number> {
    const devices = this.byRunner.get(runnerId);
    if (!devices) return 0;
    // KHÔNG xoá: một chiếc máy biến mất khỏi danh sách và một chiếc máy đang
    // tắt là hai câu khác nhau, và người dùng cần câu thứ hai — "máy của bạn
    // đang offline" chứ không phải sự im lặng.
    this.byRunner.set(runnerId, devices.map((device) => ({
      ...device, state: 'offline' as const, updatedAt: now.toISOString(),
    })));
    return devices.length;
  }
}

/** MỘT sổ cho cả tiến trình — cùng lý do với `localQueue`, `localLeases`. */
export const localDevices = new MemoryDeviceRegistry();
