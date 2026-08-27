/**
 * The loop, driven against the failure it was designed from.
 *
 * The scenario is the real one: clicking the suggestion filled the search box
 * with "VIC," and committed nothing, so the assertion on the next line found no
 * VIC row. The fix was one step — press ⊕ again — and it took a day and six
 * wrong explanations to find by hand.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  healScenarioSteps,
  type ScenarioAttempt,
  type StepPatch,
} from '../StepHealingLoop.js';
import type { StepHypothesis } from '../StepHealer.js';

const addButton = (over: Partial<StepHypothesis> = {}): StepHypothesis => ({
  step: 'I click "Thêm mã"',
  elementId: 'priceBoard.addStockButton',
  elementText: 'Thêm mã',
  action: 'tap',
  reason: '"Thêm mã" đã được dùng trước đó và vẫn hiển thị',
  confidence: 0.8,
  ...over,
});

const known = new Set(['priceBoard.addStockButton', 'addStockModal.clearButton']);

/** The run that triggered healing: line 13 proved nothing, line 14 failed. */
const failing = (): ScenarioAttempt => ({
  passed: false,
  steps: [
    { line: 11, text: 'I click "Thêm mã"', status: 'passed', isTap: true },
    { line: 12, text: 'I enter "VIC" into "Ô tìm kiếm mã cổ phiếu"', status: 'passed' },
    { line: 13, text: 'I click "Kết quả tìm kiếm đầu tiên"', status: 'unverified', isTap: true },
    { line: 14, text: '"Dòng cổ phiếu trong danh mục" shows "VIC" exactly "1" times', status: 'failed' },
  ],
});

const green = (): ScenarioAttempt => ({
  passed: true,
  steps: failing().steps.map((s) => ({ ...s, status: 'passed' as const })),
});

describe('the case it was built for', () => {
  it('finds the missing step and verifies it by replaying', async () => {
    let replayed: StepPatch[] = [];
    const outcome = await healScenarioSteps({
      scenario: 'Thêm mã cổ phiếu mới vào danh mục',
      baseline: failing(),
      knownElementIds: known,
      propose: async () => [addButton()],
      runPatched: async (patches) => { replayed = patches; return green(); },
    });

    assert.equal(outcome.kind, 'healed');
    assert.equal(outcome.kind === 'healed' && outcome.patches.length, 1);
    assert.deepEqual(
      replayed.map((p) => [p.afterLine, p.step]),
      [[13, 'I click "Thêm mã"']],
      'bản vá phải được chèn ngay sau bước không chứng minh được',
    );
  });

  it('proves nothing on plausibility alone — the replay decides', async () => {
    // Same confident hypothesis, but the replay stays red. It must not be
    // reported as healed just because it looked right.
    const outcome = await healScenarioSteps({
      scenario: 'S',
      baseline: failing(),
      knownElementIds: known,
      propose: async () => [addButton()],
      runPatched: async () => failing(),
      maxAttempts: 1,
    });
    assert.equal(outcome.kind, 'exhausted');
  });
});

describe('what it refuses to touch', () => {
  it('leaves a passing scenario alone however many steps are unverified', async () => {
    // Three steps in the real suite are permanently unverified and perfectly
    // fine; "fixing" them would insert junk into scenarios that work.
    let ran = false;
    const outcome = await healScenarioSteps({
      scenario: 'S',
      baseline: { ...green(), steps: green().steps.map((s, i) => i === 2 ? { ...s, status: 'unverified' } : s) },
      knownElementIds: known,
      propose: async () => [addButton()],
      runPatched: async () => { ran = true; return green(); },
    });
    assert.equal(outcome.kind, 'not-applicable');
    assert.equal(ran, false, 'không được tiêu tốn lượt chạy nào');
  });

  it('stops when a failure has no unverified step to blame', async () => {
    const outcome = await healScenarioSteps({
      scenario: 'S',
      baseline: {
        passed: false,
        steps: [{ line: 14, text: 'assert', status: 'failed' }],
      },
      knownElementIds: known,
      propose: async () => [addButton()],
      runPatched: async () => green(),
    });
    assert.equal(outcome.kind, 'exhausted');
    assert.match(outcome.kind === 'exhausted' ? outcome.reason : '', /ngoài phạm vi/);
  });
});

