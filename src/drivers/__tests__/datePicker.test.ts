import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseDate, sameDate } from '../datePicker.js';

describe('datePicker', () => {
  it('accepts Vietnamese display and ISO date formats', () => {
    assert.deepEqual(parseDate('01/01/2026'), { day: 1, month: 1, year: 2026 });
    assert.deepEqual(parseDate('2026-01-01'), { day: 1, month: 1, year: 2026 });
    assert.equal(sameDate('1/1/2026', '01/01/2026'), true);
  });

  it('rejects invalid calendar dates', () => {
    assert.throws(() => parseDate('31/02/2026'), /không tồn tại/);
  });
});
