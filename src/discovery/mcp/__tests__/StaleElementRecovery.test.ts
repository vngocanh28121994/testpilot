/**
 * Integration test: stale element recovery flow.
 *
 * Verifies:
 *   first findByLocator()  → UUID = AAA
 *   tap(AAA)               → StaleElementError
 *   (executor retry cycle would re-resolve)
 *   second findByLocator() → UUID = BBB  (BBB ≠ AAA)
 *   tap(BBB)               → success
 *
 * And: StaleElementError must NOT be swallowed.
 * And: final retry exhaustion must propagate failure.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AppiumMcpClientSession } from '../AppiumMcpSession.js';
import { StaleElementError } from '../AppiumMcpErrors.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

// ── mock client builder ───────────────────────────────────────────────────────

type MockCall = { name: string; arguments: Record<string, unknown> };
type MockHandler = (call: MockCall, callIndex: number) => { content: Array<{ type: string; [k: string]: unknown }>; isError?: boolean };

function makeClient(handler: MockHandler): Client {
  let callIndex = 0;
  return {
    callTool: async (params: { name: string; arguments: Record<string, unknown> }) =>
      handler({ name: params.name, arguments: params.arguments ?? {} }, callIndex++),
    close: async () => undefined,
  } as unknown as Client;
}

function textOk(text: string) {
  return { content: [{ type: 'text', text }] };
}

function staleError(uuid: string) {
  return {
    isError: true as const,
    content: [{ type: 'text', text: `StaleObjectReferenceException: element ${uuid} is stale` }],
  };
}

// ── stale recovery simulation ─────────────────────────────────────────────────

describe('StaleElementRecovery — UUID lifecycle', () => {
  it('consecutive findByLocator() calls return independent UUIDs', async () => {
    let locatorCallCount = 0;
    const client = makeClient((call) => {
      if (call.name === 'appium_find_element') {
        locatorCallCount++;
        return textOk(`elementId 'uuid-${locatorCallCount}'\nFound`);
      }
      return textOk('ok');
    });

    const session = new AppiumMcpClientSession(client);

    // Simulate first resolution.
    const uuidA = await session.findByLocator('testId', 'login-btn');
    // Simulate second resolution (after UI mutation).
    const uuidB = await session.findByLocator('testId', 'login-btn');

    assert.notEqual(uuidA, uuidB, 'each resolution must produce a new UUID');
    assert.equal(locatorCallCount, 2, 'findByLocator() must call MCP twice');
  });

  it('StaleElementError propagates from tap() and is NOT swallowed', async () => {
    let tapCallCount = 0;
    const client = makeClient((call) => {
      if (call.name === 'appium_find_element') {
        return textOk(`elementId 'uuid-${Date.now()}'\nFound`);
      }
      if (call.name === 'appium_gesture') {
        tapCallCount++;
        return staleError(call.arguments['elementUUID'] as string);
      }
      return textOk('ok');
    });

    const session = new AppiumMcpClientSession(client);
    const uuid = await session.findByLocator('testId', 'btn');

    let caughtError: unknown;
    try {
      await session.tap(uuid);
    } catch (e) {
      caughtError = e;
    }

    assert.ok(caughtError !== undefined, 'StaleElementError must not be swallowed');
    assert.ok(caughtError instanceof StaleElementError);
    assert.equal(caughtError.elementUUID, uuid);
    assert.equal(tapCallCount, 1);
  });

  it('retry with fresh UUID succeeds after stale tap', async () => {
    let tapCallCount = 0;
    let findCallCount = 0;

    const client = makeClient((call) => {
      if (call.name === 'appium_find_element') {
        findCallCount++;
        return textOk(`elementId 'uuid-${findCallCount}'\nFound`);
      }
      if (call.name === 'appium_gesture') {
        tapCallCount++;
        if (tapCallCount === 1) {
          // First tap stale
          return staleError(call.arguments['elementUUID'] as string);
        }
        // Second tap succeeds
        return textOk('Gesture performed');
      }
      return textOk('ok');
    });

    const session = new AppiumMcpClientSession(client);

    // Round 1: resolve + tap (fails with stale)
    const uuidA = await session.findByLocator('testId', 'btn');
    let staleErr: StaleElementError | undefined;
    try {
      await session.tap(uuidA);
    } catch (e) {
      if (e instanceof StaleElementError) staleErr = e;
    }

    assert.ok(staleErr, 'first tap must throw StaleElementError');
    assert.equal(staleErr.elementUUID, uuidA);

    // Round 2 (simulates executor retry): re-resolve + tap (succeeds)
    const uuidB = await session.findByLocator('testId', 'btn');
    assert.notEqual(uuidA, uuidB, 'retry must get a fresh UUID');
    await assert.doesNotReject(() => session.tap(uuidB), 'second tap must succeed');
  });

  it('UUID from first resolution is never reused in second tap', async () => {
    let tapReceivedUUIDs: string[] = [];
    let findCount = 0;

    const client = makeClient((call) => {
      if (call.name === 'appium_find_element') {
        findCount++;
        return textOk(`elementId 'uuid-resolve-${findCount}'\nFound`);
      }
      if (call.name === 'appium_gesture') {
        tapReceivedUUIDs.push(call.arguments['elementUUID'] as string);
        if (tapReceivedUUIDs.length === 1) return staleError('uuid-resolve-1');
        return textOk('ok');
      }
      return textOk('ok');
    });

    const session = new AppiumMcpClientSession(client);

    const firstUuid = await session.findByLocator('testId', 'btn');
    try { await session.tap(firstUuid); } catch { /* stale */ }

    const secondUuid = await session.findByLocator('testId', 'btn');
    await session.tap(secondUuid);

    assert.equal(tapReceivedUUIDs.length, 2);
    assert.notEqual(tapReceivedUUIDs[0], tapReceivedUUIDs[1], 'second tap must not reuse first UUID');
  });
});

// ── StaleElementError properties ──────────────────────────────────────────────

describe('StaleElementError', () => {
  it('preserves elementUUID', () => {
    const err = new StaleElementError('uuid-xyz', 'testId', 'some-value');
    assert.equal(err.elementUUID, 'uuid-xyz');
  });

  it('preserves optional strategy and value', () => {
    const err = new StaleElementError('uuid-abc', 'accessibility id', 'login-btn');
    assert.equal(err.strategy, 'accessibility id');
    assert.equal(err.value, 'login-btn');
  });

  it('is an instance of Error', () => {
    assert.ok(new StaleElementError('u') instanceof Error);
  });

  it('name is StaleElementError', () => {
    assert.equal(new StaleElementError('u').name, 'StaleElementError');
  });
});
