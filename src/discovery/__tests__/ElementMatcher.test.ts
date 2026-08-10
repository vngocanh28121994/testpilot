import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DeterministicMatcher } from '../ElementMatcher.js';
import type { ElementIntent } from '../ElementIntent.js';
import type { ObservedElement, UiObservation } from '../UiObservation.js';

const matcher = new DeterministicMatcher();

function intent(partial: Partial<ElementIntent>): ElementIntent {
  return { id: 'test.element', action: 'tap', ...partial };
}

function obs(elements: Partial<ObservedElement>[]): UiObservation {
  return {
    id: 'obs-1',
    timestamp: new Date().toISOString(),
    platform: 'android',
    source: 'native',
    context: {},
    elements: elements.map((el, i) => ({
      id: `el-${i}`,
      visible: true,
      ...el,
    })),
  };
}

describe('DeterministicMatcher — basic matching', () => {
  it('matches by testId key suffix', () => {
    const matches = matcher.match(
      intent({ id: 'login.submitButton' }),
      obs([{ testId: 'other' }, { testId: 'submitButton' }]),
    );
    assert.ok(matches.length > 0, 'should find matches');
    assert.equal(matches[0]!.observedElementId, 'el-1', 'testId match should rank first');
  });

  it('matches by accessibility label', () => {
    const matches = matcher.match(
      intent({ label: 'Login' }),
      obs([{ text: 'Something else' }, { accessibilityLabel: 'Login' }]),
    );
    assert.ok(matches.length > 0);
    assert.equal(matches[0]!.observedElementId, 'el-1');
  });

  it('matches by text', () => {
    const matches = matcher.match(
      intent({ text: 'Sign In' }),
      obs([{ text: 'Register' }, { text: 'Sign In' }]),
    );
    assert.ok(matches.length > 0);
    assert.equal(matches[0]!.observedElementId, 'el-1');
  });

  it('returns empty array when no element scores positively', () => {
    const matches = matcher.match(
      intent({ label: 'XYZ_UNIQUE_LABEL_THAT_DOES_NOT_MATCH' }),
      obs([{ role: 'textview', text: 'Hello World' }]),
    );
    assert.deepEqual(matches, []);
  });

  it('handles empty observation', () => {
    const matches = matcher.match(intent({ label: 'Login' }), obs([]));
    assert.deepEqual(matches, []);
  });
});

describe('DeterministicMatcher — ranking', () => {
  it('results sorted by confidence descending', () => {
    const matches = matcher.match(
      intent({ label: 'Login', semanticRole: 'button' }),
      obs([
        { role: 'button', accessibilityLabel: 'Login' }, // strong match
        { text: 'Login' }, // weaker match
        { role: 'textview', text: 'Not a match text' },
      ]),
    );
    for (let i = 1; i < matches.length; i++) {
      assert.ok(
        matches[i - 1]!.confidence >= matches[i]!.confidence,
        `match[${i - 1}].confidence (${matches[i - 1]!.confidence}) should be >= match[${i}].confidence (${matches[i]!.confidence})`,
      );
    }
  });

  it('testId match outranks text-only match', () => {
    const matches = matcher.match(
      intent({ id: 'login.submitButton', label: 'submitButton' }),
      obs([
        { text: 'submitButton' }, // label match only
        { testId: 'submitButton' }, // testId match
      ]),
    );
    const testIdMatchIdx = matches.findIndex((m) => m.observedElementId === 'el-1');
    const textMatchIdx = matches.findIndex((m) => m.observedElementId === 'el-0');
    assert.ok(testIdMatchIdx < textMatchIdx || textMatchIdx === -1, 'testId should rank higher');
  });
});

describe('DeterministicMatcher — locator inference', () => {
  it('infers testId locator when present', () => {
    const [first] = matcher.match(
      intent({ label: 'Confirm' }),
      obs([{ testId: 'btn-confirm', text: 'Confirm' }]),
    );
    assert.equal(first?.locator?.strategy, 'testId');
    assert.equal(first?.locator?.value, 'btn-confirm');
  });

  it('falls back to resourceId when testId absent', () => {
    const [first] = matcher.match(
      intent({ label: 'Login' }),
      obs([{ resourceId: 'btn_login', accessibilityLabel: 'Login' }]),
    );
    assert.equal(first?.locator?.strategy, 'resourceId');
    assert.equal(first?.locator?.value, 'btn_login');
  });

  it('falls back to accessibilityLabel when no id attributes', () => {
    const [first] = matcher.match(
      intent({ label: 'Cancel' }),
      obs([{ accessibilityLabel: 'Cancel', role: 'button' }]),
    );
    assert.equal(first?.locator?.strategy, 'accessibility');
    assert.equal(first?.locator?.value, 'Cancel');
  });

  it('locator is undefined when element has no stable handle', () => {
    const [first] = matcher.match(
      intent({ label: 'unnamed' }),
      obs([{ text: 'unnamed' }]),
    );
    // text-only element — no testId/resourceId/accessibility/css/xpath
    assert.equal(first?.locator, undefined);
  });
});

describe('DeterministicMatcher — method label', () => {
  it('all matches have method "deterministic"', () => {
    const matches = matcher.match(
      intent({ label: 'OK' }),
      obs([{ text: 'OK' }, { accessibilityLabel: 'OK' }]),
    );
    for (const m of matches) {
      assert.equal(m.method, 'deterministic');
      assert.equal(m.verified, false);
    }
  });
});

describe('DeterministicMatcher — screen bonus', () => {
  it('same-screen option raises confidence', () => {
    const without = matcher.match(
      intent({ label: 'Submit', screen: 'checkout' }),
      obs([{ text: 'Submit' }]),
    );
    const withScreen = matcher.match(
      intent({ label: 'Submit', screen: 'checkout' }),
      obs([{ text: 'Submit' }]),
      { screen: 'checkout' },
    );
    assert.ok(
      (withScreen[0]?.confidence ?? 0) >= (without[0]?.confidence ?? 0),
      'same-screen match should have equal or higher confidence',
    );
  });
});
