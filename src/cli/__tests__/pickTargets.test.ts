/**
 * Chọn máy cho lượt chạy song song, theo `--devices`.
 *
 * Điều bài này giữ: token nhận CẢ `id` trong config lẫn `udid`. Giao diện gửi
 * udid, vì từ lúc điện thoại có thể cắm ở laptop người khác thì `id` trong
 * config của máy chủ không trỏ tới được chiếc máy người dùng đang nhìn. Đường
 * chạy đơn đã nhận cả hai từ lâu; chỗ này từng là bản sao chỉ nhận một nửa, và
 * hậu quả là mọi lượt chạy song song đặt từ giao diện đều chết bằng câu
 * "which is not configured" — kể cả với chiếc máy đang cắm ngay trước mặt.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pickTargets, type Args } from '../parallelTargets.js';
import { ConfigSchema } from '../../config.js';

const CFG = ConfigSchema.parse({
  web: { baseUrl: 'https://x.dev' },
  android: {
    devices: [
      { id: 'sm-s918b', deviceName: 'SM_S918B', udid: 'R5CW525G35Y', systemPort: 8200 },
      { id: 'sm-s938b', deviceName: 'SM_S938B', udid: 'R5CY21WADDY', systemPort: 8201 },
    ],
  },
});

const args = (only?: string[]): Args => ({
  platforms: ['android'], includeQuarantined: false, reinstall: false,
  ...(only ? { only } : {}),
});

describe('chọn máy theo --devices', () => {
  it('nhận id trong config', () => {
    const picked = pickTargets(CFG, args(['android:sm-s918b']));
    assert.deepEqual(picked.map((t) => t.device.id), ['sm-s918b']);
  });

  it('nhận CẢ udid, vì đó là thứ giao diện gửi', () => {
    const picked = pickTargets(CFG, args(['android:R5CY21WADDY']));
    assert.deepEqual(picked.map((t) => t.device.id), ['sm-s938b']);
  });

  it('trộn hai kiểu tên trong cùng một lượt vẫn ra đúng hai máy', () => {
    const picked = pickTargets(CFG, args(['android:sm-s918b', 'android:R5CY21WADDY']));
    assert.deepEqual(picked.map((t) => t.device.id), ['sm-s918b', 'sm-s938b']);
  });

  it('tên không có trong config thì nói ra, kèm danh sách có gì', () => {
    // Im lặng bỏ qua một máy được gọi tên là chạy ít máy hơn người ta yêu cầu
    // mà không ai biết.
    assert.throws(
      () => pickTargets(CFG, args(['android:không-có'])),
      /is not configured/,
    );
  });
});
