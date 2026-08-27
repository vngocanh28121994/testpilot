/**
 * The choices a dropdown is currently offering.
 *
 * Read from the page rather than from the control, because a Material select
 * renders its list into an overlay container at the end of `<body>` — the
 * options are nowhere inside the element the scenario names. Only one such list
 * is open at a time, which is what makes "the open list" and "this control's
 * list" the same set in practice.
 *
 * No named inner functions. Playwright ships this source into the page and
 * esbuild — which tsx uses — wraps every named function in a `__name` helper
 * that does not exist there, throwing `ReferenceError: __name is not defined`
 * inside the page.
 */
export const openOptionLabels = (): string[] => {
  const nodes = document.querySelectorAll(
    '[role="option"], mat-option, li[role="menuitem"], .cdk-overlay-pane [role="listbox"] > *',
  );
  const out: string[] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const el = nodes[i] as HTMLElement;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    // An option rendered but not shown is not on offer. Material keeps the
    // previous panel in the DOM for the duration of its close animation, and
    // counting those would report choices nobody can make.
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    if (rect.width === 0 || rect.height === 0) continue;
    // Prefer an inner label: Material puts the description in the same node, so
    // whole-node text carries more than the choice itself.
    const inner = el.querySelector('label, .mat-option-text, .mdc-list-item__primary-text');
    const text = ((inner ?? el).textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text) out.push(text);
  }
  return out;
};
