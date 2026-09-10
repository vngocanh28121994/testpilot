/**
 * Trong WebView, quan sát phải nhìn DOM — không nhìn cây native.
 *
 * Cây XCUITest của một WKWebView chỉ là mấy hộp `XCUIElementTypeOther`. Đo trên
 * máy thật ngày 2026-09-10, màn đăng nhập của TCInvest cho ra 24 node: không
 * một TextField, Button hay StaticText nào, không một chữ nào. Discovery nhìn
 * vào đó chấm điểm cao nhất được 15 trên ngưỡng 40 rồi bó tay — trong khi DOM
 * ngay bên dưới có đủ ô nhập kèm placeholder "Email / Số tài khoản / Điện thoại".
 *
 * Android không dính vì nó quan sát DOM qua CDP. Nên cái cần là dùng lại đúng
 * đoạn mã đó, chạy qua Appium — chứ không viết một bản thứ hai để rồi hai bản
 * trôi khỏi nhau.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { observeDomInPage } from '../domObserve.js';

const native = readFileSync('src/drivers/native.ts', 'utf8');
const cdp = readFileSync('src/drivers/WebViewCdpDriver.ts', 'utf8');

describe('quan sát DOM trong WebView', () => {
  it('cả hai driver dùng chung một đoạn quan sát', () => {
    assert.match(native, /import \{ DOM_OBSERVE_SCRIPT, observeDomInPage, type RawEl \}/);
    assert.match(cdp, /import \{ observeDomInPage, type RawEl \}/);
    assert.match(cdp, /this\.page\.evaluate\(observeDomInPage\)/);
  });

  /**
   * Appium phải nhận CHUỖI, không nhận hàm.
   *
   * WebdriverIO tuần tự hoá hàm bằng toString(), mà tsx bọc mỗi hàm bằng
   * __name() để giữ tên — bên trong WebView không có __name nên phần thân hỏng
   * LẶNG LẼ: trả về mảng rỗng, không ném lỗi. Đo cùng lúc trên cùng trang:
   * gọi bằng hàm 0 phần tử, gọi bằng chuỗi 51. Playwright không dính vì nó tự
   * tuần tự hoá trong cùng tiến trình.
   */
  it('Appium nhận đoạn quét dưới dạng chuỗi', () => {
    assert.match(native, /this\.b\.execute\(DOM_OBSERVE_SCRIPT\)/);
    assert.doesNotMatch(native, /this\.b\.execute\(observeDomInPage\)/);
  });

  it('chỉ chạy khi đang trong WebView, ngoài ra vẫn đọc cây native', () => {
    const fn = native.slice(native.indexOf('  async observe()'));
    const body = fn.slice(0, fn.indexOf('\n  async '));
    assert.ok(
      body.indexOf('if (this.inWebview)') < body.indexOf('getPageSource'),
      'phải thử DOM trước, rồi mới lùi về cây native',
    );
    assert.match(body, /parseIosXml\(xml\)/);
  });

  /**
   * Hàm chạy TRONG trang nên không được tham chiếu bất cứ thứ gì bên ngoài —
   * cả `page.evaluate` lẫn `browser.execute` đều chỉ chuyển đi phần thân.
   */
  it('không đóng gói biến ngoài, chạy được ở cả hai nơi', () => {
    const body = observeDomInPage.toString();
    assert.doesNotMatch(body, /\bthis\./);
    assert.match(body, /document\.querySelectorAll/);
  });
});
