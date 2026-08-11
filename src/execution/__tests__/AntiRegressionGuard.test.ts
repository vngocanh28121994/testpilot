import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AntiRegressionGuard } from '../AntiRegressionGuard.js';
import type { AntiRegressionContext } from '../AntiRegressionGuard.js';
import type { UiObservation } from '../../discovery/UiObservation.js';
import type { ElementIntent } from '../../discovery/ElementIntent.js';

const guard = new AntiRegressionGuard();

// ── helpers ───────────────────────────────────────────────────────────────────

function makeObservation(elements: UiObservation['elements']): UiObservation {
  return {
    id: 'obs-1',
    timestamp: new Date().toISOString(),
    platform: 'android',
    source: 'native',
    context: {},
    elements,
  };
}

function makeIntent(overrides: Partial<ElementIntent> = {}): ElementIntent {
  return {
    id: 'login.submitButton',
    action: 'tap',
    label: 'Login',
    screen: 'LoginScreen',
    ...overrides,
  };
}

function makeCtx(overrides: Partial<AntiRegressionContext> = {}): AntiRegressionContext {
  const obs = makeObservation([
    {
      id: 'el-0',
      role: 'android.widget.Button',
      testId: 'btn-login',
      accessibilityLabel: 'Login',
      text: 'Login',
      visible: true,
      enabled: true,
      interactive: true,
      index: 0,
    },
  ]);
  return {
    intent: makeIntent(),
    newLocator: { strategy: 'testId', value: 'btn-login' },
    observation: obs,
    matchedElementId: 'el-0',
    confidence: 75,
    minConfidence: 60,
    ...overrides,
  };
}

// ── confidence check ──────────────────────────────────────────────────────────

describe('AntiRegressionGuard — confidence threshold', () => {
  it('passes when confidence meets minimum', () => {
    const result = guard.check(makeCtx({ confidence: 75, minConfidence: 60 }));
    const check = result.checks.find((c) => c.name === 'confidence-threshold')!;
    assert.equal(check.passed, true);
  });

  it('fails when confidence is below minimum', () => {
    const result = guard.check(makeCtx({ confidence: 50, minConfidence: 60 }));
    const check = result.checks.find((c) => c.name === 'confidence-threshold')!;
    assert.equal(check.passed, false);
    assert.ok(check.detail?.includes('50'));
  });

  it('passes at exactly the minimum', () => {
    const result = guard.check(makeCtx({ confidence: 60, minConfidence: 60 }));
    const check = result.checks.find((c) => c.name === 'confidence-threshold')!;
    assert.equal(check.passed, true);
  });
});

// ── uniqueness check ──────────────────────────────────────────────────────────

describe('AntiRegressionGuard — locator uniqueness', () => {
  it('passes when locator matches exactly one element', () => {
    const result = guard.check(makeCtx());
    const check = result.checks.find((c) => c.name === 'locator-uniqueness')!;
    assert.equal(check.passed, true);
  });

  it('fails when locator matches two elements', () => {
    const obs = makeObservation([
      { id: 'el-0', role: 'Button', testId: 'btn-login', visible: true, enabled: true, interactive: true, index: 0 },
      { id: 'el-1', role: 'Button', testId: 'btn-login', visible: true, enabled: true, interactive: true, index: 1 },
    ]);
    const result = guard.check(makeCtx({ observation: obs, matchedElementId: 'el-0' }));
    const check = result.checks.find((c) => c.name === 'locator-uniqueness')!;
    assert.equal(check.passed, false);
    assert.ok(check.detail?.includes('2'));
  });

  it('label strategy matches on accessibilityLabel', () => {
    const obs = makeObservation([
      { id: 'el-0', role: 'Button', accessibilityLabel: 'Login', visible: true, enabled: true, interactive: true, index: 0 },
    ]);
    const result = guard.check(makeCtx({
      newLocator: { strategy: 'label', value: 'Login' },
      observation: obs,
      matchedElementId: 'el-0',
    }));
    const check = result.checks.find((c) => c.name === 'locator-uniqueness')!;
    assert.equal(check.passed, true);
  });

  it('css/xpath strategy skips uniqueness check (cannot evaluate statically)', () => {
    const result = guard.check(makeCtx({ newLocator: { strategy: 'css', value: '.btn-login' } }));
    // uniqueness check returns false for unresolvable strategies — the overall result
    // depends on whether the element exists or not; we just verify the check runs
    const check = result.checks.find((c) => c.name === 'locator-uniqueness')!;
    assert.ok(check !== undefined);
  });
});

// ── semantic intent ───────────────────────────────────────────────────────────

