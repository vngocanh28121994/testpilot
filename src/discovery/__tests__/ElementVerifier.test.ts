import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StandardElementVerifier } from '../ElementVerifier.js';
import type { ElementIntent } from '../ElementIntent.js';
import type { ObservedElement } from '../UiObservation.js';

const verifier = new StandardElementVerifier();

function intent(partial: Partial<ElementIntent>): ElementIntent {
  return { id: 'test.element', action: 'tap', ...partial };
}

function element(partial: Partial<ObservedElement>): ObservedElement {
  return { id: 'el-1', visible: true, ...partial };
}

describe('StandardElementVerifier — tap action', () => {
  it('visible + enabled + interactive → passes', () => {
    const result = verifier.verify(
      intent({ action: 'tap' }),
      element({ enabled: true, interactive: true }),
    );
    assert.ok(result.passed);
    assert.ok(result.score > 0);
    assert.deepEqual(result.evidence, []);
  });

  it('hidden element → fails', () => {
    const result = verifier.verify(
      intent({ action: 'tap' }),
      element({ visible: false }),
    );
    assert.ok(!result.passed);
    assert.ok(result.evidence.some((e) => e.includes('not visible')));
  });

  it('disabled element → fails', () => {
    const result = verifier.verify(
      intent({ action: 'tap' }),
      element({ enabled: false }),
    );
    assert.ok(!result.passed);
    assert.ok(result.evidence.some((e) => e.includes('disabled')));
  });

  it('non-interactive element → fails', () => {
    const result = verifier.verify(
      intent({ action: 'tap' }),
      element({ interactive: false }),
    );
    assert.ok(!result.passed);
    assert.ok(result.evidence.some((e) => e.includes('not interactive')));
  });
});

describe('StandardElementVerifier — assert-disabled action', () => {
  it('enabled=false → passes', () => {
    const result = verifier.verify(
      intent({ action: 'assert-disabled' }),
      element({ enabled: false }),
    );
    assert.ok(result.passed);
  });

  it('enabled=true → fails', () => {
    const result = verifier.verify(
      intent({ action: 'assert-disabled' }),
      element({ enabled: true }),
    );
    assert.ok(!result.passed);
    assert.ok(result.evidence.some((e) => e.includes('assert-disabled')));
  });

  it('enabled=undefined → fails (not explicitly disabled)', () => {
    const result = verifier.verify(
      intent({ action: 'assert-disabled' }),
      element({ enabled: undefined }),
    );
    // undefined != false, so assertion fails
    assert.ok(!result.passed);
  });
});

describe('StandardElementVerifier — assert-visible action', () => {
  it('visible element → passes', () => {
    const result = verifier.verify(
      intent({ action: 'assert-visible' }),
      element({ visible: true }),
    );
    assert.ok(result.passed);
  });

  it('hidden element → fails', () => {
    const result = verifier.verify(
      intent({ action: 'assert-visible' }),
      element({ visible: false }),
    );
    assert.ok(!result.passed);
  });
});

describe('StandardElementVerifier — input action', () => {
  it('visible + enabled + interactive → passes', () => {
    const result = verifier.verify(
      intent({ action: 'input' }),
      element({ enabled: true, interactive: true }),
    );
    assert.ok(result.passed);
  });

  it('disabled input → fails', () => {
    const result = verifier.verify(
      intent({ action: 'input' }),
      element({ enabled: false }),
    );
    assert.ok(!result.passed);
  });
});

describe('StandardElementVerifier — semantic checks', () => {
  it('role mismatch recorded in evidence', () => {
    const result = verifier.verify(
      intent({ action: 'tap', semanticRole: 'button' }),
      element({ role: 'textview' }),
    );
    assert.ok(result.evidence.some((e) => e.includes('role mismatch')));
    assert.equal(result.checks.roleMatch, false);
  });

  it('role match sets roleMatch = true', () => {
    const result = verifier.verify(
      intent({ action: 'tap', semanticRole: 'button' }),
      element({ role: 'button' }),
    );
    assert.equal(result.checks.roleMatch, true);
  });

  it('label mismatch recorded in evidence', () => {
    const result = verifier.verify(
      intent({ action: 'tap', label: 'Login' }),
      element({ text: 'Register' }),
    );
    assert.ok(result.evidence.some((e) => e.includes('label mismatch')));
    assert.equal(result.checks.labelMatch, false);
  });

  it('label match via accessibilityLabel', () => {
    const result = verifier.verify(
      intent({ action: 'tap', label: 'Login' }),
      element({ accessibilityLabel: 'Login' }),
    );
    assert.equal(result.checks.labelMatch, true);
  });

  it('label partial match passes (contains)', () => {
    const result = verifier.verify(
      intent({ action: 'tap', label: 'Login' }),
      element({ text: 'Login Button' }),
    );
    assert.equal(result.checks.labelMatch, true);
  });
});

describe('StandardElementVerifier — uniqueness check', () => {
  it('no duplicates → uniqueness = true', () => {
    const candidate = element({ id: 'el-1', role: 'button', text: 'Confirm' });
    const other = element({ id: 'el-2', role: 'button', text: 'Cancel' });
    const result = verifier.verify(
      intent({ action: 'tap', label: 'Confirm' }),
      candidate,
      [candidate, other],
    );
    assert.equal(result.checks.uniqueness, true);
  });

  it('exact duplicate → uniqueness = false and evidence added', () => {
    const candidate = element({ id: 'el-1', role: 'button', text: 'Confirm' });
    const dup = element({ id: 'el-2', role: 'button', text: 'Confirm' });
    const result = verifier.verify(
      intent({ action: 'tap', label: 'Confirm' }),
      candidate,
      [candidate, dup],
    );
    assert.equal(result.checks.uniqueness, false);
    assert.ok(result.evidence.some((e) => e.includes('signature')));
  });

  it('uniqueness check skipped for single element', () => {
    const candidate = element({ id: 'el-1', text: 'Confirm' });
    const result = verifier.verify(
      intent({ action: 'tap', label: 'Confirm' }),
      candidate,
      [candidate],
    );
    // Only one element — no cross-check possible
    assert.equal(result.checks.uniqueness, undefined);
  });
});

describe('StandardElementVerifier — score', () => {
  it('fully passing element has score = 100', () => {
    const result = verifier.verify(
      intent({ action: 'tap' }),
      element({ enabled: true, interactive: true }),
    );
    // exists=true(30), visible=true(25), enabled=true(15), interactive=true(15) = 85/85 = 100
    assert.equal(result.score, 100);
  });

  it('hidden element has lower score', () => {
    const visible = verifier.verify(intent({ action: 'tap' }), element({}));
    const hidden = verifier.verify(
      intent({ action: 'tap' }),
      element({ visible: false }),
    );
    assert.ok(visible.score > hidden.score);
  });
});
