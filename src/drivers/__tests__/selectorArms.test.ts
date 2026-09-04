/**
 * `find` and `inspectMatches` must agree on which locator a candidate means.
 *
 * They did not, twice, in two different drivers, with the same symptom both
 * times: `find` located "Tiền chuyển (Phí = 0)" through a fallback arm while
 * the reader rebuilt the plain exact selector, which matches nothing. The
 * element resolved, the step ran, and the assertion compared its expected value
 * against an empty string —
 *
 *     Text assertion failed on "transfer.tienChuyenPhi0":
 *     expected to contain "1,000", got "".
 *
 * — which reads like the application showed nothing, when in fact the two
 * halves of the driver were looking at different elements. A resolution read
 * back through a different locator is not the same resolution.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const cdp = readFileSync('src/drivers/WebViewCdpDriver.ts', 'utf8');
const web = readFileSync('src/drivers/web.ts', 'utf8');

/** The body of one method, up to the next one. */
function bodyOf(source: string, method: string): string {
  const at = source.indexOf(`async ${method}(`);
  assert.ok(at > 0, `no ${method}()`);
  const rest = source.slice(at + 10);
  const next = rest.search(/\n  (?:async |private |\/\*\*)/);
  return next > 0 ? rest.slice(0, next) : rest;
}

describe('the WebView driver', () => {
  it('reads its selector order from one place in both find and inspectMatches', () => {
    for (const method of ['find', 'inspectMatches']) {
      assert.match(
        bodyOf(cdp, method),
        /this\.selectorsFor\(/,
        `${method}() builds its own locator instead of sharing the order`,
      );
    }
  });

  it('offers the split-caption arm before the loose one', () => {
    // Order is the correctness property: the split arm still requires the whole
    // phrase, the loose arm does not, so trying loose first would match a
    // longer message that merely contains the words.
    const start = cdp.indexOf('private selectorsFor(');
    assert.ok(start > 0, 'selectorsFor() is gone');
    const body = cdp.slice(start, cdp.indexOf('\n  }', start));
    const split = body.indexOf('labelSplitAcrossChildrenXPath');
    const loose = body.indexOf('labelContainsXPath');
    assert.ok(split >= 0, 'the split arm is missing');
    assert.ok(loose >= 0, 'the loose arm is missing');
    assert.ok(split < loose, 'the split arm must be offered before the loose arm');
  });
});

describe('the Playwright driver', () => {
  it('also reuses its find order when reading matches back', () => {
    // Same invariant, stated for the driver that learned it first — so a future
    // change to one driver does not quietly leave the other behind.
    assert.match(bodyOf(web, 'inspectMatches'), /labelFirstOrder\(/);
  });

  it('carries the split-caption arm too, since selector engines do not reach CDP', () => {
    // `visibletext` is registered on contexts Playwright creates; a context it
    // merely attached to over CDP does not have it, so the xpath arm is what
    // both drivers can share.
    assert.match(web, /labelSplitAcrossChildrenXPath/);
  });
});

/**
 * Reading a dropdown that is still rendering.
 *
 * Material fills its panel progressively, so the first non-empty reading can be
 * a partial list — and for "this value is not among the choices" a partial list
 * is a false pass. It already happened: the same assertion went green on one
 * run and red on the next, against an app that behaved identically both times,
 * because one run read four of five options.
 */
describe('reading the options of a dropdown', () => {
  for (const [name, file] of [
    ['the WebView driver', 'src/drivers/WebViewCdpDriver.ts'],
    ['the Playwright driver', 'src/drivers/web.ts'],
  ] as const) {
    it(`${name} waits for the list to stop growing`, () => {
      const source = readFileSync(file, 'utf8');
      const at = source.indexOf('async listOptions(');
      assert.ok(at > 0, `${file} has no listOptions()`);
      // Wide enough to reach the poll loop: the method carries a paragraph of
      // comment explaining why it waits, and a tight window silently stopped
      // covering the assertion it was written for.
      const body = source.slice(at, at + 3000);
      // Returning on the first non-empty poll is the bug; a stable count is
      // the fix, so the comparison against the previous reading must be there.
      assert.match(body, /=== previous/, 'returns before the list has settled');
      assert.doesNotMatch(
        body,
        /if \(seen\.length > 0\) return seen;/,
        'still returns on the first non-empty reading',
      );
    });
  }
});