describe('AntiRegressionGuard — semantic intent', () => {
  it('passes when element label matches intent label', () => {
    const result = guard.check(makeCtx());
    const check = result.checks.find((c) => c.name === 'semantic-intent')!;
    assert.equal(check.passed, true);
  });

  it('fails when element text is unrelated to intent label', () => {
    const obs = makeObservation([
      { id: 'el-0', role: 'Button', testId: 'btn-login', text: 'Cancel', visible: true, enabled: true, interactive: true, index: 0 },
    ]);
    const result = guard.check(makeCtx({ observation: obs, intent: makeIntent({ label: 'Login' }) }));
    const check = result.checks.find((c) => c.name === 'semantic-intent')!;
    assert.equal(check.passed, false);
    assert.ok(check.detail?.includes('cancel') || check.detail?.includes('Login'));
  });

  it('passes when intent has no label', () => {
    const result = guard.check(makeCtx({ intent: makeIntent({ label: undefined }) }));
    const check = result.checks.find((c) => c.name === 'semantic-intent')!;
    assert.equal(check.passed, true);
  });

  it('passes when element has no readable text (icon button)', () => {
    const obs = makeObservation([
      { id: 'el-0', role: 'Button', testId: 'btn-login', visible: true, enabled: true, interactive: true, index: 0 },
    ]);
    const result = guard.check(makeCtx({ observation: obs }));
    const check = result.checks.find((c) => c.name === 'semantic-intent')!;
    assert.equal(check.passed, true);
  });

  it('passes for partial label match', () => {
    const obs = makeObservation([
      { id: 'el-0', role: 'Button', testId: 'btn-login', text: 'Login to account', visible: true, enabled: true, interactive: true, index: 0 },
    ]);
    const result = guard.check(makeCtx({ observation: obs, intent: makeIntent({ label: 'Login' }) }));
    const check = result.checks.find((c) => c.name === 'semantic-intent')!;
    assert.equal(check.passed, true);
  });
});

// ── interactability check ─────────────────────────────────────────────────────

describe('AntiRegressionGuard — element interactable', () => {
  it('passes for interactive enabled element with tap action', () => {
    const result = guard.check(makeCtx());
    const check = result.checks.find((c) => c.name === 'element-interactable')!;
    assert.equal(check.passed, true);
  });

  it('fails for non-interactive element with tap action', () => {
    const obs = makeObservation([
      { id: 'el-0', role: 'TextView', testId: 'btn-login', text: 'Login', visible: true, enabled: true, interactive: false, index: 0 },
    ]);
    const result = guard.check(makeCtx({ observation: obs }));
    const check = result.checks.find((c) => c.name === 'element-interactable')!;
    assert.equal(check.passed, false);
    assert.ok(check.detail?.toLowerCase().includes('not interactive'));
  });

  it('fails for disabled element with tap action', () => {
    const obs = makeObservation([
      { id: 'el-0', role: 'Button', testId: 'btn-login', text: 'Login', visible: true, enabled: false, interactive: true, index: 0 },
    ]);
    const result = guard.check(makeCtx({ observation: obs }));
    const check = result.checks.find((c) => c.name === 'element-interactable')!;
    assert.equal(check.passed, false);
    assert.ok(check.detail?.toLowerCase().includes('disabled'));
  });

  it('passes for disabled element with assert-disabled action', () => {
    const obs = makeObservation([
      { id: 'el-0', role: 'Button', testId: 'btn-login', visible: true, enabled: false, interactive: false, index: 0 },
    ]);
    const result = guard.check(makeCtx({
      observation: obs,
      intent: makeIntent({ action: 'assert-disabled' }),
    }));
    const check = result.checks.find((c) => c.name === 'element-interactable')!;
    assert.equal(check.passed, true);
  });

  it('passes for assert-visible even on non-interactive element', () => {
    const obs = makeObservation([
      { id: 'el-0', role: 'TextView', testId: 'label-1', visible: true, enabled: true, interactive: false, index: 0 },
    ]);
    const result = guard.check(makeCtx({
      observation: obs,
      intent: makeIntent({ action: 'assert-visible' }),
    }));
    const check = result.checks.find((c) => c.name === 'element-interactable')!;
    assert.equal(check.passed, true);
  });
});

// ── overall result ────────────────────────────────────────────────────────────

describe('AntiRegressionGuard — overall result', () => {
  it('passed=true when all checks pass', () => {
    const result = guard.check(makeCtx());
    assert.equal(result.passed, true);
    assert.ok(result.checks.length === 4);
    assert.ok(result.checks.every((c) => c.passed));
  });

  it('passed=false when any check fails', () => {
    const result = guard.check(makeCtx({ confidence: 10, minConfidence: 60 }));
    assert.equal(result.passed, false);
  });

  it('returns all four named checks', () => {
    const result = guard.check(makeCtx());
    const names = result.checks.map((c) => c.name);
    assert.ok(names.includes('confidence-threshold'));
    assert.ok(names.includes('locator-uniqueness'));
    assert.ok(names.includes('semantic-intent'));
    assert.ok(names.includes('element-interactable'));
  });
});
