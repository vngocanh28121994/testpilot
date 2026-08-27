/**
 * Keeping the shape of a specification.
 *
 * A requirements page is a list, and every stage downstream needs to see where
 * one rule ends and the next begins: the coverage extractor splits on those
 * boundaries to build the requirements it later checks scenarios against.
 *
 * Turning every tag into a space destroyed them. A Confluence page holding
 * eight bulleted rules arrived as one 875-character line, the extractor found a
 * single "source unit" in it, and the gate reported `1/1 covered` — for a
 * document whose reverse-direction rule had no test written at all. Nothing
 * failed; the check simply had nothing to look at.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { stripHtml } from '../text.js';

describe('boundaries a specification depends on', () => {
  it('keeps each bullet on its own line', () => {
    const text = stripHtml(
      '<ul><li>Khi đã chọn 1 tiểu khoản</li><li>Khi thay đổi tiểu khoản nguồn</li></ul>',
    );
    assert.deepEqual(text.split('\n').filter(Boolean), [
      'Khi đã chọn 1 tiểu khoản',
      'Khi thay đổi tiểu khoản nguồn',
    ]);
  });

  it('keeps paragraphs apart', () => {
    const text = stripHtml('<p>Mục tiêu: chuyển tiền</p><p>Đường dẫn: Login</p>');
    assert.equal(text.split('\n').filter(Boolean).length, 2);
  });

  it('treats a line break as one', () => {
    const text = stripHtml('Thường → Ký Quỹ<br>Ký Quỹ → Thường');
    assert.deepEqual(text.split('\n').filter(Boolean), ['Thường → Ký Quỹ', 'Ký Quỹ → Thường']);
  });

  it('keeps table rows apart', () => {
    const text = stripHtml('<table><tr><td>Phí</td><td>0</td></tr><tr><td>Hạn mức</td></tr></table>');
    assert.ok(text.split('\n').filter(Boolean).length >= 2);
  });
});

describe('what must stay on one line', () => {
  it('does not break a phrase across inline formatting', () => {
    // "Ký <b>Quỹ</b>" is one account name. Splitting it would produce two
    // fragments, neither of which is a rule.
    assert.equal(stripHtml('Tiểu khoản Ký <strong>Quỹ</strong> đang chọn'),
      'Tiểu khoản Ký Quỹ đang chọn');
  });

  it('joins a link into its sentence', () => {
    assert.equal(stripHtml('Xem <a href="/x">hướng dẫn</a> tại đây'), 'Xem hướng dẫn tại đây');
  });
});

describe('leftovers that would look like content', () => {
  it('drops script and style bodies', () => {
    assert.equal(stripHtml('<style>.a{color:red}</style><p>Nội dung</p>'), 'Nội dung');
  });

  it('does not leave blank-looking lines behind', () => {
    const text = stripHtml('<p>  Một  </p>\n\n\n<p>  Hai  </p>');
    assert.deepEqual(text.split('\n').filter((line) => line.trim()), ['Một', 'Hai']);
    assert.ok(!/\n\s+\n/.test(text), 'không còn dòng chỉ chứa khoảng trắng');
  });

  it('resolves the entities a Confluence export carries', () => {
    assert.equal(stripHtml('<p>Phí &amp; hạn&nbsp;mức</p>'), 'Phí & hạn mức');
  });
});
