/**
 * Đọc lại giá trị ô nhập khi đang ở trong WebView.
 *
 * `NativeHandle.value()` viết cho view native của Android: ở đó một EditText
 * báo nội dung qua chính thuộc tính `text`, nên `getText()` là đúng. Trong
 * WebView thì sai hoàn toàn — một `<input>` không có text content, `getText()`
 * luôn trả chuỗi rỗng dù ô đang đầy chữ.
 *
 * Đo trên máy thật ngày 2026-09-10 (iPhone 12 Pro Max, app TCInvest hybrid):
 * tool gõ 10 ký tự, ảnh chụp cho thấy đúng 10 ký tự trên màn hình, mà bước
 * kiểm lại đọc ra 0 và bắn "Ô nhập không nhận đúng giá trị". Không một bước
 * nhập liệu nào của iOS hybrid qua nổi chỗ này.
 *
 * Android không dính vì ở đó handle là WebViewCdpHandle và đọc thẳng el.value.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const source = readFileSync('src/drivers/native.ts', 'utf8');
const handle = source.slice(source.indexOf('class NativeHandle'), source.indexOf('async selected()'));

describe('giá trị ô nhập trong WebView', () => {
  it('handle biết mình có đang ở trong WebView không', () => {
    assert.match(source, /private readonly inWebview = false,/);
    assert.match(source, /new NativeHandle\(c, el, this\.inWebview\)/);
  });

  it('trong WebView thì đọc thuộc tính value, không đọc text', () => {
    assert.match(handle, /if \(this\.inWebview\) \{[\s\S]{0,400}getProperty\('value'\)/);
  });

  it('ngoài WebView vẫn giữ nguyên đường cũ của native', () => {
    assert.match(handle, /return this\.el\.getText\(\)\.catch\(\(\) => null\);/);
  });

  /**
   * null và "" không nói cùng một chuyện: null là "không đọc được, đừng kết
   * luận" và verifyInput bỏ qua; "" là khẳng định ô rỗng và làm bước đỏ.
   */
  it('đọc không được thì trả null chứ không trả chuỗi rỗng', () => {
    const branch = handle.slice(handle.indexOf('if (this.inWebview)'));
    assert.match(branch, /typeof prop === 'string'/);
    assert.match(branch, /return null;/);
  });
});
