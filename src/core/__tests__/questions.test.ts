/**
 * The gate that stops the system guessing.
 *
 * Every rule here exists to keep one property: a run that continues past a
 * question did so because a human decided, not because the code found a way to
 * carry on. The failure mode being designed against is a plausible default — it
 * looks exactly like an answer until the day it is wrong.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  askQuestions,
  pendingQuestions,
  QuestionError,
  singleAnswer,
  submitAnswers,
} from '../questions.js';
import type { WorkflowQuestion, WorkflowRun } from '../history.js';

const run = (): WorkflowRun => ({
  id: 'r1',
  feature: 'F',
  kind: 'workflow',
  startedAt: new Date().toISOString(),
  status: 'running',
  stages: [],
  log: [],
});

const ask = (over: Partial<WorkflowQuestion> = {}) => ({
  kind: 'radio' as const,
  prompt: 'Sau khi chọn gợi ý, cần làm gì để mã vào danh mục?',
  options: ['Bấm "Thêm mã" lần nữa', 'Bấm Enter', 'Không cần gì thêm'],
  source: 'healing' as const,
  ...over,
});

describe('asking', () => {
  it('pauses the run', () => {
    const r = run();
    askQuestions(r, [ask()]);
    assert.equal(r.status, 'waiting_input');
    assert.equal(pendingQuestions(r).length, 1);
  });

  it('does not pause when there is nothing to ask', () => {
    const r = run();
    // A healing pass that ended up certain must carry on, not stop to ask zero
    // questions and wait forever for an answer nobody was prompted for.
    askQuestions(r, []);
    assert.equal(r.status, 'running');
  });

  it('keeps earlier questions when more arrive', () => {
    const r = run();
    askQuestions(r, [ask()]);
    askQuestions(r, [ask({ prompt: 'Danh mục nào?' })]);
    assert.equal(r.questions?.length, 2);
    assert.equal(new Set(r.questions!.map((q) => q.id)).size, 2);
  });

  it('refuses a choice question that offers no real choice', () => {
    const r = run();
    assert.throws(
      () => askQuestions(r, [ask({ options: ['Chỉ một'] })]),
      QuestionError,
    );
    assert.equal(r.status, 'running');
  });
});

describe('answering', () => {
  it('resumes the run only once nothing is left open', () => {
    const r = run();
    const [a, b] = askQuestions(r, [ask(), ask({ prompt: 'Danh mục nào?' })]);

    const first = submitAnswers(r, [{ id: a!.id, values: ['Bấm Enter'] }]);
    assert.equal(first.remaining, 1);
    assert.equal(r.status, 'waiting_input', 'một câu chưa trả lời thì vẫn phải dừng');

    const second = submitAnswers(r, [{ id: b!.id, values: ['Bấm Enter'] }]);
    assert.equal(second.remaining, 0);
    assert.equal(r.status, 'running');
  });

  it('records when the decision was made', () => {
    const r = run();
    const [q] = askQuestions(r, [ask()]);
    submitAnswers(r, [{ id: q!.id, values: ['Bấm Enter'] }]);
    assert.ok(r.questions![0]!.answeredAt);
    assert.equal(singleAnswer(r.questions![0]!), 'Bấm Enter');
  });

  it('rejects an answer that was never offered', () => {
    const r = run();
    const [q] = askQuestions(r, [ask()]);
    assert.throws(
      () => submitAnswers(r, [{ id: q!.id, values: ['Đặt lệnh mua'] }]),
      QuestionError,
    );
    assert.equal(r.status, 'waiting_input');
  });

  it('rejects an unknown question id rather than ignoring it', () => {
    const r = run();
    askQuestions(r, [ask()]);
    assert.throws(() => submitAnswers(r, [{ id: 'khong-ton-tai', values: ['x'] }]), QuestionError);
  });

  it('requires exactly one choice for radio', () => {
    const r = run();
    const [q] = askQuestions(r, [ask()]);
    assert.throws(
      () => submitAnswers(r, [{ id: q!.id, values: ['Bấm Enter', 'Không cần gì thêm'] }]),
      QuestionError,
    );
  });

  it('requires text questions to carry actual text', () => {
    const r = run();
    const [q] = askQuestions(r, [ask({ kind: 'text', options: undefined })]);
    assert.throws(() => submitAnswers(r, [{ id: q!.id, values: ['   '] }]), QuestionError);
  });

  it('treats an empty checkbox answer as a decision, not an omission', () => {
    const r = run();
    const [q] = askQuestions(r, [ask({ kind: 'checkbox' })]);
    // "None of these apply" is information, and the run should proceed on it.
    submitAnswers(r, [{ id: q!.id, values: [] }]);
    assert.equal(r.status, 'running');
    assert.deepEqual(r.questions![0]!.answer, []);
  });

  it('keeps answered questions as the record of why the run did what it did', () => {
    const r = run();
    const [q] = askQuestions(r, [ask()]);
    submitAnswers(r, [{ id: q!.id, values: ['Bấm Enter'] }]);
    assert.equal(r.questions?.length, 1);
    assert.equal(pendingQuestions(r).length, 0);
  });
});
