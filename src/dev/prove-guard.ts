/**
 * Proof: does the CDP hang guard actually turn a backgrounded WebView from an
 * indefinite hang into a fast, explanatory failure?
 *
 * Reproduces the exact condition observed during the failing run: app pushed to
 * the background, then a CDP call issued.
 *
 * Chạy: tsx src/dev/prove-guard.ts
 */
import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import { loadConfig } from '../config.js';
import { WebViewCdpDriver } from '../drivers/WebViewCdpDriver.js';

const exec = promisify(execCb);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const cfg = await loadConfig('testpilot.config.json');
const pkg = cfg.android.appPackage;
const activity = cfg.android.appActivity;
if (!pkg) throw new Error('android.appPackage missing');

console.log('[1] Foreground + connect...');
await exec(`adb shell am start -n ${pkg}/${activity}`).catch(() => {});
await sleep(3000);
const cdp = new WebViewCdpDriver(pkg);
await cdp.connect();
console.log('    ✓ connected');

console.log('[2] Baseline observe() with app in foreground...');
let t = Date.now();
const obs = await cdp.observe();
console.log(`    ✓ ${obs.elements.length} elements in ${Date.now() - t}ms`);

console.log('[3] Pushing app to BACKGROUND (HOME key)...');
await exec('adb shell input keyevent KEYCODE_HOME');
await sleep(2000);

console.log('[4] observe() with app backgrounded — the hang case:');
t = Date.now();
try {
  const o2 = await cdp.observe();
  console.log(`    (no timeout) returned ${o2.elements.length} elements in ${Date.now() - t}ms`);
} catch (err) {
  console.log(`    failed in ${Date.now() - t}ms`);
  console.log(`    message: ${(err as Error).message}`);
}

console.log('[5] find() with app backgrounded:');
t = Date.now();
const h = await cdp.find({ strategy: 'css', value: 'button.btn-login', weight: 1, origin: 'authored' });
console.log(`    returned ${h === null ? 'null' : 'handle'} in ${Date.now() - t}ms`);

console.log('[6] Restoring app to foreground...');
await exec(`adb shell am start -n ${pkg}/${activity}`).catch(() => {});
await sleep(3000);
await cdp.reconnect().catch((e) => console.log(`    reconnect: ${(e as Error).message}`));
t = Date.now();
try {
  const o3 = await cdp.observe();
  console.log(`    ✓ recovered: ${o3.elements.length} elements in ${Date.now() - t}ms`);
} catch (err) {
  console.log(`    ✗ did not recover: ${(err as Error).message}`);
}

await cdp.disconnect();
console.log('\nDone.');
