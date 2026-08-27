/**
 * STEP A — Verify WebView existence via Appium at runtime.
 *
 * Connects to Appium (noReset — app already running), lists all contexts,
 * and confirms WEBVIEW_* context is present.
 *
 * Run: npx tsx src/poc/step-a-verify-webview.ts
 */
import { remote } from 'webdriverio';

const DEVICE_NAME = 'R5CY21WADDY';
const APP_PACKAGE = 'com.fss.tcbs.mobiletrading';

console.log('STEP A — Verify WebView existence via Appium');
console.log('═'.repeat(60));

const browser = await remote({
  hostname: '127.0.0.1',
  port: 4723,
  path: '/',
  logLevel: 'silent',
  capabilities: {
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:deviceName': DEVICE_NAME,
    'appium:appPackage': APP_PACKAGE,
    'appium:noReset': true,
    'appium:autoLaunch': false,
    'appium:newCommandTimeout': 60,
  },
});

try {
  console.log('Waiting 2s for WebView to be ready...');
  await new Promise(r => setTimeout(r, 2000));

  const raw = await browser.getContexts() as Array<string | { id?: string }>;
  const contexts = raw.map(c => typeof c === 'string' ? c : (c.id ?? '')).filter(Boolean);

  console.log(`\nContexts found (${contexts.length}):`);
  for (const ctx of contexts) {
    console.log(`  - ${ctx}`);
  }

  const webviewCtx = contexts.find(c => c !== 'NATIVE_APP' && /WEBVIEW|CHROMIUM/i.test(c));

  if (webviewCtx) {
    console.log(`\nSTEP A STATUS: PASS`);
    console.log(`WebView context: ${webviewCtx}`);
  } else {
    console.log(`\nSTEP A STATUS: FAIL`);
    console.log('No WEBVIEW context found');
    process.exitCode = 1;
  }
} finally {
  await browser.deleteSession();
  console.log('Session closed.');
}
