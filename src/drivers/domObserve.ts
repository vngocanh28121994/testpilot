/**
 * Quan sát DOM, dùng chung cho mọi nền tảng chạy trong WebView.
 *
 * Trước đây đoạn này nằm khoá trong WebViewCdpDriver, tức chỉ Android với CDP
 * mới có. Trên iOS, `observe()` lùi về cây XCUITest — mà cây đó với một
 * WKWebView chỉ là mấy hộp `XCUIElementTypeOther` rỗng: đo trên máy thật ngày
 * 2026-09-10, màn đăng nhập cho ra 24 node, không một TextField, Button hay
 * StaticText nào. Discovery nhìn vào đó thì chấm điểm cao nhất được 15/40 và
 * bó tay, dù DOM ngay bên dưới có đủ ô nhập với placeholder rõ ràng.
 *
 * Hàm được viết để chạy TRONG trang, không tham chiếu gì bên ngoài, nên cả
 * `page.evaluate` của Playwright lẫn `browser.execute` của WebdriverIO đều
 * dùng lại được y nguyên.
 */
export type RawEl = {
  tag: string;
  placeholder?: string;
  value?: string;
  ariaLabel?: string;
  testId?: string;
  name?: string;
  id?: string;
  formcontrolname?: string;
  /**
   * Raw DOM text, whitespace-collapsed. Deliberately textContent, NOT
   * innerText: innerText returns the *rendered* string and therefore honours
   * `text-transform: uppercase`, while XPath's normalize-space(string(.))
   * matches against the untransformed DOM text. Harvesting innerText made
   * healing emit `label=ĐĂNG NHẬP` for a button whose DOM text is
   * `Đăng nhập` — a locator that could never match.
   */
  domText?: string;
  // Stable CSS classes (excluding Angular internal classes like ng-*, mat-*)
  cssClasses?: string;
  /** Stable selector for custom controls such as tcbs-icon[name]. */
  css?: string;
  customName?: string;
  disabled: boolean;
  visible: boolean;
  rect: { x: number; y: number; width: number; height: number };
};

// 10s: a full DOM scrape on a large Angular page is legitimately slower than
// a single locator lookup, but still nowhere near a hang.

export function observeDomInPage(): RawEl[] {
    const nodes = document.querySelectorAll(
      // `label` and `legend` earn their place: they are where a form keeps the
      // words a person reads to identify a field, and without them the
      // observation showed `name="volume"` with no hint that the screen calls
      // it "KL đặt". Both the scorer and the AI tier were guessing from
      // English attribute names because the caption was never observed.
      'input, textarea, button, [role], a, select, [onclick], tcbs-icon[name], ' +
        'span, p, li, label, legend',
    );
    return Array.from(nodes).map((node) => {
      const el = node as HTMLElement & { disabled?: boolean; value?: string; placeholder?: string; type?: string };
      const rect = el.getBoundingClientRect();

      // Extract stable CSS classes: skip Angular/CDK internal class prefixes
      const stableClasses = Array.from(el.classList)
        .filter((c) => !c.startsWith('ng-') && !c.startsWith('mat-') && !c.startsWith('cdk-') && !c.startsWith('_'))
        .join(' ')
        .trim() || undefined;

      const customName = el.tagName.includes('-')
        ? el.getAttribute('name') || undefined
        : undefined;
      let css: string | undefined;
      if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
        css = `#${CSS.escape(el.id)}`;
      } else if (customName) {
        const escaped = customName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const byName = `${el.tagName.toLowerCase()}[name="${escaped}"]`;
        if (document.querySelectorAll(byName).length === 1) css = byName;
      }

      return {
        tag: el.tagName.toLowerCase(),
        placeholder: el.placeholder || undefined,
        value: el.value || undefined,
        ariaLabel: el.getAttribute('aria-label') || el.getAttribute('title') || customName || undefined,
        testId:
          el.getAttribute('data-testid') ||
          el.getAttribute('data-test') ||
          el.getAttribute('data-cy') ||
          undefined,
        id: el.id || undefined,
        name: el.getAttribute('name') || undefined,
        formcontrolname: el.getAttribute('formcontrolname') || undefined,
        // Collapse whitespace runs exactly as XPath normalize-space() does, so
        // the harvested string is byte-identical to what the selector matches.
        domText: (el.textContent ?? '').replace(/\s+/g, ' ').trim() || undefined,
        cssClasses: stableClasses,
        css,
        customName,
        disabled: el.disabled === true,
        visible: rect.width > 0 && rect.height > 0,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    });
}
