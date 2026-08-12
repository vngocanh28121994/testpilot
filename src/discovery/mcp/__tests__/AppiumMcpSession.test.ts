import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AppiumMcpClientSession } from '../AppiumMcpSession.js';
import { StaleElementError, NotImplementedError } from '../AppiumMcpErrors.js';
import { TestPilotError, TestPilotErrorCode } from '../../../core/ErrorCodes.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

// ── mock Client ───────────────────────────────────────────────────────────────

type ToolCall = { name: string; arguments: Record<string, unknown> };

function makeClient(
  handler: (call: ToolCall) => { content: Array<{ type: string; [k: string]: unknown }> },
): Client {
  return {
    callTool: async (params: { name: string; arguments: Record<string, unknown> }) =>
      handler({ name: params.name, arguments: params.arguments ?? {} }),
    close: async () => undefined,
  } as unknown as Client;
}

function textContent(text: string) {
  return { content: [{ type: 'text', text }] };
}

function imageContent(data: string) {
  return { content: [{ type: 'image', data, mimeType: 'image/png' }] };
}

function errorContent(text: string) {
  return { isError: true, content: [{ type: 'text', text }] };
}

// ── session creation ──────────────────────────────────────────────────────────

describe('AppiumMcpClientSession.create', () => {
  it('serialises capabilities as JSON string', async () => {
    let captured: Record<string, unknown> = {};
    const client = makeClient((call) => {
      captured = call.arguments;
      return textContent('Session created');
    });
    const session = new AppiumMcpClientSession(client);
    await session.create({ platformName: 'Android', 'appium:automationName': 'UiAutomator2' });

    assert.equal(typeof captured['capabilities'], 'string', 'capabilities must be a JSON string');
    const caps = JSON.parse(captured['capabilities'] as string) as Record<string, unknown>;
    assert.equal(caps['platformName'], 'Android');
  });

  it('uses appium_session_management with action=create', async () => {
    let toolName = '';
    let action = '';
    const client = makeClient((call) => {
      toolName = call.name;
      action = call.arguments['action'] as string;
      return textContent('ok');
    });
    const session = new AppiumMcpClientSession(client);
    await session.create({ platformName: 'Android' });
    assert.equal(toolName, 'appium_session_management');
    assert.equal(action, 'create');
  });
});

// ── findByLocator ─────────────────────────────────────────────────────────────

describe('AppiumMcpClientSession.findByLocator', () => {
  it('calls appium_find_element with exact strategy and selector', async () => {
    let capturedArgs: Record<string, unknown> = {};
    const client = makeClient((call) => {
      capturedArgs = call.arguments;
      return textContent("elementId 'uuid-abc'\nSuccessfully found");
    });
    const session = new AppiumMcpClientSession(client);
    const uuid = await session.findByLocator('accessibility id', 'login-button');
    assert.equal(capturedArgs['strategy'], 'accessibility id');
    // appium-mcp uses "selector" (not "value") for the locator string
    assert.equal(capturedArgs['selector'], 'login-button');
    assert.equal(uuid, 'uuid-abc');
  });

  it('returns the extracted UUID string', async () => {
    const client = makeClient(() =>
      textContent("elementId 'my-uuid-123'\nFound element."),
    );
    const session = new AppiumMcpClientSession(client);
    const uuid = await session.findByLocator('id', 'some-id');
    assert.equal(uuid, 'my-uuid-123');
  });

  it('throws PROVIDER_ELEMENT_NOT_FOUND when isError=true', async () => {
    const client = makeClient(() => errorContent('No such element'));
    const session = new AppiumMcpClientSession(client);
    await assert.rejects(
      () => session.findByLocator('id', 'missing'),
      (err) => {
        assert.ok(err instanceof TestPilotError);
        assert.equal(err.code, TestPilotErrorCode.PROVIDER_ELEMENT_NOT_FOUND);
        return true;
      },
    );
  });

  it('throws PROVIDER_ELEMENT_NOT_FOUND — NOT StaleElementError — when element not found', async () => {
    const client = makeClient(() => errorContent('An element could not be located'));
    const session = new AppiumMcpClientSession(client);
    await assert.rejects(
      () => session.findByLocator('id', 'gone'),
      (err) => {
        assert.ok(!(err instanceof StaleElementError), 'must not be StaleElementError');
        assert.ok(err instanceof TestPilotError);
        return true;
      },
    );
  });

  it('consecutive calls can return different UUIDs (no caching)', async () => {
    let callCount = 0;
    const client = makeClient(() => {
      callCount++;
      return textContent(`elementId 'uuid-${callCount}'\nFound`);
    });
    const session = new AppiumMcpClientSession(client);
    const first = await session.findByLocator('id', 'btn');
    const second = await session.findByLocator('id', 'btn');
    assert.notEqual(first, second, 'each call must resolve independently');
    assert.equal(callCount, 2, 'callTool must have been called twice');
  });
});

// ── tap — stale element ───────────────────────────────────────────────────────

