/**
 * TestPilot — Live Test Runner Server
 * Port 4301 | SSE streaming | TAP parser
 *
 * Routes:
 *   GET  /            → dashboard HTML
 *   POST /run         → spawn test suite, return { runId }
 *   GET  /events/:id  → SSE stream of live TAP output
 *   GET  /runs        → list recent runs
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const PORT = 4301;

// ── run registry ─────────────────────────────────────────────────────────────

interface Run {
  id: string;
  suite: string;
  cmd: string;
  startedAt: number;
  status: 'running' | 'pass' | 'fail';
  lines: string[];
  listeners: Set<ServerResponse>;
}

const runs = new Map<string, Run>();

// ── test suite definitions ────────────────────────────────────────────────────

const SUITES: Record<string, { label: string; cmd: string; args: string[] }> = {
  unit: {
    label: 'Unit tests (npm test)',
    cmd: 'npm',
    args: ['test'],
  },
  phase13: {
    label: 'Phase 1.3 — full execution path (emulator)',
    cmd: 'node',
    args: [
      '--import', 'tsx/esm', '--test',
      'src/discovery/mcp/__tests__/Phase13Execution.integration.test.ts',
    ],
  },
  webview: {
    label: 'WebView interaction (emulator)',
    cmd: 'node',
    args: [
      '--import', 'tsx/esm', '--test',
      'src/discovery/mcp/__tests__/WebViewInteraction.integration.test.ts',
    ],
  },
  tapverify: {
    label: 'TapVerify — pre-flight (emulator)',
    cmd: 'node',
    args: [
      '--import', 'tsx/esm', '--test',
      'src/discovery/mcp/__tests__/TapVerify.integration.test.ts',
    ],
  },
  driver: {
    label: 'AppiumMcpDriver unit tests',
    cmd: 'node',
    args: [
      '--import', 'tsx/esm', '--test',
      'src/drivers/__tests__/AppiumMcpDriver.test.ts',
    ],
  },
};

// ── spawn a test run ──────────────────────────────────────────────────────────

function spawnRun(suiteKey: string): string {
  const suite = SUITES[suiteKey];
  if (!suite) throw new Error(`Unknown suite: ${suiteKey}`);

  const id = randomUUID().slice(0, 8);
  const run: Run = {
    id,
    suite: suiteKey,
    cmd: `${suite.cmd} ${suite.args.join(' ')}`,
    startedAt: Date.now(),
    status: 'running',
    lines: [],
    listeners: new Set(),
  };
  runs.set(id, run);

  const child = spawn(suite.cmd, suite.args, {
    cwd: process.cwd(),
    env: { ...process.env },
  });

  function broadcast(event: string, data: string) {
    run.lines.push(`${event}:${data}`);
    const msg = `event: ${event}\ndata: ${data}\n\n`;
    for (const res of run.listeners) {
      try { res.write(msg); } catch { run.listeners.delete(res); }
    }
  }

  function onLine(line: string) {
    broadcast('line', JSON.stringify(line));
  }

  let stdoutBuf = '';
  child.stdout.on('data', (chunk: Buffer) => {
    stdoutBuf += chunk.toString();
    const parts = stdoutBuf.split('\n');
    stdoutBuf = parts.pop() ?? '';
    for (const line of parts) onLine(line);
  });

  let stderrBuf = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderrBuf += chunk.toString();
    const parts = stderrBuf.split('\n');
    stderrBuf = parts.pop() ?? '';
    for (const line of parts) onLine(`[stderr] ${line}`);
  });

  child.on('close', (code) => {
    if (stdoutBuf) onLine(stdoutBuf);
    if (stderrBuf) onLine(`[stderr] ${stderrBuf}`);
    run.status = code === 0 ? 'pass' : 'fail';
    broadcast('done', JSON.stringify({ code, status: run.status, duration: Date.now() - run.startedAt }));
    for (const res of run.listeners) {
      try { res.end(); } catch {}
    }
    run.listeners.clear();
  });

  return id;
}

// ── HTTP server ───────────────────────────────────────────────────────────────

function cors(res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

createServer((req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  cors(res);

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // GET / → dashboard
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(DASHBOARD_HTML);
    return;
  }

  // GET /suites → list of suites
  if (req.method === 'GET' && url.pathname === '/suites') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(
      Object.entries(SUITES).map(([key, s]) => ({ key, label: s.label, cmd: s.cmd + ' ' + s.args.join(' ') })),
    ));
    return;
  }

  // POST /run?suite=... → start run
  if (req.method === 'POST' && url.pathname === '/run') {
    const suite = url.searchParams.get('suite') ?? 'unit';
    try {
      const id = spawnRun(suite);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  // GET /events/:id → SSE
  if (req.method === 'GET' && url.pathname.startsWith('/events/')) {
    const id = url.pathname.slice('/events/'.length);
    const run = runs.get(id);
    if (!run) { res.writeHead(404); res.end('Not found'); return; }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write(':ok\n\n');

    // Replay buffered lines
    for (const stored of run.lines) {
      const colon = stored.indexOf(':');
      const event = stored.slice(0, colon);
      const data = stored.slice(colon + 1);
      res.write(`event: ${event}\ndata: ${data}\n\n`);
    }

    if (run.status !== 'running') { res.end(); return; }
    run.listeners.add(res);
    req.on('close', () => run.listeners.delete(res));
    return;
  }

  // GET /runs → recent run summaries
  if (req.method === 'GET' && url.pathname === '/runs') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const list = [...runs.values()].slice(-20).reverse().map(r => ({
      id: r.id, suite: r.suite, status: r.status,
      startedAt: r.startedAt, cmd: r.cmd,
    }));
    res.end(JSON.stringify(list));
    return;
  }

  res.writeHead(404); res.end('Not found');
}).listen(PORT, () => {
  console.log(`TestPilot test runner  →  http://localhost:${PORT}`);
});

// ── dashboard HTML ────────────────────────────────────────────────────────────

const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>TestPilot — Test Runner</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0f1117; --surface: #1a1d27; --border: #2a2d3d;
    --text: #e2e4ef; --muted: #6b7280; --accent: #6366f1;
    --pass: #22c55e; --fail: #ef4444; --running: #f59e0b;
    --warn: #f59e0b; --radius: 8px; --mono: 'JetBrains Mono', 'Fira Code', monospace;
  }
  body { background: var(--bg); color: var(--text); font-family: system-ui, sans-serif; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
  header { padding: 14px 20px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 16px; flex-shrink: 0; }
  header h1 { font-size: 15px; font-weight: 600; letter-spacing: .02em; }
  header .badge { font-size: 11px; padding: 2px 8px; border-radius: 99px; background: var(--surface); border: 1px solid var(--border); color: var(--muted); }
  .main { display: flex; flex: 1; overflow: hidden; }
  .sidebar { width: 280px; border-right: 1px solid var(--border); display: flex; flex-direction: column; flex-shrink: 0; overflow: hidden; }
  .sidebar-header { padding: 12px 16px; font-size: 11px; font-weight: 600; letter-spacing: .08em; color: var(--muted); text-transform: uppercase; border-bottom: 1px solid var(--border); }
  .suite-list { flex: 1; overflow-y: auto; padding: 8px; }
  .suite-item { display: block; width: 100%; text-align: left; padding: 10px 12px; border-radius: var(--radius); cursor: pointer; margin-bottom: 4px; border: 1px solid transparent; transition: background .1s, border-color .1s; background: none; color: var(--text); font-family: inherit; }
  .suite-item:hover { background: var(--surface); border-color: var(--border); }
  .suite-item.selected { background: color-mix(in srgb, var(--accent) 15%, transparent); border-color: color-mix(in srgb, var(--accent) 40%, transparent); }
  .suite-item .suite-name { font-size: 13px; font-weight: 500; margin-bottom: 3px; }
  .suite-item .suite-cmd { font-size: 10px; color: var(--muted); font-family: var(--mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .run-btn { margin: 12px; padding: 10px; background: var(--accent); color: #fff; border: none; border-radius: var(--radius); font-size: 13px; font-weight: 600; cursor: pointer; transition: opacity .15s; }
  .run-btn:hover { opacity: .9; } .run-btn:active { opacity: .8; }
  .run-btn:disabled { opacity: .4; cursor: not-allowed; }
  .history { border-top: 1px solid var(--border); padding: 8px; max-height: 160px; overflow-y: auto; }
  .history-label { font-size: 10px; font-weight: 600; color: var(--muted); letter-spacing: .08em; text-transform: uppercase; padding: 4px 4px 8px; }
  .hist-item { display: flex; align-items: center; gap: 8px; padding: 5px 4px; border-radius: 4px; cursor: pointer; font-size: 12px; }
  .hist-item:hover { background: var(--surface); }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .dot.pass { background: var(--pass); } .dot.fail { background: var(--fail); } .dot.running { background: var(--running); animation: pulse 1s infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
  .hist-suite { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hist-time { color: var(--muted); font-size: 10px; flex-shrink: 0; }
  .output-pane { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .output-toolbar { padding: 10px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
  .output-title { font-size: 13px; font-weight: 500; flex: 1; }
  .stat { font-size: 12px; padding: 2px 10px; border-radius: 99px; font-weight: 600; }
  .stat.pass { background: color-mix(in srgb,var(--pass) 15%,transparent); color: var(--pass); }
  .stat.fail { background: color-mix(in srgb,var(--fail) 15%,transparent); color: var(--fail); }
  .stat.running { background: color-mix(in srgb,var(--running) 15%,transparent); color: var(--running); }
  .stat.idle { background: var(--surface); color: var(--muted); }
  .dur { font-size: 11px; color: var(--muted); }
  .pane-body { flex: 1; display: flex; overflow: hidden; }
  .test-tree { width: 300px; border-right: 1px solid var(--border); overflow-y: auto; padding: 8px; flex-shrink: 0; }
  .test-tree:empty::after { content: 'No tests yet'; font-size: 12px; color: var(--muted); padding: 12px; display: block; }
  .t-item { padding: 5px 8px; border-radius: 4px; font-size: 12px; font-family: var(--mono); margin-bottom: 2px; display: flex; align-items: flex-start; gap: 6px; cursor: pointer; }
  .t-item:hover { background: var(--surface); }
  .t-item.selected { background: color-mix(in srgb,var(--accent) 12%,transparent); }
  .t-icon { flex-shrink: 0; margin-top: 1px; }
  .t-name { flex: 1; line-height: 1.4; word-break: break-word; }
  .t-dur { color: var(--muted); font-size: 10px; flex-shrink: 0; }
  .t-item.pass .t-icon::before { content:'✓'; color: var(--pass); }
  .t-item.fail .t-icon::before { content:'✗'; color: var(--fail); }
  .t-item.running .t-icon::before { content:'●'; color: var(--running); }
  .t-item.suite > .t-name { font-weight: 600; color: var(--accent); }
  .raw-log { flex: 1; overflow-y: auto; background: var(--surface); padding: 16px; font-family: var(--mono); font-size: 12px; line-height: 1.7; }
  .raw-log:empty::after { content: 'Run a suite to see output'; font-size: 13px; color: var(--muted); }
  .l { display: block; white-space: pre-wrap; word-break: break-all; }
  .l.ok { color: var(--pass); } .l.notok { color: var(--fail); }
  .l.tap-plan { color: var(--accent); }
  .l.tap-comment { color: var(--muted); font-style: italic; }
  .l.tap-summary { color: #a78bfa; font-weight: 600; }
  .l.stderr { color: var(--warn); }
  .l.done-pass { color: var(--pass); font-weight: 600; }
  .l.done-fail { color: var(--fail); font-weight: 600; }
  .empty-state { display: flex; align-items: center; justify-content: center; flex: 1; }
  .empty-state p { color: var(--muted); font-size: 14px; text-align: center; line-height: 1.8; }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
</style>
</head>
<body>
<header>
  <h1>🧪 TestPilot Runner</h1>
  <span class="badge" id="hdr-status">idle</span>
</header>
<div class="main">
  <div class="sidebar">
    <div class="sidebar-header">Test Suites</div>
    <div class="suite-list" id="suite-list"></div>
    <button class="run-btn" id="run-btn" disabled>▶ Run</button>
    <div class="history">
      <div class="history-label">Recent Runs</div>
      <div id="hist-list"></div>
    </div>
  </div>
  <div class="output-pane">
    <div class="output-toolbar">
      <span class="output-title" id="out-title">Select a suite and click Run</span>
      <span class="stat idle" id="stat-badge">idle</span>
      <span class="dur" id="dur-badge"></span>
    </div>
    <div class="pane-body">
      <div class="test-tree" id="test-tree"></div>
      <div class="raw-log" id="raw-log"></div>
    </div>
  </div>
</div>
<script>
const API = '';
let selectedSuite = null;
let activeEs = null;
let runStartMs = 0;
let durTimer = null;
let suites = [];

// ── init ─────────────────────────────────────────────────────────────────────

async function init() {
  suites = await fetch(API + '/suites').then(r => r.json());
  renderSuites();
  refreshHistory();
  setInterval(refreshHistory, 4000);
}

// ── suite list ────────────────────────────────────────────────────────────────

function renderSuites() {
  const el = document.getElementById('suite-list');
  el.innerHTML = '';
  for (const s of suites) {
    const div = document.createElement('button');
    div.className = 'suite-item';
    div.dataset.key = s.key;
    div.innerHTML = \`<div class="suite-name">\${esc(s.label)}</div><div class="suite-cmd">\${esc(s.cmd)}</div>\`;
    div.addEventListener('click', () => selectSuite(s.key));
    el.appendChild(div);
  }
}

function selectSuite(key) {
  selectedSuite = key;
  document.querySelectorAll('.suite-item').forEach(el => el.classList.toggle('selected', el.dataset.key === key));
  document.getElementById('run-btn').disabled = false;
  const s = suites.find(s => s.key === key);
  if (s) document.getElementById('out-title').textContent = s.label;
}

// ── run ───────────────────────────────────────────────────────────────────────

document.getElementById('run-btn').addEventListener('click', async () => {
  if (!selectedSuite) return;
  if (activeEs) { activeEs.close(); activeEs = null; }
  clearLog();
  const { id } = await fetch(API + '/run?suite=' + selectedSuite, { method: 'POST' }).then(r => r.json());
  streamRun(id);
});

function streamRun(id) {
  runStartMs = Date.now();
  setStatus('running');
  document.getElementById('run-btn').disabled = true;
  clearInterval(durTimer);
  durTimer = setInterval(() => {
    document.getElementById('dur-badge').textContent = ((Date.now() - runStartMs) / 1000).toFixed(1) + 's';
  }, 200);

  const es = new EventSource(API + '/events/' + id);
  activeEs = es;

  es.addEventListener('line', e => {
    appendLine(JSON.parse(e.data));
  });

  es.addEventListener('done', e => {
    const { code, status, duration } = JSON.parse(e.data);
    clearInterval(durTimer);
    document.getElementById('dur-badge').textContent = (duration / 1000).toFixed(2) + 's';
    setStatus(status);
    document.getElementById('run-btn').disabled = false;
    es.close(); activeEs = null;
    refreshHistory();
    appendSummaryLine(status, duration);
  });

  es.onerror = () => {
    document.getElementById('run-btn').disabled = false;
    clearInterval(durTimer);
  };
}

// ── log rendering ─────────────────────────────────────────────────────────────

const testTree = document.getElementById('test-tree');
const rawLog   = document.getElementById('raw-log');
let passCount = 0, failCount = 0;
// track current suite nesting for tree
const suiteStack = [];

function clearLog() {
  rawLog.innerHTML = '';
  testTree.innerHTML = '';
  passCount = 0; failCount = 0;
  suiteStack.length = 0;
}

function appendLine(raw) {
  const span = document.createElement('span');
  span.className = 'l';
  span.textContent = raw;

  // classify
  if (raw.startsWith('[stderr]')) {
    span.classList.add('stderr');
  } else if (/^ok \\d/.test(raw)) {
    span.classList.add('ok');
    parseTestResult(raw, true);
  } else if (/^not ok \\d/.test(raw)) {
    span.classList.add('notok');
    parseTestResult(raw, false);
  } else if (/^# tests \\d/.test(raw) || /^# (pass|fail)/.test(raw)) {
    span.classList.add('tap-summary');
  } else if (/^# Subtest:/.test(raw)) {
    span.classList.add('tap-comment');
    parseSuiteStart(raw);
  } else if (/^# /.test(raw)) {
    span.classList.add('tap-comment');
  } else if (/^1\\.\\.\\./.test(raw) || /^\\.\\.\\./.test(raw)) {
    span.classList.add('tap-plan');
  } else if (/^TAP version/.test(raw)) {
    span.classList.add('tap-plan');
  }

  rawLog.appendChild(span);
  rawLog.scrollTop = rawLog.scrollHeight;
}

function parseTestResult(raw, pass) {
  // "ok 3 - suite name" or "    ok 3 - test name"
  const m = raw.trim().match(/^(ok|not ok)\\s+\\d+\\s+-\\s+(.+?)(?:\\s+#.*)?$/);
  if (!m) return;
  const name = m[2].trim();

  // duration from indent level / subtest
  const item = document.createElement('div');
  item.className = 't-item ' + (pass ? 'pass' : 'fail');
  item.innerHTML = \`<span class="t-icon"></span><span class="t-name">\${esc(name)}</span>\`;
  item.addEventListener('click', () => {
    document.querySelectorAll('.t-item').forEach(el => el.classList.remove('selected'));
    item.classList.add('selected');
    // scroll raw log to the line with this name
    const lines = rawLog.querySelectorAll('.l');
    for (const l of lines) {
      if (l.textContent.includes(name)) { l.scrollIntoView({ block: 'center' }); break; }
    }
  });
  testTree.appendChild(item);

  if (pass) passCount++; else failCount++;
  updateStat();
}

function parseSuiteStart(raw) {
  const m = raw.match(/# Subtest: (.+)/);
  if (!m) return;
}

function appendSummaryLine(status, duration) {
  const span = document.createElement('span');
  span.className = 'l ' + (status === 'pass' ? 'done-pass' : 'done-fail');
  span.textContent = status === 'pass'
    ? \`\\n✓ All tests passed in \${(duration/1000).toFixed(2)}s\`
    : \`\\n✗ Some tests failed (\${(duration/1000).toFixed(2)}s)\`;
  rawLog.appendChild(span);
  rawLog.scrollTop = rawLog.scrollHeight;
}

// ── status ────────────────────────────────────────────────────────────────────

function setStatus(s) {
  const badge = document.getElementById('stat-badge');
  const hdr = document.getElementById('hdr-status');
  badge.className = 'stat ' + s;
  badge.textContent = s === 'running' ? 'running…' : s === 'pass' ? '✓ pass' : '✗ fail';
  hdr.textContent = s;
}

function updateStat() {
  const badge = document.getElementById('stat-badge');
  if (badge.classList.contains('running')) {
    badge.textContent = \`running… \${passCount}p \${failCount}f\`;
  }
}

// ── history ───────────────────────────────────────────────────────────────────

async function refreshHistory() {
  const list = await fetch(API + '/runs').then(r => r.json()).catch(() => []);
  const el = document.getElementById('hist-list');
  el.innerHTML = '';
  for (const r of list.slice(0, 8)) {
    const div = document.createElement('div');
    div.className = 'hist-item';
    const age = Math.round((Date.now() - r.startedAt) / 1000);
    const ageStr = age < 60 ? age + 's ago' : Math.round(age/60) + 'm ago';
    div.innerHTML = \`
      <span class="dot \${r.status}"></span>
      <span class="hist-suite">\${esc(r.suite)}</span>
      <span class="hist-time">\${ageStr}</span>\`;
    div.addEventListener('click', () => replayRun(r.id, r.suite));
    el.appendChild(div);
  }
}

async function replayRun(id, suite) {
  clearLog();
  selectSuite(suite);
  setStatus('running');
  streamRun(id);
}

// ── utils ─────────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

init();
</script>
</body>
</html>`;
