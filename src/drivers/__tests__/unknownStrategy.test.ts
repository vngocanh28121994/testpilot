/**
 * A locator naming a strategy the driver has never heard of.
 *
 * `LocatorCandidate.strategy` is a narrow union, so the compiler sees both
 * selector switches as exhaustive and lets them end without a default. At
 * runtime the union is not enforced: `RuntimeRegistry` types the field as a
 * plain `string`, so discovery and healing can emit anything — `"text"` has
 * already happened. The switch then fell out with `undefined`, which travelled
 * all the way to WebDriverIO:
 *
 *     The selector "undefined" used with strategy "undefined" is invalid!
 *
 * — an error naming neither the element nor the strategy that caused it.
 *
 * Throwing is not a behaviour change for the run: the resolver already treats a
 * driver-level throw as "this candidate did not match" and moves to the next
 * one. The difference is that the reason is now stated.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { domSelector } from '../native.js';
import type { LocatorCandidate } from '../../core/types.js';

/** A candidate as discovery can really produce one, past the type system. */
const withStrategy = (strategy: string): LocatorCandidate =>
  ({ strategy, value: 'Chuyển từ', weight: 1, origin: 'healed' } as unknown as LocatorCandidate);

describe('a selector built from an unknown strategy', () => {
  it('is refused rather than returned as undefined', () => {
    assert.throws(() => domSelector(withStrategy('text')), /text/);
  });

  it('names the strategy and the value, so the cause is in the message', () => {
    try {
      domSelector(withStrategy('accessibility id'));
      assert.fail('should have thrown');
    } catch (err) {
      const message = (err as Error).message;
      assert.match(message, /accessibility id/);
      assert.match(message, /Chuyển từ/);
    }
  });

  it('still builds the strategies it does know', () => {
    // The guard must not swallow the working cases.
    assert.ok(domSelector({ strategy: 'css', value: '.x', weight: 1, origin: 'authored' }));
    assert.ok(domSelector({ strategy: 'label', value: 'Chuyển từ', weight: 1, origin: 'authored' }));
    assert.ok(domSelector({ strategy: 'testId', value: 'amount', weight: 1, origin: 'authored' }));
  });

  it('refuses an empty strategy too', () => {
    // The observed failure carried `undefined`, not a misspelled name.
    assert.throws(() => domSelector(withStrategy(undefined as unknown as string)));
  });
});
