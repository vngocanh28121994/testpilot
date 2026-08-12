/**
 * Unit tests for AppiumMcpDriver and AppiumMcpHandle.
 *
 * These tests use a mock AppiumMcpSession to verify:
 *   1. Strategy mapping (LocatorCandidate.strategy → appium-mcp strategy)
 *   2. find() returns null on PROVIDER_ELEMENT_NOT_FOUND
 *   3. find() returns AppiumMcpHandle on success
 *   4. tap/input/clear pass the correct UUID and args
 *   5. UUID is NOT cached — each find() call produces a fresh interaction pair
 *   6. StaleElementError propagates from interaction methods
 *   7. Path A ≠ Path B: find() never calls observe/discover
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AppiumMcpDriver } from '../AppiumMcpDriver.js';
import { StaleElementError } from '../../discovery/mcp/AppiumMcpErrors.js';
import { TestPilotError, TestPilotErrorCode } from '../../core/ErrorCodes.js';
import type { AppiumMcpSession } from '../../discovery/mcp/AppiumMcpSession.js';
import type { LocatorCandidate } from '../../core/types.js';

// ── mock session ──────────────────────────────────────────────────────────────

interface SessionCall {
  method: string;
  args: unknown[];
}

function makeSession(overrides?: Partial<AppiumMcpSession>): {
  session: AppiumMcpSession;
  calls: SessionCall[];
} {
  const calls: SessionCall[] = [];

  const session: AppiumMcpSession = {
    async create() { calls.push({ method: 'create', args: [] }); },
    async delete() { calls.push({ method: 'delete', args: [] }); },
    async currentContext() { calls.push({ method: 'currentContext', args: [] }); return 'NATIVE_APP'; },
    async switchContext(name) { calls.push({ method: 'switchContext', args: [name] }); },
    async listContexts() { calls.push({ method: 'listContexts', args: [] }); return ['NATIVE_APP']; },
    async getPageSource() { calls.push({ method: 'getPageSource', args: [] }); return '<hierarchy/>'; },
    async findByLocator(strategy, value) {
      calls.push({ method: 'findByLocator', args: [strategy, value] });
      return `uuid-${strategy}-${value}`;
    },
    async tap(uuid) { calls.push({ method: 'tap', args: [uuid] }); },
    async setValue(uuid, text) { calls.push({ method: 'setValue', args: [uuid, text] }); },
    async getText(uuid) { calls.push({ method: 'getText', args: [uuid] }); return 'hello'; },
    async screenshot() { calls.push({ method: 'screenshot', args: [] }); return 'base64data'; },
    ...overrides,
  };
  return { session, calls };
}

function candidate(
  strategy: LocatorCandidate['strategy'],
  value: string,
): LocatorCandidate {
  return { strategy, value, weight: 1, origin: 'authored' };
}

function makeDriver(sessionOverrides?: Partial<AppiumMcpSession>) {
  const { session, calls } = makeSession(sessionOverrides);
  const driver = new AppiumMcpDriver(session, {
    platform: 'android',
    device: 'test-device',
    appPackage: 'com.example.app',
    artifactsDir: '/tmp/test-artifacts',
  });
  return { driver, session, calls };
}

// ── strategy mapping ──────────────────────────────────────────────────────────

describe('AppiumMcpDriver.find — strategy mapping', () => {
  it('xpath → xpath (passthrough, REAL-VERIFIED)', async () => {
    const { driver, calls } = makeDriver();
    const handle = await driver.find(candidate('xpath', '//android.widget.EditText'));
    assert.ok(handle !== null);
    const call = calls.find(c => c.method === 'findByLocator')!;
    assert.equal(call.args[0], 'xpath');
    assert.equal(call.args[1], '//android.widget.EditText');
  });

  it('label → accessibility id', async () => {
    const { driver, calls } = makeDriver();
    await driver.find(candidate('label', 'ĐĂNG NHẬP'));
    const call = calls.find(c => c.method === 'findByLocator')!;
    assert.equal(call.args[0], 'accessibility id');
    assert.equal(call.args[1], 'ĐĂNG NHẬP');
  });

  it('testId → accessibility id (mirrors NativeUiDriver ~value behavior)', async () => {
    const { driver, calls } = makeDriver();
    await driver.find(candidate('testId', 'login-button'));
    const call = calls.find(c => c.method === 'findByLocator')!;
    assert.equal(call.args[0], 'accessibility id');
    assert.equal(call.args[1], 'login-button');
  });

  it('role → class name', async () => {
    const { driver, calls } = makeDriver();
    await driver.find(candidate('role', 'android.widget.Button'));
    const call = calls.find(c => c.method === 'findByLocator')!;
    assert.equal(call.args[0], 'class name');
    assert.equal(call.args[1], 'android.widget.Button');
  });

  it('placeholder → xpath with @hint attribute', async () => {
    const { driver, calls } = makeDriver();
    await driver.find(candidate('placeholder', 'Enter phone'));
    const call = calls.find(c => c.method === 'findByLocator')!;
    assert.equal(call.args[0], 'xpath');
    assert.equal(call.args[1], '//*[@hint="Enter phone"]');
  });

  it('css → null (not supported in native context)', async () => {
    const { driver, calls } = makeDriver();
    const handle = await driver.find(candidate('css', '.login-btn'));
    assert.equal(handle, null);
    assert.equal(calls.filter(c => c.method === 'findByLocator').length, 0);
  });

  it('predicate on Android → null', async () => {
    const { driver, calls } = makeDriver();
    const handle = await driver.find(candidate('predicate', 'type == "XCUIElementTypeButton"'));
    assert.equal(handle, null);
    assert.equal(calls.filter(c => c.method === 'findByLocator').length, 0);
  });

  it('predicate on iOS → -ios predicate string', async () => {
    const { session } = makeSession();
    const driver = new AppiumMcpDriver(session, {
      platform: 'ios',
      device: 'iphone',
      artifactsDir: '/tmp',
    });
    const calls: SessionCall[] = [];
    (session as unknown as { findByLocator: (strategy: unknown, value: unknown) => Promise<string> })
      .findByLocator = async (strategy: unknown, value: unknown) => {
        calls.push({ method: 'findByLocator', args: [strategy, value] });
        return 'uuid-ios';
      };
    await driver.find(candidate('predicate', 'type == "XCUIElementTypeButton"'));
    const call = calls[0]!;
    assert.equal(call.args[0], '-ios predicate string');
  });
});

// ── find() return values ──────────────────────────────────────────────────────

describe('AppiumMcpDriver.find — return values', () => {
  it('returns AppiumMcpHandle with UUID on success', async () => {
    const { driver } = makeDriver();
    const handle = await driver.find(candidate('xpath', '//android.widget.Button'));
    assert.ok(handle !== null);
    assert.equal(handle.candidate.strategy, 'xpath');
  });

  it('returns null when element not found (PROVIDER_ELEMENT_NOT_FOUND)', async () => {
    const { driver } = makeDriver({
      async findByLocator() {
        throw new TestPilotError(
          TestPilotErrorCode.PROVIDER_ELEMENT_NOT_FOUND,
          'No such element',
          {},
        );
      },
    });
    const handle = await driver.find(candidate('xpath', '//android.widget.Button'));
    assert.equal(handle, null);
  });

  it('propagates unexpected errors from findByLocator', async () => {
    const { driver } = makeDriver({
      async findByLocator() {
        throw new Error('MCP transport disconnected');
      },
    });
    await assert.rejects(
      () => driver.find(candidate('xpath', '//android.widget.Button')),
      (err) => {
        assert.ok(!(err instanceof TestPilotError));
        return true;
      },
    );
  });
});

// ── tap ───────────────────────────────────────────────────────────────────────

describe('AppiumMcpDriver.tap', () => {
  it('calls session.tap with the UUID from the handle', async () => {
    const { driver, calls } = makeDriver();
    const handle = await driver.find(candidate('xpath', '//android.widget.Button'));
    assert.ok(handle !== null);

    await driver.tap(handle);

    const tapCall = calls.find(c => c.method === 'tap');
    assert.ok(tapCall, 'session.tap must have been called');
    // UUID comes from mock: `uuid-xpath-//android.widget.Button`
    assert.ok((tapCall.args[0] as string).startsWith('uuid-'));
  });

  it('propagates StaleElementError from session.tap', async () => {
    const { driver } = makeDriver({
      async tap(uuid) {
        throw new StaleElementError(uuid);
      },
    });
    const handle = await driver.find(candidate('xpath', '//android.widget.Button'));
    assert.ok(handle !== null);
    await assert.rejects(
      () => driver.tap(handle),
      (err) => err instanceof StaleElementError,
    );
  });
});

// ── input ─────────────────────────────────────────────────────────────────────

describe('AppiumMcpDriver.input', () => {
  it('calls session.setValue with UUID and text', async () => {
    const { driver, calls } = makeDriver();
    const handle = await driver.find(candidate('xpath', '//android.widget.EditText'));
    assert.ok(handle !== null);

    await driver.input(handle, 'test-password');

    const setValueCall = calls.find(c => c.method === 'setValue');
    assert.ok(setValueCall, 'session.setValue must have been called');
    assert.equal(setValueCall.args[1], 'test-password');
  });
});

// ── clear ─────────────────────────────────────────────────────────────────────

describe('AppiumMcpDriver.clear', () => {
  it('calls session.setValue with empty string', async () => {
    const { driver, calls } = makeDriver();
    const handle = await driver.find(candidate('xpath', '//android.widget.EditText'));
    assert.ok(handle !== null);

    await driver.clear(handle);

    const setValueCall = calls.find(c => c.method === 'setValue');
    assert.ok(setValueCall, 'session.setValue must have been called');
    assert.equal(setValueCall.args[1], '');
  });
});

// ── UUID non-caching ──────────────────────────────────────────────────────────

describe('AppiumMcpDriver — UUID is not cached', () => {
  it('each find() call produces a separate findByLocator() call', async () => {
    let callCount = 0;
    const { driver } = makeDriver({
      async findByLocator(strategy, value) {
        callCount++;
        return `uuid-${callCount}-${strategy}-${value}`;
      },
    });

    const c = candidate('xpath', '//android.widget.Button');
    const h1 = await driver.find(c);
    const h2 = await driver.find(c);

    assert.equal(callCount, 2, 'findByLocator must be called twice — no caching');
    // The two handles carry different UUIDs
    assert.notEqual(
      (h1 as unknown as { elementUUID: string }).elementUUID,
      (h2 as unknown as { elementUUID: string }).elementUUID,
      'each find() must return a fresh UUID',
    );
  });

  it('tap does not store UUID — second tap re-calls findByLocator', async () => {
    let findCount = 0;
    const { driver } = makeDriver({
      async findByLocator() {
        findCount++;
        return `uuid-${findCount}`;
      },
    });

    const c = candidate('xpath', '//android.widget.Button');
    const h1 = await driver.find(c);
    assert.ok(h1 !== null);
    await driver.tap(h1);

    const h2 = await driver.find(c);
    assert.ok(h2 !== null);
    await driver.tap(h2);

    assert.equal(findCount, 2, 'each interaction must obtain a fresh UUID via find()');
  });
});

// ── UiHandle interface ────────────────────────────────────────────────────────

describe('AppiumMcpHandle', () => {
  it('isVisible() returns true (element was found via findByLocator)', async () => {
    const { driver } = makeDriver();
    const handle = await driver.find(candidate('xpath', '//android.widget.Button'));
    assert.ok(handle !== null);
    assert.equal(await handle.isVisible(), true);
  });

  it('text() returns getText result from session', async () => {
    const { driver } = makeDriver({
      async getText() { return 'ĐĂNG NHẬP'; },
    });
    const handle = await driver.find(candidate('xpath', '//android.widget.Button'));
    assert.ok(handle !== null);
    assert.equal(await handle.text(), 'ĐĂNG NHẬP');
  });

  it('text() returns empty string when getText returns null', async () => {
    const { driver } = makeDriver({
      async getText() { return null; },
    });
    const handle = await driver.find(candidate('xpath', '//android.widget.EditText'));
    assert.ok(handle !== null);
    assert.equal(await handle.text(), '');
  });

  it('value() returns null when element is stale (enables verifyInput skip)', async () => {
    const { driver } = makeDriver({
      async getText(uuid) {
        throw new StaleElementError(uuid);
      },
    });
    const handle = await driver.find(candidate('xpath', '//android.widget.EditText'));
    assert.ok(handle !== null);
    // value() returns null so executor.verifyInput skips verification
    assert.equal(await handle.value?.(), null);
  });

  it('text() propagates StaleElementError (interaction methods must not swallow it)', async () => {
    const { driver } = makeDriver({
      async getText(uuid) {
        throw new StaleElementError(uuid);
      },
    });
    const handle = await driver.find(candidate('xpath', '//android.widget.Button'));
    assert.ok(handle !== null);
    // text() is not used in interaction paths where stale matters; value() swallows.
    // But for assertText: text() propagates StaleElementError.
    await assert.rejects(
      () => handle.text(),
      (err) => err instanceof StaleElementError,
    );
  });
});

// ── isIdle ────────────────────────────────────────────────────────────────────

describe('AppiumMcpDriver.isIdle', () => {
  it('returns false (conservative — no idle signal from appium-mcp)', async () => {
    const { driver } = makeDriver();
    assert.equal(await driver.isIdle(), false);
  });
});

// ── Path A/B separation ───────────────────────────────────────────────────────

describe('Path A/B separation', () => {
  it('find() never calls observe/getPageSource/switchContext', async () => {
    const { driver, calls } = makeDriver();
    await driver.find(candidate('xpath', '//android.widget.Button'));

    const pathACalls = calls.filter(
      c => c.method === 'getPageSource' || c.method === 'switchContext' || c.method === 'listContexts',
    );
    assert.equal(
      pathACalls.length,
      0,
      'Path B (find) must never trigger Path A (observation) calls',
    );
  });

  it('tap/input/clear only call session interaction methods', async () => {
    const { driver, calls } = makeDriver();
    const handle = await driver.find(candidate('xpath', '//android.widget.EditText'));
    assert.ok(handle !== null);
    calls.length = 0; // reset after find

    await driver.input(handle, 'hello');

    const pathACalls = calls.filter(
      c => c.method === 'getPageSource' || c.method === 'observe',
    );
    assert.equal(pathACalls.length, 0, 'interaction methods must not trigger observation');
  });
});
