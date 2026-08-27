/**
 * The gate for what the system must not guess.
 *
 * A workflow reaches this point in two ways. Generation finds the source
 * document genuinely ambiguous, and no amount of looking at the application
 * would settle it — which watchlist is "the" watchlist is a business fact, not
 * an observable one. Healing forms a hypothesis it is not entitled to test,
 * because trying it would click something risky on a real account.
 *
 * Both end in the same place: a question with a typed answer, a durable pause,
 * and a run that continues only once a human has decided. The alternative is a
 * plausible guess, which is indistinguishable from knowledge right up until it
 * is wrong.
 */
import type { QuestionKind, WorkflowQuestion, WorkflowRun } from './history.js';

export interface AnswerSubmission {
  id: string;
  /** One entry for text/radio, zero or more for checkbox. */
  values: string[];
}

export class QuestionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuestionError';
  }
}

/** Questions still waiting on a human. */
export function pendingQuestions(run: WorkflowRun): WorkflowQuestion[] {
  return (run.questions ?? []).filter((q) => !q.answeredAt);
}

/**
 * Attach questions to a run and pause it.
 *
 * Adding no questions is not an error but must not pause the run: a healing
 * pass that ends up certain should carry on rather than stopping to ask
 * nothing.
 */
export function askQuestions(
  run: WorkflowRun,
  questions: Array<Omit<WorkflowQuestion, 'id'> & { id?: string }>,
): WorkflowQuestion[] {
  if (questions.length === 0) return [];
  const existing = run.questions ?? [];
  const added = questions.map((q, index) => ({
    ...q,
    id: q.id ?? `${run.id}-q${existing.length + index + 1}`,
  }));
  for (const question of added) validateShape(question);
  run.questions = [...existing, ...added];
  run.status = 'waiting_input';
  return added;
}

/**
 * Record answers and report whether the run may now continue.
 *
 * Rejects unknown ids and answers that do not fit the question rather than
 * coercing them. A checkbox silently accepting a value that was never offered
 * would put an unreviewed string into the decision record, and the whole point
 * of asking was to avoid unreviewed strings.
 */
export function submitAnswers(
  run: WorkflowRun,
  submissions: AnswerSubmission[],
): { remaining: number } {
  const byId = new Map((run.questions ?? []).map((q) => [q.id, q]));
  for (const submission of submissions) {
    const question = byId.get(submission.id);
    if (!question) {
      throw new QuestionError(`Không có câu hỏi nào mang id "${submission.id}".`);
    }
    validateAnswer(question, submission.values);
    question.answer = submission.values;
    question.answeredAt = new Date().toISOString();
  }
  const remaining = pendingQuestions(run).length;
  // Only the last answer lifts the pause. Restoring `running` while questions
  // are still open would let the workflow resume on a half-made decision.
  if (remaining === 0 && run.status === 'waiting_input') run.status = 'running';
  return { remaining };
}

/** The answer as a single string, for the text/radio cases that have one. */
export function singleAnswer(question: WorkflowQuestion): string | undefined {
  return question.answer?.[0];
}

function validateShape(question: WorkflowQuestion): void {
  if (!question.prompt.trim()) {
    throw new QuestionError('Câu hỏi phải có nội dung.');
  }
  if (needsOptions(question.kind) && (question.options?.length ?? 0) < 2) {
    throw new QuestionError(
      `Câu hỏi "${question.prompt}" kiểu ${question.kind} cần ít nhất 2 lựa chọn.`,
    );
  }
}

function validateAnswer(question: WorkflowQuestion, values: string[]): void {
  if (question.kind === 'text') {
    if (values.length !== 1 || !values[0]?.trim()) {
      throw new QuestionError(`Câu hỏi "${question.prompt}" cần một câu trả lời dạng chữ.`);
    }
    return;
  }
  if (question.kind === 'radio' && values.length !== 1) {
    throw new QuestionError(`Câu hỏi "${question.prompt}" cần chọn đúng một lựa chọn.`);
  }
  // An empty checkbox answer is a real answer ("none of these apply") and is
  // kept as such; what is rejected is a value that was never on the list.
  const offered = new Set(question.options ?? []);
  for (const value of values) {
    if (!offered.has(value)) {
      throw new QuestionError(
        `"${value}" không nằm trong các lựa chọn của câu hỏi "${question.prompt}".`,
      );
    }
  }
}

function needsOptions(kind: QuestionKind): boolean {
  return kind === 'radio' || kind === 'checkbox';
}
