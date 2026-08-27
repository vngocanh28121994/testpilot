/**
 * Turning a failed scenario into a proposed fix, one verified step at a time.
 *
 * The loop exists because a hypothesis is worth nothing until it has been run.
 * Six plausible explanations were produced by hand for one failure here and all
 * six were wrong; what settled it was executing the thing. So every candidate
 * step is inserted in memory and the scenario is replayed, and the replay is
 * both the verification of that patch and the observation of what is still
 * missing. That is why iterating costs almost nothing beyond the run that
 * verification already required.
 *
 * What it will not do is chase every unverified step. Most of them are
 * unverifiable rather than broken — clicking a suggestion genuinely changes
 * nothing until the entry is committed, and the scenario containing it passes.
 * Healing engages only where a scenario actually failed, because there the
 * unverified step is the suspect for the failure.
 */
import type { StepStatus } from '../core/types.js';
import {
  decideStepHealing,
  type AskDecision,
  type StepHypothesis,
} from './StepHealer.js';

export interface AttemptStep {
  line: number;
  text: string;
  status: StepStatus;
  elementId?: string;
  /** Whether this step is an action that could have produced the missing effect. */
  isTap?: boolean;
}

export interface ScenarioAttempt {
  passed: boolean;
  steps: AttemptStep[];
}

export interface StepPatch {
  /** Inserted immediately after the step that proved nothing. */
  afterLine: number;
  step: string;
  elementId: string;
  reason: string;
}

export interface HealingLoopDeps {
  scenario: string;
  /** The failing run that triggered healing. */
  baseline: ScenarioAttempt;
  /** Replay the scenario with these steps inserted. Nothing is written to disk. */
  runPatched: (patches: StepPatch[]) => Promise<ScenarioAttempt>;
  /**
   * Guesses for the step at this line, gathered from the live page. Must be
   * collected while the run is still stopped there — the web driver closes the
   * page when a scenario ends, and a query afterwards observes nothing.
   */
  propose: (line: number) => Promise<StepHypothesis[]>;
  knownElementIds: ReadonlySet<string>;
  blockHighRisk?: boolean;
  /** Replays allowed before giving up. Each one is a full scenario run. */
  maxAttempts?: number;
}

export type HealingOutcome =
  | { kind: 'healed'; patches: StepPatch[] }
  | { kind: 'question'; question: AskDecision['question']; patches: StepPatch[] }
  | { kind: 'exhausted'; patches: StepPatch[]; reason: string }
  | { kind: 'not-applicable'; reason: string };

export const DEFAULT_MAX_ATTEMPTS = 3;

export async function healScenarioSteps(deps: HealingLoopDeps): Promise<HealingOutcome> {
  const budget = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (deps.baseline.passed) {
    return {
      kind: 'not-applicable',
      reason: 'Kịch bản đã xanh — bước chưa chứng minh được không phải lỗi cần chữa.',
    };
  }

  const patches: StepPatch[] = [];
  let current = deps.baseline;

  for (let attempt = 0; attempt < budget; attempt++) {
    const target = suspectTap(current);
    if (!target) {
      return {
        kind: 'exhausted',
        patches,
        reason: 'Kịch bản fail nhưng trước chỗ hỏng không có thao tác nào để quy trách nhiệm — '
          + 'nguyên nhân nằm ngoài phạm vi healing bước.',
      };
    }

    const decision = decideStepHealing({
      context: { scenario: deps.scenario, line: target.line },
      hypotheses: await deps.propose(target.line),
      knownElementIds: deps.knownElementIds,
      ...(deps.blockHighRisk === undefined ? {} : { blockHighRisk: deps.blockHighRisk }),
    });

    if (decision.kind === 'ask') {
      // Progress already verified is carried out with the question: the
      // operator should be answering what is left, not redoing what worked.
      return { kind: 'question', question: decision.question, patches };
    }
    if (decision.kind === 'give-up') {
      return { kind: 'exhausted', patches, reason: decision.reason };
    }

    const candidate: StepPatch = {
      afterLine: target.line,
      step: decision.hypothesis.step,
      elementId: decision.hypothesis.elementId,
      reason: decision.hypothesis.reason,
    };
    const next = await deps.runPatched([...patches, candidate]);

    const broke = newFailures(current, next);
    if (broke.length > 0) {
      // A patch that turns a green step red is not a partial success to build
      // on. Keeping it and continuing would trade a known failure for an
      // unknown one and call the result progress.
      return {
        kind: 'exhausted',
        patches,
        reason: `Bước đề xuất "${candidate.step}" làm hỏng bước đang chạy được `
          + `(${broke.join('; ')}) nên đã bị loại.`,
      };
    }

    patches.push(candidate);
    current = next;
    if (next.passed) return { kind: 'healed', patches };
  }

  return {
    kind: 'exhausted',
    patches,
    reason: `Đã thử ${budget} lượt mà kịch bản vẫn chưa xanh.`,
  };
}

/**
 * The action most likely to be missing something: the last one before the
 * failure.
 *
 * Selecting by the `unverified` flag was the first design and it does not hold.
 * The flag clears whenever the watched element's contents moved at all, and on
 * this application selecting a symbol already in the watchlist scrolls the board
 * to it — every row changes, the tap reads as proven, and the assertion it was
 * meant to satisfy still fails. The failure that follows is the reliable signal;
 * the flag is at best a hint.
 */
function suspectTap(attempt: ScenarioAttempt): AttemptStep | undefined {
  const failedAt = attempt.steps.findIndex((step) => step.status === 'failed');
  const before = failedAt === -1 ? attempt.steps : attempt.steps.slice(0, failedAt);
  return [...before].reverse().find((step) => step.isTap);
}

/**
 * Steps that were working and are not any more.
 *
 * Only steps that actually succeeded before count. A patch that lets the
 * scenario get further will reach steps the earlier run aborted before ever
 * executing, and one of those failing is progress — the run got somewhere it
 * had never been. Treating any newly-failing step as a regression would reject
 * exactly the patches that are doing their job.
 *
 * Compared by text rather than line: inserting a step shifts every line after
 * it, so line numbers cannot be matched across attempts.
 */
function newFailures(before: ScenarioAttempt, after: ScenarioAttempt): string[] {
  const workedBefore = new Set(
    before.steps
      .filter((s) => s.status === 'passed' || s.status === 'healed' || s.status === 'unverified')
      .map((s) => s.text),
  );
  return after.steps
    .filter((s) => s.status === 'failed' && workedBefore.has(s.text))
    .map((s) => s.text);
}
