/**
 * POC: Đọc DOM thật từ WebView qua Appium + chromedriver
 *
 * Luồng:
 *   1. NATIVE_APP — kết nối session Appium
 *   2. → WEBVIEW  — chờ context xuất hiện rồi switch
 *   3. Lấy DOM    — chạy OBSERVE_DOM_FULL trong trang
 *   4. Tìm        — username / password / nút đăng nhập
 *   5. Candidates — build LocatorCandidate[] từ từng phần tử
 *   6. Interact   — type + tap qua chromedriver
 *   7. Navigate   — chờ trang mới load
 *   8. DOM lại    — snapshot DOM sau navigation
 *   9. Re-resolve — tìm lại các element theo candidates cũ
 *  10. ← NATIVE   — switch context về NATIVE_APP
 *
 * Chạy:
 *   npx tsx src/poc/webview-dom-poc.ts
 *
 * Yêu cầu: Appium server đang chạy ở port 4723, thiết bị Android đã kết nối,
 * và app đã build với WebView debugging bật.
 */

import { remote } from 'webdriverio';
import { OBSERVE_DOM_FULL } from '../discovery/WebObservationAdapter.js';
import { convertDomObservations, type DomRawElement } from '../discovery/WebObservationAdapter.js';
import type { LocatorCandidate } from '../core/types.js';

// ── cấu hình ─────────────────────────────────────────────────────────────────

const CONFIG = {
  hostname: '127.0.0.1',
  port: 4723,
  appPackage: 'com.fss.tcbs.mobiletrading',
  appActivity: 'com.fss.tcbs.mobiletrading.MainActivity',
  deviceName: 'R5CY21WADDY',   // thiết bị thật
  webviewTimeoutMs: 30_000,
};

// ── helpers ───────────────────────────────────────────────────────────────────

type WdioBrowser = Awaited<ReturnType<typeof remote>>;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function contextNames(b: WdioBrowser): Promise<string[]> {
  const raw = (await b.getContexts()) as Array<string | { id?: string }>;
  return raw.map((c) => (typeof c === 'string' ? c : (c.id ?? ''))).filter(Boolean);
}

async function waitForWebview(b: WdioBrowser, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let seen: string[] = [];
  for (;;) {
    seen = await contextNames(b);
    const found = seen.find((c) => c !== 'NATIVE_APP' && /WEBVIEW|CHROMIUM/i.test(c));
    if (found) return found;
    if (Date.now() > deadline) break;
    await sleep(500);
  }
  throw new Error(
    `Không tìm thấy WebView sau ${timeoutMs / 1000}s.\n` +
      `Contexts hiện có: ${seen.join(', ') || '(không có)'}\n` +
      `Đảm bảo app được build với WebView.setWebContentsDebuggingEnabled(true).`,
  );
}

// ── bước 5: build LocatorCandidate[] từ một phần tử DOM thô ──────────────────

function buildCandidates(el: DomRawElement, origin: LocatorCandidate['origin'] = 'crawler'): LocatorCandidate[] {
  const out: LocatorCandidate[] = [];

  if (el.testId) {
    out.push({ strategy: 'testId', value: el.testId, weight: 0.95, origin });
  }
  if (el.placeholder) {
    out.push({ strategy: 'placeholder', value: el.placeholder, weight: 0.85, origin });
  }
  if (el.name) {
    out.push({ strategy: 'label', value: el.name, weight: 0.80, origin });
  }
  if (el.text && !el.container) {
    out.push({ strategy: 'label', value: el.text, weight: 0.75, origin });
  }
  if (el.css) {
    out.push({ strategy: 'css', value: el.css, weight: 0.60, origin });
  }
  if (el.xpath) {
    out.push({ strategy: 'xpath', value: el.xpath, weight: 0.40, origin });
  }

  return out.sort((a, b) => b.weight - a.weight);
}

// ── bước 4: heuristic tìm login fields từ observation ─────────────────────────

interface LoginFields {
  username: DomRawElement | null;
  password: DomRawElement | null;
  loginButton: DomRawElement | null;
}

function findLoginFields(elements: DomRawElement[]): LoginFields {
  const usernameHints = /user|tài khoản|username|phone|số điện thoại|login|account/i;
  const passwordHints = /pass|mật khẩu|password|secret|pin/i;
  const buttonHints   = /đăng nhập|login|sign in|submit/i;

  const inputs = elements.filter((e) => e.role === 'textbox' && e.interactive && e.visible);
  const buttons = elements.filter((e) => (e.role === 'button' || e.role === 'link') && e.interactive && e.visible);

  const username = inputs.find((e) =>
    usernameHints.test(e.placeholder ?? '') ||
    usernameHints.test(e.name ?? '') ||
    usernameHints.test(e.css ?? ''),
  ) ?? inputs[0] ?? null;

  const password = inputs.find((e) =>
    passwordHints.test(e.placeholder ?? '') ||
    passwordHints.test(e.name ?? '') ||
    passwordHints.test(e.css ?? ''),
  ) ?? inputs[1] ?? null;

  const loginButton = buttons.find((e) =>
    buttonHints.test(e.text ?? '') ||
    buttonHints.test(e.name ?? ''),
  ) ?? null;

  return { username, password, loginButton };
}

