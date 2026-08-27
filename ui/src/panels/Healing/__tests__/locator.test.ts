import { describe, expect, it } from 'vitest';
import type { LocatorQuality } from '@core/ui/contracts.js';
import {
  deviceTooltip,
  formatLocator,
  healingStatusLabel,
  qualityLabel,
  qualityTone,
} from '../locator';

const q = (over: Partial<LocatorQuality>): LocatorQuality => ({
  score: 50,
  stable: false,
  persistable: false,
  promotable: false,
  reasons: [],
  ...over,
});

describe('helper của Healing', () => {
  it('formatLocator theo dạng strategy=value', () => {
    expect(formatLocator({ strategy: 'testId', value: 'x', weight: 1, origin: 'healed' })).toBe('testId=x');
    expect(formatLocator(null)).toBe('Chưa có locator');
  });

  /** `stable` phải thắng `promotable` — đúng thứ tự lồng nhau của app.js:1210. */
  it('qualityTone: stable thắng promotable', () => {
    expect(qualityTone(q({ stable: true, promotable: true }))).toBe('stable');
    expect(qualityTone(q({ stable: false, promotable: true }))).toBe('review');
    expect(qualityTone(q({ stable: false, promotable: false }))).toBe('fragile');
    expect(qualityLabel(q({ stable: true }))).toBe('Ổn định');
    expect(qualityLabel(q({ promotable: true }))).toBe('Có thể duyệt');
    expect(qualityLabel(q({}))).toBe('Fragile');
  });

  it('healingStatusLabel dịch 4 trạng thái, giữ nguyên giá trị lạ', () => {
    expect(healingStatusLabel('proposed')).toBe('Chờ duyệt');
    expect(healingStatusLabel('watching')).toBe('Đang theo dõi');
    expect(healingStatusLabel('applied')).toBe('Đã áp dụng');
    expect(healingStatusLabel('rejected')).toBe('Đã từ chối');
    // Không nuốt mất giá trị chưa biết — hiện nguyên trạng còn hơn hiện rỗng.
    expect(healingStatusLabel('gi-do-moi')).toBe('gi-do-moi');
  });

  it('deviceTooltip liệt kê từng máy, có câu riêng cho dữ liệu cũ', () => {
    expect(deviceTooltip({ 'Pixel 7': 3, 'iPhone 15': 2 })).toBe('Pixel 7: 3\niPhone 15: 2');
    expect(deviceTooltip({})).toBe('Bằng chứng ghi trước khi có tách theo máy.');
  });
});
