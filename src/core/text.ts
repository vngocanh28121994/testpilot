/**
 * Comparison form for human-authored labels.
 *
 * Vietnamese users commonly write equivalent tone-mark styles such as
 * "Xoá" and "Xóa". UI automation must not treat those spelling variants as
 * different controls, while the original text is still kept for reports and
 * exact runtime locators.
 */
export function normalizeHumanText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tone-mark pairs Vietnamese writes two equally correct ways.
 *
 * "Xoá" and "Xóa" differ in which vowel of the cluster carries the mark, and
 * both appear in real products — often in the same product. Comparison already
 * copes, because `normalizeHumanText` strips marks entirely. A locator cannot:
 * it has to put a literal string into the page query, and the app renders
 * exactly one of the two. Measured on a live screen, asking for "Xoá khỏi danh
 * mục" found 0 elements while "Xóa khỏi danh mục" found 2 — same control, same
 * word, one spelling.
 */
const TONE_PAIRS: Array<[string, string]> = [
  ['oà', 'òa'], ['oá', 'óa'], ['oả', 'ỏa'], ['oã', 'õa'], ['oạ', 'ọa'],
  ['oè', 'òe'], ['oé', 'óe'], ['oẻ', 'ỏe'], ['oẽ', 'õe'], ['oẹ', 'ọe'],
  ['uỳ', 'ùy'], ['uý', 'úy'], ['uỷ', 'ủy'], ['uỹ', 'ũy'], ['uỵ', 'ụy'],
];

/**
 * The spellings a label may legitimately appear as, most likely first.
 *
 * Returns just the input when no such cluster is present, which is the common
 * case — callers can map over the result without paying for it.
 */
export function toneMarkVariants(value: string): string[] {
  // Capitalised forms too: a label often starts with one of these clusters
  // ("Uỷ quyền", "Xoá"), and only the first letter differs.
  const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
  const pairs = TONE_PAIRS.flatMap(([a, b]) => [[a, b], [cap(a), cap(b)]] as Array<[string, string]>);
  const swap = (text: string, from: number, to: number): string =>
    pairs.reduce((acc, pair) => acc.split(pair[from]!).join(pair[to]!), text);
  const both = [value, swap(value, 0, 1), swap(value, 1, 0)];
  return [...new Set(both)];
}