// ── bước 6: interact với element qua CSS selector ────────────────────────────

async function fillField(b: WdioBrowser, el: DomRawElement, value: string): Promise<void> {
  const sel = el.css ?? el.xpath ?? '';
  if (!sel) throw new Error('Không có selector cho field!');
  const elem = await b.$(sel);
  await elem.clearValue();
  await elem.setValue(value);
  log(`  ✓ Đã nhập "${value}" vào ${sel}`);
}

async function tapElement(b: WdioBrowser, el: DomRawElement): Promise<void> {
  const sel = el.css ?? el.xpath ?? '';
  if (!sel) throw new Error('Không có selector cho button!');
  const elem = await b.$(sel);
  await elem.click();
  log(`  ✓ Đã tap ${sel}`);
}

// ── bước 9: re-resolve — tìm lại phần tử từ candidates sau navigation ─────────

async function resolveCandidate(
  b: WdioBrowser,
  candidates: LocatorCandidate[],
  label: string,
): Promise<{ found: boolean; usedCandidate: LocatorCandidate | null }> {
  for (const c of candidates) {
    try {
      let sel: string;
      if (c.strategy === 'css')   sel = c.value;
      else if (c.strategy === 'xpath') sel = c.value;
      else if (c.strategy === 'placeholder') sel = `[placeholder="${c.value}"]`;
      else if (c.strategy === 'testId')
        sel = `[data-testid="${c.value}"],[data-test="${c.value}"],[data-cy="${c.value}"]`;
      else if (c.strategy === 'label')
        sel = `[aria-label="${c.value}"]`;
      else continue;

      const el = await b.$(sel);
      if (await el.isExisting() && await el.isDisplayed()) {
        log(`  ✓ "${label}" resolve được qua ${c.strategy}="${c.value}" (weight=${c.weight})`);
        return { found: true, usedCandidate: c };
      }
    } catch {
      // thử candidate tiếp theo
    }
  }
  log(`  ✗ "${label}" không resolve được sau navigation`);
  return { found: false, usedCandidate: null };
}

// ── logging đẹp ───────────────────────────────────────────────────────────────

function log(msg: string): void {
  console.log(msg);
}

function section(title: string): void {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`▶ ${title}`);
  console.log('─'.repeat(60));
}

