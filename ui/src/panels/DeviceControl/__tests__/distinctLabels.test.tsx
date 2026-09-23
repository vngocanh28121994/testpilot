/**
 * Hai chiếc máy cùng đời thì cùng tên.
 *
 * Nhãn là tên model chứ không phải số sê-ri, vì "Samsung SM-S918B" nhận ra
 * được còn "R5CW525G35Y" thì phải đi tra. Nhưng một phòng máy có hai chiếc
 * S23 là chuyện thường, và lúc ấy hai dòng giống hệt nhau còn tệ hơn hai số
 * sê-ri: người ta chọn nhầm mà không biết mình đã chọn nhầm.
 */
import { describe, expect, it } from 'vitest';
import { withDistinctLabels } from '@/panels/DeviceControl';

describe('nhãn trùng trong ô chọn máy', () => {
  it('không trùng thì để nguyên, không gắn số sê-ri', () => {
    // Gắn số sê-ri vào mọi dòng để phòng xa là bắt mọi người đọc một chuỗi
    // mười một ký tự mỗi ngày vì một trường hợp họ có thể không bao giờ gặp.
    const out = withDistinctLabels([
      { udid: 'R5CW525G35Y', label: 'Samsung SM-S918B · Android 16' },
      { udid: 'emulator-5554', label: 'sdk_gphone64_arm64 · Android 16 · emulator' },
    ]);
    expect(out.map((o) => o.label)).toEqual([
      'Samsung SM-S918B · Android 16',
      'sdk_gphone64_arm64 · Android 16 · emulator',
    ]);
  });

  it('trùng thì thêm số sê-ri vào ĐÚNG những dòng trùng', () => {
    const out = withDistinctLabels([
      { udid: 'AAA', label: 'Samsung SM-S918B · Android 16' },
      { udid: 'BBB', label: 'Samsung SM-S918B · Android 16' },
      { udid: 'emulator-5554', label: 'sdk_gphone64_arm64 · emulator' },
    ]);
    expect(out.map((o) => o.label)).toEqual([
      'Samsung SM-S918B · Android 16 · AAA',
      'Samsung SM-S918B · Android 16 · BBB',
      'sdk_gphone64_arm64 · emulator',
    ]);
  });

  it('giá trị luôn là udid — thứ server cần, không phải thứ người đọc', () => {
    const out = withDistinctLabels([{ udid: 'R5CW525G35Y', label: 'Samsung SM-S918B' }]);
    expect(out[0]!.value).toBe('R5CW525G35Y');
  });
});