describe('not making things worse', () => {
  it('discards a patch that breaks a step which was working', async () => {
    const broken: ScenarioAttempt = {
      passed: false,
      steps: [
        { line: 11, text: 'I click "Thêm mã"', status: 'passed', isTap: true },
        { line: 12, text: 'I enter "VIC" into "Ô tìm kiếm mã cổ phiếu"', status: 'failed' },
        { line: 13, text: 'I click "Kết quả tìm kiếm đầu tiên"', status: 'unverified', isTap: true },
        { line: 14, text: '"Dòng cổ phiếu trong danh mục" shows "VIC" exactly "1" times', status: 'failed' },
      ],
    };
    const outcome = await healScenarioSteps({
      scenario: 'S',
      baseline: failing(),
      knownElementIds: known,
      propose: async () => [addButton()],
      runPatched: async () => broken,
    });
    assert.equal(outcome.kind, 'exhausted');
    assert.equal(outcome.kind === 'exhausted' && outcome.patches.length, 0, 'bản vá xấu không được giữ');
    assert.match(outcome.kind === 'exhausted' ? outcome.reason : '', /làm hỏng bước đang chạy được/);
  });
});

describe('progress is not regression', () => {
  it('keeps a patch that gets further, even though a new step now fails', async () => {
    // The earlier run aborted at line 14 and never reached line 16 at all. A
    // patch that gets past 14 and fails at 16 has moved forward; rejecting it
    // as a regression would discard the patches that are working.
    const further: ScenarioAttempt = {
      passed: false,
      steps: [
        { line: 11, text: 'I click "Thêm mã"', status: 'passed', isTap: true },
        { line: 12, text: 'I enter "VIC" into "Ô tìm kiếm mã cổ phiếu"', status: 'passed' },
        { line: 13, text: 'I click "Kết quả tìm kiếm đầu tiên"', status: 'passed', isTap: true },
        { line: 14, text: '"Dòng cổ phiếu trong danh mục" shows "VIC" exactly "1" times', status: 'passed' },
        { line: 16, text: 'I click "Đóng"', status: 'failed', isTap: true },
      ],
    };
    const outcome = await healScenarioSteps({
      scenario: 'S',
      baseline: failing(),
      knownElementIds: known,
      propose: async () => [addButton()],
      runPatched: async () => further,
      maxAttempts: 1,
    });
    assert.equal(outcome.kind, 'exhausted', 'chưa xanh nên vẫn là exhausted');
    assert.equal(outcome.kind === 'exhausted' && outcome.patches.length, 1,
      'nhưng bản vá có tác dụng phải được giữ lại');
  });
});

describe('when it cannot decide alone', () => {
  it('asks, and hands over the progress it already verified', async () => {
    const twoRounds: ScenarioAttempt = {
      passed: false,
      steps: [
        { line: 11, text: 'I click "Thêm mã"', status: 'passed', isTap: true },
        { line: 13, text: 'I click "Kết quả tìm kiếm đầu tiên"', status: 'passed', isTap: true },
        { line: 15, text: 'I click "Xác nhận"', status: 'unverified', isTap: true },
        { line: 16, text: 'assert', status: 'failed' },
      ],
    };
    let round = 0;
    const outcome = await healScenarioSteps({
      scenario: 'S',
      baseline: failing(),
      knownElementIds: known,
      // First round is decisive; second offers two guesses too close to call.
      propose: async () => (round++ === 0
        ? [addButton()]
        : [addButton({ confidence: 0.8 }), addButton({ step: 'I press "Enter"', confidence: 0.75 })]),
      runPatched: async () => twoRounds,
    });

    assert.equal(outcome.kind, 'question');
    assert.equal(outcome.kind === 'question' && outcome.patches.length, 1,
      'bản vá đã xác minh phải được giữ lại, không bắt người dùng làm lại');
    assert.match(
      outcome.kind === 'question' ? outcome.question.rationale : '',
      /ngang nhau/,
    );
  });
});

describe('budget', () => {
  it('never spends more replays than it was given', async () => {
    let runs = 0;
    await healScenarioSteps({
      scenario: 'S',
      baseline: failing(),
      knownElementIds: known,
      propose: async () => [addButton()],
      runPatched: async () => { runs++; return failing(); },
      maxAttempts: 3,
    });
    assert.equal(runs, 3);
  });
});
