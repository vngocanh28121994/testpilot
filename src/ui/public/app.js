/* 
   No framework and no build step on purpose: this is a single-user local tool,
   and a bundler would be one more thing to keep working for no benefit. */

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, kids = []) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of [].concat(kids)) n.append(k);
  return n;
};

/* 16px stroke icons, inlined so the panel has no network dependencies. */
const ICON = {
  dashboard: 'M3 3h7v7H3zM14 3h7v4h-7zM14 10h7v11h-7zM3 13h7v8H3z',
  history: 'M3 12a9 9 0 106-8.5M3 4v4h4M12 7v5l3 2',
  db: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6',
  repo: 'M5 4h13a1 1 0 011 1v15H6a1 1 0 01-1-1zM5 17h14',
  team: 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2 20a7 7 0 0114 0M17 20h5a5.5 5.5 0 00-5-5.5',
  zephyr: 'M3 8h11a3 3 0 10-3-3M3 12h15a3 3 0 11-3 3M3 16h8',
  studio: 'M12 3l2.6 5.6 6.4.8-4.7 4.3 1.3 6.3-5.6-3.1-5.6 3.1L7.7 13.7 3 9.4l6.4-.8z',
  scenarioHistory: 'M4 5h16M4 12h16M4 19h10M17 17l2 2 3-3',
  runner: 'M6 4l14 8-14 8z',
  farm: 'M7 3h10a1 1 0 011 1v16a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1zM11 18h2',
  e2eHistory: 'M4 19V5M4 19h16M8 15l3.5-4 3 2.5L20 8',
  job: 'M4 7h16v13H4zM9 7V5a2 2 0 012-2h2a2 2 0 012 2v2M4 12h16',
  settings:
    'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1V21a2 2 0 11-4 0v-.1A1.6 1.6 0 007.5 19.4l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.6 1.6 0 003 14V13a2 2 0 010-4h.1A1.6 1.6 0 004.6 7.5l-.1-.1a2 2 0 112.8-2.8l.1.1A1.6 1.6 0 0010 3.6V3a2 2 0 014 0v.1a1.6 1.6 0 002.7 1.1l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 001.1 2.7H21a2 2 0 010 4h-.1a1.6 1.6 0 00-1.5 1.4z',
  logout: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9',
  collapse: 'M4 4v16M20 4v16M14 9l-3 3 3 3',
  x: 'M6 6l12 12M18 6L6 18',
};

const svg = (d) => {
  const NS = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke-width', '1.7');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', d);
  s.append(p);
  return s;
};

/* The nav is the design's, in the design's order. Entries with `why` are the
   ones TestPilot has nothing behind yet — they route to a short explanation
   rather than a dead link, which is less confusing than hiding them. */
const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'history', label: 'History', icon: 'history',
    why: 'Lịch sử gộp mọi loại job. Hiện đã tách sẵn thành Scenario History và E2E History.' },
  { id: 'db-sources', label: 'DB Sources', icon: 'db',
    why: 'Kết nối DB để dựng/kiểm tra dữ liệu test. TestPilot chưa chạm tới tầng dữ liệu.' },
  { id: 'repositories', label: 'Repositories', icon: 'repo',
    why: 'Đẩy .feature đã sinh vào repo. Hiện file chỉ ghi xuống thư mục features/ để bạn tự commit.' },
  { id: 'team-configs', label: 'Team Configs', icon: 'team',
    why: 'Config dùng chung cho cả team. Hiện chỉ có một testpilot.config.json cục bộ.' },
  { id: 'zephyr', label: 'Zephyr', icon: 'zephyr',
    why: 'Đồng bộ kết quả sang Zephyr/Jira. Chưa nối.' },
  { id: 'studio', label: 'Scenario Studio', icon: 'studio' },
  { id: 'scenario-history', label: 'Scenario History', icon: 'scenarioHistory' },
  { id: 'e2e-runner', label: 'E2E Runner', icon: 'runner' },
  { id: 'device-farm', label: 'Device Farm', icon: 'farm' },
  { id: 'e2e-history', label: 'E2E History', icon: 'e2eHistory' },
  { id: 'job-management', label: 'Job Management', icon: 'job',
    why: 'Hàng đợi và lịch chạy. Hiện mỗi lần bấm chạy là một tiến trình đồng bộ.' },
  { id: 'settings', label: 'Personal Settings', icon: 'settings' },
];

let state = null;
let sources = [];
let accounts = [];

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

init().catch((err) => alert(`Không tải được trạng thái: ${err.message}`));

async function init() {
  buildNav();
  buildChrome();
  wireStudio();
  wireRunner();
  wireFarm();
  wireSettings();
  await refresh();
  await loadModels();
  route();
  window.addEventListener('hashchange', route);
}

function buildChrome() {
  $('logout').append(svg(ICON.logout));
  $('collapse').append(svg(ICON.collapse));
  $('collapse').onclick = () => $('app').classList.toggle('narrow');
  $('logout').onclick = () => alert('Bản chạy cục bộ không có phiên đăng nhập để thoát.');
}

function buildNav() {
  const nav = $('nav');
  for (const item of NAV) {
    const b = el('button', { type: 'button', title: item.label });
    b.dataset.id = item.id;
    b.append(svg(ICON[item.icon]), el('span', { textContent: item.label }));
    b.onclick = () => { location.hash = item.id; };
    nav.append(b);
  }
}

