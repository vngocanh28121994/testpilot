/**
 * The value that sits beside a caption, read from the page.
 *
 * Shared verbatim by the Playwright driver and the WebView CDP driver. It used
 * to live only in the Playwright one, so a confirmation screen read correctly
 * on the web and, on Android, returned the caption itself — `remember "Được
 * chuyển"` stored the words "Được chuyển" and the numeric assertion that
 * followed had nothing to compare.
 *
 * A real function, not a string: `locator.evaluate` given a string evaluates it
 * as an expression and serialises the resulting function as the return value,
 * which arrives as `undefined` for every element.
 *
 * No named inner functions, deliberately. Playwright ships this source into the
 * page and esbuild — which tsx uses — wraps every named function in a `__name`
 * helper that does not exist there, producing `ReferenceError: __name is not
 * defined` thrown inside the page.
 */
export const valueBesideCaption = (node: Element, own: string): string | undefined => {
  const wanted = own.trim().toLowerCase();
  // A Material icon's text content is its ligature name, so the refresh button
  // sitting in the same cell makes the balance read "refresh7,329". The icons
  // are stripped from a copy; the live node must not be touched.
  const ICONS = 'mat-icon,.mat-icon,.material-icons,[class*="material-icons"],[class*="icon-"]';
  let level: Element | null = node;
  // Two levels is deliberate: one for `<div>caption</div><div>value</div>`, two
  // for the same pair each wrapped in a cell. Beyond that the "next element"
  // stops being related to the caption at all and starts being the next row,
  // whose value would be confidently wrong.
  for (let depth = 0; depth < 2 && level; depth += 1) {
    let sibling: Element | null = level.nextElementSibling;
    while (sibling) {
      const copy = sibling.cloneNode(true) as Element;
      const icons = copy.querySelectorAll(ICONS);
      for (let i = 0; i < icons.length; i += 1) icons[i]!.remove();
      const text = (copy.textContent ?? '').trim();
      if (text && text.toLowerCase() !== wanted) return text;
      sibling = sibling.nextElementSibling;
    }
    level = level.parentElement;
  }
  return undefined;
};
