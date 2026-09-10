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

  /**
   * Câu thông báo phải HỎI xem tunnel có thiếu không, chứ không kể ra mọi
   * nguyên nhân có thể. Ở lượt chạy 03:27 tunnel đang chạy ngon lành mà thông
   * báo vẫn bảo người dùng đi dựng nó — đọc xong thì thôi tin những gì tool nói,
   * và lần sau họ bỏ qua cả những câu đúng.
   */
  it('hỏi trạng thái tunnel rồi mới đổ lỗi cho nó', () => {
    assert.match(source, /const tunnel = this\.opts\.platform === 'ios' \? await iosTunnelCheck\(\)/);
    assert.match(source, /tunnel && !tunnel\.ok[\s\S]{0,120}gần như chắc chắn là nguyên nhân/);
  });

  it('tunnel đang chạy thì chỉ sang Web Inspector và bản build', () => {
    const branch = source.slice(source.indexOf('tunnel?.ok'));
    assert.match(branch.slice(0, 900), /Web Inspector phải bật/);
    assert.match(branch.slice(0, 900), /isInspectable = true/);
    // Và phải nói ra cách tự phân biệt hai nguyên nhân đó.
    assert.match(branch.slice(0, 1200), /mở Safari trên máy/);
  });

  it('nối chuỗi chứ không cộng số', () => {
    // `'…\n' + + (cond ? '…' : '')` cho ra "NaN" — hợp lệ với TypeScript, nên
    // chỉ có test đọc mã mới bắt được.
    assert.doesNotMatch(source, /\+\s*\n\s*\+ \(this\.opts\.platform/);
  });
});
