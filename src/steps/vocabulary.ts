import type { Intent } from '../core/types.js';

/**
 * The controlled Gherkin vocabulary.
 *
 * This file is the contract between the LLM generator and the runtime. The
 * generator is given exactly these patterns and is not allowed to invent new
 * step wording; anything unmatched fails at bind time, loudly, before a single
 * device minute is spent. A free-form step library is what turns a generated
 * BDD suite into unmaintainable sludge.
 *
 * Vietnamese aliases exist because the source documents (Confluence) and the
 * people reviewing the scenarios are Vietnamese; the intents are identical.
 */

export interface StepRule {
  id: string;
  patterns: RegExp[];
  /** `ref` resolves a quoted element label or id to a registry element id. */
  build: (m: RegExpMatchArray, ref: (labelOrId: string) => string) => Intent;
  /** Shown to the LLM in the generation prompt. */
  doc: string;
}

const Q = '"([^"]+)"';

export const STEP_RULES: StepRule[] = [
  {
    id: 'launch',
    patterns: [
      /^I open the app$/i,
      new RegExp(`^I open ${Q}$`, 'i'),
      /^tôi mở (?:ứng dụng|app)$/i,
      new RegExp(`^tôi mở ${Q}$`, 'i'),
    ],
    build: (m) => (m[1] ? { kind: 'launch', target: m[1] } : { kind: 'launch' }),
    doc: 'I open the app | I open "<url or deeplink>"',
  },
  {
    id: 'tap',
    patterns: [
      new RegExp(`^I (?:tap|click) (?:on )?${Q}$`, 'i'),
      new RegExp(`^tôi (?:bấm|nhấn|chạm) (?:vào )?${Q}$`, 'i'),
    ],
    build: (m, ref) => ({ kind: 'tap', element: ref(m[1]!) }),
    doc: 'I tap "<element>"',
  },
  {
    id: 'longPress',
    patterns: [
      new RegExp(`^I long press (?:on )?${Q}$`, 'i'),
      new RegExp(`^tôi nhấn giữ ${Q}$`, 'i'),
    ],
    build: (m, ref) => ({ kind: 'longPress', element: ref(m[1]!), ms: 1000 }),
    doc: 'I long press "<element>"',
  },
  {
    id: 'input',
    patterns: [
      new RegExp(`^I (?:enter|type) ${Q} (?:in|into) ${Q}$`, 'i'),
      new RegExp(`^tôi nhập ${Q} vào ${Q}$`, 'i'),
    ],
    build: (m, ref) => ({ kind: 'input', element: ref(m[2]!), text: m[1]! }),
    doc: 'I enter "<text>" into "<element>"',
  },
  {
    id: 'clear',
    patterns: [new RegExp(`^I clear ${Q}$`, 'i'), new RegExp(`^tôi xoá (?:trống )?${Q}$`, 'i')],
    build: (m, ref) => ({ kind: 'clear', element: ref(m[1]!) }),
    doc: 'I clear "<element>"',
  },
  {
    id: 'select',
    patterns: [
      new RegExp(`^I select ${Q} from ${Q}$`, 'i'),
      new RegExp(`^tôi chọn ${Q} (?:từ|trong) ${Q}$`, 'i'),
    ],
    build: (m, ref) => ({ kind: 'select', element: ref(m[2]!), option: m[1]! }),
    doc: 'I select "<option>" from "<element>"',
  },
  {
    id: 'scrollTo',
    patterns: [
      new RegExp(`^I scroll to ${Q}$`, 'i'),
      new RegExp(`^tôi cuộn (?:đến|tới) ${Q}$`, 'i'),
    ],
    build: (m, ref) => ({ kind: 'scrollTo', element: ref(m[1]!) }),
    doc: 'I scroll to "<element>"',
  },
  {
    id: 'swipe',
    patterns: [
      /^I swipe (left|right|up|down)$/i,
      /^tôi vuốt (sang trái|sang phải|lên|xuống)$/i,
    ],
    build: (m) => ({ kind: 'swipe', direction: normalizeDirection(m[1]!) }),
    doc: 'I swipe left|right|up|down',
  },
  {
    id: 'back',
    patterns: [/^I go back$/i, /^tôi quay lại$/i],
    build: () => ({ kind: 'back' }),
    doc: 'I go back',
  },
  {
    id: 'waitFor',
    patterns: [
      new RegExp(`^I wait for ${Q}$`, 'i'),
      new RegExp(`^tôi chờ ${Q}$`, 'i'),
    ],
    build: (m, ref) => ({ kind: 'waitFor', element: ref(m[1]!) }),
    doc: 'I wait for "<element>"',
  },
  {
    id: 'assertVisible',
    patterns: [
      new RegExp(`^${Q} is visible$`, 'i'),
      new RegExp(`^I (?:should )?see ${Q}$`, 'i'),
      new RegExp(`^${Q} hiển thị$`, 'i'),
    ],
    build: (m, ref) => ({ kind: 'assertVisible', element: ref(m[1]!) }),
    doc: '"<element>" is visible',
  },
  {
    id: 'assertNotVisible',
    patterns: [
      new RegExp(`^${Q} is not visible$`, 'i'),
      new RegExp(`^I (?:should )?not see ${Q}$`, 'i'),
      new RegExp(`^${Q} không hiển thị$`, 'i'),
    ],
    build: (m, ref) => ({ kind: 'assertNotVisible', element: ref(m[1]!) }),
    doc: '"<element>" is not visible',
  },
  {
    id: 'assertTextContains',
    patterns: [
      new RegExp(`^${Q} (?:shows|contains) ${Q}$`, 'i'),
      new RegExp(`^${Q} chứa ${Q}$`, 'i'),
    ],
    build: (m, ref) => ({
      kind: 'assertText',
      element: ref(m[1]!),
      text: m[2]!,
      mode: 'contains',
    }),
    doc: '"<element>" shows "<text>"',
  },
  {
    id: 'assertTextEquals',
    patterns: [
      new RegExp(`^${Q} equals ${Q}$`, 'i'),
      new RegExp(`^${Q} bằng ${Q}$`, 'i'),
    ],
    build: (m, ref) => ({ kind: 'assertText', element: ref(m[1]!), text: m[2]!, mode: 'equals' }),
    doc: '"<element>" equals "<text>"',
  },
  {
    id: 'screenshot',
    patterns: [new RegExp(`^I take a screenshot named ${Q}$`, 'i')],
    build: (m) => ({ kind: 'screenshot', name: m[1]! }),
    doc: 'I take a screenshot named "<name>"',
  },
];

function normalizeDirection(raw: string): 'left' | 'right' | 'up' | 'down' {
  const map: Record<string, 'left' | 'right' | 'up' | 'down'> = {
    left: 'left',
    right: 'right',
    up: 'up',
    down: 'down',
    'sang trái': 'left',
    'sang phải': 'right',
    lên: 'up',
    xuống: 'down',
  };
  const dir = map[raw.toLowerCase()];
  if (!dir) throw new Error(`Unknown swipe direction "${raw}".`);
  return dir;
}

/** The block injected into the generation prompt. Keep it generated, never hand-copied. */
export function vocabularyDoc(): string {
  return STEP_RULES.map((r) => `- ${r.doc}`).join('\n');
}
