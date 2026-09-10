/**
 * Evidence-based confidence scorer for element candidates.
 *
 * Scores encode how reliable the match is, not how convenient the locator is.
 * All weights and thresholds are configurable so teams can tune for their
 * risk tolerance without touching business logic.
 *
 * Threshold policy (configurable):
 *   >= 85  → accept after verification
 *   60–84  → additional verification required
 *   < 60   → reject / report, do not interact
 */

import type { ElementIntent } from './ElementIntent.js';
import type { ObservedElement } from './UiObservation.js';
import { normalizeHumanText } from '../core/text.js';

export interface MatchScore {
  candidateId: string;
  score: number;
  reasons: string[];
  penalties: string[];
}

export interface ScorerWeights {
  exactTestId: number;
  exactResourceId: number;
  exactAccessibility: number;
  exactText: number;
  exactPlaceholder: number;
  /** Exact human text on a runtime-interactive control. */
  interactiveExactText: number;
  sameRole: number;
  sameScreen: number;
  sameParentContext: number;
  /** Only element on the screen that answers to the step's wording at all. */
  uniqueTextMatch: number;
  historicalSuccess: number;
  visualSimilarity: number;
  duplicatePenalty: number;
  hiddenPenalty: number;
  disabledPenalty: number;
  containerPenalty: number;
  indexOnlyPenalty: number;
  fragileXpathPenalty: number;
}

export interface ScorerThresholds {
  /** Score >= this → auto accept (still subject to verification). */
  autoAccept: number;
  /** Score >= this → proceed with verification before deciding. */
  requireVerification: number;
}

export const DEFAULT_WEIGHTS: ScorerWeights = {
  exactTestId: 40,
  exactResourceId: 40,
  exactAccessibility: 35,
  exactText: 20,
  exactPlaceholder: 20,
  interactiveExactText: 10,
  sameRole: 15,
  sameScreen: 15,
  sameParentContext: 15,
  uniqueTextMatch: 15,
  historicalSuccess: 20,
  visualSimilarity: 25,
  duplicatePenalty: -25,
  hiddenPenalty: -40,
  disabledPenalty: -20,
  containerPenalty: -30,
  indexOnlyPenalty: -40,
  fragileXpathPenalty: -30,
};

export const DEFAULT_THRESHOLDS: ScorerThresholds = {
  autoAccept: 85,
  requireVerification: 60,
};

export class ConfidenceScorer {
  constructor(
    private readonly weights: ScorerWeights = DEFAULT_WEIGHTS,
    private readonly thresholds: ScorerThresholds = DEFAULT_THRESHOLDS,
  ) {}

