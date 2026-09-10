/**
 * `xcodebuild failed with code 65` không nói được gì.
 *
 * Appium ném đúng câu đó cho MỌI thứ hỏng quanh WebDriverAgent. Người dùng
 * thấy vòng lặp cài app → cài WDA → app biến mất → lặp lại, và log chỉ lặp lại
 * cùng một câu tiếng Anh dài không chỉ được chỗ nào.
 *
 * Đào trên máy thật thì: build KÝ THÀNH CÔNG (profile và identity đều resolve,
 * đã nhúng embedded.mobileprovision), và cả hai app đều đã nằm trên điện thoại
 * — nên hỏng ở khâu CHẠY, không phải ký hay cài. Với profile Apple ID miễn phí,
 * iOS từ chối chạy cho tới khi nhà phát triển được tin cậy trên chính máy đó.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const source = readFileSync('src/cli/run.ts', 'utf8');

function body(): string {
  const at = source.indexOf('function explainDriverStart(');
  assert.ok(at > 0, 'hàm giải thích đã đổi tên');
  return source.slice(at, source.indexOf('\n}\n', at));
}

describe('explainDriverStart', () => {
  it('chỉ đúng chỗ cần bấm trên máy', () => {
    assert.match(body(), /VPN & Quản lý thiết bị/);
    assert.match(body(), /Tin cậy/);
  });

  it('nói cả hạn 7 ngày của profile miễn phí', () => {
    assert.match(body(), /7 ngày/);
  });

  /** Câu gốc phải còn, cho người đi tra sâu hơn. */
  it('giữ nguyên văn lỗi của Appium', () => {
    assert.match(body(), /Nguyên văn lỗi: \$\{err\.message\}/);
  });

  /**
   * Chỉ thêm hướng dẫn cho ĐÚNG mã lỗi này. Dán một đoạn về chứng chỉ iOS lên
   * mọi lỗi khởi động là biến hướng dẫn thành nhiễu.
   */
  it('không đoán bừa cho lỗi khác hoặc nền tảng khác', () => {
    const b = body();
    assert.match(b, /platform !== 'ios'/);
    assert.match(b, /xcodebuild failed with code 65/);
    assert.match(b, /return err\.message;/);
  });

  it('được nối vào chỗ khởi động driver', () => {
    assert.match(source, /throw new Error\(await explainDriverStart\(err as Error, platform[^)]*\)\);/);
  });
});

/**
 * "Unknown device or simulator UDID".
 *
 * Câu này nghe như cắm sai máy hoặc sai udid, và đó là chỗ ai cũng tìm đầu
 * tiên. Thực tế ngày 2026-09-10: máy vẫn cắm (usbmux báo ConnectionType USB,
 * 480 Mbps), vẫn hiện trong Finder — nhưng sổ đăng ký của tunnel rỗng:
 *
 *   {"status":"OK","tunnels":{},"metadata":{"totalTunnels":0}}
 *
 * Từ iOS 18 Appium lấy danh sách máy thật TỪ SỔ ĐÓ. Mất gần một giờ mới lần ra,
 * và không dòng log nào nhắc tới tunnel. Câu thông báo phải tự nói ra.
 */
describe('máy cắm rồi mà Appium không thấy', () => {
  it('chỉ sang tunnel thay vì để người dùng đi tìm cáp', () => {
    const source = readFileSync('src/cli/run.ts', 'utf8');
    assert.match(source, /Unknown device or simulator UDID\/i\.test\(err\.message\)/);
    assert.match(source, /const tunnel = await iosTunnelCheck\(\)/);
    assert.match(source, /Appium không thấy máy nào, dù cáp vẫn cắm/);
    // Chỉ nói về tunnel khi tunnel THẬT SỰ hỏng; tunnel tốt thì lỗi này có
    // nguyên nhân khác và đổ cho tunnel là dẫn người dùng đi sai đường.
    assert.match(source, /if \(!tunnel\.ok\) \{/);
  });
});
