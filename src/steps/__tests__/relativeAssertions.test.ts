/**
 * Asserting a change instead of a figure.
 *
 * A scenario here claimed `"Được chuyển" shows "8,829"` and was true exactly
 * once. Every run transferred another 1,000, so the balance walked away from it
 * — 7,329, 5,329, 1,329 — and the assertion failed while the application did
 * precisely what it was supposed to. The number was a snapshot of the day the
 * document was written, not a rule the product has to obey.
 *
 * What the business actually states is the movement: transferring 1,000 reduces
 * the transferable balance by 1,000. That is true on every run, on any account,
 * at any balance.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STEP_RULES } from '../vocabulary.js';

/** Bind a step the way the parser does, with labels passed through as ids. */
function parse(text: string) {
  for (const rule of STEP_RULES) {
    for (const pattern of rule.patterns) {
      const m = text.match(pattern);
      if (m) return { id: rule.id, intent: rule.build(m, (label) => label) };
    }
  }
  return undefined;
}

describe('remembering a number', () => {
  it('reads the English form', () => {
    const step = parse('I remember "Được chuyển" as "số dư trước"');
    assert.equal(step?.id, 'rememberNumber');
    assert.deepEqual(step?.intent, {
      kind: 'rememberNumber', element: 'Được chuyển', as: 'số dư trước',
    });
  });

  it('reads the Vietnamese form', () => {
    const step = parse('Tôi ghi nhớ "Được chuyển" là "số dư trước"');
    assert.equal(step?.id, 'rememberNumber');
  });
});

describe('asserting the change', () => {
  it('takes an amount written the way the screen shows it', () => {
    // "1,000", not 1000: a scenario quotes what a person reads.
    const step = parse('"Được chuyển" decreased by "1,000" from "số dư trước"');
    assert.deepEqual(step?.intent, {
      kind: 'assertNumberDelta',
      element: 'Được chuyển',
      as: 'số dư trước',
      direction: 'decreased',
      by: 1000,
    });
  });

  it('reads an increase', () => {
    const step = parse('"Số dư Ký Quỹ" increased by "1,000" from "trước khi chuyển"');
    assert.equal((step?.intent as { direction: string }).direction, 'increased');
  });

  it('reads the Vietnamese forms', () => {
    const down = parse('"Được chuyển" giảm "1,000" so với "số dư trước"');
    assert.equal((down?.intent as { direction: string }).direction, 'decreased');
    const up = parse('"Được chuyển" tăng "1.000" so với "số dư trước"');
    assert.equal((up?.intent as { direction: string; by: number }).by, 1000);
  });

  it('handles European separators the same way the assertion does', () => {
    const step = parse('"Được chuyển" decreased by "1.234,50" from "trước"');
    assert.equal((step?.intent as { by: number }).by, 1234.5);
  });
});

describe('asserting only that it moved', () => {
  it('expresses "changed" without an amount', () => {
    // The rule is "the transferable amount changes with the source account".
    // How much it changes is account data, so there is no number to write —
    // and the only thing expressible before this was that the field is still on
    // screen, which is true whether the feature works or not.
    const step = parse('"Được chuyển" changed from "số dư TK Thường"');
    assert.deepEqual(step?.intent, {
      kind: 'assertNumberDelta',
      element: 'Được chuyển',
      as: 'số dư TK Thường',
      direction: 'changed',
    });
  });

  it('reads the Vietnamese form', () => {
    const step = parse('"Được chuyển" đã thay đổi so với "số dư TK Thường"');
    assert.equal((step?.intent as { direction: string }).direction, 'changed');
  });

  it('is not confused with the unchanged form', () => {
    const unchanged = parse('"Được chuyển" is unchanged from "x"');
    assert.equal((unchanged?.intent as { direction: string }).direction, 'unchanged');
  });
});

describe('asserting nothing moved', () => {
  it('expresses "unchanged" without needing an amount', () => {
    // Cancelling a transfer must leave the balance alone, and there is no
    // number to write for that.
    const step = parse('"Được chuyển" is unchanged from "số dư trước"');
    assert.deepEqual(step?.intent, {
      kind: 'assertNumberDelta',
      element: 'Được chuyển',
      as: 'số dư trước',
      direction: 'unchanged',
    });
  });

  it('reads the Vietnamese form', () => {
    const step = parse('"Được chuyển" không đổi so với "số dư trước"');
    assert.equal((step?.intent as { direction: string }).direction, 'unchanged');
  });
});

describe('not colliding with what was already there', () => {
  it('leaves the absolute numeric assertion alone', () => {
    const step = parse('"Số lệnh" number is greater than "0"');
    assert.equal(step?.id, 'assertNumber');
  });

  it('leaves a plain text assertion alone', () => {
    const step = parse('"Lệnh" shows "Chuyển tiền"');
    assert.equal(step?.id, 'assertTextContains');
  });
});
