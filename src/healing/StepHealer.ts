/**
 * What to do when a step ran clean and proved nothing.
 *
 * A tap that changes nothing is the signature of a missing action: the scenario
 * says "pick the suggestion" and stops, while the application also needs the ⊕
 * pressed again before anything is committed. Documents never mention this, so
 * generation cannot know it and no amount of asking up front would surface it —
 * the model is not uncertain, it is confidently incomplete. Only running the
 * thing reveals the gap.
 *
 * This module decides what may be done about it. It does not decide what is
 * true: a hypothesis is promoted by a green re-run, never by looking plausible.
 *
 * The gate is a separate, tested decision rather than a branch inside the
 * executor because healing means driving controls nobody scripted. Two limits
 * always apply: it never touches an element the registry does not know, and it
 * never guesses between hypotheses it cannot separate. A third — refusing to
 * experiment with destructive-looking controls — is available but off by
 * default, because this suite runs on a test account and the classifier is
 * keyword-based enough that "Xóa từ khóa" would block the screen it appears on.
 */
import { classifyActionRisk } from '../discovery/ActionRisk.js';
import type { QuestionKind } from '../core/history.js';

export interface StepHypothesis {
  /** Gherkin to insert, e.g. `I click "Thêm mã"`. */
  step: string;
  /** Registry element the step acts on. */
  elementId: string;
  /** Visible text of that control, used for risk classification. */
  elementText: string;
  /** Action kind, as ElementIntent names it. */
  action: string;
  /** Why this was proposed — shown to a human, and kept in the record. */
  reason: string;
  /** 0..1. Ordering only; it never by itself authorises an experiment. */
  confidence: number;
}

export interface StepHealingInput {
  /** Where the run got stuck. */
  context: { scenario: string; line: number; screen?: string };
  /** Ranked guesses, best first. May be empty. */
  hypotheses: StepHypothesis[];
  /** Element ids that exist in the registry — the only ones safe to drive. */
  knownElementIds: ReadonlySet<string>;
  /** Project-specific destructive words, from config. */
  extraHighRisk?: readonly string[];
  /**
   * Whether a destructive-looking control is off limits to experimentation.
   *
   * Off by default: this suite runs with a test account, and the classifier is
   * keyword-based, so it flags harmless controls — "Xóa từ khóa" merely clears
   * the search box — often enough that enforcing it would leave healing unable
   * to try anything on most screens. Turn it on for an environment where a
   * mistaken click costs something real.
   */
  blockHighRisk?: boolean;
}

export interface AskDecision {
  kind: 'ask';
  reason: string;
  question: {
    kind: QuestionKind;
    prompt: string;
    rationale: string;
    options: string[];
  };
}

export type StepHealingDecision =
  | { kind: 'try'; hypothesis: StepHypothesis }
  | AskDecision
  | { kind: 'give-up'; reason: string };

/**
 * Below this, the leading guess is not worth spending a run on — but it is
 * still worth showing a human, who may recognise it instantly.
 */
export const CONFIDENCE_FLOOR = 0.6;

/**
 * How far ahead the best guess must be before it counts as the answer rather
 * than one of several. Two near-equal hypotheses mean the system cannot tell
 * them apart, and picking the higher number would be a coin toss dressed up as
 * a decision.
 */
export const DECISIVE_MARGIN = 0.15;

const NONE_OF_THESE = 'Không phải phương án nào ở trên';

export function decideStepHealing(input: StepHealingInput): StepHealingDecision {
  const ranked = [...input.hypotheses].sort((a, b) => b.confidence - a.confidence);
  if (ranked.length === 0) {
    return {
      kind: 'give-up',
      reason: 'Không quan sát được hành động nào có thể tạo ra kết quả mong đợi.',
    };
  }

  // Candidates the system is permitted to drive at all. Excluded ones are not
  // merely deprioritised — they never enter the experiment, whatever their
  // confidence. They are still offered to a human further down, because a
  // person choosing "Xoá khỏi danh mục" deliberately is an entirely different
  // act from a machine trying it to see what happens.
  //
  // Excluding rather than blocking matters more than it looks: nearly every
  // screen carries some control whose label contains "xóa" or "huỷ" — the
  // harmless "Xóa từ khóa" sits next to the button actually wanted here — and
  // letting their presence veto the whole decision would turn healing into a
  // mechanism that only ever asks.
  const drivable = ranked.filter((h) =>
    (!input.blockHighRisk || !isHighRisk(h, input.extraHighRisk))
    // Not a risk rule: an element with no registry entry has no locator to
    // drive, so there is nothing to try even in principle.
    && input.knownElementIds.has(h.elementId));

  const best = drivable[0];
  if (!best) {
    return ask(input, ranked,
      input.blockHighRisk
        ? 'Mọi phương án đều là thao tác nguy hiểm hoặc dùng element chưa có trong registry — '
          + 'hệ thống không tự thử những thứ đó.'
        : 'Mọi phương án đều dùng element chưa có trong registry, không có gì để thử.');
  }
  if (best.confidence < CONFIDENCE_FLOOR) {
    // Nothing here carries evidence — every candidate is merely a control that
    // happens to be on screen. Asking anyway hands the operator an inventory of
    // the page and calls it a decision: one real failure produced "bấm tab",
    // "bấm dropdown nguồn", "bấm ô Tiền chuyển", when the actual cause was the
    // application disabling the button outside business hours. A question with
    // no hypothesis in it is worse than silence, because silence does not ask
    // somebody to choose.
    return {
      kind: 'give-up',
      reason: 'Không có phương án nào dựa trên bằng chứng — chỉ là các control đang hiển thị.',
    };
  }
  const second = drivable[1];
  if (second && best.confidence - second.confidence < DECISIVE_MARGIN) {
    return ask(input, ranked,
      'Nhiều phương án ngang nhau, hệ thống không phân biệt được cái nào đúng.');
  }
  return { kind: 'try', hypothesis: best };
}

