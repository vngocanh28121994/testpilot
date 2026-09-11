/**
 * "Chạy đúng các case positive của MỘT chức năng" — trước đây không nói được.
 *
 * Dấu phẩy vốn là "hoặc", nên chọn @feature-chuyen-tien và @positive cho ra
 * positive của MỌI chức năng. Thêm dấu cộng cho "và", giữ nguyên dấu phẩy để
 * lệnh và lịch chạy cũ không đổi nghĩa.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { canonicalTag } from '../../core/tagTaxonomy.js';

const source = readFileSync('src/cli/run.ts', 'utf8');

/** Bản sao đúng bằng biểu thức trong run.ts; test bên dưới canh cho nó không lệch. */
function inScope(tagArg: string, scenarioTags: string[]): boolean {
  const groups = tagArg
    .split(',')
    .map((group) => group.split('+').map(canonicalTag).filter(Boolean))
    .filter((group) => group.length > 0);
  return groups.length === 0 || groups.some((g) => g.every((t) => scenarioTags.includes(t)));
}

const transferPositive = ['@feature-chuyen-tien', '@positive', '@p0'];
const transferNegative = ['@feature-chuyen-tien', '@negative'];
const stockPositive = ['@feature-them-ma', '@positive'];

describe('phạm vi tag của một lượt chạy', () => {
  it('dấu cộng là VÀ: chỉ positive của đúng chức năng đó', () => {
    const expr = '@feature-chuyen-tien+@positive';
    assert.equal(inScope(expr, transferPositive), true);
    assert.equal(inScope(expr, transferNegative), false);
    assert.equal(inScope(expr, stockPositive), false);
  });

  it('dấu phẩy vẫn là HOẶC, như trước', () => {
    const expr = '@feature-chuyen-tien,@feature-them-ma';
    assert.equal(inScope(expr, transferNegative), true);
    assert.equal(inScope(expr, stockPositive), true);
    assert.equal(inScope(expr, ['@feature-khac']), false);
  });

  it('trộn được: (@a và @b) hoặc @c', () => {
    const expr = '@feature-chuyen-tien+@positive,@p0';
    assert.equal(inScope(expr, transferPositive), true);
    assert.equal(inScope(expr, ['@p0']), true);
    assert.equal(inScope(expr, stockPositive), false);
  });

  it('không chọn tag nào thì chạy tất cả', () => {
    assert.equal(inScope('', transferNegative), true);
  });

  /** Bản sao ở trên chỉ có giá trị khi run.ts thật sự làm như vậy. */
  it('run.ts dùng đúng cách tách đó', () => {
    assert.match(source, /split\(','\)[\s\S]{0,120}split\('\+'\)/);
    assert.match(source, /group\.every\(\(tag\) => scenario\.tags\.includes\(tag\)\)/);
  });
});
