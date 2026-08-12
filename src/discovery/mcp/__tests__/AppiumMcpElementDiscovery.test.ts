/**
 * Tests for AppiumMcpElementDiscovery — Phase 1.1 Blocker #2.
 *
 * Verifies:
 *   E. observe() delegates to AppiumMcpContextManager.observeWithFallback()
 *   F. ContextManager returns NATIVE_APP → observe() returns it unchanged
 *   G. ContextManager returns WEBVIEW → observe() returns it unchanged (no double switch)
 *   H. findElement() throws NotImplementedError (Path C disabled)
 *   I. Real Android XML → UiObservation via NativeObservationAdapter
 *   Path separation: Path A (observe) never calls findByLocator() or client.findElement()
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AppiumMcpElementDiscovery } from '../AppiumMcpElementDiscovery.js';
import { AppiumMcpContextManager } from '../AppiumMcpContextManager.js';
import { NotImplementedError } from '../AppiumMcpErrors.js';
import type { AppiumMcpSession } from '../AppiumMcpSession.js';
import type { McpClient } from '../../ai/AiDiscoveryTypes.js';
import type { UiObservation } from '../../UiObservation.js';

// ── fixtures ──────────────────────────────────────────────────────────────────

/** Representative Android XML with two interactive elements. */
const ANDROID_XML = `<?xml version="1.0"?>
<hierarchy rotation="0">
  <node index="0" class="android.widget.FrameLayout" clickable="false" enabled="true"
        displayed="true" bounds="[0,0][1080,2160]">
    <node index="0" class="android.widget.Button" text="Login"
          resource-id="com.example:id/btn_login" content-desc="Login button"
          clickable="true" enabled="true" displayed="true"
          bounds="[100,700][980,820]"/>
    <node index="1" class="android.widget.EditText" text=""
          resource-id="com.example:id/email_input" content-desc="Email"
          clickable="true" enabled="true" displayed="true"
          bounds="[100,400][980,520]"/>
  </node>
</hierarchy>`;

function makeUiObservation(usedContext: 'NATIVE_APP' | 'WEBVIEW'): UiObservation {
  return {
    id: `obs-${usedContext}`,
    timestamp: new Date().toISOString(),
    platform: usedContext === 'NATIVE_APP' ? 'android' : 'web',
    source: usedContext === 'NATIVE_APP' ? 'native' : 'webview',
    context: { webContext: usedContext === 'WEBVIEW' ? 'WEBVIEW_com.example' : undefined },
    elements: [
      {
        id: 'el-0',
        role: usedContext === 'NATIVE_APP' ? 'android.widget.Button' : 'button',
        text: 'Login',
        visible: true,
        enabled: true,
        interactive: true,
        index: 0,
      },
    ],
  };
}

// ── mock builders ─────────────────────────────────────────────────────────────

interface ManagerSpy {
  manager: AppiumMcpContextManager;
  callCount: { observeWithFallback: number };
}

function makeManagerSpy(usedContext: 'NATIVE_APP' | 'WEBVIEW'): ManagerSpy {
  const callCount = { observeWithFallback: 0 };
  const observation = makeUiObservation(usedContext);

  const manager = {
    observeWithFallback: async () => {
      callCount.observeWithFallback++;
      return { observation, usedContext };
    },
  } as unknown as AppiumMcpContextManager;

  return { manager, callCount };
}

interface ClientSpy {
  client: McpClient;
  calls: { inspect: number; findElement: number };
}

function makeClientSpy(overrides: Partial<McpClient> = {}): ClientSpy {
  const calls = { inspect: 0, findElement: 0 };
  const client: McpClient = {
    inspect: async () => {
      calls.inspect++;
      return ANDROID_XML;
    },
    findElement: async (_desc: string) => {
      calls.findElement++;
      return {};
    },
    screenshot: async () => '',
    ...overrides,
  };
  return { client, calls };
}

/** Minimal AppiumMcpSession where findByLocator is tracked. */
function makeSpySession(xml: string): AppiumMcpSession & { findByLocatorCallCount: number } {
  let currentCtx = 'NATIVE_APP';
  const obj = {
    findByLocatorCallCount: 0,
    create: async () => undefined,
    delete: async () => undefined,
    currentContext: async () => currentCtx,
    switchContext: async (name: string) => { currentCtx = name; },
    listContexts: async () => ['NATIVE_APP'],
    getPageSource: async () => xml,
    findByLocator: async (): Promise<string> => {
      obj.findByLocatorCallCount++;
      return 'should-not-be-called';
    },
    tap: async () => undefined,
    setValue: async () => undefined,
    getText: async () => null,
    screenshot: async () => '',
  };
  return obj;
}