function isHighRisk(h: StepHypothesis, extra?: readonly string[]): boolean {
  return classifyActionRisk(h.action, h.elementText, extra ?? []) === 'HIGH';
}

function ask(
  input: StepHealingInput,
  ranked: StepHypothesis[],
  reason: string,
): AskDecision {
  const where = `${input.context.scenario}, dòng ${input.context.line}`;
  return {
    kind: 'ask',
    reason,
    question: {
      kind: 'radio',
      prompt: 'Cần thêm thao tác nào để bước này tạo ra kết quả mong đợi?',
      rationale:
        `Bước tại ${where} chạy xong nhưng không làm thay đổi gì quan sát được. ${reason}`,
      // The escape hatch is always offered: an operator who recognises that all
      // the guesses are wrong needs a way to say so, and forcing a choice
      // between wrong answers puts a wrong answer into the record.
      options: [...ranked.map((h) => h.step), NONE_OF_THESE],
    },
  };
}

export interface ProposalInput {
  /**
   * Controls tapped earlier in this scenario, oldest first, with the label the
   * scenario used for each.
   */
  priorTaps: Array<{ elementId: string; label: string }>;
  /** Controls on this screen that resolve right now. */
  visibleNow: Array<{ elementId: string; label: string }>;
  /** The element of the step that proved nothing; re-tapping it is not a fix. */
  failingElementId: string;
}

/** Confidence given to re-pressing a control the scenario already used. */
const REUSE_CONFIDENCE = 0.8;
/** Confidence for a control that is merely present and untried. */
const PRESENT_CONFIDENCE = 0.4;

/**
 * Guesses drawn from what the run itself did and what is on screen.
 *
 * The strongest signal is deliberately narrow: a control the scenario already
 * pressed, still present, and not the one that just failed. Applications
 * routinely use one control to open a mode and the same control to commit it —
 * ⊕ opens the symbol field and ⊕ writes the symbol into the watchlist — and a
 * scenario written from a document describes the opening and forgets the
 * commit, because the document only described the feature once.
 *
 * Everything else visible is offered too, but weakly. A control that is merely
 * on screen is not evidence; it is a list for a human to choose from, which is
 * exactly what the low confidence causes to happen.
 */
export function proposeStepHypotheses(input: ProposalInput): StepHypothesis[] {
  const visible = new Map(input.visibleNow.map((v) => [v.elementId, v.label]));
  const proposals: StepHypothesis[] = [];
  const taken = new Set<string>([input.failingElementId]);

  // Most recent first: the control used to enter the current state is a better
  // candidate for leaving it than one pressed several screens ago.
  for (const tap of [...input.priorTaps].reverse()) {
    if (taken.has(tap.elementId) || !visible.has(tap.elementId)) continue;
    taken.add(tap.elementId);
    proposals.push({
      step: `I click "${tap.label}"`,
      elementId: tap.elementId,
      elementText: tap.label,
      action: 'tap',
      reason: `"${tap.label}" đã được dùng trước đó trong kịch bản và vẫn đang hiển thị — `
        + 'control mở một chế độ thường cũng là control xác nhận nó.',
      confidence: REUSE_CONFIDENCE,
    });
  }

  for (const [elementId, label] of visible) {
    if (taken.has(elementId)) continue;
    taken.add(elementId);
    proposals.push({
      step: `I click "${label}"`,
      elementId,
      elementText: label,
      action: 'tap',
      reason: `"${label}" đang hiển thị trên màn hình nhưng kịch bản chưa dùng.`,
      confidence: PRESENT_CONFIDENCE,
    });
  }

  return proposals;
}

/** Whether an answer rejected every proposal. */
export function answerRejectedAll(answer: string | undefined): boolean {
  return answer === NONE_OF_THESE;
}