function route() {
  const id = location.hash.slice(1) || 'studio';
  const item = NAV.find((n) => n.id === id) ?? NAV.find((n) => n.id === 'studio');
  const page = item.why ? 'todo' : item.id;

  for (const b of $('nav').children) {
    if (b.dataset.id === item.id) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  for (const s of document.querySelectorAll('.page')) s.hidden = s.dataset.page !== page;

  if (item.why) {
    $('todoTitle').textContent = item.label;
    $('todoName').textContent = item.label;
    $('todoWhy').textContent = item.why;
  }
  if (page === 'dashboard') renderDashboard();
  if (page === 'scenario-history') renderHistory();
  if (page === 'e2e-history') renderReports();
  if (page === 'device-farm') refreshAwsStatus();
}

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

async function api(path, method = 'GET', body) {
  const res = await fetch(path, {
    method,
    ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.issues ? data.issues.join('\n') : (data.error ?? res.statusText));
  return data;
}

async function refresh() {
  state = await api('/api/state');
  fillStudio();
  fillFarm();
  fillRunner();
  fillSettings();
  renderRecent();
}

/* ------------------------------------------------------------------ */
/* Scenario Studio                                                     */
/* ------------------------------------------------------------------ */

function fillStudio() {
  const c = state.config;
  sources = [...c.sources];
  // originalLabel travels with the row so a rename can carry its stored
  // password across; the value itself is never sent to the browser.
  accounts = state.accounts.map((a) => ({ ...a, password: '', previousLabel: a.label }));
  if (accounts.length === 0) accounts.push(blankAccount());

  $('baseUrl').value = c.web.baseUrl ?? '';
  $('targetFeature').value = c.targetFeature ?? '';
  $('note').value = c.llm.note ?? '';
  renderSources();
  renderAccounts();
}

const blankAccount = () => ({ label: '', username: '', password: '', hasPassword: false, previousLabel: '' });

function wireStudio() {
  $('srcAdd').onclick = addSource;
  $('srcInput').onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addSource(); }
  };
  $('acctAdd').onclick = () => { accounts.push(blankAccount()); renderAccounts(); };
  $('studioSave').onclick = saveStudio;
  $('runWorkflow').onclick = runWorkflow;
}

/** The form's values, shared by the save button and the run button. */
function studioForm() {
  addSource(); // a link typed but not yet added should still count
  return {
    sources,
    baseUrl: $('baseUrl').value.trim(),
    targetFeature: $('targetFeature').value.trim(),
    accounts: accounts.filter((a) => a.label.trim()),
    model: $('model').value,
    note: $('note').value,
  };
}

async function saveStudio() {
  const status = $('studioSaveStatus');
  setStatus(status, 'Đang lưu…', null);
  try {
    const { accounts: saved } = await api('/api/studio/save', 'POST', studioForm());
    const withPw = saved.filter((a) => a.hasPassword).length;
    setStatus(
      status,
      `Đã lưu ${saved.length} account (${withPw} có mật khẩu). Mật khẩu nằm trong .testpilot.secrets.json.`,
      true,
    );
    await refresh();
  } catch (e) {
    setStatus(status, e.message, false);
  }
}

function addSource() {
  const input = $('srcInput');
  const url = input.value.trim();
  if (!url) return;
  if (!sources.includes(url)) sources.push(url);
  input.value = '';
  renderSources();
}

function renderSources() {
  const list = $('srcList');
  list.replaceChildren();
  sources.forEach((url, i) => {
    const kind = kindOf(url);
    const remove = el('button', { className: 'iconbtn', type: 'button', title: 'Bỏ link này' });
    remove.append(svg(ICON.x));
    remove.onclick = () => { sources.splice(i, 1); renderSources(); };
    list.append(el('li', {}, [
      el('span', { className: `tag ${kind}`, textContent: kind }),
      el('a', { href: url, target: '_blank', rel: 'noreferrer noopener', textContent: url }),
      remove,
    ]));
  });
}

/** Classifies a link so the row can say what it is before anything is fetched. */
function kindOf(url) {
  const u = url.toLowerCase();
  if (u.includes('figma.com')) return 'figma';
  if (u.includes('atlassian.net') || u.includes('confluence') || u.includes('/wiki/')) return 'confluence';
  return 'unknown';
}

function renderAccounts() {
  const box = $('accounts');
  box.replaceChildren();
  accounts.forEach((acct, i) => {
    const label = el('input', { value: acct.label, placeholder: 'Mô tả (VD: Maker, Checker)' });
    const user = el('input', { value: acct.username, placeholder: 'Username', autocomplete: 'off' });
    // The server never sends a stored password back, so the placeholder is the
    // only way to tell "not set" apart from "set, just not shown".
    const pass = el('input', {
      type: 'password',
      placeholder: acct.hasPassword ? '•••••••• (đã lưu)' : 'Password',
      autocomplete: 'new-password',
    });
    label.oninput = () => { acct.label = label.value; };
    user.oninput = () => { acct.username = user.value; };
    pass.oninput = () => { acct.password = pass.value; };

    const remove = el('button', { className: 'iconbtn', type: 'button', title: 'Xoá account' });
    remove.append(svg(ICON.x));
    remove.onclick = () => {
      accounts.splice(i, 1);
      if (accounts.length === 0) accounts.push(blankAccount());
      renderAccounts();
    };

    box.append(el('div', { className: 'acct' }, [label, user, pass, remove]));
  });
}

