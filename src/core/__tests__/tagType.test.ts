/**
 * Loại hành vi của một scenario: ai quyết định, và bắt hụt thì sao.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyGeneratedTagPolicy } from '../tagTaxonomy.js';

const REQS = [
  { id: 'R1', priority: 'P1' as const, rule: 'Dữ liệu không hợp lệ thì chặn', expectedResult: 'Hiện cảnh báo' },
];
const maps = (name: string) => [{ requirementId: 'R1', scenarios: [name] }];

function tagsOf(gherkin: string, name: string): string[] {
  const out = applyGeneratedTagPolicy(gherkin, 'X', REQS, maps(name));
  const lines = out.split('\n');
  const at = lines.findIndex((line) => line.includes(`Scenario: ${name}`));
  assert.ok(at > 0, 'không tìm thấy scenario trong kết quả');
  return (lines[at - 1] ?? '').trim().split(/\s+/).filter(Boolean);
}

const feature = (tags: string, name: string) =>
  `@feature-x\nFeature: X\n\n  ${tags}\n  Scenario: ${name}\n    When I do\n`;

describe('loại hành vi do model gán', () => {
  /**
   * tagPolicyPrompt() bảo model "mỗi scenario có đúng một loại", rồi chính sách
   * này vứt câu trả lời đó đi và dò lại bằng 19 cụm từ khoá. Hậu quả thấy ngay
   * trên feature thật: "Tiểu khoản đã chọn ở nguồn không xuất hiện ở dropdown
   * đích" — một quy tắc loại trừ rõ ràng — bị gọi là luồng thành công, chỉ vì
   * "không xuất hiện" không có trong danh sách.
   */
  it('giữ nguyên loại model đã gán', () => {
    const name = 'Tiểu khoản đã chọn ở nguồn không xuất hiện ở dropdown đích';
    assert.ok(tagsOf(feature('@p1 @business-rule', name), name).includes('@business-rule'));
  });

  it('model không gán thì mới dò từ khoá', () => {
    const name = 'Nhập dữ liệu sai';
    assert.ok(tagsOf(feature('@p1', name), name).includes('@negative'));
  });

  /** Hai loại là đã phá chính luật được giao; lúc đó không đoán được ý nào. */
  it('model gán hai loại thì không tin, quay về dò từ khoá', () => {
    const name = 'Nhập dữ liệu sai';
    const tags = tagsOf(feature('@p1 @positive @boundary', name), name);
    assert.ok(tags.includes('@negative'), `giữ nhầm loại mâu thuẫn: ${tags.join(' ')}`);
  });

  it('vẫn đúng một loại trên mỗi scenario', () => {
    const name = 'Nhập dữ liệu sai';
    const types = tagsOf(feature('@p1 @business-rule', name), name)
      .filter((tag) => ['@positive', '@negative', '@boundary', '@business-rule'].includes(tag));
    assert.equal(types.length, 1);
  });
});

/**
 * `\b` của JavaScript chỉ biết chữ cái ASCII, nên một cụm tiếng Việt chỉ khớp
 * khi ký tự đầu và cuối tình cờ là chữ ASCII. Ba cụm rơi ra ngoài và không bao
 * giờ khớp — trong đó hai cụm phổ biến nhất để nói về ca lỗi.
 */
describe('dò từ khoá tiếng Việt', () => {
  const cases: Array<[string, string]> = [
    ['Dữ liệu không hợp lệ', '@negative'],   // kết thúc bằng "ệ"
    ['Hệ thống không thể xử lý', '@negative'], // kết thúc bằng "ể"
    ['Kiểm tra độ dài tối đa', '@boundary'],   // mở đầu bằng "đ"
  ];
  for (const [name, expected] of cases) {
    it(`bắt được "${name}" → ${expected}`, () => {
      assert.ok(tagsOf(feature('@p1', name), name).includes(expected));
    });
  }

  /**
   * Biên vẫn phải là biên. Dùng requirement trung tính: scenarioType() gộp cả
   * rule và expectedResult vào chuỗi cần dò, nên REQS mặc định (có sẵn chữ
   * "không hợp lệ") sẽ tự làm test này xanh dù regex có sai.
   */
  it('không khớp khi cụm dính liền chữ khác', () => {
    const name = 'Xem báo lỗiX của hệ thống';
    const neutral = [{ id: 'R1', priority: 'P1' as const, rule: 'Xem thông tin', expectedResult: 'Hiển thị' }];
    const out = applyGeneratedTagPolicy(feature('@p1', name), 'X', neutral, maps(name));
    const line = out.split('\n')[out.split('\n').findIndex((l) => l.includes(`Scenario: ${name}`)) - 1] ?? '';
    assert.ok(!line.includes('@negative'), `khớp nhầm: ${line.trim()}`);
  });
});