// ── TEST E: observe() delegates to ContextManager ─────────────────────────────

describe('AppiumMcpElementDiscovery — TEST E: observe() delegates to ContextManager', () => {
  it('calls observeWithFallback() exactly once', async () => {
    const { manager, callCount } = makeManagerSpy('NATIVE_APP');
    const { client } = makeClientSpy();
    const discovery = new AppiumMcpElementDiscovery(client, manager);

    await discovery.observe();

    assert.equal(callCount.observeWithFallback, 1, 'observeWithFallback() must be called exactly once');
  });

  it('returns the UiObservation from ContextManager', async () => {
    const { manager } = makeManagerSpy('NATIVE_APP');
    const { client } = makeClientSpy();
    const discovery = new AppiumMcpElementDiscovery(client, manager);

    const result = await discovery.observe();

    assert.ok(result, 'must return a UiObservation');
    assert.ok(result.elements.length > 0, 'observation must have elements from ContextManager');
  });

  it('does NOT call client.inspect() when contextManager is present', async () => {
    const { manager } = makeManagerSpy('NATIVE_APP');
    const { client, calls } = makeClientSpy();
    const discovery = new AppiumMcpElementDiscovery(client, manager);

    await discovery.observe();

    assert.equal(calls.inspect, 0, 'client.inspect() must NOT be called — ContextManager is the entry point');
  });

  it('does NOT call client.findElement()', async () => {
    const { manager } = makeManagerSpy('NATIVE_APP');
    const { client, calls } = makeClientSpy();
    const discovery = new AppiumMcpElementDiscovery(client, manager);

    await discovery.observe();

    assert.equal(calls.findElement, 0, 'client.findElement() must NOT be called from observe()');
  });
});

// ── TEST F: NATIVE_APP observation passthrough ────────────────────────────────

describe('AppiumMcpElementDiscovery — TEST F: NATIVE_APP observation returned unchanged', () => {
  it('returns native observation with platform=android and source=native', async () => {
    const { manager } = makeManagerSpy('NATIVE_APP');
    const { client } = makeClientSpy();
    const discovery = new AppiumMcpElementDiscovery(client, manager);

    const result = await discovery.observe();

    assert.equal(result.platform, 'android');
    assert.equal(result.source, 'native');
  });

  it('observation id matches the one from ContextManager', async () => {
    const { manager } = makeManagerSpy('NATIVE_APP');
    const { client } = makeClientSpy();
    const discovery = new AppiumMcpElementDiscovery(client, manager);

    const result = await discovery.observe();

    assert.equal(result.id, 'obs-NATIVE_APP');
  });
});

// ── TEST G: WEBVIEW observation passthrough ───────────────────────────────────

describe('AppiumMcpElementDiscovery — TEST G: WEBVIEW observation returned unchanged', () => {
  it('returns webview observation with platform=web and source=webview', async () => {
    const { manager } = makeManagerSpy('WEBVIEW');
    const { client } = makeClientSpy();
    const discovery = new AppiumMcpElementDiscovery(client, manager);

    const result = await discovery.observe();

    assert.equal(result.platform, 'web');
    assert.equal(result.source, 'webview');
  });

  it('calls observeWithFallback() exactly once — AppiumMcpElementDiscovery does not do its own context switch', async () => {
    const { manager, callCount } = makeManagerSpy('WEBVIEW');
    const { client } = makeClientSpy();
    const discovery = new AppiumMcpElementDiscovery(client, manager);

    await discovery.observe();

    assert.equal(callCount.observeWithFallback, 1, 'no double context switch — ContextManager handles it');
  });
});

// ── TEST H: findElement() is Path C (disabled) ───────────────────────────────

describe('AppiumMcpElementDiscovery — TEST H: findElement() is disabled', () => {
  it('throws NotImplementedError', () => {
    const { client } = makeClientSpy();
    const discovery = new AppiumMcpElementDiscovery(client);

    assert.throws(
      () => discovery.findElement({ id: 'some-intent', action: 'tap' }),
      (err) => {
        assert.ok(err instanceof NotImplementedError, `expected NotImplementedError, got ${err}`);
        assert.equal(err.name, 'NotImplementedError');
        return true;
      },
    );
  });

  it('error message names the method', () => {
    const { client } = makeClientSpy();
    const discovery = new AppiumMcpElementDiscovery(client);

    try {
      discovery.findElement({ id: 'x', action: 'tap' });
      assert.fail('must throw');
    } catch (err) {
      assert.ok((err as Error).message.includes('AppiumMcpElementDiscovery.findElement'));
    }
  });

  it('never calls client.inspect() or client.findElement() when findElement throws', () => {
    const { client, calls } = makeClientSpy();
    const discovery = new AppiumMcpElementDiscovery(client);

    try { discovery.findElement({ id: 'x', action: 'tap' }); } catch { /* expected */ }

    assert.equal(calls.inspect, 0);
    assert.equal(calls.findElement, 0);
  });
});

