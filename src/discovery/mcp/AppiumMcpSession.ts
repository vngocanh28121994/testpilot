/**
 * AppiumMcpSession — typed wrapper over the appium-mcp MCP tool set.
 *
 * Responsibilities:
 *   - Session lifecycle (create / delete)
 *   - Context management (switch NATIVE_APP / WEBVIEW)
 *   - Observation: getPageSource() → raw XML or HTML string
 *   - Locator resolution: findByLocator(strategy, value) → ephemeral elementUUID
 *   - Interaction: tap / setValue / getText using ephemeral UUID
 *   - Screenshot
 *
 * IMPORTANT — two distinct paths:
 *   Path A (discovery): getPageSource() → NativeObservationAdapter → UiObservation
 *   Path B (interaction): findByLocator(strategy, value) → UUID → tap/setValue/getText
 *
 * findByLocator() calls appium_find_element ONLY to resolve an already-approved
 * locator to an ephemeral UUID.  It is NOT a discovery engine.
 * The locator MUST originate from the deterministic discovery pipeline.
 *
 * UUIDs are NEVER cached and NEVER written to RuntimeRegistry.
 * A UUID is valid for exactly ONE interaction after the page source that produced
 * its locator was observed.  Any UI mutation invalidates it (StaleElementError).
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { AppiumMcpResponseAdapter } from './AppiumMcpResponseAdapter.js';
import { StaleElementError } from './AppiumMcpErrors.js';
import { TestPilotError, TestPilotErrorCode } from '../../core/ErrorCodes.js';

// ── public interface ──────────────────────────────────────────────────────────

export interface AppiumMcpSession {
  // ── lifecycle ───────────────────────────────────────────────────────────────

  /** Create an Appium session.  capabilities is serialised to JSON internally. */
  create(caps: Record<string, unknown>): Promise<void>;

  /** Delete the active Appium session and close the MCP transport. */
  delete(): Promise<void>;

  // ── context ─────────────────────────────────────────────────────────────────

  /** Return the active Appium context name (e.g. 'NATIVE_APP'). */
  currentContext(): Promise<string>;

  /** Switch to a named Appium context (e.g. 'WEBVIEW_com.fss.tcbs.mobiletrading'). */
  switchContext(name: string): Promise<void>;

  /** List all available Appium context names. */
  listContexts(): Promise<string[]>;

  // ── observation (Path A) ───────────────────────────────────────────────────

  /**
   * Fetch the current page source.
   * Returns raw XML (NATIVE_APP) or HTML (WEBVIEW), with the markdown fence stripped.
   */
  getPageSource(): Promise<string>;

  // ── locator resolution (Path B only) ──────────────────────────────────────

  /**
   * Resolve a known locator to an ephemeral elementUUID.
   *
   * The locator MUST come from the deterministic discovery pipeline output.
   * The returned UUID is valid for exactly ONE interaction.
   * DO NOT cache or store the UUID.
   *
   * Throws TestPilotError(PROVIDER_ELEMENT_NOT_FOUND) if no matching element exists.
   * Never throws StaleElementError — element-not-found and stale are different errors.
   */
  findByLocator(strategy: string, value: string): Promise<string>;

  // ── interaction (Path B only) ─────────────────────────────────────────────

  /** Tap the element identified by elementUUID.  Throws StaleElementError if stale. */
  tap(elementUUID: string): Promise<void>;

  /** Set text value.  Throws StaleElementError if stale. */
  setValue(elementUUID: string, text: string): Promise<void>;

  /**
   * Get element text value.
   * Returns null for empty / Capacitor WebView-managed fields.
   * Throws StaleElementError if stale.
   */
  getText(elementUUID: string): Promise<string | null>;

  // ── screenshot ─────────────────────────────────────────────────────────────

  /** Capture a screenshot.  Returns base64 PNG. */
  screenshot(): Promise<string>;
}

// ── concrete implementation ───────────────────────────────────────────────────