  score(
    intent: ElementIntent,
    candidate: ObservedElement,
    opts: {
      allCandidates?: ObservedElement[];
      screen?: string;
      historicalWinner?: boolean;
    } = {},
  ): MatchScore {
    const reasons: string[] = [];
    const penalties: string[] = [];
    let score = 0;

    const add = (points: number, reason: string) => {
      score += points;
      reasons.push(reason);
    };
    const penalize = (points: number, reason: string) => {
      score += points; // points is already negative
      penalties.push(reason);
    };

    // ── action compatibility ──────────────────────────────────────────────────
    // Typing needs something that can hold text. Scoring a button against an
    // `input` step let an unrelated control tie with the real field on the
    // "same screen" bonus alone — both landed on 15, and the field the step
    // meant had no way to win. Narrowing here raises precision; the signals
    // below only ever raised recall.
    //
    // Rejects on positive evidence only: an unknown `interactive` or an unknown
    // role stays in the running, because an observation that says nothing must
    // not be read as saying no.
    if (requiresEditable(intent.action)) {
      const blocked =
        candidate.interactive === false || NON_EDITABLE_ROLES.has(norm(candidate.role ?? ''));
      if (blocked) {
        return {
          candidateId: candidate.id,
          score: 0,
          reasons: [],
          penalties: [`action "${intent.action}" needs a control that accepts input`],
        };
      }
    }

    // ── positive signals ──────────────────────────────────────────────────────

    const intentKey = intent.id.split('.').pop() ?? '';

    if (candidate.testId) {
      if (intentKey && normId(candidate.testId) === normId(intentKey)) {
        add(this.weights.exactTestId, 'testId matches intent key');
      } else if (idOverlaps(candidate.testId, intentKey)) {
        add(Math.floor(this.weights.exactTestId * 0.8), 'testId khớp một phần với khoá element');
      } else if (intent.label && normId(candidate.testId).includes(normId(intent.label))) {
        add(Math.floor(this.weights.exactTestId * 0.8), 'testId partially matches label');
      }
    }

    if (candidate.resourceId) {
      if (intentKey && normId(candidate.resourceId) === normId(intentKey)) {
        add(this.weights.exactResourceId, 'resourceId khớp khoá element');
      } else if (idOverlaps(candidate.resourceId, intentKey)) {
        add(Math.floor(this.weights.exactResourceId * 0.8), 'resourceId khớp một phần với khoá element');
      } else if (intent.label && normId(candidate.resourceId).includes(normId(intent.label))) {
        add(this.weights.exactResourceId, 'resourceId matches label');
      }
    }

    if (candidate.accessibilityLabel && intent.label) {
      const m = textMatch(candidate.accessibilityLabel, intent.label);
      if (m === 'exact') {
        add(this.weights.exactAccessibility, 'accessibility label exact match');
      } else if (m !== 'none') {
        add(Math.floor(this.weights.exactAccessibility * 0.7), 'accessibility label partial match');
      }
    }

    if (candidate.text) {
      const target = intent.text ?? intent.label;
      if (target) {
        if (norm(candidate.text) === norm(target)) {
          add(this.weights.exactText, 'text exact match');
          if (candidate.interactive && actionRequiresInteraction(intent.action)) {
            add(this.weights.interactiveExactText, 'exact text on interactive control');
          }
          // Read-only assertions cannot cause an unsafe interaction. Exact
          // visible text on the known screen may enter verification, while the
          // duplicate-text ambiguity gate below still rejects unsafe matches.
          if (intent.action === 'assert-visible' || intent.action === 'assert-text') {
            add(5, 'exact text for read-only assertion');
          }
        } else {
          const m = textMatch(candidate.text, target);
          if (m !== 'none') add(Math.floor(this.weights.exactText * 0.7), 'text partial match');
        }
      }
    }

    if (candidate.placeholder) {
      // Falling back to the label is the point. A natural-language step never
      // produces `intent.placeholder`, so this whole signal used to be dead for
      // exactly the elements that need it most: on an input, the placeholder IS
      // the visible text, and often the only human-readable thing about it.
      const wanted = intent.placeholder ?? intent.label;
      if (wanted) {
        const m = textMatch(candidate.placeholder, wanted);
        if (m === 'exact') {
          add(this.weights.exactPlaceholder, 'placeholder exact match');
        } else if (m !== 'none' && requiresEditable(intent.action)) {
          // Approximate placeholder evidence only counts for a step that types.
          // A placeholder is the name of an input box; a step waiting for a
          // search *result* has no business matching one, and letting it do so
          // healed "Kết quả tìm kiếm đầu tiên" into the search field itself.
          add(Math.floor(this.weights.exactPlaceholder * 0.7), 'placeholder partial match');
        }
      }
    }

    if (candidate.role) {
      // The action implies a role when the step did not name one. Natural
      // language never sets `semanticRole`, so this signal was dead for every
      // Vietnamese step — and the weights above are calibrated as if it fires:
      // exact text on an interactive control reaches the 60 floor only with it.
      const expected = intent.semanticRole ?? expectedRoleFor(intent.action);
      if (expected && rolesCompatible(intent.action, expected, candidate.role)) {
        add(this.weights.sameRole, 'semantic role matches');
      }
    }

    if (opts.screen && intent.screen && norm(opts.screen) === norm(intent.screen)) {
      add(this.weights.sameScreen, 'same screen');
    }

    const region = candidate.attributes?.region;
    if (region && intent.context?.some((clue) => contextRelated(region, clue))) {
      add(this.weights.sameParentContext, `same region context: ${region}`);
    }

    if (opts.historicalWinner) {
      add(this.weights.historicalSuccess, 'historical success');
    }

    // ── penalties ─────────────────────────────────────────────────────────────

    const duplicates = (opts.allCandidates ?? []).filter(
      (c) =>
        c.id !== candidate.id &&
        c.text != null &&
        candidate.text != null &&
        norm(c.text) === norm(candidate.text),
    ).length;
    if (duplicates > 0) {
      penalize(this.weights.duplicatePenalty, `${duplicates} duplicate(s) with same text`);
    }

    // Being the only answer on the screen is evidence in itself — the mirror of
    // the duplicate penalty below. Ambiguity is what makes a match unsafe, so
    // its absence is worth saying out loud, especially in an app whose controls
    // carry no testId and no accessibility label.
    if (opts.allCandidates && hasTextEvidence(intent, candidate)) {
      const answering = opts.allCandidates.filter((c) => hasTextEvidence(intent, c));
      if (answering.length === 1 && answering[0]?.id === candidate.id) {
        add(this.weights.uniqueTextMatch, 'only element on screen matching the wording');
      }
    }

    if (!candidate.visible) {
      penalize(this.weights.hiddenPenalty, 'element not visible');
    }

    if (candidate.enabled === false) {
      penalize(this.weights.disabledPenalty, 'element disabled');
    }

    if (
      candidate.childIds != null &&
      candidate.childIds.length > 0 &&
      !candidate.interactive
    ) {
      penalize(this.weights.containerPenalty, 'container element (has children, not interactive)');
    }

    if (candidate.xpath != null && isFragileXpath(candidate.xpath)) {
      penalize(this.weights.fragileXpathPenalty, 'fragile positional xpath');
    }

    return { candidateId: candidate.id, score, reasons, penalties };
  }

