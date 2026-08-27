import type { Intent } from '../core/types.js';
import { parseDisplayedNumber } from '../core/number.js';

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
  /**
   * Plain-Vietnamese description and grouping, for the cheat sheet beside the
   * scenario editor. `doc` says what to type; these say when to reach for it —
   * which is what somebody meeting the vocabulary for the first time needs.
   */
  hint: string;
  group: 'Thao tác' | 'Nhập liệu' | 'Di chuyển' | 'Kiểm tra' | 'Khác';
}

const Q = '"([^"]+)"';

/**
 * A number argument, with or without the quotes.
 *
 * Every other argument in this vocabulary is a quoted string, so the quotes
 * around a count read as decoration and the model kept dropping them —
 * "exactly 5 times" instead of "exactly \"5\" times" — burning both repair
 * rounds on a step whose meaning was never in doubt. A bare integer cannot be
 * confused with anything else here, so accept both spellings rather than fail
 * a draft over punctuation.
 */
const N = '"?(\\d+)"?';

/**
 * A displayed amount, separators included.
 *
 * `N` takes bare digits, which is right for a count and wrong for money: the
 * screen shows "1,000" and a scenario that has to write 1000 instead no longer
 * quotes what the user sees. The value is parsed the same way the assertion
 * parses what it reads back, so both sides speak the screen's language.
 */
