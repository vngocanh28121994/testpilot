import { describe, expect, it } from 'vitest';
import { removeScenario, scenarioNames } from '@/lib/gherkin';

const FEATURE = `@feature-chuyen-tien
Feature: Chuyển tiền

  @p0 @smoke
  Scenario: Một
    When I do a
    Then I see a

  @p1 @business-rule
  Scenario: Hai
    When I do b
    Then I see b

  @p1
  Scenario: Ba
    When I do c
`;

describe('removeScenario', () => {
  it('bỏ kịch bản ở giữa, giữ nguyên hai cái còn lại', () => {
    const out = removeScenario(FEATURE, 'Hai');
    expect(scenarioNames(out)).toEqual(['Một', 'Ba']);
    expect(out).not.toContain('I do b');
  });

  /** Tag đứng trên tên kịch bản thuộc về nó — bỏ sót là để lại tag mồ côi. */
  it('xoá cả khối tag của kịch bản đó', () => {
    expect(removeScenario(FEATURE, 'Hai')).not.toContain('@business-rule');
  });

  it('không đụng tag của kịch bản kế tiếp', () => {
    const out = removeScenario(FEATURE, 'Hai');
    expect(out).toContain('@p1\n  Scenario: Ba');
  });

  it('xoá được cái đầu và cái cuối', () => {
    expect(scenarioNames(removeScenario(FEATURE, 'Một'))).toEqual(['Hai', 'Ba']);
    expect(scenarioNames(removeScenario(FEATURE, 'Ba'))).toEqual(['Một', 'Hai']);
  });

  it('giữ nguyên tag và dòng Feature của file', () => {
    const out = removeScenario(FEATURE, 'Một');
    expect(out).toContain('@feature-chuyen-tien');
    expect(out).toContain('Feature: Chuyển tiền');
  });

  /** Không để lại khoảng trắng ba dòng ở chỗ vừa xoá. */
  it('không để lại dòng trống thừa', () => {
    expect(removeScenario(FEATURE, 'Hai')).not.toMatch(/\n\n\n/);
  });

  it('xoá hết thì còn lại phần đầu file', () => {
    let out = FEATURE;
    for (const name of ['Một', 'Hai', 'Ba']) out = removeScenario(out, name);
    expect(scenarioNames(out)).toEqual([]);
    expect(out).toContain('Feature: Chuyển tiền');
  });

  it('tên không tồn tại thì trả nguyên nội dung', () => {
    expect(removeScenario(FEATURE, 'Không có')).toBe(FEATURE);
  });
});
