import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RetryPolicy, DEFAULT_RETRY_POLICY } from '../RetryPolicy.js';
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

const policy = new RetryPolicy();

// ── LOCATOR_FAILURE ───────────────────────────────────────────────────────────

describe('RetryPolicy — LOCATOR_FAILURE', () => {
  it('retries on first attempt', () => {
    const d = policy.decide(makeFailure({ category: 'LOCATOR_FAILURE', code: 'ELEMENT_NOT_FOUND' }), 1);
    assert.equal(d.shouldRetry, true);
  });

  it('does not retry once maxLocatorAttempts reached', () => {
    const d = policy.decide(makeFailure({ category: 'LOCATOR_FAILURE', code: 'ELEMENT_NOT_FOUND' }), DEFAULT_RETRY_POLICY.maxLocatorAttempts);
    assert.equal(d.shouldRetry, false);
  });

  it('reason mentions element discovery', () => {
    const d = policy.decide(makeFailure({ category: 'LOCATOR_FAILURE', code: 'ELEMENT_NOT_FOUND' }), 1);
    assert.ok(d.reason.toLowerCase().includes('discovery'));
  });
});

// ── TIMEOUT ───────────────────────────────────────────────────────────────────

describe('RetryPolicy — TIMEOUT', () => {
  it('retries transient timeout', () => {
    const d = policy.decide(makeFailure({ category: 'TIMEOUT', code: 'TIMEOUT', transient: true }), 1);
    assert.equal(d.shouldRetry, true);
  });

  it('does not retry non-transient timeout', () => {
    const d = policy.decide(makeFailure({ category: 'TIMEOUT', code: 'TIMEOUT', transient: false }), 1);
    assert.equal(d.shouldRetry, false);
  });

  it('does not retry timeout with no transient flag', () => {
    const d = policy.decide(makeFailure({ category: 'TIMEOUT', code: 'TIMEOUT' }), 1);
    assert.equal(d.shouldRetry, false);
  });

  it('stops retrying transient timeout after max attempts', () => {
    const d = policy.decide(
      makeFailure({ category: 'TIMEOUT', code: 'TIMEOUT', transient: true }),
      DEFAULT_RETRY_POLICY.maxTransientAttempts,
    );
    assert.equal(d.shouldRetry, false);
  });
});

// ── NETWORK ───────────────────────────────────────────────────────────────────

describe('RetryPolicy — NETWORK', () => {
  it('retries network errors', () => {
    const d = policy.decide(makeFailure({ category: 'NETWORK', code: 'NETWORK_ERROR', transient: true }), 1);
    assert.equal(d.shouldRetry, true);
  });

  it('stops after maxNetworkAttempts', () => {
    const d = policy.decide(
      makeFailure({ category: 'NETWORK', code: 'NETWORK_ERROR' }),
      DEFAULT_RETRY_POLICY.maxNetworkAttempts,
    );
    assert.equal(d.shouldRetry, false);
  });
});

// ── hard-blocked categories ───────────────────────────────────────────────────

describe('RetryPolicy — no-retry categories', () => {
  const noRetryCategories = [
    'ASSERTION_MISMATCH',
    'PRODUCT_DEFECT',
    'TEST_DATA',
    'APP_CRASH',
    'ENVIRONMENT_UNAVAILABLE',
    'UNKNOWN',
  ] as const;

  for (const category of noRetryCategories) {
    it(`never retries ${category}`, () => {
      const d = policy.decide(makeFailure({ category, code: category }), 1);
      assert.equal(d.shouldRetry, false, `${category} should never retry`);
    });
  }

  it('ASSERTION_MISMATCH reason mentions defect', () => {
    const d = policy.decide(makeFailure({ category: 'ASSERTION_MISMATCH', code: 'ASSERTION_FAILED' }), 1);
    assert.ok(d.reason.toLowerCase().includes('defect') || d.reason.toLowerCase().includes('mask'));
  });

  it('PRODUCT_DEFECT reason mentions defect ticket', () => {
    const d = policy.decide(makeFailure({ category: 'PRODUCT_DEFECT', code: 'PRODUCT_DEFECT' }), 1);
    assert.ok(d.reason.toLowerCase().includes('defect'));
  });

  it('UNKNOWN reason mentions evidence collection', () => {
    const d = policy.decide(makeFailure({ category: 'UNKNOWN', code: 'UNKNOWN_ERROR' }), 1);
    assert.ok(d.reason.toLowerCase().includes('evidence'));
  });
});

// ── custom policy config ──────────────────────────────────────────────────────

describe('RetryPolicy — custom config', () => {
  it('respects custom maxLocatorAttempts', () => {
    const custom = new RetryPolicy({ maxLocatorAttempts: 3, maxTransientAttempts: 3, maxNetworkAttempts: 3 });
    const failure = makeFailure({ category: 'LOCATOR_FAILURE', code: 'ELEMENT_NOT_FOUND' });

    assert.equal(custom.decide(failure, 1).shouldRetry, true);
    assert.equal(custom.decide(failure, 2).shouldRetry, true);
    assert.equal(custom.decide(failure, 3).shouldRetry, false);
  });

  it('respects zero retries config', () => {
    const strict = new RetryPolicy({ maxLocatorAttempts: 1, maxTransientAttempts: 1, maxNetworkAttempts: 1 });
    const failure = makeFailure({ category: 'LOCATOR_FAILURE', code: 'ELEMENT_NOT_FOUND' });
    assert.equal(strict.decide(failure, 1).shouldRetry, false);
  });
});