// ── TEST I: real Android XML → UiObservation via NativeObservationAdapter ────

describe('AppiumMcpElementDiscovery — TEST I: real XML → UiObservation', () => {
  it('inspect() converts Android XML to UiObservation with correct platform', async () => {
    const { client } = makeClientSpy();
    const discovery = new AppiumMcpElementDiscovery(client);

    const result = await discovery.inspect();

    assert.equal(result.platform, 'android', 'raw XML must produce platform=android');
  });

  it('parsed observation has the expected number of elements from the XML', async () => {
    const { client } = makeClientSpy();
    const discovery = new AppiumMcpElementDiscovery(client);

    const result = await discovery.inspect();

    // ANDROID_XML has 3 nodes: FrameLayout + Button + EditText.
    // NativeObservationAdapter includes all nodes including containers.
    assert.ok(result.elements.length >= 2, `must parse ≥2 elements from XML, got ${result.elements.length}`);
  });

  it('Login button is correctly parsed with interactive=true', async () => {
    const { client } = makeClientSpy();
    const discovery = new AppiumMcpElementDiscovery(client);

    const result = await discovery.inspect();

    const loginEl = result.elements.find((e) => e.text === 'Login');
    assert.ok(loginEl, 'must find element with text="Login"');
    assert.ok(loginEl.enabled, 'enabled="true" must map to enabled=true');
    assert.ok(loginEl.interactive, 'clickable="true" must map to interactive=true');
  });

  it('Email input is correctly parsed', async () => {
    const { client } = makeClientSpy();
    const discovery = new AppiumMcpElementDiscovery(client);

    const result = await discovery.inspect();

    const emailEl = result.elements.find(
      (e) => e.accessibilityLabel === 'Email' || e.resourceId?.includes('email'),
    );
    assert.ok(emailEl, 'must find Email input element');
    assert.ok(emailEl.enabled, 'Email input must be enabled');
  });

  it('inspect() calls client.inspect() exactly once', async () => {
    const { client, calls } = makeClientSpy();
    const discovery = new AppiumMcpElementDiscovery(client);

    await discovery.inspect();

    assert.equal(calls.inspect, 1, 'client.inspect() must be called exactly once');
  });
});

// ── Path separation: Path A never calls findByLocator() ──────────────────────

describe('AppiumMcpElementDiscovery — Path A never calls findByLocator()', () => {
  it('observe() via ContextManager never calls session.findByLocator()', async () => {
    // Uses a REAL AppiumMcpContextManager wrapping a spy session.
    // If any code in Path A calls findByLocator(), the spy records it.
    const spySession = makeSpySession(ANDROID_XML);
    const contextManager = new AppiumMcpContextManager(spySession, false);

    const { client } = makeClientSpy();
    const discovery = new AppiumMcpElementDiscovery(client, contextManager);

    await discovery.observe();

    assert.equal(
      spySession.findByLocatorCallCount,
      0,
      'Path A (observe → ContextManager → getPageSource → parser) must NEVER call findByLocator()',
    );
  });

  it('inspect() never calls client.findElement()', async () => {
    const { client, calls } = makeClientSpy();
    const discovery = new AppiumMcpElementDiscovery(client);

    await discovery.inspect();

    assert.equal(calls.findElement, 0, 'inspect() (Path A) must never call client.findElement()');
  });
});

// ── fallback path: observe() without ContextManager ──────────────────────────

describe('AppiumMcpElementDiscovery — observe() fallback (no ContextManager)', () => {
  it('falls back to inspect() when no contextManager is provided', async () => {
    const { client, calls } = makeClientSpy();
    const discovery = new AppiumMcpElementDiscovery(client); // no contextManager

    const result = await discovery.observe();

    assert.equal(calls.inspect, 1, 'without contextManager, observe() must fall back to inspect()');
    assert.ok(result.elements.length > 0, 'fallback observation must have elements');
  });
});
