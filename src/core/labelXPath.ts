import { toneMarkVariants } from './text.js';
/**
 * XPath for "the element a person would call <label>".
 *
 * Shared by both drivers on purpose. They used to spell this differently —
 * Playwright text matching on web, XPath in the WebView — so a fix for one left
 * the other broken, which is exactly how the same step passed on Android and
 * failed on web.
 */

/**
 * Case-folding table for XPath 1.0, which has no lower-case().
 *
 * Includes the Vietnamese letters: `translate()` maps character by character,
 * so an alphabet limited to A–Z would leave "Ư" and "Ầ" untouched and the
 * comparison would still be case-sensitive for exactly the words that matter.
 */
export const XPATH_UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝĂĐĨŨƠƯẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼẾỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴỶỸ';
export const XPATH_LOWER = 'abcdefghijklmnopqrstuvwxyzàáâãèéêìíòóôõùúýăđĩũơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ';

export function xpathLiteral(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat('${value.split("'").join(`', "'", '`)}')`;
}

/** Wraps an XPath expression so it compares case-insensitively. */
export function lcXPath(expr: string): string {
  return `translate(${expr},${xpathLiteral(XPATH_UPPER)},${xpathLiteral(XPATH_LOWER)})`;
}

/**
 * Every way a caption identifies something on screen, as XPath arms.
 *
 * Joined by the caller into a union, which returns nodes in *document order* —
 * so the order of this list decides nothing, and the arms have to be mutually
 * exclusive by construction rather than by priority. A labelling element always
 * precedes the control it labels, which is why captions are excluded from the
 * text arms instead of merely ranked below them.
 */
/**
 * Association arms for one spelling.
 *
 * Deliberately not a union over spellings. Measured on a real screen, the nine
 * arms for a single spelling already cost ~350ms; unioning two spellings into
 * one query cost 651ms, and the driver gives a locator 250ms to attach before
 * moving on. The query matched the element and the driver never waited long
 * enough to hear it — a correctness fix that produced a timeout. Callers that
 * can afford separate attempts should ask for each spelling in turn.
 */
export function labelXPaths(value: string): string[] {
  return labelXPathsFor(value);
}

/** One arm list per legitimate spelling, most likely first. */
export function labelXPathsBySpelling(value: string): string[][] {
  return toneMarkVariants(value).map((variant) => labelXPathsFor(variant));
}

function labelXPathsFor(value: string): string[] {
  const lit = xpathLiteral(value.toLocaleLowerCase());
  const lc = lcXPath;
  const CONTROL = 'self::input or self::textarea or self::select';
  const NOT_A_CAPTION =
    'not(ancestor-or-self::label) and not(ancestor-or-self::legend)' +
    ' and not(@id = //*/@aria-labelledby)';
  return [
    `//*[${lc('@aria-label')}=${lit}]`,
    `//label[${lc('normalize-space()')}=${lit}]//*[${CONTROL}]`,
    `//*[@id=//label[${lc('normalize-space()')}=${lit}]/@for]`,
    // Both filters matter. `[@aria-labelledby]` first shrinks the outer set
    // from every node to the handful that carry the attribute; `[@id]` shrinks
    // the inner scan the same way. Without them the inner node-set is rebuilt
    // for every element in the document, computing string-values as it goes:
    // 81 seconds on a real TCInvest page, against 63 milliseconds with them.
    // A resolver tick that slow eats the whole waiting budget, and the run
    // reports an element it never had time to look for.
    `//*[@aria-labelledby][@aria-labelledby=//*[@id][${lc('normalize-space()')}=${lit}]/@id]`,
    `//fieldset[legend[${lc('normalize-space()')}=${lit}]]//*[${CONTROL}]`,
    `//*[${lc('normalize-space(string(.))')}=${lit} and (self::button or self::a or self::ion-button or @role='button' or @role='link')]`,
    // Own text only: string(.) concatenates every descendant, and a Material
    // icon contributes its ligature name. A dropdown reading "Lệnh thường" has
    // the string-value "Lệnh thường arrow_drop_down" and matched nothing.
    `//*[${lc('normalize-space(text())')}=${lit} and ${NOT_A_CAPTION}]`,
    `//*[${lc('normalize-space(string(.))')}=${lit} and ${NOT_A_CAPTION}]`,
    // A caption that labels nothing is still the thing being named.
    `//*[(self::label or self::legend) and ${lc('normalize-space(string(.))')}=${lit}` +
      ` and not(@for) and not(.//*[${CONTROL}])` +
      ` and not(ancestor::fieldset[1]//*[${CONTROL}])]`,
  ];
}

/**
 * The looser arm: an element whose own text *contains* what the step asked for.
 *
 * Messages carry their data inside them — "Đã lưu lệnh Mua TCB 28000 x 100 =
 * 2,800,000 vào Sổ lệnh chờ gửi" — so the wording a scenario can state is never
 * the whole string. Exact matching cannot express that, and every toast,
 * confirmation and summary line in the app is shaped this way.
 *
 * Returned separately from labelXPaths() rather than added to it, because the
 * union is resolved in document order: a near match appearing earlier on the
 * page would beat the exact match of a later element. Callers try this only
 * after the exact arms have found nothing.
 *
 * Two guards keep it honest, and only two:
 *
 *   `text()` — own text, not string(.). Every ancestor of a message also
 *   *contains* it, and the outermost one wins on document order; matching only
 *   direct text children leaves exactly the element that renders the words.
 *
 *   three words — "Đóng" or "OK" inside a longer sentence is a coincidence, not
 *   a match. A phrase long enough to be stated deliberately is specific enough
 *   to trust.
 *
 * Undefined when the label is too short to qualify: there is no safe loose
 * reading of a one-word label, so the caller simply has no second pass.
 */
/**
 * A caption that a template split across several elements.
 *
 * Angular interpolation renders `Tiền chuyển (Phí = {{fee}})` as two spans —
 * `Tiền chuyển (Phí = ` and `0)` — so the phrase a scenario writes exists on
 * screen but in no single element. Every exact arm matches nothing, and the
 * loose arm cannot help either: it reads `text()`, the element's *own* text
 * nodes, which is exactly what the split destroyed. Three scenarios failed this
 * way on the mobile build of a screen the desktop build resolves 15 times out
 * of 15.
 *
 * So this arm reads the whole subtree, `normalize-space(.)`, and pays for that
 * breadth with one constraint: no descendant may also contain the phrase. That
 * picks the smallest element that wholly contains it — the row, not the page —
 * where a plain `contains(.)` matched 31 ancestors up to `<html>` and was
 * useless.
 *
 * Two words minimum. On a subtree match a short label is a substring hazard:
 * "OK" is inside "BOOK", and the deepest-element rule would happily return the
 * element rendering the wrong word. A phrase is not.
 */
export function labelSplitAcrossChildrenXPath(value: string): string | undefined {
  const wanted = value.trim().toLocaleLowerCase();
  if (wanted.split(/\s+/).filter(Boolean).length < 2) return undefined;
  const has = `contains(${lcXPath('normalize-space(.)')},${xpathLiteral(wanted)})`;
  return `//*[${has} and not(.//*[${has}])]`;
}

export function labelContainsXPath(value: string): string | undefined {
  const wanted = value.trim().toLocaleLowerCase();
  if (wanted.split(/\s+/).filter(Boolean).length < 3) return undefined;
  return `//*[contains(${lcXPath('normalize-space(text())')},${xpathLiteral(wanted)})]`;
}
