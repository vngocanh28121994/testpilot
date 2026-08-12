/**
 * Phase 1.3 pre-flight: verify appium_gesture (tap) and appium_get_text argument names.
 *
 * NOT part of npm test — run standalone:
 *   node --import tsx/esm --test src/discovery/mcp/__tests__/TapVerify.integration.test.ts
 *
 * Taps the username EditText (safe: just focuses the field), types TAPTEST, reads back,
 * clears. Does NOT press the login button. Leaves the login screen in its original state.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppiumMcpClientSession } from '../AppiumMcpSession.js';
import os from 'node:os';
import path from 'node:path';

const androidSdk = `${os.homedir()}/Library/Android/sdk`;

const CAPS = {
  platformName: 'Android',
  'appium:automationName': 'UiAutomator2',
  'appium:deviceName': 'Android Device',
  'appium:appPackage': 'com.fss.tcbs.mobiletrading',
  'appium:noReset': true,
  'appium:chromedriverExecutable': path.join(os.homedir(), '.appium/chromedriver/chromedriver150'),
  'appium:chromedriverDisableBuildCheck': true,
};

test('TAP VERIFY — appium_gesture and appium_get_text real contracts', { timeout: 120_000 }, async (t) => {
  const session = await AppiumMcpClientSession.connect({
    command: 'appium-mcp',
    env: { ANDROID_HOME: androidSdk, ANDROID_SDK_ROOT: androidSdk },
  });

  try {
    await session.create(CAPS);
    await t.test('A: session created', () => { /* throws on failure */ });

    // Step B: find username EditText
    const usernameUUID = await session.findByLocator('xpath', '(//android.widget.EditText)[1]');
    await t.test('B: findByLocator EditText[1]', () => {
      assert.ok(usernameUUID, 'UUID must be non-empty');
      console.log(`     UUID: ${usernameUUID.slice(0, 30)}…`);
    });

    // Step C: tap — this is the critical test (verifies appium_gesture argument names)
    await t.test('C: tap(uuid) — appium_gesture argument contract', async () => {
      await session.tap(usernameUUID);
    });

    // Step D: setValue (already verified in Phase 1.2, included for completeness)
    await t.test('D: setValue after tap', async () => {
      const freshUUID = await session.findByLocator('xpath', '(//android.widget.EditText)[1]');
      await session.setValue(freshUUID, 'TAPTEST');
    });

    // Step E: getText — verifies appium_get_text argument contract
    await t.test('E: getText(uuid) — appium_get_text argument contract', async () => {
      const getUUID = await session.findByLocator('xpath', '(//android.widget.EditText)[1]');
      const text = await session.getText(getUUID);
      console.log(`     getText returned: ${JSON.stringify(text)}`);
      // text may be null (Capacitor fields return empty native text) or "TAPTEST"
      // either way, a successful call (no -32602 error) proves the argument contract is correct
    });

    // Step F: clear field to restore state
    await t.test('F: clear field (restore state)', async () => {
      const clearUUID = await session.findByLocator('xpath', '(//android.widget.EditText)[1]');
      await session.setValue(clearUUID, '');
    });

  } finally {
    await session.delete().catch((e: unknown) => console.error('delete failed:', e));
  }
});
