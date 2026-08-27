import type { Locator } from 'playwright';

/**
 * Whether this element is the one a user would actually hit on screen.
 *
 * Hit-testing rather than measuring. Two earlier attempts compared the
 * element's rectangle against the viewport and both picked the wrong twin: a
 * rect test cannot see that an element is scrolled inside a clipped drawer, or
 * covered, and `page.viewportSize()` is null on every page reached through
 * `connectOverCDP` so the comparison was skipped outright on Android. Asking
 * `elementFromPoint` what occupies the centre answers the real question —
 * off-screen, clipped and covered all come back false without any geometry
 * being reasoned about here.
 *
 * A hit on a descendant or an ancestor counts: a tab's label sits inside the
 * tab, and clicking either lands in the same place.
 */
export function isHittable(locator: Locator, timeoutMs = 2_000): Promise<boolean> {
  // Bounded, because `evaluate` is not. Playwright gives it no timeout of its
  // own: a page that stops answering leaves the promise unsettled forever and
  // the run hangs instead of failing — the exact trap WebViewCdpDriver already
  // guards its own calls against, and which these calls walked straight into.
  // Unanswerable is treated as not hittable, which is also the truthful answer.
  const timer = new Promise<boolean>((resolve) => {
    setTimeout(() => resolve(false), timeoutMs).unref?.();
  });
  const probe = locator
    .evaluate((node) => {
      const el = node as Element;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;

      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;

      const hit = document.elementFromPoint(x, y);
      return Boolean(hit && (hit === el || el.contains(hit) || hit.contains(el)));
    })
    .catch(() => false);
  return Promise.race([probe, timer]);
}