// ── MAIN ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // ── bước 1: NATIVE_APP — kết nối Appium ────────────────────────────────────
  section('Bước 1: NATIVE_APP — kết nối Appium');
  const browser = await remote({
    hostname: CONFIG.hostname,
    port: CONFIG.port,
    path: '/',
    logLevel: 'warn',
    capabilities: {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:deviceName': CONFIG.deviceName,
      'appium:appPackage': CONFIG.appPackage,
      'appium:appActivity': CONFIG.appActivity,
      'appium:newCommandTimeout': 300,
      'appium:autoGrantPermissions': true,
      // @ts-expect-error — Appium extensions not in the WDIO capability typedefs
      'appium:chromedriverExecutable': `${process.env.HOME}/.appium/chromedriver/chromedriver150`,
      'appium:chromedriverDisableBuildCheck': true,
      'appium:enableWebviewDetailsCollection': false,
    },
  });

  const startContexts = await contextNames(browser);
  log(`Context khởi đầu: ${startContexts.join(', ')}`);
  log(`Đang ở: NATIVE_APP`);

  try {
    // ── bước 2: → WEBVIEW ───────────────────────────────────────────────────
    section('Bước 2: Switch → WEBVIEW');
    const webviewCtx = await waitForWebview(browser, CONFIG.webviewTimeoutMs);
    await browser.switchContext(webviewCtx);
    log(`Đã switch sang: ${webviewCtx}`);
    log(`URL hiện tại: ${await browser.getUrl()}`);

    // Navigate đến trang đăng nhập web của app (WEBVIEW_chrome là Chrome browser
    // đang chạy background trên thiết bị — app native này hybrid: false)
    log('Navigating đến trang đăng nhập...');
    await browser.url('https://tcinvest.tcbs.com.vn');
    // Poll cho đến khi Angular/SPA render ra ít nhất 1 input (tối đa 15s)
    let waitedMs = 0;
    while (waitedMs < 15_000) {
      await sleep(1_000);
      waitedMs += 1_000;
      const count = await browser.execute<number>('return document.querySelectorAll("input").length');
      log(`  [${waitedMs / 1000}s] inputs trên DOM: ${count}`);
      if ((count as unknown as number) > 0) break;
    }
    log(`URL sau navigate: ${await browser.getUrl()}`);

    // ── bước 3: Lấy DOM ─────────────────────────────────────────────────────
    section('Bước 3: Lấy DOM (OBSERVE_DOM_FULL)');
    // WDIO execute(string) cần `return` explicit ở top-level để capture giá trị
    const rawElements = await browser.execute<DomRawElement[]>(`return ${OBSERVE_DOM_FULL}`);
    const observation = convertDomObservations(rawElements);
    log(`Tổng số element quan sát được: ${observation.elements.length}`);
    log(`  - interactive: ${observation.elements.filter((e) => e.interactive).length}`);
    log(`  - visible:     ${observation.elements.filter((e) => e.visible).length}`);

    // ── bước 4: Tìm username / password / login button ───────────────────────
    section('Bước 4: Tìm login fields');
    const { username, password, loginButton } = findLoginFields(rawElements);

    log(`Username field: ${username ? `✓ (placeholder="${username.placeholder}", css="${username.css}")` : '✗ không tìm thấy'}`);
    log(`Password field: ${password ? `✓ (placeholder="${password.placeholder}", css="${password.css}")` : '✗ không tìm thấy'}`);
    log(`Login button:   ${loginButton ? `✓ (text="${loginButton.text}", css="${loginButton.css}")` : '✗ không tìm thấy'}`);

    if (!username || !password || !loginButton) {
      throw new Error('Thiếu một hoặc nhiều login element. Kiểm tra lại app đang ở màn hình đăng nhập.');
    }

    // ── bước 5: Build LocatorCandidate[] ────────────────────────────────────
    section('Bước 5: LocatorCandidate[]');
    const usernameCandidates = buildCandidates(username);
    const passwordCandidates = buildCandidates(password);
    const buttonCandidates   = buildCandidates(loginButton);

    log('Username candidates:');
    usernameCandidates.forEach((c) => log(`  [${c.weight.toFixed(2)}] ${c.strategy}="${c.value}"`));
    log('Password candidates:');
    passwordCandidates.forEach((c) => log(`  [${c.weight.toFixed(2)}] ${c.strategy}="${c.value}"`));
    log('Button candidates:');
    buttonCandidates.forEach((c) => log(`  [${c.weight.toFixed(2)}] ${c.strategy}="${c.value}"`));

    // ── bước 6: Interaction ─────────────────────────────────────────────────
    section('Bước 6: Interaction — nhập thông tin đăng nhập');
    // Dùng credentials demo — không phải tài khoản thật
    await fillField(browser, username, 'poc-user-demo');
    await fillField(browser, password, 'poc-pass-demo');

    // ── bước 7: Navigation — tap nút đăng nhập ──────────────────────────────
    section('Bước 7: Navigation — tap nút đăng nhập');
    const urlBefore = await browser.getUrl();
    log(`URL trước: ${urlBefore}`);
    await tapElement(browser, loginButton);

    // Chờ trang phản hồi — không dùng implicit wait, poll thủ công
    await sleep(2_000);
    const urlAfter = await browser.getUrl();
    log(`URL sau:   ${urlAfter}`);
    log(urlBefore !== urlAfter ? '  ✓ Navigation đã xảy ra' : '  ~ URL không đổi (SPA in-page update)');

    // ── bước 8: Lấy DOM lại ─────────────────────────────────────────────────
    section('Bước 8: DOM sau navigation');
    const rawElements2 = await browser.execute<DomRawElement[], []>(OBSERVE_DOM_FULL as unknown as () => DomRawElement[]);
    const observation2 = convertDomObservations(rawElements2);
    log(`Số element sau navigation: ${observation2.elements.length}`);
    log(`  - interactive: ${observation2.elements.filter((e) => e.interactive).length}`);

    // Tóm tắt nhanh những gì thay đổi
    const textsBefore = new Set(rawElements.map((e) => e.text).filter(Boolean));
    const textsAfter  = new Set(rawElements2.map((e) => e.text).filter(Boolean));
    const newTexts = [...textsAfter].filter((t) => !textsBefore.has(t)).slice(0, 5);
    if (newTexts.length) {
      log(`  Texts mới xuất hiện: ${newTexts.map((t) => `"${t}"`).join(', ')}`);
    }

    // ── bước 9: Re-resolve elements ─────────────────────────────────────────
    section('Bước 9: Re-resolve elements sau navigation');
    await resolveCandidate(browser, usernameCandidates, 'username field');
    await resolveCandidate(browser, passwordCandidates, 'password field');
    await resolveCandidate(browser, buttonCandidates, 'login button');

    // ── bước 10: ← NATIVE_APP ───────────────────────────────────────────────
    section('Bước 10: Switch ← NATIVE_APP');
    await browser.switchContext('NATIVE_APP');
    const finalContexts = await contextNames(browser);
    log(`Context sau khi switch: ${finalContexts.join(', ')}`);
    log('Đang ở: NATIVE_APP ✓');

    // Chụp screenshot từ native để xác nhận
    const shot = await browser.takeScreenshot();
    log(`Screenshot native: ${shot.length} bytes (base64)`);

  } finally {
    section('Kết thúc — đóng session');
    await browser.deleteSession();
    log('Session đã đóng.');
  }
}

main().catch((err) => {
  console.error('\n✗ POC thất bại:', err.message);
  process.exit(1);
});
