import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FailureNormalizer } from '../FailureNormalizer.js';
import { ElementNotFoundError } from '../../runtime/resolver.js';

const norm = new FailureNormalizer();

// ── category classification ───────────────────────────────────────────────────

describe('FailureNormalizer — category classification', () => {
  it('classifies ElementNotFoundError as LOCATOR_FAILURE', () => {
    const err = new ElementNotFoundError('btn', 'android', [], 3);
    const result = norm.normalize(err);
    assert.equal(result.category, 'LOCATOR_FAILURE');
    assert.equal(result.code, 'ELEMENT_NOT_FOUND');
    assert.equal(result.confidence, 1.0);
  });

  it('classifies timeout error', () => {
    const result = norm.normalize(new Error('Element wait timed out after 10000ms'));
    assert.equal(result.category, 'TIMEOUT');
    assert.equal(result.code, 'TIMEOUT');
    assert.equal(result.transient, true);
  });

  it('marks navigation timeout as non-transient', () => {
    const result = norm.normalize(new Error('Navigation timeout exceeded'));
    assert.equal(result.category, 'TIMEOUT');
    assert.equal(result.transient, false);
  });

  it('marks page load timeout as non-transient', () => {
    const result = norm.normalize(new Error('Page load timed out'));
    assert.equal(result.category, 'TIMEOUT');
    assert.equal(result.transient, false);
  });

  it('classifies network ECONNREFUSED as NETWORK', () => {
    const result = norm.normalize(new Error('connect ECONNREFUSED 127.0.0.1:4723'));
    assert.equal(result.category, 'NETWORK');
    assert.equal(result.transient, true);
  });

  it('classifies fetch failed as NETWORK', () => {
    const result = norm.normalize(new Error('fetch failed: connection reset'));
    assert.equal(result.category, 'NETWORK');
  });

  it('classifies assertion error by name', () => {
    const err = Object.assign(new Error('3 !== 5'), { name: 'AssertionError' });
    const result = norm.normalize(err);
    assert.equal(result.category, 'ASSERTION_MISMATCH');
    assert.equal(result.confidence, 0.95);
  });

  it('classifies text assertion failure message', () => {
    const result = norm.normalize(
      new Error('Text assertion failed on "balance": expected "1000000", got "0".'),
    );
    assert.equal(result.category, 'ASSERTION_MISMATCH');
  });

  it('classifies app crash', () => {
    const result = norm.normalize(new Error('App not running, cannot get page source'));
    assert.equal(result.category, 'APP_CRASH');
  });

  it('classifies process died as APP_CRASH', () => {
    const result = norm.normalize(new Error('com.example.app process died unexpectedly'));
    assert.equal(result.category, 'APP_CRASH');
  });

  it('classifies driver offline as ENVIRONMENT_UNAVAILABLE', () => {
    const result = norm.normalize(new Error('driver offline'));
    assert.equal(result.category, 'ENVIRONMENT_UNAVAILABLE');
    assert.equal(result.confidence, 0.9);
  });

  it('classifies no such session as ENVIRONMENT_UNAVAILABLE', () => {
    const result = norm.normalize(new Error('No such session: abc-123'));
    assert.equal(result.category, 'ENVIRONMENT_UNAVAILABLE');
  });

  it('classifies unknown error', () => {
    const result = norm.normalize(new Error('something completely unexpected'));
    assert.equal(result.category, 'UNKNOWN');
    assert.equal(result.confidence, 0.3);
  });

  it('accepts non-Error thrown values', () => {
    const result = norm.normalize('plain string error');
    assert.equal(result.category, 'UNKNOWN');
    assert.equal(result.message, 'plain string error');
  });
});

// ── stable signature ──────────────────────────────────────────────────────────

describe('FailureNormalizer — failure signature stability', () => {
  it('signature includes category', () => {
    const err = new ElementNotFoundError('btn', 'android', [], 1);
    const result = norm.normalize(err);
    assert.ok(result.signature.startsWith('LOCATOR_FAILURE'));
  });

  it('signature includes screen when provided', () => {
    const err = new ElementNotFoundError('btn', 'android', [], 1);
    const result = norm.normalize(err, { screen: 'transfer', elementId: 'transfer.confirmButton' });
    assert.equal(result.signature, 'LOCATOR_FAILURE:screen=transfer:intent=transfer.confirmButton');
  });

  it('same failure type + same context → same signature regardless of stack', () => {
    const err1 = new ElementNotFoundError('btn', 'android', [], 3);
    const err2 = new ElementNotFoundError('btn', 'ios', [], 10);
    const ctx = { screen: 'login', elementId: 'login.submitButton' };
    assert.equal(norm.normalize(err1, ctx).signature, norm.normalize(err2, ctx).signature);
  });

  it('different screens → different signatures', () => {
    const err = new ElementNotFoundError('btn', 'android', [], 1);
    const s1 = norm.normalize(err, { screen: 'login' }).signature;
    const s2 = norm.normalize(err, { screen: 'transfer' }).signature;
    assert.notEqual(s1, s2);
  });
});

// ── context forwarding ────────────────────────────────────────────────────────

describe('FailureNormalizer — context forwarding', () => {
  it('forwards stepId', () => {
    const result = norm.normalize(new Error('timeout'), { stepId: 'step-3' });
    assert.equal(result.stepId, 'step-3');
  });

  it('forwards evidenceRefs', () => {
    const refs = ['artifact-1', 'artifact-2'];
    const result = norm.normalize(new Error('timeout'), { evidenceRefs: refs });
    assert.deepEqual(result.evidenceRefs, refs);
  });

  it('defaults evidenceRefs to empty array', () => {
    const result = norm.normalize(new Error('timeout'));
    assert.deepEqual(result.evidenceRefs, []);
  });
});
