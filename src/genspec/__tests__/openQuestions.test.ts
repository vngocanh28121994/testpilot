/**
 * Letting the generator say "I don't know" instead of inventing.
 *
 * A document that omits a limit, a rule or a value leaves the model two
 * choices: make one up, or say so. A made-up value produces a scenario
 * indistinguishable from a correct one, which then passes or fails for a reason
 * nobody can check — and this codebase has spent days digging out of exactly
 * that shape of problem.
 *
 * The comment stays in the .feature file on purpose: it belongs beside the
 * scenario it concerns, where the next person to read that scenario meets it.
 * This module only collects them so they can also be seen together.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractGeneratedQuestions } from '../openQuestions.js';

const feature = `Feature: Chuyển tiền nội bộ

  # HỎI: Tài liệu không nói hạn mức tối đa mỗi lần chuyển là bao nhiêu.
  @p1 @negative
  Scenario: Không cho chuyển quá hạn mức
    When I click "Nút CHUYỂN"

  Scenario: Chuyển tiền thành công
    When I click "Nút CHUYỂN"
`;

describe('questions the generator left behind', () => {
  it('finds the question and where it is', () => {
    const [q] = extractGeneratedQuestions(feature);
    assert.equal(q?.source, 'generation');
    assert.match(q!.prompt, /hạn mức tối đa/);
    assert.equal(q!.line, 3);
  });

  it('attributes it to the scenario it sits above', () => {
    // Tags and further comments may separate the two; the question is about the
    // scenario, not about the tag line immediately below it.
    const [q] = extractGeneratedQuestions(feature);
    assert.equal(q?.scenario, 'Không cho chuyển quá hạn mức');
  });

  it('collects several without merging them', () => {
    const two = `# HỎI: Câu một?\nScenario: A\n\n# HỎI: Câu hai?\nScenario: B\n`;
    const found = extractGeneratedQuestions(two);
    assert.deepEqual(found.map((q) => q.scenario), ['A', 'B']);
  });

  it('tolerates the spacing a model actually writes', () => {
    for (const line of ['#HỎI:X?', '  #  hỏi :  X?', '# Hỏi: X?']) {
      assert.equal(extractGeneratedQuestions(line).length, 1, JSON.stringify(line));
    }
  });
});

describe('what is not a question', () => {
  it('ignores an ordinary comment', () => {
    assert.deepEqual(extractGeneratedQuestions('# Ghi chú: không phải câu hỏi\nScenario: A'), []);
  });

  it('ignores a step that merely contains the word', () => {
    assert.deepEqual(
      extractGeneratedQuestions('Scenario: A\n  When I click "HỎI: nút"'),
      [],
    );
  });

  it('leaves a question with no scenario after it unattributed rather than guessing', () => {
    const [q] = extractGeneratedQuestions('Feature: F\n# HỎI: Câu cuối file?\n');
    assert.equal(q?.scenario, undefined);
    assert.match(q!.prompt, /Câu cuối file/);
  });
});