/** Options for AppiumMcpClientSession.connect() */
export interface AppiumMcpConnectOptions {
  /** Path or name of the appium-mcp binary (e.g. 'appium-mcp'). */
  command: string;
  /** Additional environment variables merged onto process.env. */
  env?: Record<string, string>;
}

/**
 * AppiumMcpSession backed by a real @modelcontextprotocol/sdk Client.
 *
 * Instantiate via `AppiumMcpClientSession.connect()` for production use.
 * Inject a mock Client directly for unit tests.
 */
export class AppiumMcpClientSession implements AppiumMcpSession {
  constructor(private readonly client: Client) {}

  /** Connect to appium-mcp via stdio and return a session ready for create(). */
  static async connect(opts: AppiumMcpConnectOptions): Promise<AppiumMcpClientSession> {
    const client = new Client({ name: 'testpilot', version: '0.1.0' }, { capabilities: {} });
    await client.connect(
      new StdioClientTransport({
        command: opts.command,
        // Always inherit process.env so the subprocess sees PATH, ANDROID_HOME, etc.
        env: { ...(process.env as Record<string, string>), ...opts.env },
        stderr: 'pipe',
      }),
    );
    return new AppiumMcpClientSession(client);
  }

  // ── lifecycle ───────────────────────────────────────────────────────────────

  async create(caps: Record<string, unknown>): Promise<void> {
    // appium-mcp requires `platform` as a top-level argument alongside capabilities.
    // Derive it from platformName (caps may use the bare key or the appium: prefix).
    const platformName =
      (caps['platformName'] ?? caps['appium:platformName'] ?? 'android') as string;
    const platform = platformName.toLowerCase() === 'ios' ? 'ios' : 'android';

    const res = await this.client.callTool(
      {
        name: 'appium_session_management',
        arguments: {
          action: 'create',
          platform,
          capabilities: JSON.stringify(caps),
        },
      },
      undefined,
      { timeout: 180_000 },
    );
    this.assertNotError(res, 'appium_session_management create');
  }

  async delete(): Promise<void> {
    try {
      const res = await this.client.callTool(
        { name: 'appium_session_management', arguments: { action: 'delete' } },
        undefined,
        { timeout: 30_000 },
      );
      this.assertNotError(res, 'appium_session_management delete');
    } finally {
      await this.client.close().catch(() => undefined);
    }
  }

  // ── context ─────────────────────────────────────────────────────────────────

  async currentContext(): Promise<string> {
    const res = await this.client.callTool({
      name: 'appium_context',
      arguments: { action: 'list' },
    });
    this.assertNotError(res, 'appium_context list (for currentContext)');
    // The plain-text list response indicates the current context.
    // appium-mcp typically marks it with "* " or "Current context: ...".
    // Fall back to 'NATIVE_APP' if detection is unclear.
    const text = this.extractText(res);
    const currentMatch = /current context[:\s]+([^\n]+)/i.exec(text) ??
                         /\*\s*([^\n]+)/.exec(text);
    return currentMatch?.[1]?.trim() ?? 'NATIVE_APP';
  }

  async switchContext(name: string): Promise<void> {
    const isWebView = name !== 'NATIVE_APP';
    const timeout = isWebView ? 90_000 : 30_000;
    const res = await this.client.callTool(
      { name: 'appium_context', arguments: { action: 'switch', context: name } },
      undefined,
      { timeout },
    );
    this.assertNotError(res, `appium_context switch ${name}`);
  }

  async listContexts(): Promise<string[]> {
    const res = await this.client.callTool({
      name: 'appium_context',
      arguments: { action: 'list' },
    });
    this.assertNotError(res, 'appium_context list');
    return AppiumMcpResponseAdapter.extractContextList(res);
  }

  // ── observation ─────────────────────────────────────────────────────────────

  async getPageSource(): Promise<string> {
    const res = await this.client.callTool({
      name: 'appium_get_page_source',
      arguments: {},
    });
    this.assertNotError(res, 'appium_get_page_source');
    return AppiumMcpResponseAdapter.extractPageSource(res);
  }

