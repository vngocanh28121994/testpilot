/**
 * What counts as a row, in one place.
 *
 * A row is the unit almost every list assertion is about — "the watchlist shows
 * VIC", "at most five suggestions" — and three parts of the system need to
 * agree on it: the relative locator that finds the row containing some text,
 * the contextual XPath that does the same on native, and the DOM observer that
 * decides what is worth looking at in the first place. The definition lived in
 * the first two and was missing from the third, so rows were addressable only
 * once somebody had already written a selector by hand: discovery could not see
 * them to propose one.
 */

/** Row-ish class names, without the leading dot. */
export const ROW_CLASS_TOKENS = ['content-row', 'table-row', 'list-row', 'item-row'] as const;

/** CSS form, for Playwright and for the observer's selector list. */
export const ROW_SELECTOR = [
  'tr',
  '[role="row"]',
  ...ROW_CLASS_TOKENS.map((token) => `.${token}`),
].join(', ');
