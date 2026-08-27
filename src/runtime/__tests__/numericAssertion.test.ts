/**
 * An amount is a number, not a string.
 *
 * A generated scenario asserted `"Tiền chuyển (Phí = 0)" shows "1000"` while
 * the screen rendered `1,000`, and the step failed over a comma nobody typed.
 * The previous generation of the same document had written `"1,000"` — so the
 * suite's health depended on which spelling the model happened to choose that
 * run, which is not a property a test suite may have.
 *
 * The looseness bought here is strictly about separators. Everything else stays
 * exact: a step expecting 1 must not pass against a balance of 1,000, and a
 * balance assertion that is genuinely wrong must still fail.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseDisplayedNumber } from '../../core/number.js';

/** Mirrors the executor's comparison; kept here so the rules are pinned. */
function matchesAsNumber(expected: string, seen: string[]): boolean {
  let wanted: number;
  try {
    if (!/^-?\d[\d.,]*$/u.test(expected.trim())) return false;
    wanted = parseDisplayedNumber(expected);
  } catch {
    return false;
  }
  return seen.some((text) =>
    (text.match(/-?\d[\d.,]*/gu) ?? []).some((token) => {
      try {
        return parseDisplayedNumber(token) === wanted;
      } catch {
        return false;
      }
    }));
}

describe('separators the scenario did not type', () => {
  it('matches a plain number against a formatted one', () => {
    assert.equal(matchesAsNumber('1000', ['1,000']), true);
  });

  it('matches in the other direction too', () => {
    // Which spelling the model picks varies between runs of the same document.
    assert.equal(matchesAsNumber('1,000', ['1000']), true);
  });

  it('accepts the European grouping the app also renders', () => {
    assert.equal(matchesAsNumber('1000', ['1.000']), true);
  });

  it('finds the amount inside a sentence', () => {
    assert.equal(matchesAsNumber('500', ['Tiền chuyển 500 VND']), true);
  });
});

describe('what must still fail', () => {
  it('does not let a smaller number match a larger one', () => {
    // Containment would pass "1" against "1,000" and quietly weaken every
    // count assertion in the suite.
    assert.equal(matchesAsNumber('1', ['1,000']), false);
  });

  it('keeps a genuinely wrong balance wrong', () => {
    assert.equal(matchesAsNumber('8829', ['7,329']), false);
  });

  it('does not confuse an order of magnitude', () => {
    assert.equal(matchesAsNumber('1000', ['10,000']), false);
  });
});

describe('what is not a number', () => {
  it('leaves tickers and account names alone', () => {
    for (const text of ['VIC', 'Ký Quỹ', 'Chuyển tiền']) {
      assert.equal(matchesAsNumber(text, [text]), false, `"${text}" phải đi đường so chuỗi`);
    }
  });

  it('ignores an expectation that merely starts with a digit', () => {
    assert.equal(matchesAsNumber('1 lệnh chờ', ['1 lệnh chờ']), false);
  });
});
