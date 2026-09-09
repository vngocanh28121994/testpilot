import { describe, expect, it } from 'vitest';
import { xcodeReport } from '../PrereqTools';

/**
 * Số SDK là phần đáng đọc nhất của kết quả kiểm tra Xcode.
 *
 * v2 từng chỉ đổ ra ba dòng thô — version, path, sdk — trong khi thứ quyết
 * định được hay không là: SDK này build được tới iOS mấy. Một iPhone mới hơn
 * con số đó từ chối cài WebDriverAgent dù mọi thứ khác đều đúng, và lỗi hiện
 * ra lúc chạy là `xcodebuild failed with code 65`. Không ai đọc câu đó ra
 * thành "Xcode cũ quá" — nên phải nói trước, ngay ở chỗ kiểm tra.
 */
describe('xcodeReport', () => {
  it('dịch số SDK thành phiên bản iOS build được', () => {
    const out = xcodeReport({ version: 'Xcode 26.6', path: '/Applications/Xcode.app', sdk: 'iphoneos26.5' });
    expect(out).toContain('build được cho iOS ≤ 26.x');
  });

  it('cảnh báo khi SDK quá cũ so với iPhone đời mới', () => {
    const out = xcodeReport({ version: 'Xcode 14.2', sdk: 'iphoneos16.2' });
    expect(out).toMatch(/⚠.*iOS > 16.*WebDriverAgent/);
  });

  it('không doạ khi SDK đủ mới', () => {
    expect(xcodeReport({ version: 'Xcode 26.6', sdk: 'iphoneos26.5' })).not.toContain('⚠');
  });

  it('thiếu SDK thì im, không bịa ra con số', () => {
    const out = xcodeReport({ version: 'Xcode 26.6', path: '/x' });
    expect(out).toBe('Xcode 26.6\n/x');
  });
});
