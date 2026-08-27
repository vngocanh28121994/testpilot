/**
 * The accessible name of a DOM element — what the control is called, as opposed
 * to what it currently holds.
 *
 * Shared verbatim by the Playwright driver and the WebView CDP driver so the
 * two cannot drift: a name computed one way on the desktop build and another
 * way inside the phone's WebView would put the resolver back where it started.
 *
 * A real function, not a string. `locator.evaluate` given a string evaluates it
 * as an *expression* — the arrow function it produces is then serialised as a
 * return value, which comes back `undefined`. That is not a hypothetical: the
 * first version of this file was a string, returned `undefined` for every
 * element, and looked exactly like "this page has no accessible names".
 *
 * No named inner functions, deliberately. Playwright ships this source into the
 * page and esbuild — which tsx uses — wraps every named function in a `__name`
 * helper that does not exist there, producing `ReferenceError: __name is not
 * defined` thrown inside the page. So the whitespace cleanup is inlined at each
 * use rather than factored into a `const clean = …`.
 */
export const accessibleNameOf = (node: Element): string | undefined => {
  const aria = (node.getAttribute('aria-label') ?? '').replace(/\s+/g, ' ').trim();
  if (aria) return aria;

  const ids = node.getAttribute('aria-labelledby');
  if (ids) {
    const nodes = ids
      .split(/\s+/)
      .map((id) => document.getElementById(id))
      .filter((n): n is HTMLElement => Boolean(n));
    // Material points aria-labelledby at BOTH the label and the value node, so
    // joining them would smuggle the value back into the name — which is the
    // whole bug this exists to avoid. Prefer a node that is actually a label.
    const labelish = nodes.find(
      (n) =>
        n.tagName === 'LABEL' ||
        n.tagName === 'MAT-LABEL' ||
        Boolean(n.querySelector('mat-label,label')),
    );
    const picked = labelish ?? nodes[0];
    if (picked) {
      const inner = picked.querySelector('mat-label,label');
      const name = ((inner ?? picked).textContent ?? '').replace(/\s+/g, ' ').trim();
      if (name) return name;
    }
  }

  // A wrapping form field carries the label for controls that point at nothing.
  const field = node.closest('mat-form-field,.mat-form-field,label');
  if (field) {
    const inner = field.querySelector('mat-label,label');
    const name = ((inner ?? field).textContent ?? '').replace(/\s+/g, ' ').trim();
    if (name) return name;
  }

  const id = node.getAttribute('id');
  if (id) {
    const bound = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    const name = (bound?.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (name) return name;
  }

  return undefined;
};
