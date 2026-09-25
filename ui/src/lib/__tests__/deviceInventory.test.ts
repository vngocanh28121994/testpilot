import { describe, expect, it } from 'vitest';
import type { ControlDeviceView, DeviceLeaseView } from '@core/ui/contracts.js';
import {
  filterRows, groupRows, inventory, pageOf, summarize,
} from '../deviceInventory';

const dev = (udid: string, extra: Partial<ControlDeviceView> = {}): ControlDeviceView => ({
  platform: 'android', udid, label: udid, ...extra,
});
const lease = (deviceId: string, holder: DeviceLeaseView['holder']): DeviceLeaseView => ({
  id: `l-${deviceId}`, deviceId, holder, acquiredAt: '', expiresAt: '',
});

const DEVICES = [
  dev('pixel', { runnerName: 'Máy chủ', label: 'Pixel 7' }),
  dev('s23', { runnerName: 'Máy chủ', label: 'Galaxy S23' }),
  dev('iphone', { runnerName: 'Máy chủ', platform: 'ios', label: 'iPhone 12' }),
  dev('old', { runnerName: 'Máy chủ', label: 'Galaxy A10', offline: true }),
  dev('mine', { runnerName: 'Laptop Bình', mine: true, label: 'Pixel 5' }),
];
const LEASES = [
  lease('s23', { kind: 'human', userId: 'u1' }),
  lease('iphone', { kind: 'job', jobId: 'j1' }),
];

describe('deviceInventory', () => {
  const rows = inventory(DEVICES, LEASES);

  it('tổng quan trả lời "còn máy nào rảnh không" mà không đọc bảng', () => {
    expect(summarize(rows)).toEqual({ total: 5, free: 2, held: 1, testing: 1, offline: 1 });
  });

  it('máy tắt là "tắt", kể cả khi còn lượt giữ cũ', () => {
    const r = inventory([dev('x', { offline: true })], [lease('x', { kind: 'human', userId: 'u' })]);
    expect(r[0]!.status).toBe('offline');
  });

  it('nhóm theo máy tính, máy của mình lên đầu; trong nhóm máy rảnh lên đầu', () => {
    const groups = groupRows(rows);
    expect(groups.map((g) => g.title)).toEqual(['Laptop Bình', 'Máy chủ']);
    const server = groups[1]!;
    expect(server.list.map((r) => r.status)).toEqual(['free', 'held', 'testing', 'offline']);
    expect(server.free).toBe(1);
  });

  it('lọc theo trạng thái, nền tảng, máy tính và từ khoá', () => {
    expect(filterRows(rows, { status: 'free' }).map((r) => r.device.udid).sort()).toEqual(['mine', 'pixel']);
    expect(filterRows(rows, { platform: 'ios' }).map((r) => r.device.udid)).toEqual(['iphone']);
    expect(filterRows(rows, { machine: 'Laptop Bình' }).map((r) => r.device.udid)).toEqual(['mine']);
    expect(filterRows(rows, { query: 'galaxy' }).map((r) => r.device.udid).sort()).toEqual(['old', 's23']);
  });

  it('chia trang sau khi nhóm; nhóm vắt qua hai trang có tiêu đề ở cả hai', () => {
    const many = inventory(
      Array.from({ length: 7 }, (_, i) => dev(`d${i}`, { runnerName: 'Máy chủ', label: `Máy ${i}` })), [],
    );
    const groups = groupRows(many);
    const p1 = pageOf(groups, 1, 5);
    const p2 = pageOf(groups, 2, 5);
    expect(p1.pageCount).toBe(2);
    expect(p1.groups[0]!.list).toHaveLength(5);
    expect(p2.groups[0]!.title).toBe('Máy chủ');
    expect(p2.groups[0]!.list).toHaveLength(2);
  });
});
