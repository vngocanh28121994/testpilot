/**
 * The popup interceptor must not dismiss the dialog the step is acting on.
 *
 * It did. Asked to click the ĐÓNG button of the app's own validation dialog —
 *
 *     [popup] closed top #mat-dialog-1 via ĐÓNG
 *     [popup]   nội dung: "TIỀN CHUYỂN + PHÍ VƯỢT QUÁ SỐ TIỀN CÓ THỂ CHUYỂNĐÓNG"
 *     [tap] "Nút ĐÓNG": bấm lỗi
 *
 * — the interceptor clicked that exact button first, then the step failed for
 * want of a target. The cause was the protection list: an xpath has no in-page
 * CSS equivalent, so it was passed as empty, and most locators in this project
 * resolve to xpath. "Nothing to protect" was read as "nothing worth keeping".
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const source = readFileSync('src/drivers/WebViewCdpDriver.ts', 'utf8');

function keepBody(): string {
  const at = source.indexOf('async function keep(');
  assert.ok(at > 0, 'keep() is gone');
  return source.slice(at, source.indexOf('\n}', at));
}

describe('what the interceptor is told to keep', () => {
  it('protects the overlay layer containing the target, not just its selector', () => {
    const body = keepBody();
    assert.match(body, /closest\(/, 'keep() no longer looks for a containing layer');
    for (const layer of ['cdk-overlay-pane', 'mat-dialog-container', 'role="dialog"']) {
      assert.ok(body.includes(layer), `keep() ignores ${layer}`);
    }
  });

  it('never returns nothing merely because the selector is an xpath', () => {
    // The old body was a one-line ternary returning [] for xpath. If the layer
    // lookup is removed, this is what it collapses back to.
    const body = keepBody();
    const xpathBranch = /startsWith\('\/'\) \? \[\] : \[handle\.selector\]/.test(body);
    assert.ok(
      !xpathBranch || /closest\(/.test(body),
      'an xpath selector must still contribute its containing layer',
    );
  });

  it('is awaited at every call site, since it now reads the page', () => {
    const calls = [...source.matchAll(/(await )?keep\((handle|source)\)/g)];
    assert.ok(calls.length > 0, 'no call sites found');
    const unawaited = calls.filter((m) => !m[1]);
    // An un-awaited call passes a Promise where a string[] is expected, which
    // silently protects nothing — the same failure with a different cause.
    assert.deepEqual(unawaited.map((m) => m[0]), []);
  });
});