const AMOUNT = '"?([\\d][\\d.,]*)"?';

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
    hint: 'Mở ứng dụng, hoặc mở thẳng một URL/deeplink.',
    group: 'Khác',
  },
  {
    id: 'ensureLoggedIn',
    patterns: [
      new RegExp(`^I am logged in as ${Q}$`, 'i'),
      new RegExp(`^(?:tôi|người dùng) đã đăng nhập bằng tài khoản ${Q}$`, 'iu'),
    ],
    build: (m) => ({ kind: 'ensureLoggedIn', account: m[1]! }),
    doc: 'I am logged in as "<account role>"',
    hint: 'Đảm bảo đã đăng nhập. Web ưu tiên session local đã kiểm tra; nếu không hợp lệ sẽ tự đăng nhập qua UI.',
    group: 'Khác',
  },
  {
    id: 'openFeatureFromSearch',
    patterns: [
      new RegExp(`^I open feature ${Q} from search$`, 'i'),
      new RegExp(`^(?:tôi|người dùng) mở chức năng ${Q}$`, 'iu'),
    ],
    build: (m) => ({ kind: 'openFeatureFromSearch', query: m[1]! }),
    doc: 'I open feature "<business feature>" from search',
    hint: 'Tìm đúng chức năng ở Homepage và mở kết quả trùng tên, dùng chung cho mọi kịch bản.',
    group: 'Di chuyển',
  },
  {
    id: 'focusRegion',
    patterns: [
      new RegExp(`^I inspect (?:the )?(?:section|region|area) ${Q}$`, 'i'),
      new RegExp(`^(?:tôi|người dùng) kiểm tra (?:phần|vùng|khu vực|section) ${Q}$`, 'iu'),
    ],
    build: (m, ref) => ({ kind: 'focusRegion', element: ref(m[1]!) }),
    doc: 'I inspect section "<business region>"',
    hint: 'Xác nhận một vùng nghiệp vụ và dùng vùng đó làm phạm vi cho các bước tiếp theo.',
    group: 'Kiểm tra',
  },
  {
    id: 'tap',
    patterns: [
      new RegExp(`^I (?:tap|click) (?:on )?${Q}$`, 'i'),
      new RegExp(`^I (?:tap|click) (?:on )?(?:the )?(?:button|link|icon) ${Q}$`, 'i'),
      new RegExp(`^tôi (?:bấm|nhấn|chạm) (?:vào )?${Q}$`, 'i'),
    ],
    build: (m, ref) => ({ kind: 'tap', element: ref(m[1]!) }),
    doc: 'I tap "<element>" | I click button "<element>"',
    hint: 'Bấm vào một element: nút, link, icon, tab.',
    group: 'Thao tác',
  },
  {
    id: 'longPress',
    patterns: [
      new RegExp(`^I long press (?:on )?${Q}$`, 'i'),
      new RegExp(`^tôi nhấn giữ ${Q}$`, 'i'),
    ],
    build: (m, ref) => ({ kind: 'longPress', element: ref(m[1]!), ms: 1000 }),
    doc: 'I long press "<element>"',
    hint: 'Nhấn giữ khoảng 1 giây — dùng cho menu ngữ cảnh.',
    group: 'Thao tác',
  },
  {
    id: 'hover',
    patterns: [
      new RegExp(`^I hover (?:over )?${Q}$`, 'i'),
      new RegExp(`^tôi (?:di chuột|rê chuột) (?:qua|vào|trên )?${Q}$`, 'i'),
    ],
    build: (m, ref) => ({ kind: 'hover', element: ref(m[1]!) }),
    doc: 'I hover "<element>"',
    hint: 'Rê chuột lên element để hiện tooltip/menu (chủ yếu cho web).',
    group: 'Thao tác',
  },
  {
    id: 'dragDrop',
    patterns: [
      new RegExp(`^I drag ${Q} (?:and drop (?:it )?|to )${Q}$`, 'i'),
      new RegExp(`^tôi kéo ${Q} (?:vào|đến|tới) ${Q}$`, 'i'),
    ],
    build: (m, ref) => ({
      kind: 'dragDrop',
      source: ref(m[1]!),
      target: ref(m[2]!),
    }),
    doc: 'I drag "<source>" to "<target>"',
    hint: 'Kéo một element thả vào element khác.',
    group: 'Thao tác',
  },
  {
    id: 'input',
    patterns: [
      new RegExp(`^I (?:enter|type) ${Q} (?:in|into) ${Q}$`, 'i'),
      new RegExp(`^tôi nhập ${Q} vào ${Q}$`, 'i'),
    ],
    build: (m, ref) => ({ kind: 'input', element: ref(m[2]!), text: m[1]! }),
    doc: 'I enter "<text>" into "<element>"',
    hint: 'Gõ nội dung vào ô nhập. Dùng {{account.<label>.username}} thay cho giá trị thật.',
    group: 'Nhập liệu',
  },
  {
    id: 'clear',
    patterns: [new RegExp(`^I clear ${Q}$`, 'i'), new RegExp(`^tôi xoá (?:trống )?${Q}$`, 'i')],
    build: (m, ref) => ({ kind: 'clear', element: ref(m[1]!) }),
    doc: 'I clear "<element>"',
    hint: 'Xoá sạch nội dung đang có trong ô nhập.',
    group: 'Nhập liệu',
  },
  {
    id: 'select',
    patterns: [
      new RegExp(`^I select ${Q} from ${Q}$`, 'i'),
      new RegExp(`^tôi chọn ${Q} (?:từ|trong) ${Q}$`, 'i'),
    ],
    build: (m, ref) => ({ kind: 'select', element: ref(m[2]!), option: m[1]! }),
    doc: 'I select "<option>" from "<element>"',
    hint: 'Chọn một giá trị trong dropdown. Không phân biệt hoa/thường.',
    group: 'Nhập liệu',
  },
  {
    id: 'selectDate',
    patterns: [
      new RegExp(`^I select date ${Q} from ${Q}$`, 'i'),
      new RegExp(`^tôi chọn ngày ${Q} (?:từ|trong) ${Q}$`, 'i'),
    ],
    build: (m, ref) => ({ kind: 'selectDate', element: ref(m[2]!), date: m[1]! }),
    doc: 'I select date "<DD/MM/YYYY>" from "<element>"',
    hint: 'Chọn ngày trong date picker và kiểm tra field nhận đúng ngày.',
    group: 'Nhập liệu',
  },
  {
    id: 'scrollTo',
    patterns: [
      new RegExp(`^I scroll to ${Q}$`, 'i'),
      new RegExp(`^tôi cuộn (?:đến|tới) ${Q}$`, 'i'),
    ],
    build: (m, ref) => ({ kind: 'scrollTo', element: ref(m[1]!) }),
    doc: 'I scroll to "<element>"',
    hint: 'Cuộn cho tới khi element lọt vào màn hình.',
    group: 'Di chuyển',
  },
  {
    id: 'swipe',
    patterns: [
      /^I swipe (left|right|up|down)$/i,
      /^tôi vuốt (sang trái|sang phải|lên|xuống)$/i,
    ],
    build: (m) => ({ kind: 'swipe', direction: normalizeDirection(m[1]!) }),
    doc: 'I swipe left|right|up|down',
    hint: 'Vuốt màn hình theo hướng chỉ định.',
    group: 'Di chuyển',
  },
  {
    id: 'scroll',
    patterns: [
      /^I scroll (up|down)$/i,
      /^tôi cuộn (lên|xuống)$/i,
    ],
    build: (m) => ({ kind: 'scroll', direction: normalizeVerticalDirection(m[1]!) }),
    doc: 'I scroll up|down',
    hint: 'Cuộn lên hoặc xuống một đoạn.',
    group: 'Di chuyển',
  },
  {
    id: 'back',
    patterns: [/^I go back$/i, /^tôi quay lại$/i],
    build: () => ({ kind: 'back' }),
    doc: 'I go back',
    hint: 'Quay lại màn hình trước.',
    group: 'Di chuyển',
  },
  {
    id: 'waitFor',
    patterns: [
      new RegExp(`^I wait for ${Q}$`, 'i'),
      new RegExp(`^tôi chờ ${Q}$`, 'i'),
    ],
    build: (m, ref) => ({ kind: 'waitFor', element: ref(m[1]!) }),
    doc: 'I wait for "<element>"',
    hint: 'Chờ element xuất hiện trước khi làm bước tiếp theo.',
    group: 'Kiểm tra',
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
    hint: 'Khẳng định element đang hiện. Đây là cách chứng minh bước trước đã chạy đúng.',
    group: 'Kiểm tra',
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
    hint: 'Khẳng định element đã biến mất.',
    group: 'Kiểm tra',
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
    hint: 'Khẳng định element có chứa đoạn chữ này.',
    group: 'Kiểm tra',
  },
  {
    id: 'assertTextNotContains',
    patterns: [
      new RegExp(`^${Q} (?:does not show|does not contain) ${Q}$`, 'i'),
      new RegExp(`^${Q} không chứa ${Q}$`, 'i'),
    ],
    build: (m, ref) => ({
      kind: 'assertText',
      element: ref(m[1]!),
      text: m[2]!,
      mode: 'notContains',
    }),
    doc: '"<element>" does not show "<text>"',
    hint: 'Khẳng định element không chứa đoạn chữ này. Đúng cả khi element đã biến mất.',
    group: 'Kiểm tra',
  },
  {
    id: 'assertTextEquals',
    patterns: [
      new RegExp(`^${Q} equals ${Q}$`, 'i'),
      new RegExp(`^${Q} bằng ${Q}$`, 'i'),
    ],
    build: (m, ref) => ({ kind: 'assertText', element: ref(m[1]!), text: m[2]!, mode: 'equals' }),
    doc: '"<element>" equals "<text>"',
    hint: 'Khẳng định nội dung element đúng y hệt chuỗi này.',
    group: 'Kiểm tra',
  },
  {
    id: 'assertNumber',
    patterns: [
      new RegExp(`^${Q} number is (not|equal to|greater than|at least|at most) ${N}$`, 'i'),
    ],
    build: (m, ref) => ({
      kind: 'assertNumber',
      element: ref(m[1]!),
      operator: m[2]!.toLowerCase() === 'not'
        ? 'notEquals'
        : m[2]!.toLowerCase() === 'greater than'
          ? 'greaterThan'
          : m[2]!.toLowerCase() === 'at least'
            ? 'atLeast'
            : m[2]!.toLowerCase() === 'at most'
              ? 'atMost'
            : 'equals',
      value: Number(m[3]),
    }),
    doc: '"<element>" number is not|equal to|greater than|at least|at most "<number>"',
    hint: 'Kiểm tra giá trị số, ví dụ số lượng giao dịch phải khác 0.',
    group: 'Kiểm tra',
  },
  {
    id: 'rememberNumber',
    patterns: [
      new RegExp(`^I remember ${Q} as ${Q}$`, 'i'),
      new RegExp(`^Tôi ghi nhớ ${Q} là ${Q}$`, 'iu'),
    ],
    build: (m, ref) => ({ kind: 'rememberNumber', element: ref(m[1]!), as: m[2]! }),
    doc: 'I remember "<element>" as "<tên>"',
    hint: 'Đọc và ghi nhớ một con số để so sánh ở bước sau — dùng cho số dư, tổng, số lượng.',
    group: 'Kiểm tra',
  },
  {
    id: 'assertNumberDelta',
    patterns: [
      new RegExp(`^${Q} (increased|decreased) by ${AMOUNT} from ${Q}$`, 'i'),
      new RegExp(`^${Q} (tăng|giảm) ${AMOUNT} so với ${Q}$`, 'iu'),
    ],
    build: (m, ref) => ({
      kind: 'assertNumberDelta',
      element: ref(m[1]!),
      as: m[4]!,
      direction: /increased|tăng/iu.test(m[2]!) ? 'increased' : 'decreased',
      by: parseDisplayedNumber(m[3]!),
    }),
    doc: '"<element>" increased|decreased by "<số>" from "<tên>"',
    hint: 'Khẳng định con số thay đổi đúng một lượng so với lúc ghi nhớ. '
      + 'Dùng thay cho việc ghi cứng số dư, vì số dư đổi sau mỗi lần chạy.',
    group: 'Kiểm tra',
  },
  {
    id: 'assertNumberChanged',
    patterns: [
      new RegExp(`^${Q} changed from ${Q}$`, 'i'),
      new RegExp(`^${Q} đã thay đổi so với ${Q}$`, 'iu'),
    ],
    build: (m, ref) => ({
      kind: 'assertNumberDelta',
      element: ref(m[1]!),
      as: m[2]!,
      direction: 'changed',
    }),
    doc: '"<element>" changed from "<tên>"',
    hint: 'Khẳng định con số đã đổi, không cần biết đổi bao nhiêu — dùng cho quy tắc '
      + '"thay đổi theo X", nơi lượng thay đổi là dữ liệu tài khoản chứ không phải quy tắc.',
    group: 'Kiểm tra',
  },
  {
    id: 'assertNumberUnchanged',
    patterns: [
      new RegExp(`^${Q} is unchanged from ${Q}$`, 'i'),
      new RegExp(`^${Q} không đổi so với ${Q}$`, 'iu'),
    ],
    build: (m, ref) => ({
      kind: 'assertNumberDelta',
      element: ref(m[1]!),
      as: m[2]!,
      direction: 'unchanged',
    }),
    doc: '"<element>" is unchanged from "<tên>"',
    hint: 'Khẳng định con số không thay đổi — ví dụ huỷ giao dịch thì số dư giữ nguyên.',
    group: 'Kiểm tra',
  },
  {
    id: 'assertCollectionCount',
    patterns: [
      new RegExp(`^${Q} count is (not|equal to|greater than|at least|at most) ${N}$`, 'i'),
      new RegExp(`^${Q} số lượng (khác|bằng|lớn hơn|ít nhất|tối đa) ${Q}$`, 'iu'),
      new RegExp(`^${Q} xuất hiện (khác|bằng|lớn hơn|ít nhất|tối đa) ${N} lần$`, 'iu'),
    ],
    build: (m, ref) => {
      const raw = m[2]!.toLocaleLowerCase('vi-VN');
      const operator = raw === 'not' || raw === 'khác'
        ? 'notEquals'
        : raw === 'greater than' || raw === 'lớn hơn'
          ? 'greaterThan'
          : raw === 'at least' || raw === 'ít nhất'
            ? 'atLeast'
            : raw === 'at most' || raw === 'tối đa'
              ? 'atMost'
              : 'equals';
      return {
        kind: 'assertCollection',
        element: ref(m[1]!),
        check: { kind: 'count', operator, value: Number(m[3]) },
      };
    },
    doc: '"<element>" count is not|equal to|greater than|at least|at most "<number>"',
    hint: 'Đếm các kết quả/dòng đang hiển thị, ví dụ danh sách có tối đa 5 kết quả.',
    group: 'Kiểm tra',
  },
  {
    id: 'assertCollectionCountMatching',
    patterns: [
      new RegExp(`^${Q} shows ${Q} exactly ${N} times?$`, 'i'),
      new RegExp(`^${Q} hiển thị ${Q} đúng ${N} lần$`, 'iu'),
    ],
    build: (m, ref) => ({
      kind: 'assertCollection',
      element: ref(m[1]!),
      check: { kind: 'countMatching', text: m[2]!, operator: 'equals', value: Number(m[3]) },
    }),
    doc: '"<element>" shows "<text>" exactly "<number>" times',
    hint: 'Đếm xem một giá trị xuất hiện mấy lần trong danh sách — '
      + 'ví dụ mã đã có rồi thì thêm lại không được nhân đôi.',
    group: 'Kiểm tra',
  },
  {
    id: 'assertCollectionUnique',
    patterns: [
      new RegExp(`^${Q} values are unique$`, 'i'),
      new RegExp(`^${Q} không có (?:kết quả )?trùng$`, 'iu'),
    ],
    build: (m, ref) => ({
      kind: 'assertCollection',
      element: ref(m[1]!),
      check: { kind: 'uniqueText' },
    }),
    doc: '"<element>" values are unique',
    hint: 'Khẳng định danh sách không chứa hai kết quả có cùng nội dung.',
    group: 'Kiểm tra',
  },
  {
    id: 'assertCollectionFirst',
    patterns: [
      new RegExp(`^first ${Q} shows ${Q}$`, 'i'),
      new RegExp(`^kết quả đầu tiên của ${Q} chứa ${Q}$`, 'iu'),
    ],
    build: (m, ref) => ({
      kind: 'assertCollection',
      element: ref(m[1]!),
      check: { kind: 'firstText', text: m[2]! },
    }),
    doc: 'first "<element>" shows "<text>"',
    hint: 'Khẳng định kết quả đứng đầu có nội dung mong đợi.',
    group: 'Kiểm tra',
  },
  {
    id: 'assertCollectionFocused',
    patterns: [
      new RegExp(`^${Q} is focused$`, 'i'),
      new RegExp(`^${Q} được focus$`, 'iu'),
    ],
    build: (m, ref) => ({
      kind: 'assertCollection',
      element: ref(m[1]!),
      check: { kind: 'focused' },
    }),
    doc: '"<element>" is focused',
    hint: 'Khẳng định dòng/control mong đợi đang được focus hoặc selected.',
    group: 'Kiểm tra',
  },
  {
    id: 'screenshot',
    patterns: [new RegExp(`^I take a screenshot named ${Q}$`, 'i')],
    build: (m) => ({ kind: 'screenshot', name: m[1]! }),
    doc: 'I take a screenshot named "<name>"',
    hint: 'Chụp màn hình và đính vào báo cáo, đặt tên để dễ tìm lại.',
    group: 'Khác',
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

function normalizeVerticalDirection(raw: string): 'up' | 'down' {
  const value = raw.toLocaleLowerCase();
  return value === 'up' || value === 'lên' ? 'up' : 'down';
}

/** The block injected into the generation prompt. Keep it generated, never hand-copied. */
export function vocabularyDoc(): string {
  return STEP_RULES.map((r) => `- ${r.doc}`).join('\n');
}