async function loadModels() {
  const { models, live, reason } = await api('/api/models');
  const select = $('model');
  const chosen = state?.config.llm.model ?? 'auto';
  select.replaceChildren(el('option', { value: 'auto', textContent: 'auto' }));
  for (const m of models) {
    select.append(el('option', { value: m.id, textContent: m.display_name ?? m.id }));
  }
  select.value = [...select.options].some((o) => o.value === chosen) ? chosen : 'auto';
  $('modelHint').textContent = live
    ? 'auto = claude-opus-5. Danh sách lấy trực tiếp từ Models API.'
    : `auto = claude-opus-5. Đang dùng danh sách mặc định${reason ? ` — ${reason}` : ''}.`;
}

async function runWorkflow() {
  const btn = $('runWorkflow');
  const err = $('studioErr');
  err.hidden = true;

  btn.disabled = true;
  btn.textContent = 'Đang chạy…';
  $('progressCard').hidden = false;
  $('genLog').textContent = '';
  renderStages(null);

  try {
    await streamInto(
      '/api/gen',
      $('genLog'),
      studioForm(),
      renderStages,
    );
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Bắt đầu chạy workflow';
    await refresh();
  }
}

/** Mirrors GEN_STAGES in core/history.ts, for the pre-run idle state. */
const IDLE_STAGES = [
  'Đọc tài liệu nguồn', 'Phân tích màn hình & element', 'Lưu element registry',
  'Sinh Gherkin', 'Ghi file .feature', 'Bind step vào element', 'Hoàn tất',
];

function renderStages(run) {
  renderStageList($('stages'), run, IDLE_STAGES);
}

/** Shared by Scenario Studio and Device Farm; `idle` draws the pre-run state. */
function renderStageList(ol, run, idle) {
  const stages = run?.stages ?? idle.map((name) => ({ name, status: 'pending' }));
  ol.replaceChildren();
  for (const s of stages) {
    const li = el('li', {}, [
      el('span', { className: 'dot', textContent: s.status === 'done' ? '✓' : '' }),
      el('span', { textContent: s.name }),
    ]);
    li.dataset.status = s.status;
    ol.append(li);
  }
}

/* ------------------------------------------------------------------ */
/* Recent scenarios / history                                          */
/* ------------------------------------------------------------------ */

function renderRecent() {
  const body = $('recent');
  body.replaceChildren();
  const runs = state.runs.slice(0, 8);

  if (runs.length === 0) {
    body.append(emptyRow(4, 'Chưa có lần chạy nào.'));
    return;
  }
  for (const r of runs) {
    const tr = el('tr', { className: 'clickable' }, [
      el('td', { textContent: r.feature }),
      el('td', { className: 'mono', textContent: when(r.startedAt) }),
      el('td', {}, el('span', { className: `pill ${r.status}`, textContent: r.status })),
      el('td', { className: 'right mono', textContent: `${r.stagesDone}/${r.stages.length}` }),
    ]);
    tr.onclick = () => { location.hash = 'scenario-history'; };
    body.append(tr);
  }
}

function renderHistory() {
  const box = $('historyList');
  box.replaceChildren();
  if (state.runs.length === 0) {
    box.append(el('p', { className: 'empty', textContent: 'Chưa có lần chạy nào.' }));
    return;
  }

  for (const r of state.runs) {
    const card = el('div', { className: 'run' }, el('div', { className: 'run-head' }, [
      el('b', { textContent: r.feature }),
      el('span', { className: `pill ${r.status}`, textContent: r.status }),
      el('span', { className: 'tag', textContent: `${r.stagesDone}/${r.stages.length} stages` }),
      el('time', { textContent: when(r.startedAt) }),
    ]));

    const touched = r.stages.filter((s) => s.status !== 'pending');
    if (touched.length > 0) {
      card.append(el('p', {
        className: 'hint',
        textContent: touched.map((s) => `${mark(s.status)} ${s.name}`).join('  ·  '),
      }));
    }
    if (r.error) card.append(el('p', { className: 'err', textContent: r.error }));
    if (r.log?.length) {
      card.append(el('details', {}, [
        el('summary', { textContent: `Log (${r.log.length} dòng)` }),
        el('pre', { className: 'console', textContent: r.log.join('\n') }),
      ]));
    }
    box.append(card);
  }
}

const mark = (s) => ({ done: '✓', failed: '✕', running: '…' })[s] ?? '·';
const when = (iso) => new Date(iso).toLocaleString('en-US');

