import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HealingPolicy } from '../HealingPolicy.js';
import type { NormalizedFailure } from '../ExecutionTypes.js';

function makeFailure(overrides: Partial<NormalizedFailure> = {}): NormalizedFailure {
  return {
    category: 'UNKNOWN',
    code: 'UNKNOWN_ERROR',
    message: 'test error',
    evidenceRefs: [],
    signature: 'UNKNOWN',
    ...overrides,
  };
}

const policy = new HealingPolicy();

// ── LOCATOR_FAILURE ───────────────────────────────────────────────────────────

describe('HealingPolicy — LOCATOR_FAILURE', () => {
  it('should discover and can auto-heal', () => {
    const d = policy.decide(makeFailure({ category: 'LOCATOR_FAILURE', code: 'ELEMENT_NOT_FOUND' }));
    assert.equal(d.shouldDiscover, true);
    assert.equal(d.canAutoHeal, true);
  });

  it('allows AI fallback', () => {
    const d = policy.decide(makeFailure({ category: 'LOCATOR_FAILURE', code: 'ELEMENT_NOT_FOUND' }));
    assert.equal(d.shouldTryAi, true);
  });

  it('maxAttempts > 1 (allows retry)', () => {
    const d = policy.decide(makeFailure({ category: 'LOCATOR_FAILURE', code: 'ELEMENT_NOT_FOUND' }));
    assert.ok(d.maxAttempts > 1, 'LOCATOR_FAILURE should allow at least one retry');
  });

  it('reason mentions discovery', () => {
    const d = policy.decide(makeFailure({ category: 'LOCATOR_FAILURE', code: 'ELEMENT_NOT_FOUND' }));
    assert.ok(d.reason.toLowerCase().includes('discover') || d.reason.toLowerCase().includes('observation'));
  });
});

// ── TIMEOUT ───────────────────────────────────────────────────────────────────

describe('HealingPolicy — TIMEOUT', () => {
  it('transient timeout: no heal but allows retry', () => {
    const d = policy.decide(makeFailure({ category: 'TIMEOUT', code: 'TIMEOUT', transient: true }));
    assert.equal(d.shouldDiscover, false);
    assert.equal(d.canAutoHeal, false);
    assert.ok(d.maxAttempts > 1, 'transient timeout should allow retry');
  });

  it('non-transient timeout: no discover, no heal, no retry', () => {
    const d = policy.decide(makeFailure({ category: 'TIMEOUT', code: 'TIMEOUT', transient: false }));
    assert.equal(d.shouldDiscover, false);
    assert.equal(d.canAutoHeal, false);
    assert.equal(d.maxAttempts, 1);
  });

  it('timeout with no transient flag: treated as non-transient', () => {
    const d = policy.decide(makeFailure({ category: 'TIMEOUT', code: 'TIMEOUT' }));
    assert.equal(d.canAutoHeal, false);
    assert.equal(d.maxAttempts, 1);
  });
});

// ── NETWORK ───────────────────────────────────────────────────────────────────

describe('HealingPolicy — NETWORK', () => {
  it('no discover, no heal, but retry allowed', () => {
    const d = policy.decide(makeFailure({ category: 'NETWORK', code: 'NETWORK_ERROR' }));
    assert.equal(d.shouldDiscover, false);
    assert.equal(d.canAutoHeal, false);
    assert.ok(d.maxAttempts > 1);
  });
});

// ── no-heal categories ────────────────────────────────────────────────────────

describe('HealingPolicy — hard-blocked categories', () => {
  const noHealCategories = [
    'ASSERTION_MISMATCH',
    'PRODUCT_DEFECT',
    'TEST_DATA',
    'APP_CRASH',
    'ENVIRONMENT_UNAVAILABLE',
  ] as const;

  for (const category of noHealCategories) {
    it(`${category}: canAutoHeal=false, shouldDiscover=false`, () => {
      const d = policy.decide(makeFailure({ category, code: category }));
      assert.equal(d.canAutoHeal, false, `${category} should not auto-heal`);
      assert.equal(d.shouldDiscover, false, `${category} should not discover`);
      assert.equal(d.maxAttempts, 1, `${category} should not retry`);
    });
  }

  it('ASSERTION_MISMATCH reason mentions locator cannot fix', () => {
    const d = policy.decide(makeFailure({ category: 'ASSERTION_MISMATCH', code: 'ASSERTION_FAILED' }));
    assert.ok(d.reason.toLowerCase().includes('locator') || d.reason.toLowerCase().includes('data'));
  });

  it('APP_CRASH reason mentions diagnosis', () => {
    const d = policy.decide(makeFailure({ category: 'APP_CRASH', code: 'APP_CRASH' }));
    assert.ok(d.reason.toLowerCase().includes('crash') || d.reason.toLowerCase().includes('diagnos'));
  });
});

// ── UNKNOWN ───────────────────────────────────────────────────────────────────

describe('HealingPolicy — UNKNOWN', () => {
  it('discovers for evidence but does NOT auto-heal', () => {
    const d = policy.decide(makeFailure({ category: 'UNKNOWN', code: 'UNKNOWN_ERROR' }));
    assert.equal(d.shouldDiscover, true, 'should discover to gather evidence');
    assert.equal(d.canAutoHeal, false, 'must not auto-heal unknown failures');
  });

  it('reason mentions evidence collection', () => {
    const d = policy.decide(makeFailure({ category: 'UNKNOWN', code: 'UNKNOWN_ERROR' }));
    assert.ok(d.reason.toLowerCase().includes('evidence') || d.reason.toLowerCase().includes('diagnos'));
  });
});
