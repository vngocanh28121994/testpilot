/**
 * Một quyết định, hai điều kiện, và chúng đã lệch nhau.
 *
 * `get platform()` báo 'web' khi inWebview HOẶC cdpConnected, nên resolver đưa
 * xuống ứng viên web — css, label. Nhưng `toSelector()` chọn nhánh chỉ theo
 * inWebview, nên ở trạng thái `cdpConnected && !inWebview` nó biên dịch chính
 * những ứng viên web ấy cho thế giới native:
 *
 *   label "Tổng tài sản"  →  android=new UiSelector().text("Tổng tài sản")
 *
 * Phiên Appium từ chối, WebdriverIO trả về
 *   The selector "undefined" used with strategy "undefined" is invalid!
 * — một câu không nêu tên element lẫn strategy nào. Một lượt chạy thật sinh ra
 * 81 dòng như vậy, mỗi tick poll một dòng, tất cả bị `.catch()` nuốt: không ai
 * thấy, mà mỗi tick vẫn mất thêm một vòng gọi mạng.
 *
 * Bắt được bằng cách gắn thiết bị đo vào chỗ gọi selector rồi ép nhánh
 * WebView-không-nối-được; dấu vết chỉ thẳng vào Resolver.isVisibleNow →
 * NativeUiDriver.find.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const native = readFileSync('src/drivers/native.ts', 'utf8');

/** Thân hàm find(), tới trước chỗ dựng selector. */
function findHead(): string {
  const at = native.indexOf('async find(c: LocatorCandidate)');
  assert.ok(at > 0, 'find() đã bị đổi tên hoặc xoá');
  const stop = native.indexOf('const selector = this.toSelector(c);', at);
  assert.ok(stop > at, 'find() không còn dựng selector native nữa');
  return native.slice(at, stop);
}

describe('CDP đang nối nhưng Appium không ở trong WebView', () => {
  it('không hỏi Appium nữa, vì selector sẽ được dựng cho sai thế giới', () => {
    assert.match(
      findHead(),
      /if \(this\.cdpConnected && !this\.inWebview\) return null;/,
      'đường rơi xuống Appium đã quay lại — nó chỉ sinh ra lỗi selector undefined',
    );
  });

  it('chặn trước khi selector kịp được dựng, không phải sau', () => {
    const head = findHead();
    const guard = head.indexOf('this.cdpConnected && !this.inWebview');
    const playwrightOnly = head.indexOf('isPlaywrightOnlyCss');
    assert.ok(guard > 0, 'không còn chốt chặn nào');
    assert.ok(
      playwrightOnly === -1 || guard < playwrightOnly,
      'chốt chặn phải đứng trước mọi thứ dùng tới candidate',
    );
  });

  /**
   * Gốc rễ là hai điều kiện cho cùng một quyết định. Nếu ai đó đổi `platform`
   * mà quên `toSelector`, lỗi này quay lại y nguyên — nên khoá cả hai lại.
   */
  it('platform vẫn coi cdpConnected là web', () => {
    const at = native.indexOf('get platform(): Platform');
    assert.ok(at > 0, 'getter platform đã biến mất');
    assert.match(
      native.slice(at, at + 200),
      /this\.inWebview \|\| this\.cdpConnected \? 'web'/,
      'điều kiện chọn ứng viên đã đổi — kiểm lại toSelector và chốt chặn trong find()',
    );
  });

  it('toSelector vẫn chỉ dựng DOM selector khi thật sự ở trong WebView', () => {
    const at = native.indexOf('private toSelector(c: LocatorCandidate)');
    assert.ok(at > 0, 'toSelector đã biến mất');
    assert.match(
      native.slice(at, at + 200),
      /if \(this\.inWebview\) return this\.toDomSelector\(c\);/,
      'nhánh dựng selector đã đổi — kiểm lại chốt chặn trong find()',
    );
  });
});
