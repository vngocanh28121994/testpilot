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
  /**
   * Whether this DOM node itself owns an interaction. `undefined` means the
   * DOM cannot answer (common for framework icon components whose event
   * binding is not exposed as an HTML attribute).
   */
  interactive?: boolean;
  /**
   * Node này bọc node khác, nên `domText` của nó là chữ của cả cây con.
   *
   * Bộ chọn ở dưới cố ý thu cả những div bọc có `cursor: pointer` — chúng là
   * nút thật trong Angular — nên chữ nối dài là chuyện bình thường ở đây, và
   * các tầng sau phải được nói cho biết thay vì phải tự đoán.
   */
  container: boolean;
  disabled: boolean;
  visible: boolean;
  rect: { x: number; y: number; width: number; height: number };
};

// 10s: a full DOM scrape on a large Angular page is legitimately slower than
// a single locator lookup, but still nowhere near a hang.

export function observeDomInPage(): RawEl[] {
    const layerRoots = Array.from(document.querySelectorAll(
      '.cdk-overlay-pane, mat-dialog-container, [role="dialog"], [aria-modal="true"]',
    )).filter((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    });
    // A pane contains its mat-dialog-container; retain only the innermost root
    // so one visible modal is not counted twice. Highest z-index wins, with DOM
    // order as the framework-neutral tiebreaker used by stacked dialogs.
    const modalLayers = layerRoots.filter((root) =>
      !layerRoots.some((other) => other !== root && root.contains(other)),
    );
    const frontModal = modalLayers
      .map((root, order) => {
        let current: Element | null = root;
        let z = 0;
        while (current) {
          const value = Number.parseInt(getComputedStyle(current).zIndex || '0', 10);
          if (Number.isFinite(value)) z = Math.max(z, value);
          current = current.parentElement;
        }
        return { root, order, z };
      })
      .sort((a, b) => b.z - a.z || b.order - a.order)[0]?.root;
    const nodes = document.querySelectorAll(
      // `label` and `legend` earn their place: they are where a form keeps the
      // words a person reads to identify a field, and without them the
      // observation showed `name="volume"` with no hint that the screen calls
      // it "KL đặt". Both the scorer and the AI tier were guessing from
      // English attribute names because the caption was never observed.
      'input, textarea, button, [role], a, select, [onclick], [aria-label], [title], ' +
        'mat-icon, tcbs-icon, .material-icons, ' +
        'span, p, li, label, legend, div.name, div.title, ' +
        '[class*="-title"], [class*="__title"], [class*="-name"], [class*="__name"], ' +
        'div[class] > div:only-child',
    );
    return Array.from(nodes).filter((node) => {
      if (node.tagName.toLowerCase() !== 'div') return true;
      const el = node as HTMLElement;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      // Leaf divs commonly carry headings/card names in Angular apps. A div
      // with children is useful only when it owns an interaction; otherwise it
      // contributes a huge concatenated duplicate of the entire subtree.
      return el.children.length === 0 || getComputedStyle(el).cursor === 'pointer';
    }).map((node) => {
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
      const role = (el.getAttribute('role') || '').toLowerCase();
      const ownsInteraction = /^(a|button|input|select|textarea)$/i.test(el.tagName) ||
        /^(button|link|menuitem|option|tab|checkbox|radio|switch|textbox|combobox|searchbox)$/i.test(role) ||
        el.hasAttribute('onclick') ||
        el.hasAttribute('data-testid') ||
        el.hasAttribute('data-test') ||
        el.hasAttribute('data-cy') ||
        Boolean(customName) ||
        getComputedStyle(el).cursor === 'pointer';
      // Frameworks keep parent dialogs mounted below their child dialogs. Such
      // controls remain geometrically visible in the DOM but a user cannot
      // touch them through the modal backdrop, so discovery must not count them
      // as a second actionable candidate.
      const isIconSemanticLeaf = el.matches('mat-icon, tcbs-icon, .material-icons');
      const inFrontLayer = !frontModal || frontModal.contains(el);
      // Covered controls are definitely not actionable. A visible icon in the
      // front layer with no onclick/cursor metadata is merely unknown: Angular
      // and React handlers are not represented by either signal.
      const interactive = !inFrontLayer
        ? false
        : ownsInteraction
          ? true
          : isIconSemanticLeaf
            ? undefined
            : false;
      let css: string | undefined;
      if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
        css = `#${CSS.escape(el.id)}`;
      } else if (customName) {
        const escaped = customName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const byName = `${el.tagName.toLowerCase()}[name="${escaped}"]`;
        if (document.querySelectorAll(byName).length === 1) css = byName;
      }
      if (!css && stableClasses) {
        const tokens = stableClasses.split(/\s+/).filter((token) =>
          /^[a-z][a-z0-9_-]{3,}$/i.test(token) &&
          !/^(?:active|disabled|selected|focus(?:ed)?|hover|show|open)$/i.test(token),
        );
        // Prefer names that describe a control/action. Layout utility classes
        // may also be unique today, but are not the element's identity.
        tokens.sort((a, b) =>
          Number(!/(?:^|[-_])(btn|button|add|create|save|delete|close|menu|search)(?:$|[-_])/i.test(a)) -
          Number(!/(?:^|[-_])(btn|button|add|create|save|delete|close|menu|search)(?:$|[-_])/i.test(b)),
        );
        for (const token of tokens) {
          const candidate = `${el.tagName.toLowerCase()}.${CSS.escape(token)}`;
          if (document.querySelectorAll(candidate).length === 1) {
            css = candidate;
            break;
          }
        }
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
        interactive,
        container: el.children.length > 0,
        disabled: el.disabled === true,
        visible: rect.width > 0 && rect.height > 0,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    });
}

/**
 * Cùng đoạn quét, nhưng ở dạng CHUỖI — và đây mới là dạng dùng được thật.
 *
 * WebdriverIO và Playwright đều nhận một hàm, nhưng để gửi được vào trang thì
 * hàm phải đi qua `toString()`. Mà tsx/esbuild bọc mỗi hàm bằng `__name(...)`
 * để giữ tên khi transpile, và bên trong WebView không có `__name` — nên phần
 * thân hỏng LẶNG LẼ: trả về mảng rỗng, không ném lỗi, không dấu vết.
 *
 * Đo trên máy thật ngày 2026-09-10, cùng một lúc trên cùng một trang:
 *
 *   gọi bằng HÀM: 0 phần tử  |  gọi bằng CHUỖI: 51
 *
 * Bốn lượt truy đi tìm nguyên nhân ở context, ở trạng thái trang, ở bộ chọn —
 * trong khi nó nằm ở đúng chỗ mà PopupInterceptor.ts đã ghi lại từ trước.
 *
 * Và trả về JSON.stringify chứ không trả mảng đối tượng: cùng đoạn quét, trả
 * về `.length` thì ra 51, trả về cả mảng thì bên nhận được mảng rỗng — khâu
 * tuần tự hoá kết quả qua Appium không chịu nổi 51 đối tượng lồng nhau. Một
 * chuỗi thì luôn qua được, và JSON.parse ở phía mình là chuyện vặt.
 */
export const DOM_OBSERVE_SCRIPT = `return JSON.stringify((${observeDomInPage.toString()})());`;
