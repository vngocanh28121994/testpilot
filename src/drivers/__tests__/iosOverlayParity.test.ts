/**
 * iOS phải đóng được thứ che màn hình, y như web và Android.
 *
 * `dismissOverlay()` là hàm resolver gọi mỗi khi locator bị che (resolver.ts)
 * và executor gọi trước mỗi thao tác (executor.ts). Bản cũ mở đầu bằng
 *
 *   if (this.opts.platform !== 'android') return false;
 *
 * nên trên iOS nó không bao giờ làm gì. Web có PopupInterceptor qua Playwright,
 * Android có nó qua CDP cộng thêm chạm nút native — iOS không có cả hai.
 * Một modal của app bật lên giữa kịch bản là bước đỏ vì "không tìm thấy
 * element", trỏ vào locator trong khi thứ hỏng nằm bên trên nó.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const native = readFileSync('src/drivers/native.ts', 'utf8');
const run = readFileSync('src/cli/run.ts', 'utf8');

describe('đóng overlay trên iOS', () => {
  it('không còn thoát sớm cho iOS', () => {
    // Cắt tại chữ 'async' kế TIẾP, không phải chữ 'async' của chính nó — cắt ở
    // vị trí 0 thì đoạn soi rỗng và test đỏ một thay đổi hoàn toàn đúng.
    const fn = native.slice(native.indexOf('async dismissOverlay(') + 10);
    const head = fn.slice(0, fn.indexOf('async '));
    assert.match(head, /platform === 'ios'\) return this\.dismissIosOverlay\(protect\)/);
  });

  it('dùng lại đúng đoạn quét ngữ nghĩa của web và Android', () => {
    assert.match(native, /import \{ SMART_DISMISS_SCRIPT, type PopupRule \}/);
    assert.match(native, /SMART_DISMISS_SCRIPT\.replace\('__PROTECT__'/);
  });

  it('chạy luật cấu hình trước, quét ngữ nghĩa sau', () => {
    const fn = native.slice(native.indexOf('private async dismissDomPopup'));
    const body = fn.slice(0, fn.indexOf('\n  }'));
    assert.ok(
      body.indexOf('IOS_CONFIGURED_POPUP_SCRIPT') < body.indexOf('SMART_DISMISS_SCRIPT'),
      'luật cấu hình phải được thử trước: nó chính xác và rẻ hơn quét cả DOM',
    );
  });

  /**
   * Đổi context sang NATIVE_APP rồi quên quay lại thì bước sau bỗng dưng thấy
   * mình ở ngoài WebView, và mọi locator web đều trượt — một lỗi trông hệt như
   * locator sai.
   */
  it('trả lại context WebView sau khi dọn hộp thoại native', () => {
    const fn = native.slice(native.indexOf('private async dismissIosOverlay'));
    const body = fn.slice(0, fn.indexOf('\n  /**'));
    assert.match(body, /const before = this\.webview;/);
    assert.match(body, /switchContext\(before\)/);
  });

  it('luật popup được truyền vào driver iOS, không chỉ vào driver Android', () => {
    const ios = run.slice(run.indexOf("platform: 'ios',"));
    assert.match(ios.slice(0, 2500), /popupRules: cfg\.web\.popups/);
  });
});
