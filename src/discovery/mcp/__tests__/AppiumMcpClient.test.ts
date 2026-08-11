import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AppiumMcpClient } from '../AppiumMcpClient.js';
import { NotImplementedError } from '../AppiumMcpErrors.js';
import type { AppiumMcpSession } from '../AppiumMcpSession.js';

// ── mock session ──────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<AppiumMcpSession> = {}): AppiumMcpSession {
  return {
    create: async () => undefined,
    delete: async () => undefined,
    currentContext: async () => 'NATIVE_APP',
    switchContext: async () => undefined,
    listContexts: async () => ['NATIVE_APP'],
    getPageSource: async () => '<hierarchy></hierarchy>',
    findByLocator: async () => 'should-not-be-called',
    tap: async () => undefined,
    setValue: async () => undefined,
    getText: async () => null,
    screenshot: async () => 'base64data',
    ...overrides,
  };
}

// ── inspect ───────────────────────────────────────────────────────────────────

describe('AppiumMcpClient.inspect', () => {
  it('delegates to session.getPageSource()', async () => {
    let called = false;
    const session = makeSession({
      getPageSource: async () => {
        called = true;
        return '<hierarchy><node/></hierarchy>';
      },
    });
    const client = new AppiumMcpClient(session);
    const result = await client.inspect();
    assert.ok(called, 'getPageSource must be called');
    assert.equal(result, '<hierarchy><node/></hierarchy>');
  });

  it('returns a raw string — NOT a JSON object', async () => {
    const xml = '<hierarchy><node class="android.widget.Button"/></hierarchy>';
    const session = makeSession({ getPageSource: async () => xml });
    const client = new AppiumMcpClient(session);
    const result = await client.inspect();
    assert.equal(typeof result, 'string');
    assert.equal(result, xml);
  });
});

// ── findElement — disabled ────────────────────────────────────────────────────

describe('AppiumMcpClient.findElement', () => {
  it('throws NotImplementedError synchronously', () => {
    const session = makeSession();
    const client = new AppiumMcpClient(session);
    assert.throws(
      () => client.findElement('some description'),
      (err) => {
        assert.ok(err instanceof NotImplementedError);
        assert.equal(err.name, 'NotImplementedError');
        return true;
      },
    );
  });

  it('never calls session.findByLocator()', () => {
    let findByLocatorCalled = false;
    const session = makeSession({
      findByLocator: async () => {
        findByLocatorCalled = true;
        return 'uuid';
      },
    });
    const client = new AppiumMcpClient(session);
    try { client.findElement('desc'); } catch { /* expected */ }
    assert.equal(findByLocatorCalled, false, 'findByLocator must never be called from findElement');
  });
});

// ── screenshot ────────────────────────────────────────────────────────────────

describe('AppiumMcpClient.screenshot', () => {
  it('delegates to session.screenshot()', async () => {
    let called = false;
    const session = makeSession({
      screenshot: async () => {
        called = true;
        return 'base64png';
      },
    });
    const client = new AppiumMcpClient(session);
    const result = await client.screenshot();
    assert.ok(called, 'screenshot must delegate to session');
    assert.equal(result, 'base64png');
  });
});
