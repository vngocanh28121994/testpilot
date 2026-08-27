/**
 * Kiểm tra nhanh xem WebView có được enable trên device không.
 * Chạy: tsx src/dev/check-webview.ts
 */
import { remote } from 'webdriverio';
import { loadConfig } from '../config.js';

const cfg = await loadConfig('testpilot.config.json');
const a = cfg.android;

const driver = await remote({
  hostname: '127.0.0.1',
  port: 4723,
  path: '/',
  logLevel: 'silent',
  capabilities: {
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:deviceName': a.deviceName,
    'appium:appPackage': a.appPackage,
    'appium:appActivity': a.appActivity,
    ...(a.app ? { 'appium:app': a.app } : {}),
    'appium:noReset': true,
    'appium:autoLaunch': true,
  },
});

console.log('App đã mở. Đợi 3 giây rồi list context...');
await new Promise(r => setTimeout(r, 3000));

const contexts = await driver.getContexts();
console.log('\nContext hiện có:');
for (const ctx of contexts) console.log(' ', ctx);

if (contexts.some((c: string) => c.startsWith('WEBVIEW'))) {
  console.log('\n✓ WebView ĐÃ được enable — Appium có thể thao tác được.');
} else {
  console.log('\n✗ Chỉ thấy NATIVE_APP — WebView chưa được enable hoặc chưa load xong.');
}

await driver.deleteSession();