  verdict(score: number): 'accept' | 'verify' | 'reject' {
    if (score >= this.thresholds.autoAccept) return 'accept';
    if (score >= this.thresholds.requireVerification) return 'verify';
    return 'reject';
  }

  get thresholdValues(): ScorerThresholds {
    return { ...this.thresholds };
  }
}

/** Normalise for label/text comparison. */
function norm(s: string): string {
  return normalizeHumanText(s);
}

/**
 * How well an on-screen string answers to what the step asked for.
 *
 * Steps are written the way a tester talks — "Ô nhập mã cổ phiếu" — while the
 * screen says "Nhập mã". Comparing them only one way round, and only as a
 * substring, scored that pair at zero: the label *contains* the screen text,
 * never the reverse. Every element whose name is a description rather than a
 * caption was invisible to discovery because of it.
 *
 * `subset` is the useful middle ground: every word the screen shows appears in
 * what the step asked for. It stays specific — "Nhập mã" against "Xoá mã" has
 * no subset relation — while tolerating the articles and qualifiers a person
 * adds when naming a thing rather than quoting it.
 */
export type TextMatch = 'exact' | 'contains' | 'subset' | 'none';

/**
 * Words that name the kind of control rather than the control itself.
 *
 * Written the way norm() leaves them — diacritics stripped — because that is
 * the form every comparison here works in.
 */
const FIELD_NOUNS = new Set(['o', 'truong', 'nut', 'input', 'field', 'button', 'icon']);

/**
 * Verbs that name what a control is *for*, not what it holds.
 *
 * "Ô tìm kiếm mã cổ phiếu" is a box for stock codes; the app labels it "Mã cổ
 * phiếu". Stopping the head at "tìm" made the two disagree, and — worse — made
 * the label agree with the unrelated global "Tìm kiếm" box, which does contain
 * that word. The thing being named comes after the verb, so the verb is skipped
 * the same way "ô" and "nút" already are.
 */
