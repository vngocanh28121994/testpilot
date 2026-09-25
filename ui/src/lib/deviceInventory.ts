/**
 * Danh sách thiết bị khi có NHIỀU máy: trạng thái, tổng quan, lọc, nhóm, trang.
 *
 * Bảng phẳng cũ đủ cho ba chiếc máy. Với vài chục chiếc — máy chủ cắm cả chồng
 * điện thoại, cộng máy cá nhân của từng người — nó không trả lời được câu hỏi
 * đầu tiên ai cũng hỏi: "còn máy nào rảnh không?", mà phải đọc từng dòng.
 *
 * Tách khỏi phần vẽ để test được thuần: đây là chỗ quyết định máy nào hiện, ở
 * nhóm nào, theo thứ tự nào — những thứ sai là người ta chọn nhầm máy.
 */
import type { ControlDeviceView, DeviceLeaseView } from '@core/ui/contracts.js';
import { groupByMachine, type MachineGroup } from './deviceGroups';

export type DeviceStatus = 'free' | 'held' | 'testing' | 'offline';

/** Thứ tự trong mỗi nhóm: thứ người ta tìm nhất lên đầu. */
const STATUS_ORDER: Record<DeviceStatus, number> = { free: 0, held: 1, testing: 2, offline: 3 };

export const STATUS_LABEL: Record<DeviceStatus, string> = {
  free: 'Rảnh',
  held: 'Đang giữ',
  testing: 'Đang chạy test',
  offline: 'Tắt',
};

export interface InventoryRow {
  device: ControlDeviceView;
  lease?: DeviceLeaseView;
  status: DeviceStatus;
}

/**
 * Máy tắt thì là "tắt", kể cả khi sổ còn một lượt giữ chưa hết hạn: người
 * đọc cần biết nó KHÔNG dùng được, không cần biết ai từng cầm nó.
 */
export function statusOf(device: ControlDeviceView, lease?: DeviceLeaseView): DeviceStatus {
  if (device.offline) return 'offline';
  if (!lease) return 'free';
  return lease.holder.kind === 'job' ? 'testing' : 'held';
}

export function inventory(
  devices: ControlDeviceView[],
  leases: DeviceLeaseView[],
): InventoryRow[] {
  const byDevice = new Map(leases.map((lease) => [lease.deviceId, lease]));
  return devices.map((device) => {
    const lease = byDevice.get(device.udid);
    return { device, ...(lease ? { lease } : {}), status: statusOf(device, lease) };
  });
}

export type Summary = Record<DeviceStatus | 'total', number>;

export function summarize(rows: InventoryRow[]): Summary {
  const out: Summary = { total: rows.length, free: 0, held: 0, testing: 0, offline: 0 };
  for (const row of rows) out[row.status] += 1;
  return out;
}

export interface InventoryFilter {
  status?: DeviceStatus;
  platform?: 'android' | 'ios';
  /** Tên máy tính (`runnerName`); chuỗi rỗng là "chưa rõ máy". */
  machine?: string;
  /** Tìm theo tên máy, udid, hoặc tên máy tính — không phân biệt hoa thường. */
  query?: string;
}

export function filterRows(rows: InventoryRow[], filter: InventoryFilter): InventoryRow[] {
  const query = filter.query?.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter.status && row.status !== filter.status) return false;
    if (filter.platform && row.device.platform !== filter.platform) return false;
    if (filter.machine !== undefined && (row.device.runnerName ?? '') !== filter.machine) return false;
    if (query) {
      const haystack = `${row.device.label} ${row.device.udid} ${row.device.runnerName ?? ''}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

/** Tên các máy tính đang có trong danh sách — cho ô lọc theo máy tính. */
export function machinesOf(rows: InventoryRow[]): string[] {
  return [...new Set(rows.map((row) => row.device.runnerName ?? ''))];
}

export interface InventoryGroup extends MachineGroup<InventoryRow> {
  /** Số máy rảnh / tổng trong nhóm — hiện ngay ở tiêu đề nhóm. */
  free: number;
}

/**
 * Nhóm theo máy tính (máy của mình lên đầu — cùng luật với ô chọn máy), trong
 * mỗi nhóm máy rảnh lên đầu, rồi theo tên để danh sách không nhảy giữa hai lần
 * làm mới.
 */
export function groupRows(rows: InventoryRow[]): InventoryGroup[] {
  // Bản sao có thêm hai trường mà `groupByMachine` đọc — không sửa dòng gốc.
  const withMachine = rows.map((row) => ({
    ...row,
    ...(row.device.runnerName !== undefined ? { runnerName: row.device.runnerName } : {}),
    ...(row.device.mine !== undefined ? { mine: row.device.mine } : {}),
  }));
  return groupByMachine(withMachine).map((group) => ({
    ...group,
    list: [...group.list].sort((a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
      || a.device.label.localeCompare(b.device.label, 'vi')),
    free: group.list.filter((row) => row.status === 'free').length,
  }));
}

export const PAGE_SIZE = 50;

/**
 * Một trang, TÍNH SAU khi nhóm: xếp các nhóm nối tiếp nhau rồi cắt. Một nhóm
 * lớn vắt qua hai trang thì hiện tiêu đề ở cả hai — người lật trang vẫn biết
 * mình đang ở máy tính nào.
 */
export function pageOf(groups: InventoryGroup[], page: number, size = PAGE_SIZE): {
  groups: InventoryGroup[];
  pageCount: number;
} {
  const flat = groups.flatMap((group) => group.list.map((row) => ({ group, row })));
  const pageCount = Math.max(1, Math.ceil(flat.length / size));
  const current = Math.min(Math.max(1, page), pageCount);
  const slice = flat.slice((current - 1) * size, current * size);
  const out: InventoryGroup[] = [];
  for (const { group, row } of slice) {
    const last = out[out.length - 1];
    if (last && last.key === group.key) last.list.push(row);
    else out.push({ ...group, list: [row] });
  }
  return { groups: out, pageCount };
}