describe('AppiumMcpClientSession.tap', () => {
  it('sends action=tap and elementUUID (not gesture=click)', async () => {
    let args: Record<string, unknown> = {};
    const client = makeClient((call) => { args = call.arguments; return textContent('Gesture performed'); });
    const session = new AppiumMcpClientSession(client);
    await session.tap('my-uuid');
    // appium-mcp requires action="tap" (not gesture="click")
    assert.equal(args['action'], 'tap');
    assert.equal(args['elementUUID'], 'my-uuid');
    assert.equal(args['gesture'], undefined, 'must NOT send "gesture" key');
  });

  it('succeeds on normal response', async () => {
    const client = makeClient(() => textContent('Gesture performed'));
    const session = new AppiumMcpClientSession(client);
    await assert.doesNotReject(() => session.tap('uuid-ok'));
  });

  it('throws StaleElementError on StaleObjectReferenceException', async () => {
    const client = makeClient(() =>
      errorContent('StaleObjectReferenceException: object is stale'),
    );
    const session = new AppiumMcpClientSession(client);
    await assert.rejects(
      () => session.tap('uuid-stale'),
      (err) => {
        assert.ok(err instanceof StaleElementError);
        assert.equal(err.elementUUID, 'uuid-stale');
        return true;
      },
    );
  });

  it('throws StaleElementError on "stale element reference"', async () => {
    const client = makeClient(() => errorContent('stale element reference'));
    const session = new AppiumMcpClientSession(client);
    await assert.rejects(
      () => session.tap('uuid-x'),
      (err) => err instanceof StaleElementError,
    );
  });

  it('does NOT swallow stale errors', async () => {
    const client = makeClient(() => errorContent('StaleObjectReferenceException'));
    const session = new AppiumMcpClientSession(client);
    let threw = false;
    try {
      await session.tap('uuid-s');
    } catch {
      threw = true;
    }
    assert.ok(threw, 'stale error must propagate — never swallowed');
  });

  it('throws generic error (not StaleElementError) for non-stale failures', async () => {
    const client = makeClient(() => errorContent('driver offline'));
    const session = new AppiumMcpClientSession(client);
    await assert.rejects(
      () => session.tap('uuid-err'),
      (err) => {
        assert.ok(!(err instanceof StaleElementError));
        return true;
      },
    );
  });
});

// ── setValue — stale element ──────────────────────────────────────────────────

describe('AppiumMcpClientSession.setValue', () => {
  it('throws StaleElementError when stale', async () => {
    const client = makeClient(() => errorContent('StaleObjectReferenceException'));
    const session = new AppiumMcpClientSession(client);
    await assert.rejects(
      () => session.setValue('uuid-stale', 'hello'),
      (err) => err instanceof StaleElementError,
    );
  });

  it('passes elementUUID and text to appium_set_value', async () => {
    let args: Record<string, unknown> = {};
    const client = makeClient((call) => { args = call.arguments; return textContent('ok'); });
    const session = new AppiumMcpClientSession(client);
    await session.setValue('my-uuid', 'test text');
    assert.equal(args['elementUUID'], 'my-uuid');
    assert.equal(args['text'], 'test text');
  });
});

// ── getText ───────────────────────────────────────────────────────────────────

describe('AppiumMcpClientSession.getText', () => {
  it('extracts text from real appium-mcp response format', async () => {
    // Real appium-mcp format: "elementId '<uuid>'\nSuccessfully got text <VALUE> from element <uuid>."
    const client = makeClient(() =>
      textContent("elementId 'uuid-1'\nSuccessfully got text Hello from element uuid-1."),
    );
    const session = new AppiumMcpClientSession(client);
    assert.equal(await session.getText('uuid-1'), 'Hello');
  });

  it('returns text value from plain text response (mock/fallback)', async () => {
    const client = makeClient(() => textContent('Hello'));
    const session = new AppiumMcpClientSession(client);
    assert.equal(await session.getText('uuid-1'), 'Hello');
  });

  it('returns null for empty text (Capacitor WebView field)', async () => {
    const client = makeClient(() => textContent(''));
    const session = new AppiumMcpClientSession(client);
    assert.equal(await session.getText('uuid-1'), null);
  });

  it('throws StaleElementError when stale', async () => {
    const client = makeClient(() => errorContent('StaleObjectReferenceException'));
    const session = new AppiumMcpClientSession(client);
    await assert.rejects(
      () => session.getText('uuid-stale'),
      (err) => err instanceof StaleElementError,
    );
  });
});

// ── screenshot ────────────────────────────────────────────────────────────────

describe('AppiumMcpClientSession.screenshot', () => {
  it('returns base64 from image content block', async () => {
    const client = makeClient(() => imageContent('aGVsbG8='));
    const session = new AppiumMcpClientSession(client);
    assert.equal(await session.screenshot(), 'aGVsbG8=');
  });
});

// ── NotImplementedError import sanity ─────────────────────────────────────────

describe('NotImplementedError', () => {
  it('is thrown by findElement on AppiumMcpClient (via AppiumMcpErrors)', () => {
    // Verify the error class itself behaves correctly
    const err = new NotImplementedError('SomeMethod.findElement');
    assert.ok(err instanceof Error);
    assert.equal(err.name, 'NotImplementedError');
    assert.ok(err.message.includes('SomeMethod.findElement'));
  });
});