const ACTION_VERBS = new Set([
  'nhap', 'tim', 'kiem', 'chon', 'go', 'dien', 'search', 'enter', 'select', 'type',
]);

export function textMatch(screen: string, wanted: string): TextMatch {
  const a = norm(screen);
  const b = norm(wanted);
  if (!a || !b) return 'none';
  if (a === b) return 'exact';
  // The old rule, kept: the screen shows the asked-for phrase plus more.
  if (a.includes(b)) return 'contains';
  const words = (t: string) => t.split(/\s+/).filter(Boolean);
  const screenWords = words(a);
  const wantedWords = new Set(words(b));
  // A compact option token is often the entire on-screen caption while the
  // business step adds context: "Giá 1M" → "1M", "Kỳ YTD" → "YTD". These
  // tokens are self-identifying choices, unlike a generic fragment such as
  // "mã", which would pair with every ticker field on the screen.
  if (screenWords.length === 1) {
    const token = screenWords[0]!;
    return isCompactOptionToken(token) && wantedWords.has(token) ? 'subset' : 'none';
  }
  if (!screenWords.every((w) => wantedWords.has(w))) return 'none';

  // The words have to cover what the phrase is *about*. Vietnamese puts the
  // head noun first, so the label's first content word — past a field noun like
  // "ô" or "nút" — is the thing being named:
  //
  //   "Ô nhập mã cổ phiếu"        head "nhập"   ⊂ "Nhập mã"   → the same field
  //   "Kết quả tìm kiếm đầu tiên" head "kết"    ⊄ "Tìm kiếm"  → a different thing
  //
  // Both are two words out of five, so no ratio can separate them; what differs
  // is whether the match reaches the head. Without this, waiting for the first
  // search *result* healed onto the search *box*, and the next tap sat on an
  // input field until it timed out.
  const content = words(b);
  // Falls back to the unfiltered first word: a label made entirely of framing
  // words still has to be *about* something, and dropping every word would let
  // it match anything at all.
  const head = content.find((w) => !FIELD_NOUNS.has(w) && !ACTION_VERBS.has(w)) ?? content[0];
  return head && screenWords.includes(head) ? 'subset' : 'none';
}

/**
 * Short captions whose shape carries semantic meaning on its own.
 *
 * Keep this deliberately structural rather than vocabulary-specific: it
 * supports period/range choices such as 1M, 3Y, YTD and percentages without
 * turning every ordinary one-word overlap into a valid element match.
 */
function isCompactOptionToken(token: string): boolean {
  return /^(?:\d+[a-z%]+|[a-z]+\d+[a-z%]*|ytd|mtd|qtd|all)$/i.test(token);
}

/** Region headings need a little more tolerance than element labels. */
function contextRelated(region: string, clue: string): boolean {
  if (textMatch(region, clue) !== 'none' || textMatch(clue, region) !== 'none') return true;
  const meaningful = (value: string) => normalizeHumanText(value)
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !CONTEXT_STOP_WORDS.has(word));
  const regionWords = new Set(meaningful(region));
  const clueWords = meaningful(clue);
  return clueWords.filter((word) => regionWords.has(word)).length >= 2;
}

const CONTEXT_STOP_WORDS = new Set([
  'cac', 'ban', 'cho', 'nguoi', 'dung', 'trong', 'vong', 'tren', 'duoi',
  'this', 'that', 'with', 'from', 'visible',
]);

