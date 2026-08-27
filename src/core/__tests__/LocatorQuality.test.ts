import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assessLocatorQuality, asUnapprovedFallback } from '../locatorQuality.js';
import type { LocatorCandidate } from '../types.js';

describe('locator quality gate', () => {
  it('accepts a compact row-relative locator as maintainable', () => {
    const candidate: LocatorCandidate = {
      strategy: 'relative',
      value: 'row("ADS") >> "...":metadata',
      weight: 0.9,
      origin: 'healed',
    };
    const quality = assessLocatorQuality(candidate);
    assert.equal(quality.stable, true);
    assert.equal(quality.persistable, true);
    assert.equal(quality.promotable, true);
  });

  it('rejects a long positional heuristic XPath from persistence and promotion', () => {
    const candidate: LocatorCandidate = {
      strategy: 'xpath',
      value: `((//*[not(*) and normalize-space(.)='ADS'])[1]/ancestor::*[` +
        `contains(concat(' ', normalize-space(@class), ' '), ' content-row ')][1]` +
        `//*[contains(translate(concat(@data-walkthrough,' ',@class),` +
        `'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'more')])[1]`,
      weight: 0.98,
      origin: 'healed',
    };
    const quality = assessLocatorQuality(candidate);
    assert.equal(quality.persistable, false);
    assert.equal(quality.promotable, false);
  });

  it('keeps an unapproved healed locator below authored primary weight', () => {
    const fallback = asUnapprovedFallback({
      strategy: 'testId',
      value: 'stock-row-more-ADS',
      weight: 0.98,
      origin: 'healed',
    });
    assert.equal(fallback.approved, false);
    assert.equal(fallback.weight, 0.79);
  });
});