function emptyRow(cols, text) {
  return el('tr', {}, el('td', { colSpan: cols }, el('p', { className: 'empty', textContent: text })));
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

function renderDashboard() {
  const scenarios = state.features.reduce((n, f) => n + f.scenarios.length, 0);
  const failed = state.runs.filter((r) => r.status === 'failed').length;

  $('tiles').replaceChildren(
    ...[
      [state.features.length, 'feature file'],
      [scenarios, 'scenario'],
      [state.elements, 'element'],
      [state.runs.length, 'lần chạy'],
      [failed, 'lần thất bại'],
    ].map(([n, label]) =>
      el('div', { className: 'tile' }, [
        el('b', { textContent: String(n) }),
        el('span', { textContent: label }),
      ]),
    ),
  );

  const body = $('featureRows');
  body.replaceChildren();
  if (state.features.length === 0) {
    body.append(emptyRow(4, 'Chưa sinh feature nào.'));
    return;
  }
  for (const f of state.features) {
    body.append(el('tr', {}, [
      el('td', { className: 'mono', textContent: f.name }),
      el('td', { textContent: f.error ? `⚠ ${f.error}` : f.feature }),
      el('td', { className: 'right', textContent: String(f.scenarios.length) }),
      el('td', { className: 'right', textContent: String(f.scenarios.reduce((n, s) => n + s.steps, 0)) }),
    ]));
  }
}

/* ------------------------------------------------------------------ */
/* E2E runner + reports                                                */
/* ------------------------------------------------------------------ */

function wireRunner() {
  // slowMo is meaningless headless, and headed is meaningless off-web, so the
  // controls appear only when they can actually do something.
  const syncHeaded = () => {
    const web = $('platform').value === 'web';
    $('headed').disabled = !web;
    if (!web) $('headed').checked = false;
    $('slowMoField').hidden = !($('headed').checked && web);
    $('headedHint').hidden = web;
  };
  $('platform').onchange = syncHeaded;
  $('headed').onchange = syncHeaded;
  syncHeaded();

  $('runSuite').onclick = async () => {
    const btn = $('runSuite');
    btn.disabled = true;
    $('runLog').textContent = '';
    try {
      await saveSlowMo();
      await streamInto('/api/run', $('runLog'), {
        platform: $('platform').value,
        tag: $('tag').value.trim() || undefined,
        headed: $('headed').checked,
      });
    } catch (e) {
      $('runLog').append(el('span', { className: 'err', textContent: e.message + '\n' }));
    } finally {
      btn.disabled = false;
      await refresh();
    }
  };
}

function fillRunner() {
  $('slowMo').value = state.config.web.slowMoMs;
}

/**
 * The CLI reads slowMo from the config, not from a flag, so the value has to be
 * saved before the run is spawned. Saving only when it changed keeps a plain
 * headless run from rewriting the config file for nothing.
 */
async function saveSlowMo() {
  const value = Number($('slowMo').value);
  if (!$('headed').checked || !Number.isFinite(value)) return;
  if (value === state.config.web.slowMoMs) return;

  const cfg = structuredClone(state.config);
  cfg.web.slowMoMs = value;
  await api('/api/config', 'PUT', cfg);
  state.config = cfg;
}

/** Human-readable time for a run, degrading to the id rather than to garbage. */
/**
 * Monday 00:00 of the week a run started in, as a sortable key.
 *
 * Weeks are Monday-based because that is how the team talks about them ("chạy
 * hôm thứ ba tuần trước"), and the key is a timestamp rather than an ISO week
 * number so that sorting and labelling need no calendar arithmetic and no
 * year-boundary special case.
 */
function weekStart(iso) {
  const t = Date.parse(iso ?? '');
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Sunday is 0, so shift it to 6
  return d.getTime();
}

function weekLabel(startMs) {
  const fmt = (ms) => new Date(ms).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
  const end = startMs + 6 * 86400000;
  const thisWeek = weekStart(new Date().toISOString());
  if (startMs === thisWeek) return `Tuần này (${fmt(startMs)} – ${fmt(end)})`;
  if (startMs === thisWeek - 7 * 86400000) return `Tuần trước (${fmt(startMs)} – ${fmt(end)})`;
  return `${fmt(startMs)} – ${fmt(end)}`;
}

/** Wall-clock length of a run, in the coarsest unit that still says something. */
function runDuration(r) {
  const a = Date.parse(r.startedAt ?? '');
  const b = Date.parse(r.finishedAt ?? '');
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return '—';
  const secs = Math.round((b - a) / 1000);
  return secs < 90 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function runLabel(r) {
  const t = Date.parse(r.startedAt ?? '');
  if (!Number.isNaN(t)) {
    return new Date(t).toLocaleString('vi-VN', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  }
  return r.id ?? r.platform ?? 'không rõ';
}

const PLATFORMS = ['web', 'android', 'ios'];

function renderReports() {
  const bar = $('reportTabs');
  const runbar = $('reportRuns');
  const frame = $('reportFrame');
  const open = $('reportOpen');
  // Keep the "open in new tab" anchor; only the platform buttons are rebuilt.
  for (const node of [...bar.children]) if (node !== open) node.remove();
  runbar.replaceChildren();

  const has = state.reports.length > 0;
  $('noReports').hidden = has;
  frame.hidden = !has;
  open.hidden = !has;
  $('reportWeek').replaceChildren();
  $('reportDevice').replaceChildren();
  $('reportWeekCount').textContent = '';
  document.querySelector('.runfilter').hidden = !has;
  $('reportRunsCard').hidden = !has;
  if (!has) return;

  // Tabs are the three platforms and nothing else. They are a fixed set, which
  // is what a tab is for; runs accumulate without limit, so they belong inside
  // a tab rather than beside it — a tab strip that grows by one every time you
  // run the suite stops being navigation.
  const byPlatform = new Map(PLATFORMS.map((p) => [p, []]));
  for (const r of state.reports) byPlatform.get(r.platform)?.push(r);
  // Newest first within a platform. The server already sorts, but the list is
  // re-grouped here and a display order should not depend on that staying true.
  for (const list of byPlatform.values()) {
    list.sort((a, b) => Date.parse(b.startedAt ?? '') - Date.parse(a.startedAt ?? ''));
  }

  const week = $('reportWeek');
  const device = $('reportDevice');
  const weekCount = $('reportWeekCount');

  const showRuns = (platform) => {
    const all = byPlatform.get(platform) ?? [];
    // Week options come from the runs actually present, so the dropdown never
    // offers a week that would show nothing.
    const weeks = [...new Set(all.map((r) => weekStart(r.startedAt)).filter((w) => w !== null))]
      .sort((a, b) => b - a);
    week.replaceChildren(el('option', { value: 'all', textContent: `Tất cả (${all.length})` }));
    for (const w of weeks) {
      const n = all.filter((r) => weekStart(r.startedAt) === w).length;
      week.append(el('option', { value: String(w), textContent: `${weekLabel(w)} — ${n}` }));
    }
    // Devices come from the runs present, same as weeks. A pool run produces one
    // entry per phone, and "which phone failed" is the question the pool exists
    // to answer.
    const devices = [...new Set(all.map((r) => r.device).filter(Boolean))].sort();
    device.replaceChildren(el('option', { value: 'all', textContent: `Tất cả (${devices.length || 1})` }));
    for (const d of devices) {
      const n = all.filter((r) => r.device === d).length;
      device.append(el('option', { value: d, textContent: `${d} — ${n}` }));
    }
    device.disabled = devices.length < 2;
    device.onchange = () => paint(all);

    week.disabled = all.length === 0;
    week.onchange = () => paint(all);
    paint(all);
  };

  const paint = (all) => {
    const pickWeek = week.value;
    const pickDevice = device.value;
    const runs = all.filter(
      (r) =>
        (pickWeek === 'all' || String(weekStart(r.startedAt)) === pickWeek) &&
        (pickDevice === 'all' || r.device === pickDevice),
    );
    const filtered = pickWeek !== 'all' || pickDevice !== 'all';
    weekCount.textContent = filtered ? `${runs.length}/${all.length} lần chạy` : '';
    runbar.replaceChildren();
    if (runs.length === 0) {
      frame.hidden = true;
      open.hidden = true;
      runbar.append(el('tr', {}, [el('td', {
        colSpan: 7,
        className: 'empty',
        textContent: all.length === 0
          ? 'Chưa có lần chạy nào trên nền tảng này.'
          : 'Không có lần chạy nào khớp bộ lọc.',
      })]));
      return;
    }
    frame.hidden = false;
    open.hidden = false;
    // A table rather than a row of chips: runs have several attributes worth
    // comparing down a column — when, verdict, how many failed, how long — and
    // chips can only carry that as one run-on string.
    runs.forEach((r, i) => {
      const c = r.counters;
      const tr = el('tr', { className: 'clickable' }, [
        el('td', { textContent: runLabel(r) }),
        el('td', {}, [el('span', { className: `v-${r.status}`, textContent: r.status })]),
        el('td', { className: 'right', textContent: c ? `${c.passed}/${c.total}` : '—' }),
        el('td', { className: 'right', textContent: c ? String(c.failed) : '—' }),
        el('td', { className: 'right', textContent: runDuration(r) }),
        el('td', { textContent: r.tag ?? '—' }),
        el('td', { className: 'mono', textContent: r.device ?? '—' }),
      ]);
      tr.title = r.id;
      tr.onclick = () => {
        frame.src = r.url;
        open.href = r.url;
        for (const other of runbar.children) other.classList.toggle('picked', other === tr);
      };
      runbar.append(tr);
      if (i === 0) tr.click();
    });
  };

  PLATFORMS.forEach((platform, i) => {
    const runs = byPlatform.get(platform) ?? [];
    const b = el('button', {
      type: 'button',
      textContent: runs.length ? `${platform} (${runs.length})` : platform,
      disabled: runs.length === 0,
      title: runs.length === 0 ? 'Chưa có lần chạy nào' : `${runs.length} lần chạy`,
    });
    b.onclick = () => {
      for (const other of bar.children) {
        if (other !== open) other.setAttribute('aria-selected', String(other === b));
      }
      showRuns(platform);
    };
    bar.insertBefore(b, open);
    // Open on the first platform that actually has something to show.
    if (runs.length > 0 && !PLATFORMS.slice(0, i).some((p) => byPlatform.get(p).length > 0)) {
      b.click();
    }
  });
}

/* ------------------------------------------------------------------ */
/* AWS Device Farm                                                     */
/* ------------------------------------------------------------------ */

let farmDevices = [];
const picked = new Set();
let envRows = [];
/** Path the server wrote the uploaded APK/IPA to; empty means "keep the saved one". */
let uploadedApp = '';

/**
 * Credential state, shown before anything is uploaded.
 *
 * The failure this exists for is not "no credentials" — it is credentials that
 * expire while a run is in flight, which reads as a mysterious crash after the
 * money is already spent.
 */
async function refreshAwsStatus() {
  const box = $('awsStatus');
  const text = $('awsStatusText');
  box.dataset.state = 'unknown';
  text.textContent = 'Đang kiểm tra credential…';
  try {
    const s = await api(`/api/aws?region=${encodeURIComponent($('fRegion').value)}`);
    state.aws = s;
    if (!s.ok) {
      box.dataset.state = 'bad';
      text.textContent = `Không dùng được credential (${s.source}) — ${s.reason ?? 'không rõ lý do'}`;
      return;
    }
    const mins = s.expiresInMinutes;
    // 15 minutes is the same headroom the scheduler warns at; below it a run is
    // likely to outlive its credentials.
    box.dataset.state = mins !== undefined && mins < 15 ? 'warn' : 'good';
    const life =
      mins === undefined
        ? 'không hết hạn (IAM role hoặc access key)'
        : mins < 0
          ? 'đã hết hạn'
          : `còn ${mins} phút`;
    text.textContent = `Kết nối được — nguồn: ${s.source}, key ${s.keyHint}…, ${life}`;
  } catch (err) {
    box.dataset.state = 'bad';
    text.textContent = err.message;
  } finally {
    // Offered only for a local session. With environment credentials or an IAM
    // role there is nothing to log into, and on a deployed box the browser
    // would open on the server where nobody can see it.
    $('awsLogin').hidden = !(state.aws?.canLogin ?? false);
  }
}

function wireFarm() {
  $('awsRecheck').onclick = refreshAwsStatus;
  $('awsLogin').onclick = async () => {
    const log = $('awsLoginLog');
    log.hidden = false;
    log.textContent = '';
    $('awsLogin').disabled = true;
    try {
      await streamInto('/api/aws/login', log, { region: $('fRegion').value });
    } catch (err) {
      log.textContent += `\n${err.message}`;
    } finally {
      $('awsLogin').disabled = false;
      // The whole point is the state afterwards, so do not make anyone go and
      // press the other button.
      await refreshAwsStatus();
    }
  };
  $('fRegion').addEventListener('change', refreshAwsStatus);
  $('fLoad').onclick = loadProjects;
  $('fProject').onchange = loadPools;
  $('fPlatform').onchange = () => {
    // The app extension and the device list both follow the OS choice, and a
    // pool of Android phones is meaningless once you switch to iOS.
    $('fExt').textContent = $('fPlatform').value === 'ios' ? '.ipa' : '.apk';
    farmDevices = [];
    picked.clear();
    renderDevices();
  };
  $('fLoadDevices').onclick = loadDevices;
  $('fCreatePool').onclick = createPool;
  $('fSearch').oninput = renderDevices;
  $('fRealOnly').onchange = renderDevices;
  $('fEnvAdd').onclick = () => { envRows.push({ key: '', value: '' }); renderEnv(); };
  $('fRun').onclick = runFarm;
  wireDrop();
}

function fillFarm() {
  const f = state.config.farm;
  $('fRegion').value = f.region;
  $('fPlatform').value = f.platform;
  $('fExt').textContent = f.platform === 'ios' ? '.ipa' : '.apk';
  $('fTestPkg').value = f.testPackagePath;
  $('fTestSpec').value = f.testSpecPath;
  $('fRunName').value = f.runName;
  $('fJobTimeout').value = f.jobTimeoutMinutes;
  $('fVideo').checked = f.videoCapture;
  $('fSendSecrets').checked = f.sendSecrets;
  uploadedApp = '';
  $('fAppPath').textContent = f.appPath ? `Đang dùng: ${f.appPath}` : 'Chưa có file nào.';

  envRows = Object.entries(f.env).map(([key, value]) => ({ key, value }));
  renderEnv();

  // The pickers hold ARNs that only make sense once their list is loaded; keep
  // the saved value visible as a single option until then.
  if (f.projectArn) keepOption($('fProject'), f.projectArn, shortArn(f.projectArn));
  if (f.devicePoolArn) keepOption($('fPool'), f.devicePoolArn, shortArn(f.devicePoolArn));
}

function keepOption(select, value, label) {
  if (![...select.options].some((o) => o.value === value)) {
    select.append(el('option', { value, textContent: label }));
  }
  select.value = value;
}

const shortArn = (arn) => arn.split('/').pop() ?? arn;

/** Device Farm calls answer 200 with {ok:false} so the hint can render inline. */
async function farmApi(path, method = 'GET', body) {
  const res = await api(path, method, body);
  if (!res.ok) throw new Error(res.hint ? `${res.error}\n\n${res.hint}` : res.error);
  return res.data;
}

async function loadProjects() {
  const status = $('fConn');
  setStatus(status, 'Đang gọi Device Farm…', null);
  try {
    const projects = await farmApi(`/api/farm/projects?region=${$('fRegion').value}`);
    const select = $('fProject');
    select.replaceChildren(el('option', { value: '', textContent: '— chọn project —' }));
    for (const p of projects) select.append(el('option', { value: p.arn, textContent: p.name }));
    if (state.config.farm.projectArn) select.value = state.config.farm.projectArn;
    setStatus(status, `${projects.length} project.`, true);
    if (select.value) await loadPools();
  } catch (e) {
    setStatus(status, e.message, false);
  }
}

async function loadPools() {
  const projectArn = $('fProject').value;
  const select = $('fPool');
  if (!projectArn) {
    select.replaceChildren(el('option', { value: '', textContent: '— chọn project trước —' }));
    return;
  }
  try {
    const pools = await farmApi(
      `/api/farm/pools?region=${$('fRegion').value}&projectArn=${encodeURIComponent(projectArn)}`,
    );
    select.replaceChildren(el('option', { value: '', textContent: '— chọn pool —' }));
    for (const p of pools) {
      select.append(el('option', { value: p.arn, textContent: `${p.name} (${p.type})` }));
    }
    if (state.config.farm.devicePoolArn) {
      keepOption(select, state.config.farm.devicePoolArn, shortArn(state.config.farm.devicePoolArn));
    }
  } catch (e) {
    setStatus($('fConn'), e.message, false);
  }
}

async function loadDevices() {
  const status = $('fPoolStatus');
  setStatus(status, 'Đang tải danh sách thiết bị…', null);
  try {
    farmDevices = await farmApi(
      `/api/farm/devices?region=${$('fRegion').value}&platform=${$('fPlatform').value}`,
    );
    picked.clear();
    renderDevices();
    setStatus(status, `${farmDevices.length} thiết bị.`, true);
  } catch (e) {
    setStatus(status, e.message, false);
  }
}

function renderDevices() {
  const box = $('fDevices');
  const q = $('fSearch').value.trim().toLowerCase();
  const realOnly = $('fRealOnly').checked;

  const shown = farmDevices
    .filter((d) => !realOnly || d.availability === 'HIGHLY_AVAILABLE' || d.availability === 'AVAILABLE')
    .filter((d) => !q || `${d.name} ${d.manufacturer} ${d.os}`.toLowerCase().includes(q))
    .slice(0, 300); // the full list is many hundreds; 300 is already a long scroll

  box.replaceChildren();
  if (farmDevices.length === 0) {
    box.append(el('p', { className: 'empty', textContent: 'Bấm “Tải thiết bị” để xem danh sách.' }));
    return;
  }
  if (shown.length === 0) {
    box.append(el('p', { className: 'empty', textContent: 'Không có thiết bị nào khớp bộ lọc.' }));
    return;
  }

  for (const d of shown) {
    const cb = el('input', { type: 'checkbox', checked: picked.has(d.arn) });
    cb.onchange = () => {
      if (cb.checked) picked.add(d.arn);
      else picked.delete(d.arn);
      setStatus($('fPoolStatus'), `${picked.size} thiết bị đã chọn.`, null);
    };
    box.append(el('label', {}, [
      cb,
      el('span', { textContent: d.name }),
      el('span', { className: 'dev-os', textContent: `${d.formFactor} · OS ${d.os}` }),
      el('span', { className: `tag ${d.availability === 'BUSY' ? 'unknown' : ''}`, textContent: d.availability.replace('_', ' ').toLowerCase() }),
    ]));
  }
}

async function createPool() {
  const status = $('fPoolStatus');
  const name = $('fPoolName').value.trim();
  if (!name) return setStatus(status, 'Đặt tên cho pool trước đã.', false);
  if (picked.size === 0) return setStatus(status, 'Chưa chọn thiết bị nào.', false);

  setStatus(status, 'Đang tạo pool…', null);
  try {
    const pool = await farmApi('/api/farm/pool', 'POST', {
      region: $('fRegion').value,
      projectArn: $('fProject').value,
      name,
      deviceArns: [...picked],
    });
    keepOption($('fPool'), pool.arn, `${pool.name} (${picked.size} thiết bị)`);
    setStatus(status, `Đã tạo "${pool.name}" và chọn sẵn.`, true);
  } catch (e) {
    setStatus(status, e.message, false);
  }
}

function wireDrop() {
  const drop = $('fDrop');
  const input = $('fAppFile');

  input.onchange = () => input.files[0] && uploadApp(input.files[0]);
  for (const ev of ['dragenter', 'dragover']) {
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
  }
  for (const ev of ['dragleave', 'drop']) {
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); });
  }
  drop.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) uploadApp(file);
  });
}

