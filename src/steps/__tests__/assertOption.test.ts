/**
 * "Not in this dropdown" is a different claim from "not on screen".
 *
 * The vocabulary had only the second, so a requirement stating the first was
 * written as `"TK Thường" is not visible` — and that assertion can never pass
 * while the source field displays the very account it names. The dropdown was
 * correct, the product was correct, and two scenarios were permanently red.
 * Scope is the whole difference, so scope needs its own sentence.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { matchesVocabulary } from '../normalizer.js';
import { STEP_RULES } from '../vocabulary.js';

/** Parses a Gherkin step the way the binder does, returning the intent. */
function intentOf(line: string): Record<string, unknown> | undefined {
  for (const rule of STEP_RULES) {
    for (const pattern of rule.patterns) {
      const m = pattern.exec(line);
      if (m) return rule.build(m, (v: string) => v) as unknown as Record<string, unknown>;
    }
  }
  return undefined;
}

describe('the dropdown-scoped assertion', () => {
  it('is recognised as valid vocabulary, so the parser will not reject it', () => {
    assert.equal(matchesVocabulary('"TK Thường" is not an option in "Chọn TK nhận tiền"'), true);
    assert.equal(matchesVocabulary('"TK Ký Quỹ" is an option in "Chọn TK nhận tiền"'), true);
  });

  it('reads the value and the dropdown in the order the sentence states them', () => {
    assert.deepEqual(intentOf('"TK Thường" is not an option in "Chọn TK nhận tiền"'), {
      kind: 'assertOption',
      element: 'Chọn TK nhận tiền',
      option: 'TK Thường',
      expect: 'absent',
    });
  });

  it('has a positive form too', () => {
    assert.deepEqual(intentOf('"TK Ký Quỹ" is an option in "Chọn TK nhận tiền"'), {
      kind: 'assertOption',
      element: 'Chọn TK nhận tiền',
      option: 'TK Ký Quỹ',
      expect: 'present',
    });
  });

  it('accepts the Vietnamese spellings', () => {
    assert.equal(intentOf('"TK Thường" không có trong "Chọn TK nhận tiền"')?.expect, 'absent');
    assert.equal(intentOf('"TK Ký Quỹ" có trong "Chọn TK nhận tiền"')?.expect, 'present');
  });

  it('does not swallow the plain visibility forms', () => {
    // The two must stay distinguishable: one is about a list, the other about
    // the screen, and collapsing them is how this started.
    assert.equal(intentOf('"TK Thường" is not visible')?.kind, 'assertNotVisible');
    assert.equal(intentOf('"TK Thường" is visible')?.kind, 'assertVisible');
  });
});

describe('the generator', () => {
  it('is told which of the two to use, with the case that went wrong', async () => {
    const { TESTCASE_DESIGN_RULES } = await import('../../genspec/prompt.js');
    // A rule the model cannot connect to a situation is a rule it will not
    // apply, so the instruction carries the actual failure alongside it.
    assert.match(TESTCASE_DESIGN_RULES, /is not an option in/);
    assert.match(TESTCASE_DESIGN_RULES, /TUYỆT ĐỐI không viết thành/);
  });

  it('is told to capture a baseline before navigating away from it', async () => {
    const { TESTCASE_DESIGN_RULES } = await import('../../genspec/prompt.js');
    // "Được chuyển" lives on the transfer screen and not on the confirmation
    // screen, so a `remember` placed after the CHUYỂN click reads a field that
    // is not there. Stated with the real case, like the scoping rule above.
    assert.match(TESTCASE_DESIGN_RULES, /I remember phải đứng TRƯỚC/);
    assert.match(TESTCASE_DESIGN_RULES, /không có ở màn xác nhận/);
  });

  it('is told to stop once the rule under test is proven', async () => {
    const { TESTCASE_DESIGN_RULES } = await import('../../genspec/prompt.js');
    // Steps appended after the assertion test a different behaviour, and each
    // one is another way for the scenario to go red for an unrelated reason.
    assert.match(TESTCASE_DESIGN_RULES, /DỪNG ngay khi quy tắc/);
    assert.match(TESTCASE_DESIGN_RULES, /bấm ĐÓNG/);
  });

  it('offers the form in the vocabulary it is given', async () => {
    const { vocabularyDoc } = await import('../vocabulary.js');
    assert.match(vocabularyDoc(), /is not an option in/);
  });
});
