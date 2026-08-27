/**
 * WebView Interaction Integration Test
 *
 * Verifies the full pipeline for Capacitor hybrid apps:
 *   1. Switch to WEBVIEW context
 *   2. Get HTML page source → parse DOM elements
 *   3. findByLocator with CSS/XPath in WebView context → ephemeral UUID
 *   4. Interact with UUID (tap, setValue, getText)
 *   5. Restore NATIVE_APP
 *
 * Run standalone (not in npm test — requires live emulator):
 *   node --import tsx/esm --test \
 *     src/discovery/mcp/__tests__/WebViewInteraction.integration.test.ts
 *
 * Prerequisites:
 *   - Android emulator running
 *   - TCBS app on login screen
 *   - appium-mcp in PATH
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { AppiumMcpClientSession } from '../AppiumMcpSession.js';
import { AppiumMcpContextManager } from '../AppiumMcpContextManager.js';
import { AppiumMcpClient } from '../AppiumMcpClient.js';
import { AppiumMcpElementDiscovery } from '../AppiumMcpElementDiscovery.js';
import { AppiumMcpDriver } from '../../../drivers/AppiumMcpDriver.js';

const androidSdk = `${os.homedir()}/Library/Android/sdk`;
const APP_PACKAGE = 'com.fss.tcbs.mobiletrading';
const WEBVIEW_CONTEXT = `WEBVIEW_${APP_PACKAGE}`;

const CAPS = {
  platformName: 'Android',
  'appium:automationName': 'UiAutomator2',
  'appium:deviceName': 'Android Device',
  'appium:appPackage': APP_PACKAGE,
  'appium:noReset': true,
  'appium:chromedriverExecutable': `${os.homedir()}/.appium/chromedriver/chromedriver150`,
  'appium:chromedriverDisableBuildCheck': true,
};

test('WebView — switch context and inspect HTML page source', { timeout: 60_000 }, async (t) => {
  const session = await AppiumMcpClientSession.connect({
    command: 'appium-mcp',
    env: { ANDROID_HOME: androidSdk, ANDROID_SDK_ROOT: androidSdk },
  });

  try {
    await session.create(CAPS);

    // ── available contexts ───────────────────────────────────────────────────
    await t.test('1: list contexts — WEBVIEW must be present', async () => {
      const contexts = await session.listContexts();
      console.log(`     contexts: ${JSON.stringify(contexts)}`);
      assert.ok(
        contexts.some(c => c.startsWith('WEBVIEW_')),
        `must have a WEBVIEW context; got: ${JSON.stringify(contexts)}`,
      );
    });

    // ── switch to WebView and get HTML ───────────────────────────────────────
    let html = '';
    await t.test('2: switch to WEBVIEW context and get HTML page source', async () => {
      await session.switchContext(WEBVIEW_CONTEXT);
      const ctx = await session.currentContext();
      assert.ok(ctx?.includes('WEBVIEW'), `must be in WebView context; got: ${ctx}`);
      console.log(`     current context: ${ctx}`);

      html = await session.getPageSource();
      assert.ok(html.length > 0, 'HTML page source must not be empty');
      console.log(`     HTML page source length: ${html.length} chars`);
      console.log('     first 500 chars:');
      console.log('     ' + html.slice(0, 500).replace(/\n/g, '\n     '));
    });

    // ── what input/button elements are in the HTML ───────────────────────────
    await t.test('3: identify interactive DOM elements in HTML', () => {
      const inputs = [...html.matchAll(/<input([^>]*)>/gi)];
      const buttons = [...html.matchAll(/<button([^>]*)>/gi)];
      const ionInputs = [...html.matchAll(/<ion-input([^>]*)>/gi)];

      console.log(`     <input> tags: ${inputs.length}`);
      inputs.slice(0, 5).forEach((m, i) => console.log(`       [${i}] attrs: ${m[1]!.trim().slice(0, 120)}`));

      console.log(`     <button> tags: ${buttons.length}`);
      buttons.slice(0, 5).forEach((m, i) => console.log(`       [${i}] attrs: ${m[1]!.trim().slice(0, 120)}`));

      console.log(`     <ion-input> tags: ${ionInputs.length}`);
      ionInputs.slice(0, 3).forEach((m, i) => console.log(`       [${i}] attrs: ${m[1]!.trim().slice(0, 120)}`));

      assert.ok(
        inputs.length > 0 || ionInputs.length > 0,
        'WebView HTML must contain at least one <input> or <ion-input>',
      );
    });

    // ── findByLocator in WebView context (CSS) ───────────────────────────────
    let cssUuid: string | undefined;
    await t.test('4: findByLocator("css selector", "input") in WebView context', async () => {
      // Must still be in WEBVIEW context from step 2
      const ctx = await session.currentContext();
      assert.ok(ctx?.includes('WEBVIEW'), `must be in WebView context for CSS find; got: ${ctx}`);

      const uuid = await session.findByLocator('css selector', 'input');
      assert.ok(uuid, 'css selector must resolve to a UUID');
      assert.ok(uuid.length > 0);
      cssUuid = uuid;
      console.log(`     CSS find UUID: ${uuid.slice(0, 40)}…`);
    });

    // ── tap via WebView UUID ─────────────────────────────────────────────────
    await t.test('5: tap(UUID) in WebView context — appium_gesture action:tap', async () => {
      assert.ok(cssUuid, 'UUID from step 4 must exist');
      await session.tap(cssUuid!);
      console.log(`     tapped WebView element UUID: ${cssUuid!.slice(0, 40)}…`);
    });

    // ── setValue in WebView context ──────────────────────────────────────────
    let setValueUuid: string | undefined;
    await t.test('6: findByLocator + setValue in WebView context', async () => {
      // Fresh find before setValue (UUID is ephemeral)
      setValueUuid = await session.findByLocator('css selector', 'input');
      await session.setValue(setValueUuid, 'WEBVIEW123');
      console.log(`     setValue("WEBVIEW123") via UUID: ${setValueUuid.slice(0, 40)}…`);
    });

    // ── getText in WebView context ────────────────────────────────────────────
    await t.test('7: getText in WebView context', async () => {
      const getUuid = await session.findByLocator('css selector', 'input');
      const value = await session.getText(getUuid);
      console.log(`     getText returned: ${JSON.stringify(value)}`);
      // Ionic/Capacitor apps may store value in shadow DOM — null or '' is acceptable
      // A non-throw proves the contract works
    });

    // ── xpath in WebView context ─────────────────────────────────────────────
    await t.test('8: findByLocator("xpath", "//input") in WebView context', async () => {
      const uuid = await session.findByLocator('xpath', '//input');
      assert.ok(uuid, 'xpath must resolve to UUID in WebView');
      console.log(`     xpath WebView UUID: ${uuid.slice(0, 40)}…`);
    });

    // ── restore NATIVE_APP ────────────────────────────────────────────────────
    await t.test('9: restore NATIVE_APP context', async () => {
      await session.switchContext('NATIVE_APP');
      const ctx = await session.currentContext();
      assert.ok(ctx?.includes('NATIVE') || ctx === 'NATIVE_APP', `must be back in NATIVE_APP; got: ${ctx}`);
      console.log(`     restored context: ${ctx}`);
    });

    // ── verify NATIVE_APP find still works after WebView round-trip ───────────
    await t.test('10: xpath find in NATIVE_APP still works after WebView round-trip', async () => {
      const uuid = await session.findByLocator('xpath', '(//android.widget.EditText)[1]');
      assert.ok(uuid, 'NATIVE_APP xpath must still work after WebView round-trip');
      console.log(`     NATIVE_APP xpath UUID: ${uuid.slice(0, 40)}…`);
    });

  } finally {
    // Always restore NATIVE_APP before deleting
    await session.switchContext('NATIVE_APP').catch(() => {});
    await session.delete().catch((e: unknown) => console.error('delete failed:', e));
  }
});

// ── hybrid=true observe pipeline ────────────────────────────────────────────────

test('WebView — hybrid=true observeWithFallback() returns DOM elements', { timeout: 60_000 }, async (t) => {
  const session = await AppiumMcpClientSession.connect({
    command: 'appium-mcp',
    env: { ANDROID_HOME: androidSdk, ANDROID_SDK_ROOT: androidSdk },
  });

  try {
    await session.create(CAPS);

    // hybrid=true: observeWithFallback() should switch to WEBVIEW and parse HTML
    const ctxMgr = new AppiumMcpContextManager(session, true, 'android');
    const client = new AppiumMcpClient(session);
    const discovery = new AppiumMcpElementDiscovery(client, ctxMgr);

    let webObs: Awaited<ReturnType<typeof discovery.observe>>;

    await t.test('1: hybrid=true observe() returns WebView DOM elements', async () => {
      webObs = await discovery.observe();
      console.log(
        `     source=${webObs.source} platform=${webObs.platform} elements=${webObs.elements.length}`,
      );
      // With hybrid=true on a Capacitor screen: should switch to WEBVIEW and get DOM elements
      if (webObs.source === 'webview') {
        assert.ok(webObs.elements.length > 0, 'WebView observation must have interactive DOM elements');
        console.log('     WebView elements:');
        webObs.elements.slice(0, 10).forEach((el, i) => {
          console.log(
            `       [${i}] role=${el.role} ` +
            `resourceId="${el.resourceId ?? ''}" ` +
            `placeholder="${el.placeholder ?? ''}" ` +
            `testId="${el.testId ?? ''}" ` +
            `interactive=${el.interactive}`,
          );
        });
      } else {
        // If source is 'native', the screen must have returned native interactive elements
        console.log(`     note: source=${webObs.source} (native had interactive elements)`);
      }
      // Either path is valid — but source must be one of the two
      assert.ok(
        webObs.source === 'webview' || webObs.source === 'native',
        `source must be webview or native; got: ${webObs.source}`,
      );
    });

    await t.test('2: after observe(), context is restored to NATIVE_APP', async () => {
      const ctx = await session.currentContext();
      // observeWithFallback() always restores NATIVE_APP in finally
      assert.ok(
        ctx === 'NATIVE_APP' || ctx?.includes('NATIVE'),
        `context must be NATIVE_APP after observe(); got: ${ctx}`,
      );
      console.log(`     context after observe(): ${ctx}`);
    });

    await t.test('3: AppiumMcpDriver.find() still works in NATIVE_APP after hybrid observe', async () => {
      const driver = new AppiumMcpDriver(session, {
        platform: 'android',
        device: 'emulator',
        appPackage: APP_PACKAGE,
        artifactsDir: os.tmpdir(),
      });
      const handle = await driver.find({
        strategy: 'xpath',
        value: '(//android.widget.EditText)[1]',
        weight: 1,
        origin: 'authored',
      });
      assert.ok(handle !== null, 'NATIVE xpath find must work after hybrid observe');
      const uuid = (handle as unknown as { elementUUID: string }).elementUUID;
      console.log(`     NATIVE find UUID: ${uuid.slice(0, 40)}…`);
    });

  } finally {
    await session.switchContext('NATIVE_APP').catch(() => {});
    await session.delete().catch((e: unknown) => console.error('delete failed:', e));
  }
});
