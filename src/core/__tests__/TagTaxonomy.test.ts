import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyGeneratedTagPolicy,
  canonicalTag,
  normalizeFeatureTags,
  normalizeTagList,
} from '../tagTaxonomy.js';

describe('central tag taxonomy', () => {
  it('maps legacy aliases and namespaces a genuinely new business tag', () => {
    assert.equal(canonicalTag('@login'), '@feature-dang-nhap');
    assert.equal(canonicalTag('@happy-path'), '@positive');
    assert.equal(canonicalTag('Tài sản trái phiếu'), '@feature-tai-san-trai-phieu');
  });

  it('keeps only one priority and one test type', () => {
    assert.deepEqual(
      normalizeTagList(['@p2', '@p0', '@negative', '@positive', '@web']),
      ['@p0', '@negative', '@web'],
    );
  });

  it('normalizes old/manual tag lines without rewriting scenario steps', () => {
    const source = `@login\nFeature: Đăng nhập\n\n  @critical @happy-path\n  Scenario: Thành công\n    Then "Trang chủ" is visible\n`;
    const result = normalizeFeatureTags(source);
    assert.equal(result.changed, true);
    assert.match(result.content, /^@feature-dang-nhap$/m);
    assert.match(result.content, /^  @p0 @positive$/m);
    assert.match(result.content, /Then "Trang chủ" is visible/);
  });

  it('derives generated tags from coverage rather than accepting model inventions', () => {
    const source = `@random-ai-tag\nFeature: Chức năng Thêm mã cổ phiếu\n\n  @whatever\n  Scenario: Thêm mã mới\n    Then "AAA" is visible\n\n  Scenario: Tự động lọc trùng\n    Then "AAA" appears once\n`;
    const tagged = applyGeneratedTagPolicy(
      source,
      'Chức năng Thêm mã cổ phiếu',
      [
        { id: 'REQ-001', priority: 'P0', rule: 'Thêm mã mới', expectedResult: 'Mã hiển thị' },
        { id: 'REQ-002', priority: 'P1', rule: 'Tự động lọc trùng', expectedResult: 'Không trùng kết quả' },
      ],
      [
        { requirementId: 'REQ-001', scenarios: ['Thêm mã mới'] },
        { requirementId: 'REQ-002', scenarios: ['Tự động lọc trùng'] },
      ],
    );
    assert.match(tagged, /^@feature-them-ma-co-phieu$/m);
    assert.match(tagged, /^  @p0 @smoke @positive$/m);
    assert.match(tagged, /^  @p1 @business-rule$/m);
    assert.doesNotMatch(tagged, /random-ai-tag|whatever/);
  });
});