async function uploadApp(file) {
  const out = $('fAppPath');
  out.textContent = `Đang tải lên ${file.name} (${mb(file.size)})…`;
  try {
    // Raw body with the name in the query: a multipart parser would be a lot of
    // code for a form that only ever sends one file.
    const res = await fetch(`/api/farm/app?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: file,
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    uploadedApp = data.path;
    out.textContent = `Đang dùng: ${data.path} (${mb(data.size)})`;
    $('fDropText').textContent = file.name;
  } catch (e) {
    out.textContent = `Tải lên hỏng: ${e.message}`;
  }
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function renderEnv() {
  const box = $('fEnv');
  box.replaceChildren();
  for (const [i, row] of envRows.entries()) {
    const key = el('input', { value: row.key, placeholder: 'API_BASE_URL', autocomplete: 'off' });
    const value = el('input', { value: row.value, placeholder: 'https://api-sit.tcbs.com.vn', autocomplete: 'off' });
    key.oninput = () => { row.key = key.value; };
    value.oninput = () => { row.value = value.value; };

    const remove = el('button', { className: 'iconbtn', type: 'button', title: 'Xoá biến' });
    remove.append(svg(ICON.x));
    remove.onclick = () => { envRows.splice(i, 1); renderEnv(); };

    box.append(el('div', { className: 'env-row' }, [key, value, remove]));
  }
}

async function runFarm() {
  const btn = $('fRun');
  const err = $('fErr');
  err.hidden = true;

  btn.disabled = true;
  btn.textContent = 'Đang chạy…';
  $('fProgressCard').hidden = false;
  $('fLog').textContent = '';
  renderFarmStages(null);

  const env = {};
  for (const r of envRows) if (r.key.trim()) env[r.key.trim()] = r.value;

  try {
    await streamInto('/api/farm/run', $('fLog'), {
      region: $('fRegion').value,
      projectArn: $('fProject').value,
      devicePoolArn: $('fPool').value,
      platform: $('fPlatform').value,
      appPath: uploadedApp || state.config.farm.appPath,
      testPackagePath: $('fTestPkg').value.trim(),
      testSpecPath: $('fTestSpec').value.trim(),
      runName: $('fRunName').value.trim(),
      jobTimeoutMinutes: Number($('fJobTimeout').value) || 30,
      videoCapture: $('fVideo').checked,
      sendSecrets: $('fSendSecrets').checked,
      env,
      bundle: $('fBundle').checked,
    }, renderFarmStages);
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Chạy trên Device Farm';
    await refresh();
  }
}

/** Mirrors FARM_STAGES in core/history.ts. */
const FARM_IDLE = [
  'Đóng gói test package', 'Upload app + package lên Device Farm',
  'Chờ Device Farm chạy', 'Thu artifact',
];

function renderFarmStages(run) {
  renderStageList($('fStages'), run, FARM_IDLE);
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

function wireSettings() {
  $('mcpTransport').onchange = syncMcpFields;
  $('mcpProbe').onclick = probeMcp;
  $('saveSettings').onclick = saveSettings;
}

function fillSettings() {
  const c = state.config;
  const m = c.mcp ?? null;

  $('mcpTransport').value = m ? m.transport : '';
  $('mcpUrl').value = m?.url ?? '';
  $('mcpCommand').value = m?.command ?? '';
  $('mcpArgs').value = (m?.args ?? []).join(' ');
  $('toolConfluence').value = m?.tools?.confluencePage ?? '';
  $('toolFigma').value = m?.tools?.figmaFile ?? '';
  syncMcpFields();

  $('pDocs').value = c.paths.docs;
  $('pFeatures').value = c.paths.features;
  $('pRegistry').value = c.paths.registry;
  $('pReports').value = c.paths.reports;

  $('cfgFile').textContent = state.configFile;
  $('apiKey').textContent = state.hasApiKey ? 'đã set' : 'chưa set — không sinh được testcase';
  $('elCount').textContent = String(state.elements);
  $('cfgErr').textContent = state.configError ?? '';
  $('cfgErr').hidden = !state.configError;
}

function syncMcpFields() {
  const t = $('mcpTransport').value;
  for (const node of document.querySelectorAll('[data-mcp]')) {
    const want = node.dataset.mcp;
    node.hidden = want === 'any' ? !t : want !== t;
  }
}

function mcpFromForm() {
  const transport = $('mcpTransport').value;
  if (!transport) return undefined;
  return {
    transport,
    ...(transport === 'stdio'
      ? {
          command: $('mcpCommand').value.trim(),
          args: $('mcpArgs').value.trim().split(/\s+/).filter(Boolean),
        }
      : { url: $('mcpUrl').value.trim() }),
    env: {},
    headers: {},
    tools: {
      confluencePage: $('toolConfluence').value.trim(),
      figmaFile: $('toolFigma').value.trim(),
    },
  };
}

async function probeMcp() {
  const status = $('mcpStatus');
  setStatus(status, 'Đang kết nối…', null);
  try {
    const { tools, guess } = await api('/api/mcp/tools', 'POST', mcpFromForm());
    $('mcpTools').replaceChildren(...tools.map((t) => el('option', { value: t.name })));
    if (!$('toolConfluence').value && guess.confluencePage) $('toolConfluence').value = guess.confluencePage;
    if (!$('toolFigma').value && guess.figmaFile) $('toolFigma').value = guess.figmaFile;
    setStatus(status, `${tools.length} tool khả dụng.`, true);
  } catch (e) {
    setStatus(status, e.message, false);
  }
}

async function saveSettings() {
  const status = $('saveStatus');
  const c = structuredClone(state.config);
  c.mcp = mcpFromForm();
  c.paths = {
    ...c.paths,
    docs: $('pDocs').value.trim(),
    features: $('pFeatures').value.trim(),
    registry: $('pRegistry').value.trim(),
    reports: $('pReports').value.trim(),
  };
  try {
    await api('/api/config', 'PUT', c);
    await refresh();
    setStatus(status, 'Đã lưu.', true);
  } catch (e) {
    setStatus(status, e.message, false);
  }
}

function setStatus(node, text, ok) {
  node.textContent = text;
  node.className = `status${ok === true ? ' ok' : ok === false ? ' bad' : ''}`;
}

/* ------------------------------------------------------------------ */
/* SSE over POST                                                       */
/* ------------------------------------------------------------------ */

/**
 * The stream carries two channels: `log` lines for the console and `run`
 * snapshots for the stage tracker. It is read with a stream reader rather than
 * EventSource because EventSource cannot issue a POST.
 */
async function streamInto(path, pre, body, onRun) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? res.statusText);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let failure = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const event = /^event: (.+)$/m.exec(frame)?.[1];
      const raw = /^data: (.*)$/m.exec(frame)?.[1];
      if (!event || raw === undefined) continue;
      const data = JSON.parse(raw);

      if (event === 'log') append(pre, data);
      else if (event === 'run') onRun?.(data);
      else if (event === 'error') { failure = data; append(pre, data, true); }
    }
  }
  if (failure) throw new Error(failure);
}

function append(pre, line, isError = false) {
  if (isError) {
    pre.append(el('span', { className: 'err', textContent: line + '\n' }));
  } else {
    // Device Farm logs artifact URLs; a console that renders them as dead text
    // means copy-pasting a 500-character presigned link by hand. Built as DOM
    // nodes rather than innerHTML so log content can never inject markup.
    const parts = line.split(/(https?:\/\/\S+)/g);
    for (const part of parts) {
      if (/^https?:\/\//.test(part)) {
        pre.append(el('a', { href: part, target: '_blank', rel: 'noreferrer noopener', textContent: part }));
      } else if (part) {
        pre.append(part);
      }
    }
    pre.append('\n');
  }
  pre.scrollTop = pre.scrollHeight;
}
