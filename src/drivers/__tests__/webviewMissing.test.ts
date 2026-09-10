/**
 * Câu thông báo khi không vào được WebView.
 *
 * Đo trên máy thật (iPhone 12 Pro Max, iOS 26.5, app hybrid): getContexts() của
 * Appium trả về đúng ["NATIVE_APP"] sau ~10s, vì trước đó nó ghi
 *
 *   [RemoteDebugger] Failed to start WebInspector shim service:
 *   Tunnel registry port not found. Please run the tunnel creation script first.
 *
 * Từ iOS 17, Web Inspector chỉ với tới được qua một tunnel CoreDevice. Không có
 * tunnel thì mọi lượt chạy app hybrid đều hỏng ở bước đầu tiên, và câu duy nhất
 * người chạy đọc được phải nói ra cách dựng tunnel đó.
 *
 * Hai chi tiết dưới đây đều là lỗi đã xảy ra, không phải giả định:
 *  - hạn 8s ngắn hơn vòng thử 20 lượt của Appium, nên câu trả lời thật không
 *    bao giờ tới nơi và log chỉ còn một dòng hết giờ;
 *  - một dấu `+` thừa biến cả đoạn hướng dẫn thành chuỗi "NaN".
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const source = readFileSync('src/drivers/native.ts', 'utf8');

describe('không vào được WebView', () => {
  it('chờ getContexts lâu hơn vòng thử của chính Appium', () => {
    const bound = /getContexts không trả lời sau (\d+)s'\)\), (\d+)_000\)/.exec(source);
    assert.ok(bound, 'không thấy ràng buộc thời gian cho getContexts');
    assert.equal(bound[1], bound[2], 'câu thông báo phải khớp con số thật');
    assert.ok(Number(bound[2]) >= 15, `${bound[2]}s vẫn ngắn hơn ~10s+ Appium cần`);
  });

  it('chỉ ra cách dựng tunnel cho iOS 17+', () => {
    assert.match(source, /sudo appium driver run xcuitest tunnel-creation/);
    assert.match(source, /Tunnel registry port not/);
  });

  it('nối chuỗi chứ không cộng số', () => {
    // `'…\n' + + (cond ? '…' : '')` cho ra "NaN" — hợp lệ với TypeScript, nên
    // chỉ có test đọc mã mới bắt được.
    assert.doesNotMatch(source, /\+\s*\n\s*\+ \(this\.opts\.platform/);
  });
});
