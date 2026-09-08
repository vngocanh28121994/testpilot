/**
 * Ảnh và video phải tự nói nó thuộc kịch bản nào.
 *
 * Tên kịch bản có ở tiêu đề khối, nhưng cuộn xuống tới ảnh là nó đã ra khỏi tầm
 * nhìn — và với mười kịch bản fail thì màn hình chỉ còn một dãy ảnh giống nhau,
 * không cái nào tự nhận là của ai. Ảnh cũng là thứ người ta hay tải về hoặc dán
 * vào ticket, lúc đó thì mọi bối cảnh xung quanh đều đã mất.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const html = readFileSync('src/report/html.ts', 'utf8');

describe('media của kịch bản fail', () => {
  it('ảnh lúc fail mang tên kịch bản trong caption', () => {
    assert.match(
      html,
      /<figure class="shot"><figcaption><b>\$\{esc\(r\.scenario\.name\)\}<\/b>[\s\S]{0,120}Lúc fail/,
    );
  });

  it('ảnh do kịch bản tự chụp cũng mang tên kịch bản', () => {
    assert.match(
      html,
      /staged\.map[\s\S]{0,200}<figcaption><b>\$\{esc\(r\.scenario\.name\)\}<\/b>/,
    );
  });

  /** Video còn dễ bị tải về hơn cả ảnh. */
  it('video cũng mang tên kịch bản', () => {
    assert.match(html, /<figcaption><b>\$\{esc\(r\.scenario\.name\)\}<\/b>[\s\S]{0,80}Video —/);
  });

  /**
   * `alt` không phải chỗ để lặp lại "Screenshot": khi ảnh không tải được, hoặc
   * khi trình đọc màn hình đọc nó, đó là toàn bộ thông tin còn lại.
   */
  it('alt của ảnh nói rõ ảnh gì của kịch bản nào', () => {
    assert.match(html, /const shotOf = \(what: string\) =>/);
    assert.match(html, /alt="\$\{shotOf\('Ảnh lúc fail'\)\}"/);
    assert.doesNotMatch(html, /alt="Screenshot at failure"/);
  });
});
