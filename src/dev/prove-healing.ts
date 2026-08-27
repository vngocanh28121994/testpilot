/**
 * Proof script: does healing actually generate a working locator for the
 * Angular Material login button?
 *
 * Connects CDP directly — no Appium, no UiAutomator2 — so it is unaffected by
 * the instrumentation crashes that keep killing the full suite.
 *
 * Chạy: tsx src/dev/prove-healing.ts
 *
 * SECURITY: never prints element `value` — the password field's contents must
 * not reach stdout or any log.
 */
import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import { loadConfig } from '../config.js';
import { WebViewCdpDriver } from '../drivers/WebViewCdpDriver.js';
import { domSelector } from '../drivers/native.js';
import { candidatesFor, type Observed } from '../crawl/observe.js';
import type { LocatorCandidate } from '../core/types.js';

const exec = promisify(execCb);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const cfg = await loadConfig('testpilot.config.json');
const pkg = cfg.android.appPackage;
const activity = cfg.android.appActivity;
if (!pkg) throw new Error('android.appPackage missing from testpilot.config.json');

// ── 1. Ensure the app is in the FOREGROUND ───────────────────────────────────
// CDP's HTTP server only answers while the app is foregrounded — the root cause
// of every "endpoint not reachable" failure so far.
console.log(`[1] Bringing ${pkg} to foreground...`);
await exec(`adb shell am start -n ${pkg}/${activity}`).catch(() => {});
await sleep(3000);

const { stdout: winOut } = await exec(
  `adb shell dumpsys window | grep -E "mCurrentFocus|mFocusedApp" | head -2`,
).catch(() => ({ stdout: '' }));
console.log(`    focus: ${winOut.trim().split('\n')[0] ?? '(unknown)'}`);

// ── 2. Connect CDP ────────────────────────────────────────────────────────────
console.log(`[2] Connecting CDP...`);
const cdp = new WebViewCdpDriver(pkg);
await cdp.connect();
console.log(`    ✓ connected`);

const page = cdp.getPage();
if (!page) throw new Error('no page');
console.log(`    url: ${page.url()}`);

// ── 3. Observe ────────────────────────────────────────────────────────────────
console.log(`[3] observe()...`);
const obs = await cdp.observe();
console.log(`    ${obs.elements.length} elements`);

// ── 4. Locate the login button among the observed elements ───────────────────
// Match on visible text rather than any authored locator: the whole point is to
// see what healing would find on its own.
const wanted = 'đăng nhập';
const buttons = obs.elements.filter(
  (e) =>
    (e.role === 'button' || e.role === 'a') &&
    (e.text ?? '').toLowerCase().includes(wanted),
);

console.log(`\n[4] Buttons whose text contains "${wanted}": ${buttons.length}`);
for (const b of buttons) {
  // Deliberately NOT printing b.value — password safety.
  console.log(`  ─────────────────────────────────────────`);
  console.log(`  role:        ${b.role}`);
  console.log(`  text:        ${JSON.stringify(b.text)}`);
  console.log(`  css:         ${b.css ?? '(none)'}`);
  console.log(`  testId:      ${b.testId ?? '(none)'}`);
  console.log(`  resourceId:  ${b.resourceId ?? '(none)'}`);
  console.log(`  ariaLabel:   ${b.accessibilityLabel ?? '(none)'}`);
  console.log(`  visible:     ${b.visible}`);
}

if (buttons.length === 0) {
  console.log('\n  ⚠ No login button observed — is the app on the login screen?');
  await cdp.disconnect();
  process.exit(1);
}

// ── 5. What candidates would healing generate? ───────────────────────────────
const target = buttons[0]!;
const asObserved: Observed = {
  testId: target.testId,
  role: target.role,
  name: target.accessibilityLabel,
  text: target.text,
  placeholder: target.placeholder,
  resourceId: target.resourceId,
  css: target.css,
  interactive: target.interactive ?? false,
  index: 0,
  container: false,
};

const candidates = candidatesFor(asObserved, 'web');
console.log(`\n[5] Candidates healing would generate (ranked):`);
for (const c of candidates) {
  console.log(`  ${c.weight.toFixed(2)}  ${c.strategy.padEnd(11)} ${c.value}${c.name ? `  (name=${c.name})` : ''}`);
}

// ── 6. Decisive test: does each candidate actually MATCH in the live DOM? ─────
console.log(`\n[6] Live match test — the actual proof:`);
for (const c of candidates) {
  let sel: string;
  try {
    sel = domSelector(c as LocatorCandidate);
  } catch (err) {
    console.log(`  ✗ ${c.strategy.padEnd(11)} domSelector threw: ${(err as Error).message}`);
    continue;
  }
  const count = await page.locator(sel).count().catch(() => -1);
  const mark = count > 0 ? '✓' : '✗';
  console.log(`  ${mark} ${c.strategy.padEnd(11)} count=${count}`);
  console.log(`      ${sel.slice(0, 160)}${sel.length > 160 ? '…' : ''}`);
}

// ── 7. Regression check: the exact label candidate that used to fail ─────────
// Before the fix, domSelector's label arm carried `not(*)`, so an Angular
// Material button (which has mat-ripple/span children) could never match.
console.log(`\n[7] The case that failed before the fix — label="Đăng nhập":`);
const labelSel = domSelector({ strategy: 'label', value: 'Đăng nhập', weight: 0.7, origin: 'authored' });
const labelCount = await page.locator(labelSel).count().catch(() => -1);
console.log(`  count=${labelCount}  ${labelCount > 0 ? '✓ FIXED' : '✗ STILL BROKEN'}`);

// Matching more than one node is only safe if .first() — which is what every
// call site uses — lands on the button rather than a wrapper. A wrapper match
// is the classic failure where the tap hits the centre of the whole subtree.
if (labelCount > 1) {
  console.log(`\n[8] ${labelCount} matches — verifying .first() is the real button:`);
  for (let i = 0; i < labelCount; i++) {
    const n = page.locator(labelSel).nth(i);
    const info = await n.evaluate((e: Element) => ({
      tag: e.tagName.toLowerCase(),
      cls: (e as HTMLElement).className || '(none)',
      clickable: e.tagName === 'BUTTON' || e.getAttribute('role') === 'button',
    })).catch(() => null);
    if (!info) continue;
    console.log(
      `  [${i}]${i === 0 ? ' ← .first()' : '          '} <${info.tag}> class="${info.cls}" clickable=${info.clickable}`,
    );
  }
}

await cdp.disconnect();
console.log('\nDone.');
