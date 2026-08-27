/**
 * A rule that states two directions must become two requirements.
 *
 * The transfer document said "Chuyển tiền từ tiểu khoản Thường sang Ký Quỹ và
 * ngược lại". Extraction kept it whole, one scenario tested the forward
 * direction, and the audit recorded it as covered — its stated reason never
 * mentioning direction at all. The gate then reported `PASS 1/1` for a
 * requirement that was half tested, and the reverse transfer was never written.
 *
 * Nothing anywhere said so, which is the part that matters: a coverage gate
 * exists precisely to make silence impossible.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { expandBidirectional } from '../coverage.js';

describe('a rule naming both directions', () => {
  it('yields the forward direction on its own', () => {
    const [forward] = expandBidirectional(
      'Chuyển tiền từ tiểu khoản Thường sang Ký Quỹ và ngược lại',
    );
    assert.equal(forward, 'Chuyển tiền từ tiểu khoản Thường sang Ký Quỹ');
  });

  it('states the reverse in the document\'s own words', () => {
    // Written out rather than left as "and vice versa" so the audit has
    // something concrete to match a scenario against.
    const [, reverse] = expandBidirectional(
      'Chuyển tiền từ tiểu khoản Thường sang Ký Quỹ và ngược lại',
    );
    assert.equal(reverse, 'Chuyển tiền từ Ký Quỹ sang tiểu khoản Thường');
  });

  it('handles the other prepositions the same rule can use', () => {
    for (const [preposition, expected] of [
      ['đến', 'Cho phép chuyển từ B đến A'],
      ['tới', 'Cho phép chuyển từ B tới A'],
      ['qua', 'Cho phép chuyển từ B qua A'],
    ] as const) {
      const [, reverse] = expandBidirectional(`Cho phép chuyển từ A ${preposition} B và ngược lại`);
      assert.equal(reverse, expected);
    }
  });

  it('tolerates trailing punctuation and a comma before the clause', () => {
    const [forward, reverse] = expandBidirectional(
      'Cho phép chuyển từ TK Ký Quỹ đến TK Thường, và ngược lại.',
    );
    assert.equal(forward, 'Cho phép chuyển từ TK Ký Quỹ đến TK Thường');
    assert.equal(reverse, 'Cho phép chuyển từ TK Thường đến TK Ký Quỹ');
  });

  it('still raises a requirement when the direction cannot be parsed', () => {
    // Naming it explicitly beats folding it into the forward rule: an
    // unwritten reverse scenario is then reported instead of passing silently.
    const [, reverse] = expandBidirectional('Người dùng có thể lọc danh sách và ngược lại');
    assert.equal(reverse, 'Chiều ngược lại của: Người dùng có thể lọc danh sách');
  });
});

describe('how these documents actually write a direction', () => {
  it('reverses an arrow, and clears the bracket the clause left behind', () => {
    // The real line: "Thường → Ký Quỹ (và ngược lại)". Removing the clause used
    // to leave "()" stranded in a requirement a person has to read, and the
    // arrow was not recognised so the reverse could only be named, not stated.
    const [forward, reverse] = expandBidirectional(
      'Mục tiêu: Chuyển được tiền từ tiểu khoản Thường → Ký Quỹ (và ngược lại)',
    );
    assert.equal(forward, 'Mục tiêu: Chuyển được tiền từ tiểu khoản Thường → Ký Quỹ');
    assert.equal(reverse, 'Mục tiêu: Chuyển được tiền từ Ký Quỹ → tiểu khoản Thường');
  });

  it('handles the ascii arrows too', () => {
    const [, reverse] = expandBidirectional('Cho phép chuyển từ A -> B và ngược lại');
    assert.equal(reverse, 'Cho phép chuyển từ B -> A');
  });
});

describe('what it leaves alone', () => {
  it('does not touch a rule with only one direction', () => {
    const quote = 'Chuyển tiền nội bộ giữa hai tiểu khoản';
    assert.deepEqual(expandBidirectional(quote), [quote]);
  });

  it('does not split on a bare "và"', () => {
    // "và" joins clauses far more often than it adds a requirement. Splitting
    // there would bury the real gaps under fragments nobody asked for.
    const quote = 'Hiển thị số dư và phí chuyển tiền';
    assert.deepEqual(expandBidirectional(quote), [quote]);
  });

  it('keeps the original when removing the clause would leave nothing', () => {
    assert.deepEqual(expandBidirectional('ngược lại'), ['ngược lại']);
  });
});
