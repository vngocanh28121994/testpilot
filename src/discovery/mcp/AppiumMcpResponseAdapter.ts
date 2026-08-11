/**
 * Typed boundary for all raw appium-mcp MCP tool responses.
 *
 * Every callTool() result in AppiumMcpSession must pass through one of these
 * static methods.  Nothing else in the codebase may parse raw MCP output.
 *
 * All methods accept `unknown` and throw descriptive errors on malformed input.
 */

export class AppiumMcpResponseAdapter {
  /**
   * Extract raw page source (XML or HTML) from an appium_get_page_source response.
   *
   * appium-mcp wraps the content in a markdown code fence:
   *   "Page source retrieved successfully:\n```xml\n...\n```"
   *   "Page source retrieved successfully:\n```html\n...\n```"
   *
   * Returns the unwrapped XML or HTML string.
   * Throws if the expected code fence is absent.
   */
  static extractPageSource(raw: unknown): string {
    const text = firstTextContent(raw);
    const match = /```(?:xml|html|XML|HTML)\r?\n([\s\S]*?)\r?\n?```/.exec(text);
    if (!match || match[1] == null) {
      throw new Error(
        `extractPageSource: no code fence found in appium_get_page_source response. ` +
          `First 300 chars: ${text.slice(0, 300)}`,
      );
    }
    return match[1].trim();
  }

  /**
   * Extract the ephemeral elementUUID from an appium_find_element plain-text response.
   *
   * Expected format:
   *   "elementId '<uuid>'\nSuccessfully found element..."
   *   "elementId \"<uuid>\"\nSuccessfully found element..."
   *
   * Throws if UUID cannot be extracted.
   */
  static extractElementUuid(raw: unknown): string {
    const text = firstTextContent(raw);
    const match = /elementId\s+['"]([^'"]+)['"]/.exec(text);
    if (!match || !match[1]) {
      throw new Error(
        `extractElementUuid: UUID not found in appium_find_element response. ` +
          `First 300 chars: ${text.slice(0, 300)}`,
      );
    }
    return match[1];
  }

  /**
   * Extract base64 PNG from an appium_screenshot image-type content block.
   *
   * appium-mcp returns: { type: 'image', data: '<base64>', mimeType: 'image/png' }
   * Throws if no image content is present.
   */
  static extractScreenshotBase64(raw: unknown): string {
    const content = asContentArray(raw);
    const imageItem = content.find((c) => c.type === 'image');
    if (
      !imageItem ||
      !('data' in imageItem) ||
      typeof imageItem['data'] !== 'string' ||
      !imageItem['data']
    ) {
      throw new Error(
        'extractScreenshotBase64: no image content block in appium_screenshot response',
      );
    }
    return imageItem['data'] as string;
  }

  /**
   * Extract text value from an appium_get_text plain-text response.
   *
   * Returns null for empty or missing text.
   * On Capacitor hybrid apps, native get_text on WebView-managed fields returns
   * an empty string — null is the correct representation (not a failure).
   */
  static extractTextValue(raw: unknown): string | null {
    try {
      const text = firstTextContent(raw).trim();
      return text.length > 0 ? text : null;
    } catch {
      return null;
    }
  }

  /**
   * Parse the plain-text context listing from appium_context action=list.
   *
   * Returns an array of context name strings (e.g. ['NATIVE_APP', 'WEBVIEW_com.example']).
   */
  static extractContextList(raw: unknown): string[] {
    const text = firstTextContent(raw);
    return text
      .split('\n')
      .map((l) => l.trim())
      .filter(
        (l) =>
          l.length > 0 &&
          !l.toLowerCase().startsWith('available context') &&
          !l.toLowerCase().startsWith('contexts:') &&
          !l.toLowerCase().startsWith('current context'),
      );
  }

  /**
   * Detect UiAutomator2 stale-element error patterns.
   *
   * Returns true ONLY for errors that indicate a UUID became invalid after a UI
   * mutation.  Generic "element not found" or "no such element" errors are NOT
   * stale and must NOT return true here.
   *
   * Patterns detected:
   *   - StaleObjectReferenceException (UiAutomator2 primary stale signal)
   *   - stale element reference (W3C WebDriver standard message)
   *   - StaleElementReferenceError (WebDriver JS error class name)
   *   - element is stale (Appium shorthand)
   */
  static isStaleElementError(raw: unknown): boolean {
    if (raw == null) return false;

    let text: string;
    if (typeof raw === 'string') {
      text = raw;
    } else if (
      typeof raw === 'object' &&
      'message' in raw &&
      typeof (raw as { message: unknown }).message === 'string'
    ) {
      text = (raw as { message: string }).message;
    } else {
      try {
        text = firstTextContent(raw);
      } catch {
        return false;
      }
    }

    const lower = text.toLowerCase();
    return (
      lower.includes('staleobjectreferenceexception') ||
      lower.includes('stale element reference') ||
      lower.includes('staleelementreferenceerror') ||
      lower.includes('element is stale')
    );
  }
}

// ── internal helpers ──────────────────────────────────────────────────────────

type ContentItem = { type: string; [key: string]: unknown };

function asContentArray(raw: unknown): ContentItem[] {
  if (raw == null || typeof raw !== 'object') return [];
  const r = raw as Record<string, unknown>;
  const arr = r['content'];
  return Array.isArray(arr) ? (arr as ContentItem[]) : [];
}

function firstTextContent(raw: unknown): string {
  // If raw is already a plain string (test convenience), return it directly.
  if (typeof raw === 'string') return raw;

  const content = asContentArray(raw);
  const item = content.find((c) => c['type'] === 'text');
  if (!item || typeof item['text'] !== 'string') {
    throw new Error(
      'firstTextContent: no text content item in MCP response. ' +
        `Received: ${JSON.stringify(raw).slice(0, 200)}`,
    );
  }
  return item['text'] as string;
}
