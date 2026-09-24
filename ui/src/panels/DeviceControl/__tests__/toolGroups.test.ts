import { describe, expect, it } from 'vitest';
import { toolsFor } from '../index';

const ids = (platform: 'android' | 'ios') =>
  toolsFor(platform).flatMap((group) => group.items.map((item) => item.id));

describe('toolsFor — cột nút theo nền tảng', () => {
  it('iPhone có thông báo, trung tâm điều khiển, âm lượng, xoay, app, chụp màn hình', () => {
    expect(ids('ios')).toEqual(expect.arrayContaining([
      'home', 'notifications', 'quick_settings',
      'volume_up', 'volume_down', 'rotate', 'restart', 'close', 'screenshot',
    ]));
  });

  it('iPhone KHÔNG có Quay lại, Tab, và (chưa) Đa nhiệm — không hiện rồi báo lỗi', () => {
    expect(ids('ios')).not.toContain('recents');
    expect(ids('ios')).not.toContain('back');
    expect(ids('ios')).not.toContain('tab');
  });

  it('Android có đủ, kể cả Quay lại và Tab', () => {
    expect(ids('android')).toEqual(expect.arrayContaining(['back', 'tab', 'recents', 'rotate']));
  });

  it('không nút nào khoá máy hay tắt nguồn', () => {
    for (const platform of ['android', 'ios'] as const) {
      for (const id of ids(platform)) expect(id).not.toMatch(/power|sleep|lock/i);
    }
  });
});