  // ── locator resolution ───────────────────────────────────────────────────

  async findByLocator(strategy: string, value: string): Promise<string> {
    let res: Awaited<ReturnType<Client['callTool']>>;
    try {
      // appium-mcp's appium_find_element uses "selector" (not "value") for the locator string.
      res = await this.client.callTool({
        name: 'appium_find_element',
        arguments: { strategy, selector: value },
      });
    } catch (err) {
      throw new TestPilotError(
        TestPilotErrorCode.PROVIDER_ELEMENT_NOT_FOUND,
        `appium_find_element threw: ${(err as Error).message}`,
        { strategy, value },
      );
    }

    // appium-mcp may return isError:true when the element doesn't exist.
    if ((res as { isError?: boolean }).isError) {
      throw new TestPilotError(
        TestPilotErrorCode.PROVIDER_ELEMENT_NOT_FOUND,
        `appium_find_element: ${this.extractText(res)}`,
        { strategy, value },
      );
    }

    try {
      return AppiumMcpResponseAdapter.extractElementUuid(res);
    } catch {
      throw new TestPilotError(
        TestPilotErrorCode.PROVIDER_ELEMENT_NOT_FOUND,
        `findByLocator: no UUID in response for ${strategy}="${value}"`,
        { strategy, value },
      );
    }
  }

  // ── interaction ──────────────────────────────────────────────────────────

  async tap(elementUUID: string): Promise<void> {
    const res = await this.client.callTool({
      name: 'appium_gesture',
      // appium-mcp uses "action" (not "gesture") and "tap" (not "click").
      arguments: { elementUUID, action: 'tap' },
    });
    this.checkStale(res, elementUUID);
    this.assertNotError(res, 'appium_gesture tap');
  }

  async setValue(elementUUID: string, text: string): Promise<void> {
    const res = await this.client.callTool({
      name: 'appium_set_value',
      arguments: { elementUUID, text },
    });
    this.checkStale(res, elementUUID);
    this.assertNotError(res, 'appium_set_value');
  }

  async getText(elementUUID: string): Promise<string | null> {
    const res = await this.client.callTool({
      name: 'appium_get_text',
      arguments: { elementUUID },
    });
    this.checkStale(res, elementUUID);
    this.assertNotError(res, 'appium_get_text');
    return AppiumMcpResponseAdapter.extractTextValue(res);
  }

  // ── screenshot ─────────────────────────────────────────────────────────────

  async screenshot(): Promise<string> {
    const res = await this.client.callTool({
      name: 'appium_screenshot',
      arguments: {},
    });
    this.assertNotError(res, 'appium_screenshot');
    return AppiumMcpResponseAdapter.extractScreenshotBase64(res);
  }

  // ── private helpers ───────────────────────────────────────────────────────

  private extractText(res: unknown): string {
    const content = ((res as Record<string, unknown>)?.['content'] ?? []) as Array<{
      type: string;
      text?: string;
    }>;
    const item = content.find((c) => c.type === 'text');
    return item?.text ?? '';
  }

  /**
   * Check whether an interaction response signals a stale element.
   * Must be called BEFORE assertNotError so the typed StaleElementError is raised
   * instead of a generic error.
   */
  private checkStale(res: unknown, elementUUID: string, strategy?: string, value?: string): void {
    const isError = (res as { isError?: boolean }).isError;
    if (isError) {
      const msg = this.extractText(res);
      if (AppiumMcpResponseAdapter.isStaleElementError(msg)) {
        throw new StaleElementError(elementUUID, strategy, value);
      }
    }
  }

  private assertNotError(res: unknown, toolName: string): void {
    if ((res as { isError?: boolean }).isError) {
      const msg = this.extractText(res);
      throw new Error(`appium-mcp tool "${toolName}" failed: ${msg}`);
    }
  }
}
