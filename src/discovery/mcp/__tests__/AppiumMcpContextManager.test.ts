import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AppiumMcpContextManager } from '../AppiumMcpContextManager.js';
import type { AppiumMcpSession } from '../AppiumMcpSession.js';

// ── fixture XML ───────────────────────────────────────────────────────────────

const NATIVE_XML_WITH_INTERACTIVE = `<?xml version="1.0"?>
<hierarchy>
  <node class="android.widget.FrameLayout" clickable="false" enabled="true" displayed="true"
        bounds="[0,0][1080,2160]">
    <node class="android.widget.Button" text="Login" clickable="true" enabled="true"
          displayed="true" bounds="[100,700][980,820]"/>
  </node>
</hierarchy>`;

const NATIVE_XML_NO_INTERACTIVE = `<?xml version="1.0"?>
<hierarchy>
  <node class="android.widget.FrameLayout" clickable="false" enabled="true" displayed="true"
        bounds="[0,0][1080,2160]">
    <node class="android.widget.TextView" text="Loading..." clickable="false" enabled="true"
          displayed="true" bounds="[100,400][980,480]"/>
  </node>
</hierarchy>`;

const WEBVIEW_HTML = `<!DOCTYPE html>
<html class="plt-android plt-capacitor">
<body>
  <ion-app>
    <ion-button id="login-btn" aria-label="Login">Login</ion-button>
    <ion-input placeholder="Email" data-testid="email-input"></ion-input>
  </ion-app>
</body>
</html>`;

// ── mock session builder ──────────────────────────────────────────────────────

interface SessionSetup {
  nativeXml?: string;
  webviewHtml?: string;
  /** Track context switches in order. */
  contextSwitches?: string[];
  switchContextError?: Error;
}

function makeSession(setup: SessionSetup = {}): AppiumMcpSession & { contextSwitches: string[] } {
  const switches: string[] = [];
  setup.contextSwitches = switches;

  let currentCtx = 'NATIVE_APP';

  return {
    create: async () => undefined,
    delete: async () => undefined,
    currentContext: async () => currentCtx,
    switchContext: async (name: string) => {
      if (setup.switchContextError && name !== 'NATIVE_APP') throw setup.switchContextError;
      switches.push(name);
      currentCtx = name;
    },
    listContexts: async () => ['NATIVE_APP', 'WEBVIEW_com.fss.tcbs.mobiletrading'],
    getPageSource: async () => {
      if (currentCtx === 'NATIVE_APP') return setup.nativeXml ?? NATIVE_XML_WITH_INTERACTIVE;
      return setup.webviewHtml ?? WEBVIEW_HTML;
    },
    findByLocator: async () => 'uuid',
    tap: async () => undefined,
    setValue: async () => undefined,
    getText: async () => null,
    screenshot: async () => '',
    contextSwitches: switches,
  };
}

// ── hybrid=false ──────────────────────────────────────────────────────────────

describe('AppiumMcpContextManager — hybrid=false', () => {
  it('returns NATIVE_APP observation without switching to WebView', async () => {
    const session = makeSession({ nativeXml: NATIVE_XML_WITH_INTERACTIVE });
    const mgr = new AppiumMcpContextManager(session, false);
    const { usedContext } = await mgr.observeWithFallback();
    assert.equal(usedContext, 'NATIVE_APP');
  });

  it('switches to NATIVE_APP at start but never to WEBVIEW', async () => {
    const session = makeSession({ nativeXml: NATIVE_XML_NO_INTERACTIVE });
    const mgr = new AppiumMcpContextManager(session, false);
    await mgr.observeWithFallback();
    assert.ok(
      !session.contextSwitches.includes('WEBVIEW_com.fss.tcbs.mobiletrading'),
      'WEBVIEW must never be switched to when hybrid=false',
    );
  });
});

// ── hybrid=true + native has interactive elements ─────────────────────────────

describe('AppiumMcpContextManager — hybrid=true, native has interactive elements', () => {
  it('returns NATIVE_APP observation', async () => {
    const session = makeSession({ nativeXml: NATIVE_XML_WITH_INTERACTIVE });
    const mgr = new AppiumMcpContextManager(session, true);
    const { usedContext } = await mgr.observeWithFallback();
    assert.equal(usedContext, 'NATIVE_APP');
  });

  it('does not switch to WEBVIEW', async () => {
    const session = makeSession({ nativeXml: NATIVE_XML_WITH_INTERACTIVE });
    const mgr = new AppiumMcpContextManager(session, true);
    await mgr.observeWithFallback();
    assert.ok(
      !session.contextSwitches.includes('WEBVIEW_com.fss.tcbs.mobiletrading'),
    );
  });

  it('observation has elements', async () => {
    const session = makeSession({ nativeXml: NATIVE_XML_WITH_INTERACTIVE });
    const mgr = new AppiumMcpContextManager(session, true);
    const { observation } = await mgr.observeWithFallback();
    assert.ok(observation.elements.length > 0);
  });
});

