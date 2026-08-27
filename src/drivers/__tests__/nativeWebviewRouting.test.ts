/**
 * Every DOM-shaped operation must route into the WebView, not just most of them.
 *
 * `NativeUiDriver` delegates to the CDP driver when the app is inside a WebView.
 * The delegation has been added one method at a time, and each omission stayed
 * invisible for a while: `selectOption` was missed and only surfaced once
 * Android stopped running natively; `captionValue` was missed and cost four
 * scenarios in one run, because `readTexts` silently skips the caption fallback
 * when the driver does not implement it — no error, just the caption where a
 * number should have been.
 *
 * So the rule is checked as a rule, rather than one method at a time.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const source = readFileSync('src/drivers/native.ts', 'utf8');
const cdpSource = readFileSync('src/drivers/WebViewCdpDriver.ts', 'utf8');

/** The guard every delegating method uses, as written in native.ts. */
const GUARD = /this\.inWebview \|\| this\.cdpConnected/;

describe('WebView delegation in the native driver', () => {
  // Native method → the CDP method it hands off to. Mostly the same name;
  // `input` is spelled `fill` on the Playwright side, which is why this is a
  // table rather than an assumption.
  const DELEGATES: Array<[string, string]> = [
    ['tap', 'tap'],
    ['input', 'fill'],
    ['clear', 'clear'],
    ['selectOption', 'selectOption'],
    ['scrollIntoView', 'scrollIntoView'],
    ['captionValue', 'captionValue'],
    ['listOptions', 'listOptions'],
  ];

  for (const [method, target] of DELEGATES) {
    it(`routes ${method}() to the WebView driver`, () => {
      const at = source.indexOf(`async ${method}(`);
      assert.ok(at > 0, `native.ts has no ${method}()`);
      // The guard belongs to this method, so look only as far as the next one.
      const body = source.slice(at, at + 1400);
      assert.match(body, GUARD, `${method}() does not check for a WebView`);
      assert.match(
        body,
        new RegExp(`this\\.cdpDriver\\.${target}\\(`),
        `${method}() checks for a WebView but never delegates to ${target}()`,
      );
    });
  }

  it('the CDP driver implements everything the native driver forwards', () => {
    const forwarded = [...source.matchAll(/this\.cdpDriver\.(\w+)\(/g)].map((m) => m[1]!);
    const missing = [...new Set(forwarded)].filter(
      (name) => !new RegExp(`\\b${name}\\s*\\(`).test(cdpSource),
    );
    // A forward to a method that does not exist is a runtime TypeError on a
    // device, which is the most expensive place to find one.
    assert.deepEqual(missing, []);
  });
});
