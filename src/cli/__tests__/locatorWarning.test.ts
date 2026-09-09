/**
 * Cảnh báo "chưa có locator" phải đúng và phải đúng phạm vi.
 *
 * Chạy tag đăng nhập trên iOS lại nhận về:
 *
 *   [run] 1 element chưa có locator ios và chưa từng resolve:
 *     ✗ "Danh sách sàn và nhóm bảng giá" (priceBoard.floorTabs)
 *       — Xóa mã khỏi danh mục hiện tại không ảnh hưởng danh mục khác:52
 *
 * Hai chỗ sai cùng lúc:
 *
 *  - Kịch bản đó thuộc feature thêm-mã-cổ-phiếu, chưa bao giờ nằm trong phạm vi
 *    được hỏi. Cảnh báo duyệt MỌI feature.
 *  - Và nó không hỏng: `ios.hybrid = true`, app chạy trong WebView, mà
 *    `NativeUiDriver.platform` trả về 'web' khi đang ở trong đó
 *    (native.ts:216). Element chỉ có candidate `web` vẫn dùng được — phần lớn
 *    element của bộ này là web-only và chúng chạy tốt trên Android hybrid suốt.
 *
 * Cảnh báo về việc mình không yêu cầu, lại còn sai, là cách nhanh nhất khiến
 * người ta ngừng đọc cảnh báo.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const source = readFileSync('src/cli/run.ts', 'utf8');

function warnBody(): string {
  const at = source.indexOf('function warnAboutLocatorlessElements(');
  assert.ok(at > 0, 'hàm cảnh báo đã đổi tên');
  return source.slice(at, source.indexOf('\n}\n', at));
}

describe('cảnh báo element thiếu locator', () => {
  it('bỏ qua kịch bản ngoài phạm vi lượt chạy', () => {
    assert.match(warnBody(), /if \(!inScope\(scenario\)\) continue;/);
  });

  it('app hybrid thì candidate web cũng tính', () => {
    const body = warnBody();
    assert.match(body, /hybrid/, 'không xét tới hybrid');
    assert.match(body, /candidates\.web/, 'không tính candidate web cho nền tảng native');
  });

  it('không hybrid thì vẫn chỉ tính candidate của đúng nền tảng', () => {
    assert.match(warnBody(), /:\s*\(element\.candidates\[platform\] \?\? \[\]\)/);
  });

  /** Element đã từng resolve thì im — nó chứng minh được bằng lịch sử. */
  it('vẫn bỏ qua element đã từng resolve', () => {
    assert.match(warnBody(), /health\?\.resolutions \?\? 0\) > 0\) continue;/);
  });
});
