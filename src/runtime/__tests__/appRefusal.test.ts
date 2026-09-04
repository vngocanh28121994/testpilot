/**
 * An application that answers is not a locator that missed.
 *
 * Healing exists to find a better locator when the current one did not match.
 * It cannot, by itself, tell these two apart — both end with the expected
 * screen absent:
 *
 *   1. the step clicked the wrong element
 *   2. the step clicked the right element and the application said no
 *
 * So it treated the second as the first: blamed the locator, excluded it, and
 * went clicking other candidates on a live banking account. One run produced
 * 216 lines of `The selector "undefined" used with strategy "undefined"` that
 * way, while the reason sat one line above in the log —
 *
 *   [popup] nội dung: "TIỀN CHUYỂN + PHÍ VƯỢT QUÁ SỐ TIỀN CÓ THỂ CHUYỂN"
 *
 * — captured, printed, and used by nothing.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const executor = readFileSync('src/runtime/executor.ts', 'utf8');
const interceptor = readFileSync('src/drivers/PopupInterceptor.ts', 'utf8');

/** The catch block that decides whether to try another candidate. */
function healingDecision(): string {
  const at = executor.indexOf('lastOutcomeError = err as Error;');
  assert.ok(at > 0, 'the healing catch block is gone');
  return executor.slice(at, at + 1800);
}

describe('a failed postcondition after a successful action', () => {
  it('asks whether the application said anything', () => {
    assert.match(healingDecision(), /saidSince\?\.\(/, 'no longer consults the app message');
  });

  it('checks before blaming the locator, not after', () => {
    // Order is the whole point: rejectResolution() demotes the locator and
    // excluded() removes it from the next attempt, so both must come after the
    // refusal check or the damage is already done.
    const body = healingDecision();
    const said = body.indexOf('saidSince');
    const reject = body.indexOf('rejectResolution');
    const exclude = body.indexOf('excluded.add');
    assert.ok(said > 0 && reject > 0 && exclude > 0, 'expected all three steps');
    assert.ok(said < reject, 'the locator is demoted before the app is consulted');
    assert.ok(said < exclude, 'the candidate is excluded before the app is consulted');
  });

  it('reports what the application said, and that it is not a locator fault', () => {
    const body = healingDecision();
    assert.match(body, /app từ chối/, 'does not quote the refusal');
    assert.match(body, /Không phải lỗi locator/, 'does not say what the failure is not');
  });

  it('measures "since" from the start of this attempt', () => {
    // A message from an earlier attempt, or from before the step ran, must not
    // be read as a reply to this one.
    assert.match(executor, /const attemptStartedAt = Date\.now\(\);/);
    assert.match(healingDecision(), /saidSince\?\.\(attemptStartedAt\)/);
  });
});

describe('the popup interceptor', () => {
  it('retains what it dismissed, not only logs it', () => {
    // Dismissing a dialog destroys the evidence; logging it leaves it where
    // nothing can read it. The retained copy is the whole signal.
    assert.match(interceptor, /private lastSaid\?:/);
    assert.match(interceptor, /saidSince\(since: number\)/);
  });

  it('only reports a message newer than the caller asked about', () => {
    assert.match(interceptor, /this\.lastSaid\.at >= since/);
  });
});
