import { describe, expect, it } from 'vitest';
import type { WorkflowStage } from '@core/ui/contracts.js';
import { farmRunningCopy } from '../progress';

const stagesAt = (running: number): WorkflowStage[] =>
  [
    'Đóng gói test package',
    'Upload app + package lên Device Farm',
    'Chờ Device Farm chạy',
    'Thu artifact',
  ].map((name, index) => ({
    name,
    status: index < running ? 'done' : index === running ? 'running' : 'pending',
  }));

describe('Farm — trạng thái lượt chạy', () => {
  it.each([
    [0, 'Đang đóng gói…'],
    [1, 'Đang upload lên AWS…'],
    [2, 'Đang chờ Device Farm…'],
    [3, 'Đang thu report, ảnh và video…'],
  ])('hiện đúng công việc của phase %i', (phase, button) => {
    expect(farmRunningCopy(stagesAt(phase)).button).toBe(button);
  });

  it('giải thích vì sao AWS complete nhưng lượt chạy chưa kết thúc', () => {
    const copy = farmRunningCopy(stagesAt(3));
    expect(copy.title).toMatch(/AWS đã chạy xong/);
    expect(copy.detail).toMatch(/report, ảnh, video của từng thiết bị/);
    expect(copy.detail).toMatch(/mất thêm vài phút/);
  });

  it('nói rõ bước lưu cuối cùng sau khi đã thu xong artifact', () => {
    const copy = farmRunningCopy(stagesAt(4));
    expect(copy.button).toBe('Đang hoàn tất…');
    expect(copy.detail).toMatch(/lưu lịch sử/);
  });
});