// ── hybrid=true + native has zero interactive elements ────────────────────────

describe('AppiumMcpContextManager — hybrid=true, native has no interactive elements', () => {
  it('switches to WEBVIEW and returns WEBVIEW observation', async () => {
    const session = makeSession({ nativeXml: NATIVE_XML_NO_INTERACTIVE });
    const mgr = new AppiumMcpContextManager(session, true);
    const { usedContext } = await mgr.observeWithFallback();
    assert.equal(usedContext, 'WEBVIEW');
  });

  it('usedContext is WEBVIEW when fallback triggered', async () => {
    const session = makeSession({ nativeXml: NATIVE_XML_NO_INTERACTIVE });
    const mgr = new AppiumMcpContextManager(session, true);
    const result = await mgr.observeWithFallback();
    assert.equal(result.usedContext, 'WEBVIEW');
  });

  it('restores NATIVE_APP after WEBVIEW observation', async () => {
    const session = makeSession({ nativeXml: NATIVE_XML_NO_INTERACTIVE });
    const mgr = new AppiumMcpContextManager(session, true);
    await mgr.observeWithFallback();
    // Last switch must be back to NATIVE_APP
    const switches = session.contextSwitches;
    assert.equal(switches[switches.length - 1], 'NATIVE_APP');
  });

  it('WebView observation has interactive elements from HTML', async () => {
    const session = makeSession({
      nativeXml: NATIVE_XML_NO_INTERACTIVE,
      webviewHtml: WEBVIEW_HTML,
    });
    const mgr = new AppiumMcpContextManager(session, true);
    const { observation } = await mgr.observeWithFallback();
    assert.ok(observation.elements.length > 0, 'WebView HTML must produce elements');
    assert.ok(
      observation.elements.some((e) => e.interactive),
      'WebView elements must be interactive',
    );
  });

  it('observation context.webContext is set to WEBVIEW name', async () => {
    const session = makeSession({ nativeXml: NATIVE_XML_NO_INTERACTIVE });
    const mgr = new AppiumMcpContextManager(session, true);
    const { observation } = await mgr.observeWithFallback();
    assert.equal(
      observation.context.webContext,
      'WEBVIEW_com.fss.tcbs.mobiletrading',
    );
  });
});

// ── WebView failure restores NATIVE_APP ───────────────────────────────────────

describe('AppiumMcpContextManager — WebView failure recovery', () => {
  it('restores NATIVE_APP even when WEBVIEW observation throws', async () => {
    const session = makeSession({ nativeXml: NATIVE_XML_NO_INTERACTIVE });
    const switches: string[] = [];
    let getPageSourceCallCount = 0;
    let currentCtx = 'NATIVE_APP';

    const failingSession: AppiumMcpSession & { contextSwitches: string[] } = {
      ...session,
      contextSwitches: switches,
      switchContext: async (name: string) => {
        switches.push(name);
        currentCtx = name;
      },
      getPageSource: async () => {
        getPageSourceCallCount++;
        if (currentCtx !== 'NATIVE_APP') throw new Error('WebView page source failed');
        return NATIVE_XML_NO_INTERACTIVE;
      },
    };

    const mgr = new AppiumMcpContextManager(failingSession, true);
    await assert.rejects(() => mgr.observeWithFallback(), Error);

    // lastIndexOf: the first 'NATIVE_APP' is the initial switch; the final one
    // (after WEBVIEW) is the one that proves restoration happened.
    assert.ok(
      switches.includes('NATIVE_APP') &&
        switches.lastIndexOf('NATIVE_APP') > switches.indexOf('WEBVIEW_com.fss.tcbs.mobiletrading'),
      `NATIVE_APP must be restored after WEBVIEW switch even on error. switches: ${JSON.stringify(switches)}`,
    );
  });

  it('rethrows the WebView error', async () => {
    const session = makeSession({ nativeXml: NATIVE_XML_NO_INTERACTIVE });
    let currentCtx = 'NATIVE_APP';
    const failingSession: AppiumMcpSession = {
      ...session,
      switchContext: async (name: string) => { currentCtx = name; },
      getPageSource: async () => {
        if (currentCtx !== 'NATIVE_APP') throw new Error('WebView timeout');
        return NATIVE_XML_NO_INTERACTIVE;
      },
    };
    const mgr = new AppiumMcpContextManager(failingSession, true);
    await assert.rejects(
      () => mgr.observeWithFallback(),
      (err) => {
        assert.ok((err as Error).message.includes('WebView timeout'));
        return true;
      },
    );
  });
});