/** Normalise for id/resourceId/testId comparison (strip separators). */
/**
 * Định danh trong DOM có khớp khoá của element không, theo CẢ HAI CHIỀU.
 *
 * Luật cũ chỉ hỏi một chiều và chỉ so với NHÃN: `testId` phải chứa nhãn người
 * đọc. Nhãn ở đây viết bằng tiếng Việt ("Ô tên đăng nhập") còn app viết bằng
 * tiếng Anh ("username"), nên nó không bao giờ khớp — và cả một lớp bằng chứng
 * mạnh nhất bị bỏ qua.
 *
 * Đo trên máy thật ngày 2026-09-10: ô tài khoản mang `formcontrolname="username"`,
 * khoá element là `usernameField`. Chuỗi này chứa chuỗi kia, chỉ là chiều ngược
 * với thứ luật cũ kiểm. Kết quả: ô đúng và ô mật khẩu cùng được 30 điểm — bộ
 * chấm không phân biệt nổi hai ô ngay cạnh nhau.
 *
 * Ngưỡng 4 ký tự để "id" hay "el" không khớp bừa với mọi thứ.
 */
export function idOverlaps(candidateId: string, intentKey: string): boolean {
  const a = normId(candidateId);
  const b = normId(intentKey);
  if (a.length < 4 || b.length < 4) return false;
  return a.includes(b) || b.includes(a);
}

function normId(s: string): string {
  return normalizeHumanText(s).replace(/[\s_\-./]+/g, '');
}

/**
 * Whether an observed element answers to the step's wording in any way at all.
 *
 * Deliberately the union of every human-readable signal, not the strongest one:
 * this feeds the uniqueness test, which asks "is there anything else on screen
 * this step could possibly mean?" — a question a narrower rule would answer yes
 * to far too readily.
 */
function hasTextEvidence(intent: ElementIntent, el: ObservedElement): boolean {
  const wanted = intent.text ?? intent.label;
  if (!wanted) return false;
  const fields = [el.text, el.accessibilityLabel, el.placeholder];
  if (fields.some((f) => f && textMatch(f, wanted) !== 'none')) return true;
  const id = normId(wanted);
  return Boolean(
    (el.testId && normId(el.testId).includes(id)) ||
    (el.resourceId && normId(el.resourceId).includes(id)),
  );
}

/** Actions that put a value into a control, rather than merely activating it. */
function requiresEditable(action: string): boolean {
  return ['input', 'select'].includes(action);
}

/** Roles that can never accept typed input, whatever else they are. */
const NON_EDITABLE_ROLES = new Set(['button', 'link', 'heading', 'img', 'image', 'progressbar']);

function actionRequiresInteraction(action: string): boolean {
  return ['tap', 'input', 'select', 'check', 'uncheck', 'scroll'].includes(action);
}

/** Inputs backed by autocomplete widgets expose combobox/searchbox rather than
 * textbox. They are still valid targets for an input action. */
/** The role a step's verb implies, for a step that never named one. */
function expectedRoleFor(action: string): string | undefined {
  if (action === 'input') return 'textbox';
  if (action === 'select') return 'combobox';
  if (action === 'tap') return 'button';
  return undefined;
}

function rolesCompatible(action: string, expected: string, actual: string): boolean {
  if (norm(expected) === norm(actual)) return true;
  // `input` and `textarea` are what the web observer reports for a text field —
  // it reads the tag, not an ARIA role most pages never set. Leaving them out
  // meant the role signal, which the weights are calibrated to include, never
  // fired for the commonest control on the web: an ordinary <input>.
  if (action === 'input' && norm(expected) === 'textbox') {
    return ['input', 'textarea', 'combobox', 'searchbox', 'spinbutton'].includes(norm(actual));
  }
  if (action === 'select' && norm(expected) === 'combobox') {
    return ['select', 'listbox', 'menu', 'textbox'].includes(norm(actual));
  }
  // Anything a person taps to activate. Kept narrow on purpose: a generic
  // container is not made tappable by sitting under the finger.
  if (action === 'tap' && norm(expected) === 'button') {
    return ['link', 'menuitem', 'tab', 'option', 'checkbox', 'radio'].includes(norm(actual));
  }
  return false;
}

function isFragileXpath(xpath: string): boolean {
  return /\[\d+\]/.test(xpath) || (xpath.split('/').length > 6 && !xpath.includes('@id'));
}
