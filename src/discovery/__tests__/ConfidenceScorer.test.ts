import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ConfidenceScorer,
  DEFAULT_WEIGHTS,
  DEFAULT_THRESHOLDS,
} from '../ConfidenceScorer.js';
import type { ElementIntent } from '../ElementIntent.js';
import type { ObservedElement } from '../UiObservation.js';

const scorer = new ConfidenceScorer();

function intent(partial: Partial<ElementIntent>): ElementIntent {
  return { id: 'test.element', action: 'tap', ...partial };
}

function element(partial: Partial<ObservedElement>): ObservedElement {
  return { id: 'el-1', visible: true, ...partial };
}

describe('ConfidenceScorer — positive signals', () => {
  it('exact testId match gives score >= exactTestId weight * 0.7', () => {
    const result = scorer.score(
      intent({ id: 'login.submitButton' }),
      element({ testId: 'submitButton' }),
    );
    assert.ok(
      result.score >= Math.floor(DEFAULT_WEIGHTS.exactTestId * 0.7),
      `score ${result.score} should be >= ${Math.floor(DEFAULT_WEIGHTS.exactTestId * 0.7)}`,
    );
    assert.ok(result.reasons.length > 0, 'should have at least one reason');
  });

  it('exact accessibility label match gives score >= exactAccessibility weight', () => {
    const result = scorer.score(
      intent({ label: 'Login Button' }),
      element({ accessibilityLabel: 'Login Button' }),
    );
    assert.ok(
      result.score >= DEFAULT_WEIGHTS.exactAccessibility,
      `score ${result.score} should be >= ${DEFAULT_WEIGHTS.exactAccessibility}`,
    );
    assert.ok(
      result.reasons.some((r) => r.includes('accessibility')),
      'reason should mention accessibility',
    );
  });

  it('exact text match gives score >= exactText weight', () => {
    const result = scorer.score(
      intent({ text: 'Sign In' }),
      element({ text: 'Sign In' }),
    );
    assert.ok(result.score >= DEFAULT_WEIGHTS.exactText);
  });

  it('role match adds sameRole weight', () => {
    const without = scorer.score(intent({ semanticRole: 'button' }), element({}));
    const with_ = scorer.score(
      intent({ semanticRole: 'button' }),
      element({ role: 'button' }),
    );
    assert.ok(with_.score >= without.score + DEFAULT_WEIGHTS.sameRole);
    assert.ok(with_.reasons.some((r) => r.includes('role')));
  });

  it('historical winner adds historicalSuccess weight', () => {
    const base = scorer.score(intent({ label: 'Login' }), element({ accessibilityLabel: 'Login' }));
    const withHistory = scorer.score(
      intent({ label: 'Login' }),
      element({ accessibilityLabel: 'Login' }),
      { historicalWinner: true },
    );
    assert.ok(withHistory.score >= base.score + DEFAULT_WEIGHTS.historicalSuccess);
  });

  it('same-screen bonus applied when screens match', () => {
    const without = scorer.score(intent({ label: 'OK', screen: 'confirm' }), element({ text: 'OK' }));
    const withScreen = scorer.score(
      intent({ label: 'OK', screen: 'confirm' }),
      element({ text: 'OK' }),
      { screen: 'confirm' },
    );
    assert.ok(withScreen.score >= without.score + DEFAULT_WEIGHTS.sameScreen);
  });
});

describe('ConfidenceScorer — penalties', () => {
  it('hidden element incurs hiddenPenalty', () => {
    const result = scorer.score(
      intent({ label: 'Login' }),
      element({ accessibilityLabel: 'Login', visible: false }),
    );
    assert.ok(result.penalties.length > 0);
    assert.ok(result.penalties.some((p) => p.includes('not visible')));
    // Score is reduced by the penalty even if positive signals are present
    const noHide = scorer.score(
      intent({ label: 'Login' }),
      element({ accessibilityLabel: 'Login', visible: true }),
    );
    assert.ok(noHide.score > result.score);
  });

  it('disabled element incurs disabledPenalty', () => {
    const enabled = scorer.score(intent({ label: 'Submit' }), element({ text: 'Submit', enabled: true }));
    const disabled = scorer.score(intent({ label: 'Submit' }), element({ text: 'Submit', enabled: false }));
    assert.ok(enabled.score > disabled.score);
    assert.ok(disabled.penalties.some((p) => p.includes('disabled')));
  });

  it('duplicate text incurs duplicatePenalty', () => {
    const candidate = element({ id: 'el-1', text: 'Confirm' });
    const dup = element({ id: 'el-2', text: 'Confirm' });
    const result = scorer.score(intent({ label: 'Confirm' }), candidate, {
      allCandidates: [candidate, dup],
    });
    assert.ok(result.penalties.some((p) => p.includes('duplicate')));
  });

  it('container element (has children, not interactive) incurs containerPenalty', () => {
    const result = scorer.score(
      intent({ label: 'Panel' }),
      element({ text: 'Panel', childIds: ['child-1'], interactive: false }),
    );
    assert.ok(result.penalties.some((p) => p.includes('container')));
  });

  it('fragile xpath incurs fragileXpathPenalty', () => {
    const result = scorer.score(
      intent({ label: 'OK' }),
      element({ text: 'OK', xpath: '//div/div[2]/span[1]/button[3]' }),
    );
    assert.ok(result.penalties.some((p) => p.includes('fragile')));
  });
});

describe('ConfidenceScorer — verdict thresholds', () => {
  it('score >= autoAccept returns "accept"', () => {
    assert.equal(scorer.verdict(DEFAULT_THRESHOLDS.autoAccept), 'accept');
    assert.equal(scorer.verdict(DEFAULT_THRESHOLDS.autoAccept + 20), 'accept');
  });

  it('score in [requireVerification, autoAccept) returns "verify"', () => {
    assert.equal(scorer.verdict(DEFAULT_THRESHOLDS.requireVerification), 'verify');
    assert.equal(scorer.verdict(DEFAULT_THRESHOLDS.autoAccept - 1), 'verify');
  });

  it('score < requireVerification returns "reject"', () => {
    assert.equal(scorer.verdict(DEFAULT_THRESHOLDS.requireVerification - 1), 'reject');
    assert.equal(scorer.verdict(0), 'reject');
    assert.equal(scorer.verdict(-10), 'reject');
  });
});

describe('ConfidenceScorer — custom weights', () => {
  it('custom weights override defaults', () => {
    const custom = new ConfidenceScorer(
      { ...DEFAULT_WEIGHTS, exactAccessibility: 99 },
      DEFAULT_THRESHOLDS,
    );
    const result = custom.score(
      intent({ label: 'Login' }),
      element({ accessibilityLabel: 'Login' }),
    );
    assert.ok(result.score >= 99, `expected score >= 99, got ${result.score}`);
  });

  it('custom thresholds change verdict boundaries', () => {
    const custom = new ConfidenceScorer(DEFAULT_WEIGHTS, { autoAccept: 50, requireVerification: 30 });
    assert.equal(custom.verdict(50), 'accept');
    assert.equal(custom.verdict(30), 'verify');
    assert.equal(custom.verdict(29), 'reject');
  });
});
