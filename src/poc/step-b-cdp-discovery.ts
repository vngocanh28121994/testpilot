/**
 * STEP B — Verify CDP discovery programmatically.
 *
 * 1. Get PID of the app process via `adb shell pidof`
 * 2. Forward TCP port to WebView devtools socket
 * 3. Fetch /json from CDP endpoint
 * 4. Report: host, port, wsUrl, target type, url, title
 *
 * Run: npx tsx src/poc/step-b-cdp-discovery.ts
 */
import { execSync } from 'node:child_process';

const DEVICE_SERIAL = 'R5CY21WADDY';
const APP_PACKAGE = 'com.fss.tcbs.mobiletrading';
const LOCAL_PORT = 9222;

console.log('STEP B — Programmatic CDP Discovery');
console.log('═'.repeat(60));

// 1. Get PID
const pidRaw = execSync(`adb -s ${DEVICE_SERIAL} shell pidof ${APP_PACKAGE}`, { encoding: 'utf8' }).trim();
const pid = parseInt(pidRaw.split(/\s+/)[0]!, 10);
console.log(`\nApp PID: ${pid}`);

if (isNaN(pid)) {
  console.error('STEP B STATUS: FAIL — could not get PID');
  process.exit(1);
}

// 2. Forward TCP port
const socketName = `webview_devtools_remote_${pid}`;
const forwardResult = execSync(
  `adb -s ${DEVICE_SERIAL} forward tcp:${LOCAL_PORT} localabstract:${socketName}`,
  { encoding: 'utf8' }
).trim();
console.log(`ADB forward: tcp:${LOCAL_PORT} → localabstract:${socketName} → ${forwardResult}`);

// 3. Fetch /json
await new Promise(r => setTimeout(r, 300));
const resp = await fetch(`http://localhost:${LOCAL_PORT}/json`);
const targets = await resp.json() as Array<{
  id: string;
  title: string;
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
  description: string;
}>;

const versionResp = await fetch(`http://localhost:${LOCAL_PORT}/json/version`);
const version = await versionResp.json() as Record<string, string>;

console.log(`\nCDP /json/version:`);
console.log(`  Browser:          ${version['Browser'] ?? 'N/A'}`);
console.log(`  Protocol-Version: ${version['Protocol-Version'] ?? 'N/A'}`);
console.log(`  Android-Package:  ${version['Android-Package'] ?? 'N/A'}`);

console.log(`\nCDP targets (${targets.length}):`);
for (const t of targets) {
  console.log(`  id:    ${t.id}`);
  console.log(`  title: ${t.title}`);
  console.log(`  type:  ${t.type}`);
  console.log(`  url:   ${t.url}`);
  console.log(`  ws:    ${t.webSocketDebuggerUrl}`);
}

const pageTarget = targets.find(t => t.type === 'page');
if (pageTarget) {
  console.log(`\nSTEP B STATUS: PASS`);
  console.log(`CDP host:   localhost`);
  console.log(`CDP port:   ${LOCAL_PORT}`);
  console.log(`WS URL:     ${pageTarget.webSocketDebuggerUrl}`);
  console.log(`Target URL: ${pageTarget.url}`);
  console.log(`Title:      ${pageTarget.title}`);
} else {
  console.log(`\nSTEP B STATUS: FAIL — no page target found`);
  process.exitCode = 1;
}
