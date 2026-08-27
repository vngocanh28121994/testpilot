/**
 * Where a missing WebView is fatal, and where it is not.
 *
 * Both halves matter, and the first version of this guard got them the wrong
 * way round.
 *
 * `start()` runs when the app has just been attached and no screen is
 * guaranteed to have rendered a WebView, so a failure there says nothing about
 * whether the run can work — and throwing would kill runs that were about to
 * succeed. Worse, the original code discarded the driver object on failure,
 * which silently disabled the reconnect in `launch()` that exists for exactly
 * this case. One run spent half an hour failing natively while the WebView sat
 * there, reachable, the whole time.
 *
 * `launch()` runs per scenario, after the app is in front and its dialogs are
 * cleared. A WebView that is going to exist exists by then. With `hybrid: true`
 * and 67 of 106 elements carrying web locators and no native ones, continuing
 * past that point is not a degraded run, it is no run at all.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const source = readFileSync('src/drivers/native.ts', 'utf8');

function sliceAt(needle: string, length: number): string {
  const at = source.indexOf(needle);
  assert.ok(at > 0, `not found: ${needle}`);
  return source.slice(at, at + length);
}

describe('a WebView that is not reachable at startup', () => {
  const handler = (): string => sliceAt('this.cdpDriver.connect()', 1400);

  it('does not abort the run', () => {
    assert.doesNotMatch(handler(), /throw new Error\(/, 'start() must not be fatal');
  });

  it('keeps the driver so launch() can reconnect', () => {
    // `this.cdpDriver = undefined` here is what disabled the reconnect path.
    assert.doesNotMatch(handler(), /this\.cdpDriver = undefined/);
  });

  it('says it will retry rather than passing in silence', () => {
    assert.match(handler(), /thử nối lại/);
  });
});

describe('a WebView that is still not reachable once the app is open', () => {
  const guard = (): string => sliceAt('await this.cdpDriver.reconnect()', 1800);

  it('stops the run', () => {
    assert.match(guard(), /throw new Error\(/, 'launch() must be fatal');
  });

  it('checks both the CDP session and the Appium WebView context', () => {
    // Either route into the WebView is enough; only having neither is fatal.
    assert.match(guard(), /!this\.cdpConnected && !this\.inWebview/);
  });

  it('says what to check and how to opt out', () => {
    const body = guard();
    assert.match(body, /WebView debugging/, 'does not say what to check on the app');
    assert.match(body, /chạy lại/, 'does not mention retrying');
    assert.match(body, /android\.hybrid = false/, 'does not offer the native opt-out');
  });

  it('only applies when the config asked for hybrid', () => {
    // A native-only suite must be unaffected: the guard belongs inside the
    // `hybrid` branch, not around it.
    const hybridAt = source.indexOf('if (this.opts.hybrid) {');
    const guardAt = source.indexOf('!this.cdpConnected && !this.inWebview');
    assert.ok(hybridAt > 0 && guardAt > hybridAt, 'the guard escaped the hybrid branch');
  });
});
