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
  // A package: the shipped artifact, and deliberately nothing like the play
  // triangle that means "run" — the two sat next to each other in the menu
  // wearing the same icon.
  package: 'M12 2.5l8.5 4.7v9.6L12 21.5l-8.5-4.7V7.2zM3.5 7.2L12 12l8.5-4.8M12 12v9.5',
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

function dropdownChevron() {
  const NS = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(NS, 'svg');
  icon.setAttribute('viewBox', '0 0 10 6');
  icon.setAttribute('aria-hidden', 'true');
  icon.classList.add('dropdown-chevron');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', 'M1 1l4 4 4-4');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.5');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  icon.append(path);
  return icon;
}

/* The nav is the design's, in the design's order. Entries with `why` are the
   ones TestPilot has nothing behind yet — they route to a short explanation
   rather than a dead link, which is less confusing than hiding them. */
const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'history', label: 'Gen History', icon: 'history',
    why: 'Lịch sử gộp mọi loại job. Hiện đã tách sẵn thành Scenario History và E2E History.' },
  { id: 'db-sources', label: 'DB Sources', icon: 'db',
    why: 'Kết nối DB để dựng/kiểm tra dữ liệu test. TestPilot chưa chạm tới tầng dữ liệu.' },
  { id: 'repositories', label: 'Repositories', icon: 'repo',
    why: 'Đẩy .feature đã sinh vào repo. Hiện file chỉ ghi xuống thư mục features/ để bạn tự commit.' },
  { id: 'team-configs', label: 'Team Configs', icon: 'team',
    why: 'Config dùng chung cho cả team. Hiện chỉ có một testpilot.config.json cục bộ.' },
  { id: 'zephyr', label: 'Zephyr', icon: 'zephyr',
    why: 'Đồng bộ kết quả sang Zephyr/Jira. Chưa nối.' },
  { id: 'studio', label: 'App Automation Studio', icon: 'studio' },
  { id: 'scenario-review', label: 'Kịch bản', icon: 'scenarioHistory' },
  { id: 'healing-center', label: 'Healing Center', icon: 'e2eHistory' },
  { id: 'builds', label: 'Bản build', icon: 'package' },
  { id: 'e2e-runner', label: 'Local Runner', icon: 'runner' },
  { id: 'device-farm', label: 'Device Farm', icon: 'farm' },
  { id: 'job-management', label: 'Job Management', icon: 'job',
    why: 'Hàng đợi và lịch chạy. Hiện mỗi lần bấm chạy là một tiến trình đồng bộ.' },
  { id: 'settings', label: 'Personal Settings', icon: 'settings' },
];

let state = null;
let sources = [];
let accounts = [];
// [{ name, roles: [{ role, label }], iosApp, androidApp, baseUrl }] — a list,
// not the config's object, so a half-renamed environment can exist while
// someone is typing and two blank rows do not collapse into one.
let environments = [];
let defaultEnv = '';
/**
 * Device ids ticked for the next run. Empty = the single-device path.
 *
 * Declared up here with the other boot state rather than beside the picker it
 * belongs to: `init()` wires the runner before this module finishes evaluating,
 * so a `let` further down the file is still in its temporal dead zone by then
 * and the first render throws before any of the UI appears.
 */
let selectedDevices = new Set();
let deviceQuery = '';        // bộ lọc của device picker
// Serial/UDID của máy được phát hiện đang cắm ở lần bấm Kiểm tra gần nhất.
let attachedUdids = new Set();

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

init().catch((err) => alert(`Không tải được trạng thái: ${err.message}`));

async function init() {
  buildNav();
  buildChrome();
  wireStudio();
  wireReview();
  wireHealing();
  wireRunner();
  wireFarm();
  wireSettings();
  await refresh();
  await loadModels();
  initCustomSelects();
  route();
  window.addEventListener('hashchange', route);
}

/* ─── Custom Select ─────────────────────────────────────────────────────────
   Upgrades every <select> to a styled dropdown. The native element stays
   hidden so all existing code (.value, .onchange, replaceChildren, append…)
   keeps working with zero changes.                                           */

function initCustomSelects() {
  document.querySelectorAll('select:not([data-native-select])').forEach(upgradeSelect);
}

function upgradeSelect(sel) {
  if (sel.__cs) return;
  sel.__cs = true;

  // Wrapper
  const wrap = el('div', { className: 'cs' });
  sel.replaceWith(wrap);
  wrap.appendChild(sel);
  sel.style.cssText = 'position:absolute;opacity:0;pointer-events:none;width:0;height:0;';

  // Trigger button
  const lbl = el('span', { className: 'cs-lbl' });
  const chevSvg = dropdownChevron();
  const btn = el('button', { type: 'button', className: 'cs-btn' });
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.append(lbl, chevSvg);

  // Panel
  const panel = el('div', { className: 'cs-panel' });
  panel.setAttribute('role', 'listbox');
  panel.hidden = true;

  wrap.append(btn, panel);

  let isOpen = false;
  let query = '';

  function syncLabel() {
    const opt = sel.options[sel.selectedIndex];
    lbl.textContent = opt ? opt.textContent.trim() : '—';
    lbl.classList.toggle('cs-pholder', !opt?.value);
  }

  function buildOptions() {
    panel.replaceChildren();

    // Always present, no length threshold. A cutoff means the control changes
    // shape depending on how much data happens to be loaded — you learn to type
    // on a long list, then the same dropdown swallows your keystrokes on a
    // short one. Predictable beats minimal here, and the box costs one row.
    {
      const search = el('input', {
        className: 'cs-search', type: 'search', placeholder: 'Tìm…',
        autocomplete: 'off', value: query,
      });
      search.oninput = () => { query = search.value; buildOptions(); };
      // Keep focus and the caret through the rebuild, otherwise typing a second
      // character lands nowhere.
      search.onkeydown = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); close(); btn.focus(); return; }
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const first = panel.querySelector('.cs-opt');
        if (first) first.click();
      };
      search.addEventListener('pointerdown', (e) => e.stopPropagation());
      panel.append(search);
      requestAnimationFrame(() => { search.focus(); search.setSelectionRange(query.length, query.length); });
    }

    const want = query.trim().toLocaleLowerCase();
    let shown = 0;
    for (let i = 0; i < sel.options.length; i++) {
      const opt = sel.options[i];
      if (want && !opt.textContent.toLocaleLowerCase().includes(want)) continue;
      shown += 1;
      const isSel = sel.value === opt.value;
      const item = el('div', { className: 'cs-opt' + (isSel ? ' cs-sel' : '') + (!opt.value ? ' cs-pholder-opt' : '') });
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', isSel ? 'true' : 'false');
      // checkmark + text
      const check = el('span', { className: 'cs-check', textContent: isSel ? '✓' : '' });
      const text = el('span', { textContent: opt.textContent.trim() });
      item.append(text, check);
      item.addEventListener('pointerdown', (e) => e.preventDefault());
      item.addEventListener('click', () => {
        sel.value = opt.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        close();
      });
      panel.appendChild(item);
    }
    if (shown === 0) {
      panel.append(el('div', { className: 'cs-empty', textContent: 'Không có mục nào khớp.' }));
    }
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    query = '';
    buildOptions();
    panel.hidden = false;
    btn.classList.add('cs-open');
    btn.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => {
      const r = wrap.getBoundingClientRect();
      panel.classList.toggle('cs-up', window.innerHeight - r.bottom < panel.offsetHeight + 8);
    });
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    panel.hidden = true;
    btn.classList.remove('cs-open');
    btn.setAttribute('aria-expanded', 'false');
  }

  btn.addEventListener('click', () => isOpen ? close() : open());

  btn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); isOpen ? close() : open(); }
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!isOpen) open(); }
  });

  document.addEventListener('pointerdown', (e) => { if (!wrap.contains(e.target)) close(); });

  // React to dynamic option changes (replaceChildren, append, etc.)
  new MutationObserver(() => { syncLabel(); if (isOpen) buildOptions(); })
    .observe(sel, { childList: true });

  // React to programmatic sel.value = ... assignments
  const proto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(sel, 'value', {
    get() { return proto.get.call(this); },
    set(v) { proto.set.call(this, v); syncLabel(); if (isOpen) buildOptions(); },
    configurable: true,
  });

  syncLabel();
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

function navigate(pageId, subId) {
  location.hash = subId ? `${pageId}:${subId}` : pageId;
}

function route() {
  const [id, subId] = (location.hash.slice(1) || 'studio').split(':');
  // Allow unlisted pages (e2e-history, scenario-history, farm-run-detail) to render without NAV fallback
  const UNLISTED = new Set(['e2e-history', 'scenario-history', 'farm-run-detail']);
  const item = NAV.find((n) => n.id === id) ?? (UNLISTED.has(id) ? { id } : NAV.find((n) => n.id === 'studio'));
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
  if (page === 'scenario-review') renderReview(subId);
  if (page === 'healing-center') void loadHealing();
  if (page === 'scenario-history') renderHistory(subId);
  if (page === 'builds') void loadBuilds();
  if (page === 'e2e-runner') renderLocalHistory();
  if (page === 'e2e-history') renderE2eHistory(subId);
  if (page === 'device-farm') { refreshAwsStatus(); renderFarmHistory(); }
  if (page === 'farm-run-detail') renderFarmRunDetail(subId);
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
  // Re-render review if currently visible
  if (!document.querySelector('[data-page="scenario-review"]').hidden) renderReview();
  if (!document.querySelector('[data-page="healing-center"]').hidden) void loadHealing();
  if (!document.querySelector('[data-page="e2e-runner"]').hidden) renderLocalHistory();
  if (!document.querySelector('[data-page="device-farm"]').hidden) renderFarmHistory();
}

/* ------------------------------------------------------------------ */
/* Scenario Studio                                                     */
/* ------------------------------------------------------------------ */

/**
 * Whether the ticked local platforms can actually be driven from this machine.
 *
 * Web needs nothing but a URL, so it says nothing. Android and iOS need a
 * device, a running Appium and a build, and the checkbox shows none of that —
 * without this you learn what was missing after the workflow has read the
 * documents, called the model twice and waited for you to review the result.
 */
let preflightToken = 0;

/**
 * Device chosen per platform, by config id, held here between the pick and the
 * save. Only ever populated when more than one configured device is attached.
 */
let workflowDevices = {};

async function refreshPreflight() {
  const box = $('workflowPreflight');
  const platforms = [...document.querySelectorAll('#workflowPlatforms input[value]:checked')]
    .map((input) => input.value)
    .filter((p) => p !== 'web');
  if (platforms.length === 0) {
    box.hidden = true;
    box.replaceChildren();
    return;
  }

  // Ticking two boxes quickly fires two probes; only the last one may write.
  const token = ++preflightToken;
  box.hidden = false;
  box.dataset.state = 'checking';
  box.replaceChildren(el('p', { className: 'hint', textContent: 'Đang kiểm tra môi trường…' }));

  const results = await Promise.all(
    platforms.map(async (platform) => {
      try {
        // The pick travels with the probe: the server reads the saved config,
        // and a choice made a second ago is not in it yet.
        const chosen = workflowDevices[platform];
        return await api(
          `/api/preflight?platform=${encodeURIComponent(platform)}`
          + (chosen ? `&device=${encodeURIComponent(chosen)}` : ''),
        );
      } catch (e) {
        return { platform, ok: false, checks: [{ name: 'Kiểm tra', ok: false, detail: e.message }] };
      }
    }),
  );
  if (token !== preflightToken) return;

  box.dataset.state = results.every((r) => r.ok) ? 'ok' : 'bad';
  box.replaceChildren(...results.map((r) => {
    const group = el('div', { className: 'preflight-group' });
    // Spelled out here rather than by CSS `capitalize`, which would also
    // capitalise every word of the verdict and turn "ios" into "Ios".
    const platformLabel = { web: 'Web', android: 'Android', ios: 'iOS' }[r.platform] ?? r.platform;
    group.append(el('div', {
      className: 'preflight-head',
      textContent: `${platformLabel} — ${r.ok ? 'sẵn sàng' : 'chưa chạy được'}`,
    }));
    for (const c of r.checks) {
      const row = el('div', { className: 'preflight-check' + (c.ok ? ' ok' : ' bad') });
      // Name and detail share one cell so the detail wraps across the full
      // width instead of into a column narrowed by the longest check name.
      const body = el('div', { className: 'preflight-body' });
      body.append(
        el('span', { className: 'preflight-name', textContent: c.name }),
        el('span', { className: 'preflight-detail', textContent: c.detail }),
      );
      row.append(el('span', { className: 'preflight-mark', textContent: c.ok ? '✓' : '✗' }), body);
      group.append(row);
    }
    // The choice is offered where the ambiguity was found. Sending someone to a
    // config file to resolve something the screen already knows about is how a
    // blocked run stays blocked.
    if (r.candidates?.length > 1) group.append(devicePicker(r.platform, r.candidates));
    return group;
  }));
}

/**
 * Which of the attached devices to run on.
 *
 * Radios rather than a dropdown: there are two or three of them, and the whole
 * point is seeing which phones are on the desk at once. Picking re-runs the
 * probe, so the verdict above updates from red to green immediately instead of
 * waiting for a save nobody knows to make.
 */
function devicePicker(platform, candidates) {
  const wrap = el('div', { className: 'preflight-picker' });
  wrap.append(el('span', { className: 'preflight-picker-label', textContent: 'Chạy trên máy' }));
  for (const candidate of candidates) {
    const input = el('input', { type: 'radio', name: `pfDevice-${platform}`, value: candidate.id });
    input.checked = workflowDevices[platform] === candidate.id;
    input.onchange = () => {
      workflowDevices[platform] = candidate.id;
      // Saved as part of the studio form, like every other workflow setting —
      // but probed again right away so the panel stops saying "chưa chạy được"
      // the moment the question is answered.
      refreshPreflight();
    };
    wrap.append(el('label', { className: 'workflow-platform-option' }, [
      input,
      el('span', { textContent: candidate.label }),
    ]));
  }
  return wrap;
}

/**
 * The farm platform question only makes sense once the farm is in play, so the
 * row stays hidden until then rather than sitting there inert.
 */
function syncFarmDetail() {
  $('workflowFarmDetail').hidden = !$('workflowFarm').checked;
}

function fillStudio() {
  const c = state.config;
  sources = [...c.sources];
  // originalLabel travels with the row so a rename can carry its stored
  // password across; the value itself is never sent to the browser.
  accounts = state.accounts.map((a) => ({ ...a, password: '', previousLabel: a.label }));
  if (accounts.length === 0) accounts.push(blankAccount());
  environments = Object.entries(c.environments ?? {}).map(([name, e]) => ({
    name,
    // Collapsed on arrival: an environment already in the config is something
    // to glance at, not something to fill in.
    open: false,
    roles: Object.entries(e.accounts ?? {}).map(([role, label]) => ({ role, label })),
    iosApp: e.ios?.app ?? '',
    androidApp: e.android?.app ?? '',
    baseUrl: e.web?.baseUrl ?? '',
  }));
  defaultEnv = c.defaultEnv ?? '';

  $('baseUrl').value = c.web.baseUrl ?? '';
  $('targetFeature').value = c.targetFeature ?? '';
  // A stored focus must never be hidden from the user: it changes which part
  // of a document AI is allowed to cover. Empty means the normal auto mode.
  $('featureFocusSettings').open = Boolean(c.targetFeature?.trim());
  $('note').value = c.llm.note ?? '';
  const workflowPlatforms = new Set(c.workflow?.platforms ?? ['web']);
  // `[value]` selects the three local-platform boxes and skips the farm box,
  // which shares the row but is not a platform. Testing `input.value` instead
  // would not work: a checkbox with no value attribute reports "on".
  for (const input of document.querySelectorAll('#workflowPlatforms input[type="checkbox"][value]')) {
    input.checked = workflowPlatforms.has(input.value);
  }
  // Fired without awaiting: a cold `adb` can take seconds to start its daemon,
  // and the rest of the form must not wait on it.
  workflowDevices = { ...(c.workflow?.devices ?? {}) };
  refreshPreflight();
  const farm = c.workflow?.deviceFarm;
  $('workflowFarm').checked = Boolean(farm);
  for (const radio of document.querySelectorAll('input[name="farmPlatform"]')) {
    radio.checked = radio.value === (farm?.platform ?? 'android');
  }
  syncFarmDetail();
  $('workflowHeaded').checked = Boolean(c.workflow?.headed);
  const workflowEnv = $('workflowEnv');
  const envNames = Object.keys(c.environments ?? {});
  workflowEnv.replaceChildren(...envNames.map((name) =>
    el('option', { value: name, textContent: name.toUpperCase() })
  ));
  if (envNames.length === 0) workflowEnv.append(el('option', { value: '', textContent: 'Mặc định' }));
  workflowEnv.value = c.workflow?.env ?? c.defaultEnv ?? envNames[0] ?? '';
  renderSources();
  renderAccounts();
  renderEnvEditor();
}

const blankAccount = () => ({ label: '', username: '', password: '', hasPassword: false, previousLabel: '' });

function wireStudio() {
  $('srcAdd').onclick = addSource;
  $('srcInput').onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addSource(); }
  };
  $('acctAdd').onclick = () => { accounts.push(blankAccount()); renderAccounts(); renderEnvEditor(); };
  $('envAdd').onclick = () => {
    // A new environment starts with the same roles the others use, because a
    // role only means anything when every environment answers it.
    const roles = [...new Set(environments.flatMap((e) => e.roles.map((r) => r.role)))];
    environments.push({
      name: '',
      open: true,
      roles: (roles.length > 0 ? roles : ['tcbs']).map((role) => ({ role, label: '' })),
      iosApp: '', androidApp: '', baseUrl: '',
    });
    renderEnvEditor();
  };
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
    defaultEnv: defaultEnv.trim(),
    environments: Object.fromEntries(
      environments
        .filter((e) => e.name.trim())
        .map((e) => [
          e.name.trim(),
          {
            accounts: Object.fromEntries(
              e.roles
                .filter((r) => r.role.trim() && r.label.trim())
                .map((r) => [r.role.trim(), r.label.trim()]),
            ),
            ios: { app: e.iosApp },
            android: { app: e.androidApp },
            web: { baseUrl: e.baseUrl },
          },
        ]),
    ),
    model: $('model').value,
    note: $('note').value,
    // `[value]` excludes the farm checkbox, which is not a platform. It has no
    // value attribute, and a checkbox without one reports "on" — so filtering
    // on the property rather than the attribute would let "on" through.
    workflowPlatforms: [...document.querySelectorAll('#workflowPlatforms input[value]:checked')]
      .map((input) => input.value),
    workflowDeviceFarm: $('workflowFarm').checked
      ? { platform: document.querySelector('input[name="farmPlatform"]:checked')?.value ?? 'android' }
      : null,
    // Sent even when empty, so unticking the last multi-device platform clears
    // a stale pin rather than leaving the run aimed at a phone nobody uses.
    workflowDevices: { ...workflowDevices },
    workflowEnv: $('workflowEnv').value,
    workflowHeaded: $('workflowHeaded').checked,
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
    label.onchange = renderEnvEditor;
    user.oninput = () => { acct.username = user.value; };
    pass.oninput = () => { acct.password = pass.value; };

    const remove = el('button', { className: 'iconbtn', type: 'button', title: 'Xoá account' });
    remove.append(svg(ICON.x));
    remove.onclick = () => {
      accounts.splice(i, 1);
      if (accounts.length === 0) accounts.push(blankAccount());
      renderAccounts();
      renderEnvEditor();
    };

    box.append(el('div', { className: 'acct' }, [label, user, pass, remove]));
  });
}

/**
 * The one line a collapsed environment shows.
 *
 * Says the two things that decide whether a run against it will work at all:
 * which account it uses, and whether it has a build of its own. A missing build
 * is called out because the runner refuses to start without one.
 */
function envSummary(env) {
  const roles = env.roles.filter((r) => r.role.trim() && r.label.trim());
  const parts = roles.map((r) => `${r.role.trim()} → ${r.label.trim()}`);
  if (parts.length === 0) parts.push('chưa gán account');
  const builds = [env.iosApp.trim() && 'ipa', env.androidApp.trim() && 'apk'].filter(Boolean);
  // The default environment has no build of its own by definition — the base
  // config is its build, and the runner exempts it. Calling that "missing"
  // would be reporting the normal case as a problem.
  const isDefault = defaultEnv.trim() === env.name.trim() && Boolean(env.name.trim());
  parts.push(
    builds.length > 0 ? builds.join(' + ')
    : isDefault ? 'dùng build chung'
    : '⚠ chưa có build riêng',
  );
  if (env.baseUrl.trim()) parts.push(env.baseUrl.trim());
  return parts.join(' · ');
}

/**
 * The environments editor.
 *
 * Each environment answers two questions and no more: which account each role
 * means, and which package to install. The account side is a <select> over the
 * accounts above rather than a free-text field — a typo there resolves to no
 * account at all, and the run would only say so much later.
 */
function renderEnvEditor() {
  const box = $('envEditor');
  box.replaceChildren();
  const labels = accounts.map((a) => a.label.trim()).filter(Boolean);

  environments.forEach((env, i) => {
    const card = el('div', { className: 'env-card' + (env.open ? ' open' : '') });

    // Collapsed head: name, a one-line summary, and the two controls that make
    // sense without opening anything. Everything else lives in the body.
    if (!env.open) {
      const toggle = el('button', { className: 'env-toggle', type: 'button' });
      const chev = svg('M9 6l6 6-6 6');
      chev.classList.add('env-chev');
      toggle.append(
        chev,
        el('span', { className: 'env-name', textContent: env.name.trim() || '(chưa đặt tên)' }),
        el('span', { className: 'env-summary', textContent: envSummary(env) }),
      );
      if (defaultEnv.trim() === env.name.trim() && env.name.trim()) {
        toggle.append(el('span', { className: 'env-badge', textContent: 'mặc định' }));
      }
      toggle.onclick = () => { env.open = true; renderEnvEditor(); };

      const kill = el('button', { className: 'iconbtn', type: 'button', title: 'Xoá môi trường' });
      kill.append(svg(ICON.x));
      kill.onclick = () => { environments.splice(i, 1); renderEnvEditor(); };

      card.append(el('div', { className: 'env-head collapsed' }, [toggle, kill]));
      box.append(card);
      return;
    }

    const name = el('input', { value: env.name, placeholder: 'Tên môi trường (prod, sit, uat)' });
    name.oninput = () => {
      const before = env.name;
      env.name = name.value;
      // The default follows a rename instead of silently pointing at nothing.
      if (defaultEnv === before) { defaultEnv = env.name; paintDefault(); }
    };

    const isDefault = el('input', { type: 'radio', name: 'defaultEnv' });
    isDefault.checked = defaultEnv.trim() === env.name.trim() && Boolean(env.name.trim());
    isDefault.onchange = () => { defaultEnv = env.name; renderEnvEditor(); };
    const defaultLabel = el('label', { className: 'check env-default' }, [
      isDefault, el('span', { textContent: 'Mặc định' }),
    ]);

    const remove = el('button', { className: 'iconbtn', type: 'button', title: 'Xoá môi trường' });
    remove.append(svg(ICON.x));
    remove.onclick = () => { environments.splice(i, 1); renderEnvEditor(); };

    const shut = el('button', { className: 'iconbtn', type: 'button', title: 'Thu gọn' });
    const shutIcon = svg('M9 6l6 6-6 6');
    shutIcon.classList.add('env-chev', 'open');
    shut.append(shutIcon);
    shut.onclick = () => { env.open = false; renderEnvEditor(); };

    card.append(el('div', { className: 'env-head' }, [shut, name, defaultLabel, remove]));

    // Account roles.
    const roles = el('div', { className: 'env-roles' });
    env.roles.forEach((r, j) => {
      const role = el('input', { value: r.role, placeholder: 'Vai trò (tcbs)' });
      role.oninput = () => { r.role = role.value; };

      const pick = el('select');
      pick.append(el('option', { value: '', textContent: '— chọn account —' }));
      for (const l of labels) pick.append(el('option', { value: l, textContent: l }));
      // A label that no longer exists still shows, so a deleted account is
      // visible as a problem rather than silently reset to the first option.
      if (r.label && !labels.includes(r.label)) {
        pick.append(el('option', { value: r.label, textContent: `${r.label} (không còn)` }));
      }
      pick.value = r.label;
      pick.onchange = () => { r.label = pick.value; };

      const drop = el('button', { className: 'iconbtn', type: 'button', title: 'Xoá vai trò' });
      drop.append(svg(ICON.x));
      drop.onclick = () => { env.roles.splice(j, 1); renderEnvEditor(); };

      roles.append(el('div', { className: 'env-role' }, [role, el('span', { className: 'env-arrow', textContent: '→' }), pick, drop]));
    });
    const addRole = el('button', { className: 'ghost-btn tiny', type: 'button', textContent: '+ Vai trò' });
    addRole.onclick = () => { env.roles.push({ role: '', label: '' }); renderEnvEditor(); };
    roles.append(addRole);
    card.append(roles);

    // Packages. Left blank means "same as the base config".
    const apps = el('div', { className: 'env-apps' });
    for (const [key, platform, accept, placeholder] of [
      ['iosApp', 'ios', '.ipa', 'iOS .ipa (để trống = dùng ios.app chung)'],
      ['androidApp', 'android', '.apk', 'Android .apk (để trống = dùng android.app chung)'],
    ]) {
      const input = el('input', { value: env[key], placeholder, autocomplete: 'off', spellcheck: false });
      input.oninput = () => { env[key] = input.value; };

      // A browser never reveals a real filesystem path, so typing one means
      // knowing where the project lives. Upload instead and let the server say
      // where it put the file.
      const file = el('input', { type: 'file', accept, hidden: true });
      const pick = el('button', { className: 'ghost-btn narrow', type: 'button', textContent: 'Chọn file…' });
      const bar = el('progress', { max: 100, value: 0, className: 'app-progress', hidden: true });
      const note = el('span', { className: 'app-path-state' });

      pick.onclick = () => {
        if (!env.name.trim()) {
          note.className = 'app-path-state missing';
          note.textContent = 'Đặt tên môi trường trước — file được cất theo tên đó.';
          return;
        }
        file.click();
      };
      file.onchange = async () => {
        const chosen = file.files?.[0];
        // Chosen then cancelled leaves no file; and clearing the input lets the
        // same file be picked again after a failed attempt.
        file.value = '';
        if (!chosen) return;
        pick.disabled = true;
        try {
          const body = await uploadEnvBuild(env.name.trim(), platform, chosen, bar, note);
          env[key] = body.path;
          input.value = body.path;
          note.className = 'app-path-state ok';
          note.textContent = `✓ ${body.path}${body.sizeMb ? ` · ${body.sizeMb} MB` : ''} — bấm Lưu để ghi vào config.`;
        } catch {
          // uploadEnvBuild already wrote the reason into `note`.
        } finally {
          pick.disabled = false;
        }
      };

      apps.append(el('div', { className: 'env-app' }, [pick, input, file]), bar, note);
    }
    const url = el('input', {
      value: env.baseUrl, placeholder: 'Web baseUrl (để trống = dùng web.baseUrl chung)',
      autocomplete: 'off', spellcheck: false,
    });
    url.oninput = () => { env.baseUrl = url.value; };
    apps.append(url);
    card.append(apps);
    box.append(card);
  });

  function paintDefault() {
    for (const [i, env] of environments.entries()) {
      const radio = box.querySelectorAll('.env-default input')[i];
      if (radio) radio.checked = defaultEnv.trim() === env.name.trim() && Boolean(env.name.trim());
    }
  }
}

async function loadModels() {
  const { models, live, reason, auto } = await api('/api/models');
  const select = $('model');
  const chosen = state?.config.llm.model ?? 'auto';
  select.replaceChildren(el('option', { value: 'auto', textContent: 'auto' }));
  for (const m of models) {
    select.append(el('option', { value: m.id, textContent: m.display_name ?? m.id }));
  }
  select.value = [...select.options].some((o) => o.value === chosen) ? chosen : 'auto';
  const autoNote = `auto = ${auto ?? 'claude-opus-5'}.`;
  $('modelHint').textContent = live
    ? `${autoNote} Danh sách lấy trực tiếp từ nhà cung cấp.`
    : `${autoNote} Đang dùng danh sách mặc định${reason ? ` — ${reason}` : ''}.`;
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
    const result = await streamInto(
      '/api/gen',
      $('genLog'),
      studioForm(),
      renderStages,
    );
    if (result.lastRun?.status === 'waiting_review') {
      await refresh();
      navigate('scenario-review', result.lastRun.id);
    }
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
  'Đọc và xác thực tài liệu',
  'AI phân tích yêu cầu, màn hình và element',
  'Cập nhật element registry',
  'Sinh bộ testcase',
  'Chuẩn hoá và bind step',
  'Chờ duyệt / chỉnh sửa testcase',
  'Chuẩn bị môi trường automation',
  'Chạy các kịch bản đã duyệt',
  'Healing và chạy lại lỗi locator',
  'Sinh report, ảnh và video',
  'Hoàn tất workflow',
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
      el('span', { className: 'dot', textContent: s.status === 'done' ? '✓' : s.status === 'skipped' ? '–' : '' }),
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
  const runs = state.runs.filter((run) => run.kind === 'workflow' || run.kind === 'gen').slice(0, 8);

  if (runs.length === 0) {
    body.append(emptyRow(4, 'Chưa có lần chạy nào.'));
    return;
  }
  for (const r of runs) {
    const labels = { waiting_review: 'Chờ duyệt', running: 'Đang chạy', passed: 'Hoàn tất', failed: 'Có lỗi' };
    const tr = el('tr', { className: 'clickable' }, [
      el('td', { textContent: r.feature }),
      el('td', { className: 'mono', textContent: when(r.startedAt) }),
      el('td', {}, el('span', { className: `pill ${r.status}`, textContent: labels[r.status] ?? r.status })),
      el('td', { className: 'right mono', textContent: `${r.stagesDone}/${r.stages.length}` }),
    ]);
    tr.onclick = () => {
      // Both pauses lead to the same page, because both are things the run is
      // waiting on a human for. Routing waiting_input to history instead would
      // put the questions somewhere the operator has no reason to look.
      const waiting = r.status === 'waiting_review' || r.status === 'waiting_input';
      location.hash = r.kind === 'workflow' && waiting
        ? `scenario-review:${r.id}`
        : `scenario-history:${r.id}`;
    };
    body.append(tr);
  }
}

function renderHistory(focusId) {
  const box = $('historyList');
  box.replaceChildren();
  if (state.runs.length === 0) {
    box.append(el('p', { className: 'empty', textContent: 'Chưa có lần chạy nào.' }));
    return;
  }

  let focusCard = null;
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
    if (r.generatedFile) {
      card.append(el('p', { className: 'hint mono', textContent: r.generatedFile }));
    }
    // The report is the point of the run, and it was reachable from exactly one
    // place: the review screen, for whichever workflow happened to be open
    // there. Every earlier run kept its `runDirs` all along — nothing here was
    // missing but the link.
    for (const runDir of r.runDirs ?? []) {
      const report = (state.reports ?? []).find((item) => item.id === runDir);
      if (report?.url) {
        card.append(el('a', {
          className: 'workflow-report-link',
          href: report.url,
          target: '_blank',
          rel: 'noreferrer',
          textContent: `Xem report ${report.platform ?? ''}`.trim(),
        }));
      } else {
        // Said rather than skipped: a missing link otherwise reads as "this run
        // produced nothing", when in fact retention removed the directory.
        card.append(el('p', {
          className: 'hint',
          textContent: `Report ${runDir} đã bị dọn theo retention.`,
        }));
      }
    }
    // The farm run is a separate record with its own stages and artifacts, so
    // the workflow links to it rather than flattening it into one line. Without
    // this the id was stored and never shown, leaving the farm half of a
    // four-platform run reachable only by hunting through the Device Farm tab.
    if (r.farmRunId) {
      const farmRun = (state.runs ?? []).find((item) => item.id === r.farmRunId);
      const link = el('button', {
        className: 'workflow-report-link',
        type: 'button',
        textContent: farmRun
          ? `Xem lượt chạy Device Farm (${farmRun.status})`
          : 'Xem lượt chạy Device Farm',
      });
      link.onclick = () => navigate('farm-run-detail', r.farmRunId);
      card.append(link);
    }
    if (r.error) card.append(el('p', { className: 'err', textContent: r.error }));
    if (r.log?.length) {
      card.append(el('details', {}, [
        el('summary', { textContent: `Log (${r.log.length} dòng)` }),
        el('pre', { className: 'console', textContent: r.log.join('\n') }),
      ]));
    }
    if (focusId && r.id === focusId) {
      card.classList.add('run-focus');
      focusCard = card;
    }
    box.append(card);
  }
  if (focusCard) requestAnimationFrame(() => focusCard.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

const mark = (s) => ({ done: '✓', failed: '✕', running: '…', skipped: '–' })[s] ?? '·';
const when = (iso) => new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function emptyRow(cols, text) {
  return el('tr', {}, el('td', { colSpan: cols }, el('p', { className: 'empty', textContent: text })));
}

/* ------------------------------------------------------------------ */
/* Healing Center                                                      */
/* ------------------------------------------------------------------ */

let healingData = null;
let healingPending = '';

function wireHealing() {
  $('healStatusFilter').onchange = renderHealing;
  $('healPlatformFilter').onchange = renderHealing;
}

async function loadHealing() {
  const status = $('healingStatus');
  status.className = 'status';
  status.textContent = 'Đang tải healing telemetry…';
  try {
    healingData = await api('/api/healing');
    status.textContent = '';
    renderHealing();
  } catch (err) {
    status.className = 'status bad';
    status.textContent = err.message;
  }
}

function renderHealing() {
  if (!healingData) return;
  const summary = healingData.summary ?? {};
  $('healProposed').textContent = String(summary.proposed ?? 0);
  $('healWatching').textContent = String(summary.watching ?? 0);
  $('healApplied').textContent = String(summary.applied ?? 0);
  $('healRejected').textContent = String(summary.rejected ?? 0);
  $('healingPolicy').textContent =
    `Đề xuất khi ≥ ${healingData.policy.minSuccesses} lần heal qua ≥ ${healingData.policy.minRuns} run`;

  const statusFilter = $('healStatusFilter').value;
  const platformFilter = $('healPlatformFilter').value;
  const records = (healingData.records ?? []).filter((record) =>
    (statusFilter === 'all' || record.status === statusFilter) &&
    (platformFilter === 'all' || record.platform === platformFilter),
  );

  const body = $('healingBody');
  body.replaceChildren();
  if (records.length === 0) {
    body.append(emptyRow(11, 'Không có healing record khớp bộ lọc.'));
    return;
  }

  for (const record of records) {
    const actions = el('div', { className: 'healing-actions' });
    const pendingApply = healingPending === `${record.id}:apply`;
    const pendingReject = healingPending === `${record.id}:reject`;

    if (record.status === 'proposed' && !pendingApply && !pendingReject) {
      const apply = el('button', { className: 'primary-btn tiny', type: 'button', textContent: 'Áp dụng' });
      const reject = el('button', { className: 'ghost-btn tiny', type: 'button', textContent: 'Từ chối' });
      apply.disabled = record.quality?.promotable === false;
      if (apply.disabled) {
        apply.title = `Chưa đạt quality gate: ${(record.quality.reasons ?? []).join(', ')}`;
      } else {
        apply.onclick = () => { healingPending = `${record.id}:apply`; renderHealing(); };
      }
      reject.onclick = () => { healingPending = `${record.id}:reject`; renderHealing(); };
      actions.append(apply, reject);
    } else if (pendingApply || pendingReject) {
      const action = pendingApply ? 'apply' : 'reject';
      const confirm = el('button', {
        className: pendingApply ? 'primary-btn tiny' : 'danger-btn tiny',
        type: 'button',
        textContent: pendingApply ? 'Xác nhận áp dụng' : 'Xác nhận từ chối',
      });
      const cancel = el('button', { className: 'ghost-btn tiny', type: 'button', textContent: 'Huỷ' });
      confirm.onclick = () => reviewHealing(record.id, action, confirm);
      cancel.onclick = () => { healingPending = ''; renderHealing(); };
      actions.append(confirm, cancel);
    }

    const locator = (candidate) => `${candidate.strategy}=${candidate.value}`;
    const primary = record.primary ? locator(record.primary) : 'Chưa có locator';
    const current = locator(record.current);
    const proposed = locator(record.proposed);
    body.append(el('tr', {}, [
      el('td', { className: 'mono', textContent: record.elementId }),
      el('td', {}, el('span', { className: `pill ${record.platform}`, textContent: record.platform })),
      healingLocatorCell(primary),
      healingLocatorCell(current),
      healingLocatorCell(proposed, record.quality),
      el('td', { className: 'right', textContent: String(record.successes) }),
      el('td', { className: 'right', textContent: String(record.runs), title: record.runIds.join('\n') }),
      healingDeviceCell(record),
      el('td', { className: 'faint', textContent: when(record.lastSeen) }),
      el('td', {}, el('span', {
        className: `pill healing-${record.status}`,
        textContent: healingStatusLabel(record.status),
      })),
      el('td', {}, actions),
    ]));
  }
}

/**
 * How many devices backed this proposal, with the split behind a tooltip.
 *
 * Evidence is pooled across devices on purpose, so the count is the only thing
 * distinguishing "three devices agree the testId changed" from "one device out
 * of three disagrees with the other two" — which look identical in the Heals
 * column and mean opposite things.
 */
function healingDeviceCell(record) {
  const devices = record.devices ?? {};
  const names = Object.keys(devices);
  const count = record.deviceCount ?? (names.length || 1);
  const cell = el('td', { className: 'right', textContent: String(count) });
  cell.title = names.length
    ? names.map((name) => `${name}: ${devices[name]}`).join('\n')
    : 'Bằng chứng ghi trước khi có tách theo máy.';
  if (count === 1 && record.runs > 1) cell.classList.add('faint');
  return cell;
}

function healingLocatorCell(value, quality) {
  const preview = el('code', {
    className: 'locator-code',
    textContent: value,
    title: value,
  });
  const toggle = el('span', { className: 'locator-toggle', textContent: 'Xem đủ', hidden: true });
  const summary = el('summary', {}, [preview, toggle]);
  // The preview itself expands in-place. Rendering a second full copy below it
  // makes the same locator appear twice and wastes vertical space.
  const details = el('details', { className: 'locator-details' }, [summary]);
  // The score goes in the cell, NOT inside <details>. Anything after <summary>
  // is the disclosure body, so appending it there hid the one number the row
  // exists to communicate until somebody expanded a locator to read it.
  const badge = quality
    ? el('span', {
        className: `locator-quality ${quality.stable ? 'stable' : quality.promotable ? 'review' : 'fragile'}`,
        textContent: `${quality.score}/100 · ${
          quality.stable ? 'Ổn định' : quality.promotable ? 'Có thể duyệt' : 'Fragile'
        }`,
        title: (quality.reasons ?? []).join(', '),
      })
    : null;
  const syncOverflow = () => {
    if (details.open) return;
    const clipped = preview.scrollWidth > preview.clientWidth + 1;
    details.classList.toggle('locator-expandable', clipped);
    toggle.hidden = !clipped;
  };
  summary.onclick = (event) => {
    if (!details.classList.contains('locator-expandable')) event.preventDefault();
  };
  details.ontoggle = () => {
    toggle.textContent = details.open ? 'Thu gọn' : 'Xem đủ';
    if (!details.open) requestAnimationFrame(syncOverflow);
  };
  requestAnimationFrame(syncOverflow);
  return el('td', { className: 'healing-locator-cell' }, badge ? [details, badge] : [details]);
}

async function reviewHealing(id, action, button) {
  button.disabled = true;
  button.textContent = action === 'apply' ? 'Đang áp dụng…' : 'Đang lưu…';
  try {
    healingData = await api('/api/healing/review', 'POST', { id, action });
    healingPending = '';
    $('healingStatus').className = 'status good';
    $('healingStatus').textContent = action === 'apply'
      ? 'Đã đưa locator được duyệt lên primary trong element registry.'
      : 'Đã từ chối đề xuất; locator hiện tại không bị thay đổi.';
    renderHealing();
  } catch (err) {
    button.disabled = false;
    $('healingStatus').className = 'status bad';
    $('healingStatus').textContent = err.message;
  }
}

function healingStatusLabel(status) {
  return ({
    proposed: 'Chờ duyệt', watching: 'Đang theo dõi',
    applied: 'Đã áp dụng', rejected: 'Đã từ chối',
  })[status] ?? status;
}

/* ------------------------------------------------------------------ */
/* Local Runner history (embedded)                                     */
/* ------------------------------------------------------------------ */
const PAGE_SIZE = 10;
let localRunPage = 0;
let farmRunPage = 0;
let localRunDate = '';
let farmRunDate = '';
let localPlatform = 'all';
let farmPlatformFilter = 'all';

function isoToDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function replaceMonthSelect(fp) {
  const select = fp.calendarContainer.querySelector('.flatpickr-monthDropdown-months');
  if (!select) return;
  const span = document.createElement('span');
  span.className = 'fp-month-label';
  span.textContent = fp.l10n.months.longhand[fp.currentMonth] + ' ' + fp.currentYear;
  select.replaceWith(span);
  // also hide the year numInputWrapper since year is now in the label
  const yearWrap = fp.calendarContainer.querySelector('.numInputWrapper');
  if (yearWrap) yearWrap.hidden = true;
}

function syncMonthLabel(fp) {
  const label = fp.calendarContainer.querySelector('.fp-month-label');
  if (label) label.textContent = fp.l10n.months.longhand[fp.currentMonth] + ' ' + fp.currentYear;
}

function renderPager(pagerId, currentPage, totalItems, onGo) {
  const pager = $(pagerId);
  const totalPages = Math.ceil(totalItems / PAGE_SIZE);
  pager.replaceChildren();
  if (totalPages <= 1) return;

  const prev = el('button', { className: 'ghost-btn narrow', type: 'button', textContent: '← Trước', disabled: currentPage === 0 });
  prev.onclick = () => onGo(currentPage - 1);

  const info = el('span', { className: 'pager-info', textContent: `${currentPage + 1} / ${totalPages}` });

  const next = el('button', { className: 'ghost-btn narrow', type: 'button', textContent: 'Tiếp →', disabled: currentPage >= totalPages - 1 });
  next.onclick = () => onGo(currentPage + 1);

  pager.append(prev, info, next);
}

function syncFilterClear(clearBtnId, active) {
  const btn = $(clearBtnId);
  if (btn) btn.hidden = !active;
}

function renderLocalHistory() {
  syncFilterClear('localRunDateClear', localRunDate !== '' || localPlatform !== 'all');
  const all = (state.reports ?? []).filter(
    (r) => (!localRunDate || isoToDate(r.startedAt) === localRunDate) &&
            (localPlatform === 'all' || r.platform === localPlatform),
  );
  const wrap = $('localRunHistory');
  wrap.hidden = (state.reports ?? []).length === 0;
  if ((state.reports ?? []).length === 0) return;

  // clamp page
  const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  if (localRunPage >= totalPages) localRunPage = totalPages - 1;

  const page = all.slice(localRunPage * PAGE_SIZE, (localRunPage + 1) * PAGE_SIZE);
  const tbody = $('localRunBody');
  tbody.replaceChildren();

  if (page.length === 0) {
    const parts = [];
    if (localRunDate) parts.push(`ngày ${localRunDate}`);
    if (localPlatform !== 'all') parts.push(`platform ${localPlatform}`);
    tbody.append(emptyRow(7, `Không có lần chạy local nào${parts.length ? ' cho ' + parts.join(', ') : ''}.`));
  }

  for (const r of page) {
    // Current run metadata stores verdict totals under `counters`. Keep the
    // top-level fallback so reports produced by older TestPilot versions still
    // render correctly.
    const pass = r.counters?.passed ?? r.passed ?? 0;
    const fail = r.counters?.failed ?? r.failed ?? 0;
    const openBtn = el('button', { className: 'ghost-btn narrow', type: 'button', textContent: 'Chi tiết' });
    // Carry the run id across, or the reports page opens on whichever run it
    // defaults to — which is what made "Chi tiết" land on somebody else's log.
    openBtn.onclick = () => navigate('e2e-history', r.id);
    tbody.append(el('tr', {}, [
      el('td', { textContent: when(r.startedAt ?? '') }),
      el('td', {}, [el('span', { className: `pill ${r.platform}`, textContent: r.platform ?? '—' })]),
      el('td', { className: 'mono faint', textContent: r.tag || 'tất cả' }),
      el('td', { className: 'right ' + (pass > 0 ? 'pass-txt' : ''), textContent: String(pass) }),
      el('td', { className: 'right ' + (fail > 0 ? 'fail-txt' : ''), textContent: String(fail) }),
      el('td', { className: 'right faint', textContent: runDuration(r) }),
      el('td', {}, [openBtn]),
    ]));
  }

  renderPager('localRunPager', localRunPage, all.length, (p) => { localRunPage = p; renderLocalHistory(); });
}

/* ------------------------------------------------------------------ */
/* Device Farm history (embedded)                                      */
/* ------------------------------------------------------------------ */
function renderFarmHistory() {
  syncFilterClear('farmRunDateClear', farmRunDate !== '' || farmPlatformFilter !== 'all');
  const farmAll = (state.runs ?? []).filter((r) => r.kind === 'farm');
  const all = farmAll.filter((r) => {
    if (farmRunDate && isoToDate(r.startedAt) !== farmRunDate) return false;
    if (farmPlatformFilter !== 'all' && farmPlatform(r) !== farmPlatformFilter) return false;
    return true;
  });
  const wrap = $('farmRunHistory');
  wrap.hidden = farmAll.length === 0;
  if (farmAll.length === 0) return;

  const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  if (farmRunPage >= totalPages) farmRunPage = totalPages - 1;

  const page = all.slice(farmRunPage * PAGE_SIZE, (farmRunPage + 1) * PAGE_SIZE);
  const tbody = $('farmRunBody');
  tbody.replaceChildren();

  if (page.length === 0) {
    const parts = [];
    if (farmRunDate) parts.push(`ngày ${farmRunDate}`);
    if (farmPlatformFilter !== 'all') parts.push(`platform ${farmPlatformFilter}`);
    tbody.append(emptyRow(7, `Không có lần chạy Device Farm nào${parts.length ? ' cho ' + parts.join(', ') : ''}.`));
  }

  for (const r of page) {
    const done = r.stages?.filter((s) => s.status !== 'pending').length ?? 0;
    const total = r.stages?.length ?? 0;
    const platform = farmPlatform(r);
    const statusCls = r.status === 'done' ? 'passed' : r.status === 'failed' ? 'failed' : r.status;
    const viewBtn = el('button', { className: 'ghost-btn narrow', type: 'button', textContent: 'Xem' });
    viewBtn.onclick = () => navigate('farm-run-detail', r.id);
    tbody.append(el('tr', {}, [
      el('td', { textContent: when(r.startedAt ?? '') }),
      el('td', {}, [el('span', {
        className: `pill ${platform}`,
        textContent: platform === 'ios' ? 'iOS' : platform === 'android' ? 'Android' : '—',
      })]),
      el('td', { className: 'mono', textContent: r.feature ?? '—' }),
      el('td', { className: 'faint', textContent: total ? `${done}/${total}` : '—' }),
      el('td', {}, [el('span', { className: `pill ${statusCls}`, textContent: r.status ?? '—' })]),
      el('td', { className: 'right faint', textContent: runDuration(r) }),
      el('td', {}, [viewBtn]),
    ]));
  }

  renderPager('farmRunPager', farmRunPage, all.length, (p) => { farmRunPage = p; renderFarmHistory(); });
}

function farmPlatform(run) {
  if (run.platform === 'android' || run.platform === 'ios') return run.platform;

  for (const dir of run.runDirs ?? []) {
    const match = /-(android|ios)(?:-|$)/i.exec(dir);
    if (match) return match[1].toLowerCase();
  }

  const linkedReport = (state.reports ?? []).find(
    (report) => (run.runDirs ?? []).includes(report.id),
  );
  if (linkedReport?.platform === 'android' || linkedReport?.platform === 'ios') {
    return linkedReport.platform;
  }

  const log = (run.log ?? []).join('\n');
  if (/Upload APK:/i.test(log)) return 'android';
  if (/Upload IPA:/i.test(log)) return 'ios';
  return '';
}

/* ------------------------------------------------------------------ */
/* Farm Run Detail                                                     */
/* ------------------------------------------------------------------ */

function renderFarmRunDetail(runId) {
  const box = $('farmRunDetail');
  box.replaceChildren();

  const run = state.runs.find((r) => r.id === runId);
  if (!run) {
    box.append(el('p', { className: 'empty', textContent: 'Không tìm thấy lần chạy.' }));
    return;
  }

  // Header
  const statusCls = run.status === 'passed' ? 'passed' : run.status === 'failed' ? 'failed' : 'running';
  box.append(el('div', { className: 'farm-detail-header' }, [
    el('h1', { className: 'page-title', textContent: run.feature }),
    el('span', { className: `pill ${statusCls}`, textContent: run.status }),
    el('span', { className: 'faint', textContent: when(run.startedAt) }),
  ]));

  if (run.error) box.append(el('p', { className: 'err', textContent: run.error }));

  // Stages
  const stageList = el('ul', { className: 'farm-stages-list' });
  for (const s of run.stages) {
    const icon = s.status === 'done' ? '✓' : s.status === 'failed' ? '✕' : s.status === 'running' ? '…' : s.status === 'skipped' ? '–' : '·';
    stageList.append(el('li', { className: `farm-stage-item stage-${s.status}` }, [
      el('span', { className: 'farm-stage-icon', textContent: icon }),
      el('span', { textContent: s.name }),
    ]));
  }
  box.append(el('div', { className: 'card farm-stages-card' }, [
    el('h3', { className: 'card-title', textContent: 'Tiến trình' }),
    stageList,
  ]));

  // Device reports (linked via runDirs)
  const linkedReports = run.runDirs
    ? state.reports.filter((r) => run.runDirs.includes(r.id))
    : [];

  if (linkedReports.length > 0) {
    const reportsSection = el('div', { className: 'farm-device-reports' });
    reportsSection.append(el('h3', { className: 'card-title', textContent: 'Kết quả thiết bị' }));

    for (const r of linkedReports) {
      const deviceCard = el('div', { className: 'card farm-device-card' });

      // Device header
      const devStatusCls = r.status === 'passed' ? 'passed' : r.status === 'failed' ? 'failed' : r.status;
      const headerItems = [
        el('b', { textContent: r.device ?? r.id }),
        el('span', { className: `pill ${devStatusCls}`, textContent: r.status }),
      ];
      if (r.counters) {
        headerItems.push(el('span', { className: 'faint', textContent: `${r.counters.passed} passed · ${r.counters.failed} failed` }));
      }
      if (r.url) {
        const link = el('a', { href: r.url, target: '_blank', className: 'farm-report-link', textContent: '↗ Báo cáo' });
        headerItems.push(link);
      }
      deviceCard.append(el('div', { className: 'farm-device-header' }, headerItems));

      // Videos
      if (r.videoUrls?.length) {
        const videosWrap = el('div', { className: 'farm-videos' });
        for (const url of r.videoUrls) {
          const name = url.split('/').pop() ?? 'video';
          videosWrap.append(el('div', { className: 'farm-video-item' }, [
            el('p', { className: 'farm-video-label faint', textContent: name }),
            videoWithChapters(url, videoOptsFor(r, url)),
          ]));
        }
        deviceCard.append(videosWrap);
      }

      // Log
      if (r.log) {
        deviceCard.append(el('details', { className: 'farm-log-details' }, [
          el('summary', { textContent: 'Log' }),
          el('pre', { className: 'console farm-log', textContent: r.log }),
        ]));
      }

      // The same viewer as E2E History. Worth repeating here rather than
      // sending people to another page: this is where someone lands right
      // after a farm run fails, and on the farm the network log is usually
      // the only artifact that says why.
      if (r.networkLogUrl) deviceCard.append(networkLogPanel(r.networkLogUrl));

      reportsSection.append(deviceCard);
    }
    box.append(reportsSection);
  } else if (run.status === 'running') {
    // Live log while running
    if (run.log?.length) {
      box.append(el('details', { open: true }, [
        el('summary', { textContent: `Log (${run.log.length} dòng)` }),
        el('pre', { className: 'console', textContent: run.log.join('\n') }),
      ]));
    }
  } else {
    // Completed but no device reports (e.g. run failed before artifact collection)
    if (run.log?.length) {
      box.append(el('details', { open: true }, [
        el('summary', { textContent: `Log (${run.log.length} dòng)` }),
        el('pre', { className: 'console', textContent: run.log.join('\n') }),
      ]));
    }
    box.append(el('p', { className: 'empty', textContent: 'Không có artifact thiết bị (lần chạy có thể đã thất bại trước khi thu thập được).' }));
  }

  // Back button wiring
  $('farmDetailBack').onclick = () => navigate('device-farm');
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
/* Scenario Review — flat table + side panel editor                    */
/* ------------------------------------------------------------------ */

let rvSearch = '';
let rvFilterTags = new Set();
let rvFilterFile = '';
let rvFilterStatus = '';
let rvSelected = new Set();   // key = "filename::scenarioName"
let rvEditing = null;         // { mode: 'edit'|'create', filename, scenarioName? }
let rvEditorTags = new Set();
let rvPage = 0;
let rvTagSearch = '';
let rvVocabulary = null;      // { forms, actions, elements } — last fetch, refreshed on open
let rvSyntaxQuery = '';
let activeReviewWorkflowId = '';
let rvSaving = false;
// Per-file draft contents (edits not yet saved to disk)
const rvDrafts = new Map();   // filename -> content
// Server snapshot on which each draft is based. A regenerated file may keep
// the same name; without this revision the old browser draft can erase it.
const rvBaseContents = new Map();
const rvBaseRevisions = new Map();
/**
 * Scenarios whose Gherkin is open in the list.
 *
 * Reviewing means reading the steps, and the steps were two clicks and a side
 * panel away — so the quick judgement the list is for could not be made from
 * the list. Kept keyed rather than as a flag on the row so the open state
 * survives re-rendering, which happens on every filter, page and save.
 */
const rvExpanded = new Set();
/**
 * A message for a row that is about to be rebuilt.
 *
 * Saving reloads the list, which replaces the very element the result was
 * written into — so the confirmation appeared for a fraction of a second and
 * then vanished with its row. Held here and rendered by the new row instead.
 */
let rvInlineNotice = null;   // { key, text, ok }

function rvKey(filename, name) { return `${filename}::${name}`; }

function wireReview() {
  if (!$('rvTagFilterBtn').querySelector('.dropdown-chevron')) {
    $('rvTagFilterBtn').append(dropdownChevron());
  }
  $('rvSearch').oninput = (e) => {
    rvSearch = e.target.value.toLowerCase();
    rvPage = 0;
    rvSelected.clear();
    rvRenderTable();
  };

  $('rvFileFilter').onchange = (e) => {
    rvFilterFile = e.target.value;
    rvPage = 0;
    rvSelected.clear();
    rvRenderTable();
  };

  $('rvStatusFilter').onchange = (e) => {
    rvFilterStatus = e.target.value;
    rvPage = 0;
    rvSelected.clear();
    rvRenderTable();
  };

  $('rvTagFilterBtn').onclick = () => {
    const panel = $('rvTagFilterPanel');
    const open = panel.hidden;
    panel.hidden = !open;
    $('rvTagFilterBtn').setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      rvTagSearch = '';
      $('rvTagFilterSearch').value = '';
      rvRenderTagFilter();
      $('rvTagFilterSearch').focus();
    }
  };
  $('rvTagFilterSearch').oninput = (event) => {
    rvTagSearch = event.target.value.toLocaleLowerCase();
    rvRenderTagFilter();
  };
  $('rvTagFilterSearch').onkeydown = (event) => {
    if (event.key !== 'Escape') return;
    $('rvTagFilterPanel').hidden = true;
    $('rvTagFilterBtn').setAttribute('aria-expanded', 'false');
    $('rvTagFilterBtn').focus();
  };
  $('rvTagFilterClear').onclick = () => {
    rvFilterTags.clear();
    rvTagSearch = '';
    $('rvTagFilterSearch').value = '';
    rvPage = 0;
    rvSelected.clear();
    rvRenderTagFilter();
    rvRenderTable();
  };
  document.addEventListener('pointerdown', (event) => {
    if ($('rvTagFilter').contains(event.target)) return;
    $('rvTagFilterPanel').hidden = true;
    $('rvTagFilterBtn').setAttribute('aria-expanded', 'false');
  });

  $('rvSelectAll').onchange = (e) => {
    const rows = rvFilteredScenarios();
    if (e.target.checked) rows.forEach((r) => rvSelected.add(rvKey(r.filename, r.name)));
    else rows.forEach((r) => rvSelected.delete(rvKey(r.filename, r.name)));
    rvRenderTable();
  };

  $('rvBulkApprove').onclick = () => rvBulkReview('approve');
  $('rvBulkDelete').onclick = () => rvBulkDelete();
  $('rvAddScenario').onclick = () => rvOpenCreatePanel();
  $('rvPanelTargetFile').onchange = () => rvSyncNewFileRow();
  $('rvPanelNewFile').oninput = () => rvSyncNewFileRow();

  $('rvPanelClose').onclick = () => rvClosePanel();
  $('rvPanelCancel').onclick = () => rvClosePanel();
  $('rvPanelNormalize').onclick = () => rvNormalizePanel();
  $('rvBackdrop').onclick = () => rvClosePanel();
  $('rvPanelSave').onclick = () => rvSavePanel();
  $('rvPanelEditor').onkeydown = rvEditorKeydown;
  $('rvSyntaxToggle').onclick = () => rvToggleSyntax();
  $('rvSyntaxSearch').oninput = (event) => {
    rvSyntaxQuery = event.target.value;
    rvRenderSyntax();
  };
  $('rvPanelEditor').oninput = () => rvMarkEditorDirty();
  $('workflowComplete').onclick = () => completeActiveWorkflow();
  $('workflowAnswers').onclick = () => submitWorkflowAnswers();

  const tagInput = $('rvEditorTagInput');
  $('rvEditorTagControl').onclick = (event) => {
    if (event.target === $('rvEditorTagControl')) tagInput.focus();
  };
  tagInput.onfocus = () => rvRenderEditorTags(true);
  tagInput.oninput = () => rvRenderEditorTags(true);
  tagInput.onkeydown = (event) => {
    if (event.key === 'Escape') {
      $('rvEditorTagSuggestions').hidden = true;
      return;
    }
    if (event.key === 'Backspace' && !tagInput.value && rvEditorTags.size > 0) {
      const tags = [...rvEditorTags];
      rvEditorTags.delete(tags[tags.length - 1]);
      rvApplyEditorTags();
      rvRenderEditorTags(true);
      return;
    }
    if (event.key !== 'Enter' && event.key !== ',') return;
    event.preventDefault();
    const query = tagInput.value.trim();
    const knownMatch = rvKnownTags().find((tag) =>
      tag.toLocaleLowerCase() === rvNormalizeTag(query).toLocaleLowerCase()
    );
    rvAddEditorTag(knownMatch ?? query);
  };
  tagInput.onblur = () => setTimeout(() => {
    // Clicking Save/Normalize directly after typing must not silently discard
    // a new tag merely because the user did not press Enter first.
    rvCommitPendingEditorTag(false);
    $('rvEditorTagSuggestions').hidden = true;
  }, 120);
}

function renderReview(workflowId = activeReviewWorkflowId) {
  if (workflowId) activeReviewWorkflowId = workflowId;
  // Sync drafts: add new files, remove deleted ones
  const features = state?.features ?? [];
  const fileNames = new Set(features.map((f) => f.name));
  for (const [k] of rvDrafts) {
    if (!fileNames.has(k)) {
      rvDrafts.delete(k);
      rvBaseContents.delete(k);
      rvBaseRevisions.delete(k);
    }
  }
  for (const f of features) {
    if (!rvDrafts.has(f.name)) {
      rvDrafts.set(f.name, f.content);
      rvBaseContents.set(f.name, f.content);
      rvBaseRevisions.set(f.name, f.revision ?? '');
      continue;
    }
    const previousRevision = rvBaseRevisions.get(f.name) ?? '';
    if (previousRevision === (f.revision ?? '')) continue;

    const previousBase = rvBaseContents.get(f.name) ?? '';
    const draft = rvDrafts.get(f.name) ?? '';
    // Clean drafts follow the server automatically. Dirty drafts retain their
    // old base revision so PUT receives a 409 instead of overwriting new work.
    if (draft === previousBase) {
      rvDrafts.set(f.name, f.content);
      rvBaseContents.set(f.name, f.content);
      rvBaseRevisions.set(f.name, f.revision ?? '');
    }
  }

  // Rebuild file filter options
  const sel = $('rvFileFilter');
  const prev = sel.value;
  sel.replaceChildren(el('option', { value: '', textContent: 'Tất cả file' }));
  for (const f of features) sel.append(el('option', { value: f.name, textContent: f.name }));
  sel.value = fileNames.has(prev) ? prev : '';
  const workflow = state?.runs?.find((run) => run.id === activeReviewWorkflowId);
  if (workflow?.generatedFile && fileNames.has(workflow.generatedFile)) {
    sel.value = workflow.generatedFile;
  }
  rvFilterFile = sel.value;

  renderWorkflowGate(workflow);

  // Rebuild tag filter pills
  rvRenderTagFilter();

  if (features.length === 0) {
    $('rvBody').replaceChildren(
      el('tr', {}, [el('td', { colSpan: 7, className: 'empty', textContent: 'Chưa có feature file nào. Chạy workflow sinh kịch bản trước.' })])
    );
    $('rvSummary').textContent = '';
    $('rvPager').replaceChildren();
    return;
  }

  rvRenderTable();
}

/**
 * The questions the run is blocked on.
 *
 * Deliberately not a stage of its own: a question can come from generation
 * reading an ambiguous document or from healing refusing to test a risky
 * hypothesis, and those happen at different points. Tying it to one fixed step
 * would misrepresent the second case entirely.
 */
function renderWorkflowQuestions(workflow) {
  const box = $('workflowQuestions');
  const questions = workflow.questions ?? [];
  const pending = questions.filter((q) => !q.answeredAt);
  box.hidden = pending.length === 0;
  if (pending.length === 0) return;

  $('workflowQuestionsCount').textContent = `${pending.length} câu`;
  $('workflowQuestionsHelp').textContent =
    'Hệ thống dừng lại vì những điểm sau không thể tự quyết mà không đoán. '
    + 'Trả lời xong, workflow chạy tiếp từ đúng chỗ đang dở.';

  const form = $('workflowQuestionsForm');
  form.replaceChildren(...pending.map((question) => {
    const body = [];
    if (question.rationale) {
      // Without the reason, a question nobody understands gets answered
      // arbitrarily, which is worse than not asking.
      body.push(el('p', { className: 'hint', textContent: question.rationale }));
    }
    if (question.context?.scenario) {
      const at = question.context.line
        ? `${question.context.scenario}, dòng ${question.context.line}`
        : question.context.scenario;
      body.push(el('p', { className: 'hint', textContent: `Phát sinh tại: ${at}` }));
    }
    // `el` assigns properties, and a property named "data-question" is not an
    // attribute — the selector that reads the form back would match nothing.
    // dataset has to be set on the node itself.
    const tag = (props) => {
      const input = el('input', props);
      input.dataset.question = question.id;
      input.dataset.kind = question.kind;
      return input;
    };
    if (question.kind === 'text') {
      body.push(tag({ type: 'text', className: 'question-text', name: question.id }));
    } else {
      const type = question.kind === 'radio' ? 'radio' : 'checkbox';
      for (const option of question.options ?? []) {
        body.push(el('label', { className: 'question-option' }, [
          tag({ type, name: question.id, value: option }),
          document.createTextNode(option),
        ]));
      }
    }
    return el('fieldset', { className: 'question' }, [
      el('legend', { textContent: question.prompt }),
      ...body,
    ]);
  }));
  $('workflowQuestionsStatus').textContent = '';
}

/** Reads the form back into the shape the API expects. */
function collectAnswers() {
  const form = $('workflowQuestionsForm');
  const byQuestion = new Map();
  for (const input of form.querySelectorAll('[data-question]')) {
    const id = input.dataset.question;
    const values = byQuestion.get(id) ?? [];
    if (input.dataset.kind === 'text') {
      if (input.value.trim()) values.push(input.value.trim());
    } else if (input.checked) {
      values.push(input.value);
    }
    byQuestion.set(id, values);
  }
  return [...byQuestion].map(([id, values]) => ({ id, values }));
}

function renderWorkflowGate(workflow) {
  const gate = $('workflowGate');
  if (!workflow || workflow.kind !== 'workflow') {
    gate.hidden = true;
    return;
  }
  gate.hidden = false;
  renderStageList($('workflowReviewStages'), workflow, IDLE_STAGES);

  const feature = (state.features ?? []).find((item) => item.name === workflow.generatedFile);
  const scenarios = feature?.scenarios ?? [];
  const counts = { pending: 0, approved: 0, rejected: 0 };
  for (const scenario of scenarios) {
    const status = scenario.review?.status ?? 'pending';
    if (status in counts) counts[status] += 1;
  }
  const coverage = feature?.coverage ?? null;
  const coverageTotal = coverage?.total ?? workflow.generated?.coverageRequirements ?? 0;
  const coverageCovered = coverage?.covered ?? workflow.generated?.coverageCovered ?? coverageTotal;
  const coverageMissing = coverage?.missing ?? workflow.generated?.coverageMissing ?? [];
  $('workflowGateSummary').textContent = workflow.generated
    ? `${workflow.generated.scenarios} testcase · ${workflow.generated.steps} bước` +
      (workflow.generated.visuals ? ` · ${workflow.generated.visuals} ảnh/design đã phân tích` : '') +
      (coverageTotal
        ? ` · ${coverageCovered}/${coverageTotal} yêu cầu bắt buộc đã có testcase`
        : '') +
      (workflow.generated.coverageRepaired ? ' · AI đã tự bổ sung coverage thiếu' : '') +
      ` · ${workflow.generatedFile ?? ''}`
    : workflow.generatedFile ?? workflow.feature;

  const coverageBox = $('workflowCoverage');
  coverageBox.hidden = coverageMissing.length === 0;
  if (coverageMissing.length > 0) {
    $('workflowCoverageTitle').textContent = 'Coverage cần bổ sung trước khi chạy';
    $('workflowCoverageCount').textContent = `${coverageMissing.length} quy tắc`;
    $('workflowCoverageHelp').textContent =
      'Bản nháp vẫn được giữ để review. Hãy sửa hoặc thêm testcase tương ứng; hệ thống sẽ kiểm tra lại khi bấm Hoàn thành kịch bản.';
    $('workflowCoverageList').replaceChildren(...coverageMissing.map((item) =>
      el('li', {}, [
        el('code', { textContent: item.id }),
        document.createTextNode(` — ${item.rule ?? item.sourceQuote ?? ''}`),
      ])
    ));
  } else {
    $('workflowCoverageList').replaceChildren();
  }

  renderWorkflowQuestions(workflow);

  const statusLabels = {
    waiting_review: 'Chờ duyệt', waiting_input: 'Chờ bổ sung thông tin',
    running: 'Đang chạy', passed: 'Hoàn tất', failed: 'Có lỗi',
  };
  const badge = $('workflowGateStatus');
  badge.className = `pill ${workflow.status}`;
  badge.textContent = statusLabels[workflow.status] ?? workflow.status;

  const complete = $('workflowComplete');
  const canContinue = workflow.status === 'waiting_review'
    && counts.pending === 0
    && counts.approved > 0;
  complete.disabled = !canContinue;
  complete.hidden = workflow.status === 'passed' || workflow.status === 'failed';
  $('workflowGateHint').textContent = workflow.status === 'waiting_review'
    ? counts.pending > 0
      ? `Còn ${counts.pending} chờ duyệt · ${counts.approved} đã duyệt · ${counts.rejected} không duyệt`
      : counts.approved === 0
        ? 'Cần duyệt ít nhất một testcase để tiếp tục.'
        : `${counts.approved} testcase sẽ được chạy · ${counts.rejected} testcase bị loại` +
          (coverageMissing.length > 0 ? ' · Coverage sẽ được kiểm tra lại trước khi chạy' : '')
    : workflow.status === 'running'
      ? 'Workflow đang tự động chạy; không cần thao tác thêm.'
      : workflow.error ?? 'Workflow đã hoàn tất.';

  const links = $('workflowReportLinks');
  links.replaceChildren();
  for (const runDir of workflow.runDirs ?? []) {
    const report = (state.reports ?? []).find((item) => item.id === runDir);
    if (!report?.url) continue;
    links.append(el('a', {
      className: 'workflow-report-link', href: report.url, target: '_blank', rel: 'noreferrer',
      textContent: `Xem report ${report.platform ?? ''}`.trim(),
    }));
  }
}

/**
 * Send the answers, then let the run continue.
 *
 * The two are separate calls on purpose: answers are persisted as they arrive,
 * so an operator who fills in half the form and walks away loses nothing, and
 * the run only moves once nothing is left open.
 */
async function submitWorkflowAnswers() {
  const runId = activeReviewWorkflowId;
  if (!runId) return;
  const button = $('workflowAnswers');
  const status = $('workflowQuestionsStatus');
  button.disabled = true;
  setStatus(status, 'Đang lưu câu trả lời…', null);
  try {
    const res = await fetch('/api/workflow/answers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId, answers: collectAnswers() }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? 'Không lưu được câu trả lời.');
    if (body.remaining > 0) {
      setStatus(status, `Còn ${body.remaining} câu chưa trả lời.`, false);
      return;
    }
    setStatus(status, 'Đã ghi nhận. Workflow đang chạy tiếp…', true);
    await refresh();
  } catch (err) {
    setStatus(status, err.message, false);
  } finally {
    button.disabled = false;
  }
}

async function completeActiveWorkflow() {
  const runId = activeReviewWorkflowId;
  if (!runId) return;
  const button = $('workflowComplete');
  const status = $('workflowCompleteStatus');
  const log = $('workflowReviewLog');
  button.disabled = true;
  button.textContent = 'Đang tiếp tục workflow…';
  log.hidden = false;
  log.textContent = '';
  setStatus(status, 'Đang chuẩn bị chạy các testcase đã duyệt…', null);
  try {
    const result = await streamInto('/api/workflow/complete', log, { runId }, (run) => {
      renderStageList($('workflowReviewStages'), run, IDLE_STAGES);
      const badge = $('workflowGateStatus');
      badge.className = `pill ${run.status}`;
      badge.textContent = run.status === 'running' ? 'Đang chạy' : run.status;
    });
    const ok = result.lastRun?.status === 'passed';
    setStatus(
      status,
      ok ? 'Workflow đã hoàn tất. Report, ảnh và video đã sẵn sàng.' : 'Workflow hoàn tất nhưng có testcase fail. Xem report để biết chi tiết.',
      ok,
    );
  } catch (error) {
    setStatus(status, error.message, false);
  } finally {
    button.textContent = 'Hoàn thành kịch bản và tiếp tục chạy';
    await refresh();
    renderReview(runId);
  }
}

function rvAllScenarios() {
  const features = state?.features ?? [];
  const result = [];
  for (const f of features) {
    const content = rvDrafts.get(f.name) ?? f.content;
    const parsed = rvParseContent(content);
    const serverScenarios = new Map((f.scenarios ?? []).map((scenario) => [scenario.name, scenario]));
    for (const s of parsed) {
      const server = serverScenarios.get(s.name);
      result.push({
        filename: f.name,
        featureTitle: f.feature,
        ...s,
        review: server?.review ?? { status: 'pending' },
      });
    }
  }
  return result;
}

function rvFilteredScenarios() {
  return rvAllScenarios().filter((s) => {
    if (rvFilterFile && s.filename !== rvFilterFile) return false;
    if (rvSearch && !s.name.toLowerCase().includes(rvSearch) && !s.filename.toLowerCase().includes(rvSearch)) return false;
    if (rvFilterTags.size > 0 && !s.tags.some((t) => rvFilterTags.has(t))) return false;
    if (rvFilterStatus && s.review?.status !== rvFilterStatus) return false;
    return true;
  });
}

function rvRenderTagFilter() {
  const all = rvAllScenarios();
  const counts = new Map();
  for (const scenario of all) {
    for (const tag of scenario.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const allTags = [...counts.keys()].sort((a, b) => {
    const selectedOrder = Number(rvFilterTags.has(b)) - Number(rvFilterTags.has(a));
    return selectedOrder || a.localeCompare(b, 'vi');
  });
  for (const selected of [...rvFilterTags]) {
    if (!counts.has(selected)) rvFilterTags.delete(selected);
  }

  const selectedCount = rvFilterTags.size;
  $('rvTagFilterLabel').textContent = selectedCount ? `Tags (${selectedCount})` : 'Tags';
  $('rvTagFilterBtn').classList.toggle('active', selectedCount > 0);
  $('rvTagFilterSummary').textContent = selectedCount ? `Đã chọn ${selectedCount} tag` : 'Chưa chọn tag';
  $('rvTagFilterClear').disabled = selectedCount === 0;

  const query = rvTagSearch.trim();
  const visibleTags = allTags.filter((tag) => !query || tag.toLocaleLowerCase().includes(query));
  const box = $('rvTagFilterOptions');
  box.replaceChildren();
  for (const tag of visibleTags) {
    const active = rvFilterTags.has(tag);
    const check = el('span', { className: 'rv-tag-option-check' + (active ? ' checked' : ''), textContent: active ? '✓' : '' });
    const option = el('button', { className: 'rv-tag-option' + (active ? ' active' : ''), type: 'button' }, [
      check,
      el('span', { className: 'rv-tag-option-name', textContent: tag }),
      el('span', { className: 'rv-tag-option-count', textContent: String(counts.get(tag) ?? 0) }),
    ]);
    option.setAttribute('role', 'checkbox');
    option.setAttribute('aria-checked', active ? 'true' : 'false');
    option.onclick = () => {
      if (rvFilterTags.has(tag)) rvFilterTags.delete(tag); else rvFilterTags.add(tag);
      rvPage = 0;
      rvSelected.clear();
      rvRenderTagFilter();
      rvRenderTable();
    };
    box.append(option);
  }
  if (visibleTags.length === 0) {
    box.append(el('div', { className: 'rv-tag-filter-empty', textContent: 'Không tìm thấy tag phù hợp.' }));
  }
}

function rvPageScenarios() {
  const rows = rvFilteredScenarios();
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  if (rvPage >= totalPages) rvPage = totalPages - 1;
  if (rvPage < 0) rvPage = 0;
  return rows.slice(rvPage * PAGE_SIZE, (rvPage + 1) * PAGE_SIZE);
}

let rvActionMenuSeq = 0;

function rvRemoveActionMenus() {
  document.querySelectorAll('.rv-action-menu[data-rv-action-menu]').forEach((menu) => menu.remove());
}

function rvPositionActionMenu(menu, anchor) {
  const rect = anchor.getBoundingClientRect();
  const width = 196;
  menu.style.left = `${Math.max(10, Math.min(window.innerWidth - width - 10, rect.right - width))}px`;
  menu.style.top = `${rect.bottom + 6}px`;
  requestAnimationFrame(() => {
    const menuRect = menu.getBoundingClientRect();
    if (menuRect.bottom > window.innerHeight - 10) {
      menu.style.top = `${Math.max(10, rect.top - menuRect.height - 6)}px`;
    }
  });
}

function rvCloseActionMenu(menu) {
  if (typeof menu.hidePopover === 'function' && menu.matches(':popover-open')) {
    menu.hidePopover();
  } else {
    menu.hidden = true;
  }
}

function rvActionMenuItem(label, onClick, { danger = false } = {}) {
  const button = el('button', {
    className: `rv-action-menu-item${danger ? ' danger' : ''}`,
    type: 'button',
    textContent: label,
  });
  button.onclick = onClick;
  return button;
}

function rvRenderTable() {
  const filtered = rvFilteredScenarios();
  const rows = rvPageScenarios();
  const tbody = $('rvBody');
  rvRemoveActionMenus();
  tbody.replaceChildren();

  if (rows.length === 0) {
    tbody.append(el('tr', {}, [el('td', { colSpan: 7, className: 'empty', textContent: 'Không có kịch bản nào khớp bộ lọc.' })]));
  } else {
    for (const s of rows) {
      const key = rvKey(s.filename, s.name);
      const checked = rvSelected.has(key);

      const chk = el('input', { type: 'checkbox', checked });
      chk.onchange = () => {
        if (chk.checked) rvSelected.add(key); else rvSelected.delete(key);
        rvSyncBulkBtn();
        rvSyncSelectAll(rows);
      };

      const tagEls = s.tags.map((t) => el('span', { className: 'rv-row-tag', textContent: t }));

      const reviewStatus = s.review?.status ?? 'pending';
      const reviewLabels = {
        pending: 'Chờ duyệt',
        approved: 'Đã duyệt',
        rejected: 'Không duyệt',
      };
      const reviewBadge = el('span', {
        className: `rv-review-badge ${reviewStatus}`,
        textContent: reviewLabels[reviewStatus] ?? reviewStatus,
      });

      const approveBtn = el('button', {
        className: 'primary-btn narrow rv-review-action',
        type: 'button',
        textContent: reviewStatus === 'rejected' ? 'Duyệt lại' : 'Duyệt',
        hidden: reviewStatus === 'approved',
      });
      approveBtn.onclick = () => rvReviewScenario(s, 'approve', approveBtn);

      const isDirty = rvDrafts.get(s.filename) !== (state?.features?.find(f => f.name === s.filename)?.content ?? '');
      const menuId = `rv-action-menu-${++rvActionMenuSeq}`;
      const moreBtn = el('button', {
        className: 'rv-more-action',
        type: 'button',
        title: `Thao tác với ${s.name}`,
      }, [el('span', { className: 'rv-more-dots' })]);
      moreBtn.firstElementChild?.setAttribute('aria-hidden', 'true');
      moreBtn.setAttribute('aria-label', `Thao tác với kịch bản ${s.name}`);
      moreBtn.setAttribute('aria-haspopup', 'menu');

      const actionMenu = el('div', {
        id: menuId,
        className: 'rv-action-menu',
      });
      actionMenu.dataset.rvActionMenu = 'true';
      actionMenu.setAttribute('role', 'menu');

      const editAction = rvActionMenuItem('Sửa kịch bản', () => {
        rvCloseActionMenu(actionMenu);
        rvOpenPanel(s.filename, s.name);
      });
      actionMenu.append(editAction);

      if (reviewStatus !== 'rejected') {
        const rejectLabel = reviewStatus === 'approved' ? 'Thu hồi phê duyệt' : 'Không duyệt';
        const rejectAction = rvActionMenuItem(rejectLabel, async () => {
          rvCloseActionMenu(actionMenu);
          await rvReviewScenario(s, 'reject', rejectAction);
        });
        actionMenu.append(rejectAction);
      }

      if (isDirty) {
        const saveAction = rvActionMenuItem('Lưu thay đổi file', async () => {
          rvCloseActionMenu(actionMenu);
          await rvSaveFile(s.filename, saveAction);
        });
        actionMenu.append(saveAction);
      }

      const deleteAction = rvActionMenuItem('Xoá kịch bản', async () => {
        rvCloseActionMenu(actionMenu);
        const confirmed = await askConfirm({
          title: 'Xoá kịch bản?',
          message: `“${s.name}” sẽ bị xoá khỏi ${s.filename}. Thao tác này không thể hoàn tác.`,
          confirmLabel: 'Xoá kịch bản',
        });
        if (confirmed) await rvDeleteOne(s.filename, s.name);
      }, { danger: true });
      actionMenu.append(deleteAction);

      if (typeof actionMenu.showPopover === 'function') {
        actionMenu.setAttribute('popover', 'auto');
        moreBtn.setAttribute('popovertarget', menuId);
        actionMenu.addEventListener('toggle', (event) => {
          if (event.newState === 'open') rvPositionActionMenu(actionMenu, moreBtn);
        });
      } else {
        actionMenu.hidden = true;
        moreBtn.onclick = () => {
          actionMenu.hidden = !actionMenu.hidden;
          if (!actionMenu.hidden) rvPositionActionMenu(actionMenu, moreBtn);
        };
      }
      document.body.append(actionMenu);

      // The whole name is the toggle, not a separate control: reading the steps
      // is the common act on this screen and should cost one click on the
      // obvious target.
      const open = rvExpanded.has(key);
      const nameBtn = el('button', {
        type: 'button',
        className: `rv-name-toggle${open ? ' open' : ''}`,
      }, [
        el('span', { className: 'rv-chevron', textContent: open ? '▾' : '▸' }),
        el('span', { textContent: s.name }),
      ]);
      nameBtn.setAttribute('aria-expanded', String(open));
      nameBtn.onclick = () => {
        if (rvExpanded.has(key)) rvExpanded.delete(key); else rvExpanded.add(key);
        rvRenderTable();
      };

      const tr = el('tr', {}, [
        el('td', { className: 'rv-col-check' }, [el('label', {}, [chk])]),
        el('td', { className: 'rv-col-file mono', textContent: s.filename.replace('.feature', '') }),
        el('td', { className: 'rv-col-name' }, [nameBtn]),
        el('td', { className: 'rv-col-tags' }, tagEls),
        el('td', { className: 'rv-col-steps right', textContent: String(s.steps.length) }),
        el('td', { className: 'rv-col-review' }, [reviewBadge]),
        el('td', { className: 'rv-col-actions' }, [
          el('div', { className: 'rv-actions-row' }, [
            approveBtn,
            moreBtn,
          ]),
        ]),
      ]);
      tbody.append(tr);
      if (open) tbody.append(rvInlineEditorRow(s));
    }
  }

  const total = rvAllScenarios().length;
  const fileCount = new Set(rvAllScenarios().map((s) => s.filename)).size;
  const first = filtered.length === 0 ? 0 : rvPage * PAGE_SIZE + 1;
  const last = Math.min((rvPage + 1) * PAGE_SIZE, filtered.length);
  $('rvSummary').textContent = filtered.length < total
    ? `Hiển thị ${first}–${last} / ${filtered.length} kết quả · ${total} kịch bản trong ${fileCount} file`
    : `Hiển thị ${first}–${last} / ${total} kịch bản trong ${fileCount} file`;

  renderPager('rvPager', rvPage, filtered.length, (page) => {
    rvPage = page;
    rvRenderTable();
  });

  rvSyncBulkBtn();
  rvSyncSelectAll(filtered);
}

/**
 * The scenario's own Gherkin, editable where it is listed.
 *
 * Same normalization and the same write endpoint the side panel uses — an edit
 * made here must not be able to save a step that the panel would have rejected,
 * or the list becomes a way to slip an unbindable scenario past the checks.
 */
function rvInlineEditorRow(scenario) {
  const content = rvDrafts.get(scenario.filename) ?? '';
  const editor = el('textarea', {
    className: 'rv-inline-editor mono',
    spellcheck: false,
    value: rvExtractScenario(content, scenario.name),
  });
  // Grows with the scenario instead of making the reader scroll a small box.
  editor.rows = Math.min(24, Math.max(6, editor.value.split('\n').length + 1));

  const status = el('p', { className: 'status rv-inline-status' });
  const key = rvKey(scenario.filename, scenario.name);
  if (rvInlineNotice?.key === key) {
    setStatus(status, rvInlineNotice.text, rvInlineNotice.ok);
    rvInlineNotice = null;
  }
  const save = el('button', { className: 'primary-btn narrow', type: 'button', textContent: 'Lưu' });
  const cancel = el('button', { className: 'ghost-btn narrow', type: 'button', textContent: 'Đóng' });
  cancel.onclick = () => {
    rvExpanded.delete(rvKey(scenario.filename, scenario.name));
    rvRenderTable();
  };
  save.onclick = () => rvInlineSave(scenario, editor, status, save);
  // Ctrl/Cmd+Enter saves, because the mouse trip to the button is exactly the
  // kind of step this whole change exists to remove.
  editor.onkeydown = (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      save.click();
    }
  };

  return el('tr', { className: 'rv-inline-row' }, [
    el('td', { colSpan: 7 }, [
      el('div', { className: 'rv-inline-box' }, [
        editor,
        status,
        el('div', { className: 'rv-inline-actions' }, [save, cancel]),
      ]),
    ]),
  ]);
}

async function rvInlineSave(scenario, editor, status, button) {
  const { filename, name } = scenario;
  button.disabled = true;
  setStatus(status, 'Đang chuẩn hoá và lưu…', null);
  try {
    const normalized = await api('/api/feature/normalize', 'POST', { content: editor.value });
    if (!normalized.valid) {
      setStatus(status, rvNormalizationError(normalized.error), false);
      return;
    }
    const block = rvFormatGherkin(normalized.content);
    const parsed = rvParseContent(block);
    if (parsed.length !== 1) {
      setStatus(status, 'Mỗi lần chỉ sửa một kịch bản.', false);
      return;
    }
    editor.value = block;

    const nextName = parsed[0].name.trim();
    const current = rvDrafts.get(filename) ?? '';
    const clash = rvParseContent(current).some((other) =>
      other.name.toLocaleLowerCase() === nextName.toLocaleLowerCase() && other.name !== name);
    if (clash) {
      setStatus(status, `Feature này đã có kịch bản “${nextName}”.`, false);
      return;
    }

    const updated = rvReplaceScenario(current, name, block);
    const saved = await api('/api/feature', 'PUT', {
      filename,
      content: updated,
      baseRevision: rvBaseRevisions.get(filename) ?? '',
    });
    const savedContent = saved.content ?? updated;
    rvDrafts.set(filename, savedContent);
    rvBaseContents.set(filename, savedContent);
    rvBaseRevisions.set(filename, saved.revision ?? '');
    // Renaming moves the row's identity, so carry the open state across.
    if (nextName !== name) {
      rvExpanded.delete(rvKey(filename, name));
      rvExpanded.add(rvKey(filename, nextName));
    }
    // Editing a scenario returns it to pending; saying so here saves the reader
    // hunting for why the badge changed.
    const review = (saved.review ?? []).find((item) => item.scenarioName === nextName);
    rvInlineNotice = {
      key: rvKey(filename, nextName),
      text: review?.status === 'pending' ? 'Đã lưu · Cần duyệt lại trước khi chạy.' : 'Đã lưu.',
      ok: true,
    };
    await refresh();
  } catch (err) {
    setStatus(status, err.message, false);
  } finally {
    button.disabled = false;
  }
}

async function rvReviewScenario(scenario, decision, button) {
  const status = $('rvReviewStatus');
  const oldText = button.textContent;
  button.disabled = true;
  button.textContent = decision === 'approve' ? 'Đang duyệt…' : 'Đang cập nhật…';
  setStatus(status, decision === 'approve' ? 'Đang duyệt kịch bản…' : 'Đang ghi nhận không duyệt…', null);
  try {
    const result = await api('/api/feature/review', 'POST', {
      filename: scenario.filename,
      scenarioName: scenario.name,
      decision,
    });
    const message = decision === 'approve'
      ? 'Đã duyệt. Kịch bản được phép chạy và POM đã đồng bộ.'
      : 'Đã ghi nhận không duyệt. Kịch bản bị loại khỏi run và generated spec.';
    if (result.pomWarning) {
      setStatus(status, result.pomWarning, false);
    } else {
      const shown = withPomWarnings(
        result.pom ? message : 'Đã cập nhật trạng thái duyệt.',
        result,
      );
      setStatus(status, shown.text, shown.ok);
    }
    await refresh();
  } catch (error) {
    button.disabled = false;
    button.textContent = oldText;
    setStatus(status, error.message || 'Không cập nhật được trạng thái duyệt.', false);
  }
}

function rvSyncBulkBtn() {
  const n = rvSelected.size;
  $('rvBulkApprove').hidden = n === 0;
  $('rvBulkApproveCount').textContent = String(n);
  $('rvBulkDelete').hidden = n === 0;
  $('rvBulkCount').textContent = String(n);
}

function rvSyncSelectAll(rows) {
  const selectedOnPage = rows.filter((r) => rvSelected.has(rvKey(r.filename, r.name))).length;
  const allChecked = rows.length > 0 && selectedOnPage === rows.length;
  $('rvSelectAll').checked = allChecked;
  $('rvSelectAll').indeterminate = selectedOnPage > 0 && !allChecked;
}

async function rvDeleteOne(filename, scenarioName) {
  const draft = rvDrafts.get(filename) ?? '';
  rvDrafts.set(filename, rvRemoveScenario(draft, scenarioName));
  rvSelected.delete(rvKey(filename, scenarioName));
  await rvSaveFile(filename);
  rvRenderTable();
}

async function rvBulkDelete() {
  const count = rvSelected.size;
  if (count === 0) return;
  const confirmed = await askConfirm({
    title: `Xoá ${count} kịch bản?`,
    message: 'Các kịch bản đã chọn sẽ bị xoá khỏi feature file. Thao tác này không thể hoàn tác.',
    confirmLabel: `Xoá ${count} kịch bản`,
  });
  if (!confirmed) return;

  // Group by file
  const byFile = new Map();
  for (const key of rvSelected) {
    const [filename, ...rest] = key.split('::');
    const name = rest.join('::');
    if (!byFile.has(filename)) byFile.set(filename, []);
    byFile.get(filename).push(name);
  }
  for (const [filename, names] of byFile) {
    let draft = rvDrafts.get(filename) ?? '';
    for (const name of names) draft = rvRemoveScenario(draft, name);
    rvDrafts.set(filename, draft);
    await rvSaveFile(filename);
  }
  rvSelected.clear();
  rvRenderTable();
}

async function rvBulkReview(decision) {
  const scenarios = rvAllScenarios().filter((scenario) =>
    rvSelected.has(rvKey(scenario.filename, scenario.name))
  );
  if (scenarios.length === 0) return;
  const button = $('rvBulkApprove');
  const status = $('rvReviewStatus');
  button.disabled = true;
  setStatus(status, 'Đang kiểm tra và duyệt các kịch bản đã chọn…', null);
  try {
    const result = await api('/api/feature/review-bulk', 'POST', {
      decision,
      items: scenarios.map((scenario) => ({
        filename: scenario.filename,
        scenarioName: scenario.name,
      })),
    });
    rvSelected.clear();
    if (result.pomWarning) {
      setStatus(status, result.pomWarning, false);
    } else {
      const shown = withPomWarnings(
        `Đã duyệt ${result.reviewed ?? scenarios.length} kịch bản và đồng bộ POM.`,
        result,
      );
      setStatus(status, shown.text, shown.ok);
    }
    await refresh();
  } catch (error) {
    setStatus(status, error.message || 'Không duyệt được các kịch bản đã chọn.', false);
  } finally {
    button.disabled = false;
    rvRenderTable();
  }
}

function askConfirm({ title, message, confirmLabel = 'Xác nhận' }) {
  const dialog = $('confirmDialog');
  const accept = $('confirmDialogAccept');
  const cancel = $('confirmDialogCancel');
  $('confirmDialogTitle').textContent = title;
  $('confirmDialogMessage').textContent = message;
  accept.textContent = confirmLabel;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (accepted) => {
      if (settled) return;
      settled = true;
      dialog.removeEventListener('cancel', onCancel);
      if (dialog.open) dialog.close();
      resolve(accepted);
    };
    const onCancel = (event) => {
      event.preventDefault();
      finish(false);
    };
    cancel.onclick = () => finish(false);
    accept.onclick = () => finish(true);
    dialog.addEventListener('cancel', onCancel);
    dialog.showModal();
    cancel.focus();
  });
}

async function rvSaveFile(filename, btn) {
  const content = rvDrafts.get(filename) ?? '';
  if (btn) { btn.disabled = true; btn.textContent = 'Đang lưu…'; }
  try {
    const saved = await api('/api/feature', 'PUT', {
      filename,
      content,
      baseRevision: rvBaseRevisions.get(filename) ?? '',
    });
    const savedContent = saved.content ?? content;
    rvDrafts.set(filename, savedContent);
    rvBaseContents.set(filename, savedContent);
    rvBaseRevisions.set(filename, saved.revision ?? '');
    await refresh();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Lưu file'; }
    alert(e.message);
  }
}

/* ── Side panel editor ────────────────────────────────────────────── */

function rvKnownTags() {
  const taxonomy = state?.tagTaxonomy?.definitions?.map((item) => item.name) ?? [];
  return [...new Set([...taxonomy, ...rvAllScenarios().flatMap((scenario) => scenario.tags)])]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'vi'));
}

/** Sentinel value of the "new feature" entry in the target picker. */
const RV_NEW_FEATURE = '__new__';

/**
 * A file name derived from what the author typed as the feature's title.
 *
 * Asking for a file name would be asking the wrong question: the title is the
 * thing they have in mind, and Gherkin repeats it inside the file anyway. The
 * diacritics are folded because a feature path ends up in run directory names,
 * bundle entries and Device Farm logs, none of which are reliable about them.
 */
function rvFeatureFileName(title) {
  const slug = String(title ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug ? `${slug}.feature` : '';
}

/** The skeleton a new feature file starts from, matching the existing ones. */
function rvNewFeatureContent(title) {
  return `Feature: ${title}\n\n  Background:\n    Given I open the app\n`;
}

/**
 * Keeps the target row in step with the picker, and reports what the file will
 * be called before anything is written.
 */
function rvSyncNewFileRow() {
  const select = $('rvPanelTargetFile');
  const input = $('rvPanelNewFile');
  const hint = $('rvPanelNewFileHint');
  const creating = select.value === RV_NEW_FEATURE;

  input.hidden = !creating;
  hint.hidden = !creating;
  if (!creating) {
    if (rvEditing?.mode === 'create') rvEditing.filename = select.value;
    return;
  }

  const title = input.value.trim();
  const file = rvFeatureFileName(title);
  const taken = (state?.features ?? []).some((f) => f.name.toLowerCase() === file.toLowerCase());

  hint.classList.toggle('bad', Boolean(title) && (!file || taken));
  hint.textContent = !title
    ? 'Nhập tên feature — file sẽ được đặt tên theo đó.'
    : !file
      ? 'Tên này không tạo được tên file hợp lệ.'
      : taken
        ? `features/${file} đã tồn tại.`
        : `→ features/${file}`;

  if (rvEditing?.mode === 'create') {
    rvEditing.newFeatureTitle = title;
    rvEditing.filename = file && !taken ? file : '';
  }
}

function rvNormalizeTag(value) {
  const body = String(value ?? '')
    .trim()
    .replace(/^@+/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  if (!body) return '';
  const raw = `@${body}`;
  const aliased = state?.tagTaxonomy?.aliases?.[raw] ?? raw;
  const known = new Set((state?.tagTaxonomy?.definitions ?? []).map((item) => item.name));
  return known.has(aliased) || aliased.startsWith('@feature-')
    ? aliased
    : `@feature-${aliased.slice(1)}`;
}

function rvTagsFromEditor(source = $('rvPanelEditor').value) {
  const lines = String(source).replace(/\r\n/g, '\n').split('\n');
  const scenarioIndex = lines.findIndex((line) => /^\s*Scenario(?:\s+Outline)?:/i.test(line));
  if (scenarioIndex < 0) return [];
  return lines
    .slice(0, scenarioIndex)
    .filter((line) => line.trim().startsWith('@'))
    .flatMap((line) => line.trim().split(/\s+/))
    .filter((tag) => /^@[^@\s]+$/.test(tag))
    .map(rvNormalizeTag)
    .filter(Boolean);
}

function rvSyncEditorTagsFromText() {
  rvEditorTags = new Set(rvTagsFromEditor());
  rvRenderEditorTags(false);
}

function rvMarkEditorDirty() {
  rvSyncEditorTagsFromText();
  if (!rvEditing || rvSaving) return;
  $('rvPanelSave').disabled = false;
  $('rvPanelSave').textContent = rvEditing.mode === 'create' ? 'Thêm kịch bản' : 'Lưu thay đổi';
  $('rvPanelCancel').textContent = 'Huỷ';
  $('rvPanelStatus').textContent = '';
}

function rvApplyEditorTags() {
  const editor = $('rvPanelEditor');
  const lines = editor.value.replace(/\r\n/g, '\n').split('\n');
  let scenarioIndex = lines.findIndex((line) => /^\s*Scenario(?:\s+Outline)?:/i.test(line));
  if (scenarioIndex < 0) return;

  // A scenario block owns every tag line before its Scenario header. Replace
  // only those lines so all step wording and indentation remain untouched.
  for (let index = scenarioIndex - 1; index >= 0; index--) {
    if (!lines[index].trim().startsWith('@')) continue;
    lines.splice(index, 1);
    scenarioIndex--;
  }
  if (rvEditorTags.size > 0) {
    lines.splice(scenarioIndex, 0, `  ${[...rvEditorTags].join(' ')}`);
  }
  const selection = editor.selectionStart;
  editor.value = lines.join('\n');
  editor.setSelectionRange(Math.min(selection, editor.value.length), Math.min(selection, editor.value.length));
  rvMarkEditorDirty();
}

function rvAddEditorTag(value, refocus = true) {
  const tag = rvNormalizeTag(value);
  if (!tag) return;
  const duplicate = [...rvEditorTags].some((current) => current.toLocaleLowerCase() === tag.toLocaleLowerCase());
  if (!duplicate) rvEditorTags.add(tag);
  $('rvEditorTagInput').value = '';
  rvApplyEditorTags();
  rvRenderEditorTags(true);
  if (refocus) $('rvEditorTagInput').focus();
}

function rvCommitPendingEditorTag(refocus = false) {
  const input = $('rvEditorTagInput');
  const value = input.value.trim();
  if (!value) return;
  const knownMatch = rvKnownTags().find((tag) =>
    tag.toLocaleLowerCase() === rvNormalizeTag(value).toLocaleLowerCase()
  );
  rvAddEditorTag(knownMatch ?? value, refocus);
}

function rvRemoveEditorTag(tag) {
  rvEditorTags.delete(tag);
  rvApplyEditorTags();
  rvRenderEditorTags(true);
  $('rvEditorTagInput').focus();
}

function rvRenderEditorTags(openSuggestions = false) {
  const chipBox = $('rvEditorTagChips');
  chipBox.replaceChildren(...[...rvEditorTags].map((tag) => {
    const remove = el('button', {
      className: 'rv-editor-tag-remove', type: 'button', textContent: '×',
      title: `Bỏ ${tag}`, 'aria-label': `Bỏ ${tag}`,
    });
    remove.onclick = (event) => {
      event.stopPropagation();
      rvRemoveEditorTag(tag);
    };
    return el('span', { className: 'rv-editor-tag-chip' }, [
      el('span', { textContent: tag }), remove,
    ]);
  }));

  const input = $('rvEditorTagInput');
  const suggestionBox = $('rvEditorTagSuggestions');
  const query = input.value.trim();
  const normalizedQuery = rvNormalizeTag(query);
  const selectedLower = new Set([...rvEditorTags].map((tag) => tag.toLocaleLowerCase()));
  const known = rvKnownTags();
  const matches = known.filter((tag) =>
    !selectedLower.has(tag.toLocaleLowerCase())
      && (!query || tag.toLocaleLowerCase().includes(query.replace(/^@/, '').toLocaleLowerCase()))
  );
  const knownExact = normalizedQuery
    && known.some((tag) => tag.toLocaleLowerCase() === normalizedQuery.toLocaleLowerCase());

  const options = matches.map((tag) => {
    const option = el('button', { className: 'rv-editor-tag-option', type: 'button', textContent: tag });
    option.onmousedown = (event) => event.preventDefault();
    option.onclick = () => rvAddEditorTag(tag);
    return option;
  });
  if (normalizedQuery && !knownExact && !selectedLower.has(normalizedQuery.toLocaleLowerCase())) {
    const create = el('button', {
      className: 'rv-editor-tag-option is-new', type: 'button',
      textContent: `＋ Thêm tag mới ${normalizedQuery}`,
    });
    create.onmousedown = (event) => event.preventDefault();
    create.onclick = () => rvAddEditorTag(normalizedQuery);
    options.unshift(create);
  }
  if (options.length === 0) {
    options.push(el('div', {
      className: 'rv-editor-tag-empty',
      textContent: query ? 'Tag này đã được chọn.' : 'Không còn tag nào để chọn.',
    }));
  }
  suggestionBox.replaceChildren(...options);
  suggestionBox.hidden = !openSuggestions;
}

function rvOpenPanel(filename, scenarioName) {
  const content = rvDrafts.get(filename) ?? '';
  const block = rvExtractScenario(content, scenarioName);
  rvEditing = { mode: 'edit', filename, scenarioName };
  $('rvPanelTitle').textContent = scenarioName;
  $('rvPanelFile').textContent = filename;
  $('rvPanelFile').hidden = false;
  $('rvPanelTarget').hidden = true;
  $('rvPanelEditor').value = block;
  $('rvEditorTagInput').value = '';
  rvSyncEditorTagsFromText();
  $('rvPanelStatus').textContent = '';
  $('rvActionProposals').replaceChildren();
  $('rvActionProposals').hidden = true;
  // Button state belongs to one editor session. A successful save disables the
  // button while its request is in flight; without resetting it here, the next
  // scenario inherits that stale disabled state.
  $('rvPanelSave').disabled = false;
  $('rvPanelSave').textContent = 'Lưu thay đổi';
  $('rvPanelCancel').textContent = 'Huỷ';
  $('rvPanelNormalize').disabled = false;
  $('rvPanel').classList.add('open');
  $('rvBackdrop').classList.add('open');
  $('rvPanelEditor').focus();
}

function rvOpenCreatePanel() {
  const features = state?.features ?? [];
  const target = $('rvPanelTargetFile');
  target.replaceChildren(
    ...features.map((feature) => el('option', { value: feature.name, textContent: feature.name })),
    el('option', { value: RV_NEW_FEATURE, textContent: '＋ Feature mới…' }),
  );
  // A project with no feature file at all has to start somewhere, so the new
  // file is the only thing to offer it.
  const filename = features.length === 0
    ? RV_NEW_FEATURE
    : rvFilterFile && features.some((feature) => feature.name === rvFilterFile)
      ? rvFilterFile
      : features[0].name;
  target.value = filename;
  $('rvPanelNewFile').value = '';
  rvEditing = { mode: 'create', filename: filename === RV_NEW_FEATURE ? '' : filename };
  rvSyncNewFileRow();
  $('rvPanelTitle').textContent = 'Thêm kịch bản';
  $('rvPanelFile').hidden = true;
  $('rvPanelTarget').hidden = false;
  $('rvPanelEditor').value = rvFormatGherkin([
    'Scenario: Nhập tên kịch bản',
    '  Given I open the app',
  ].join('\n'));
  $('rvEditorTagInput').value = '';
  rvSyncEditorTagsFromText();
  $('rvPanelStatus').textContent = '';
  $('rvActionProposals').replaceChildren();
  $('rvActionProposals').hidden = true;
  $('rvPanelSave').disabled = false;
  $('rvPanelSave').textContent = 'Thêm kịch bản';
  $('rvPanelCancel').textContent = 'Huỷ';
  $('rvPanelNormalize').disabled = false;
  $('rvPanel').classList.add('open');
  $('rvBackdrop').classList.add('open');
  const editor = $('rvPanelEditor');
  editor.focus();
  const title = 'Nhập tên kịch bản';
  const start = editor.value.indexOf(title);
  if (start >= 0) editor.setSelectionRange(start, start + title.length);
}

/**
 * The cheat sheet beside the editor.
 *
 * New authors do not know the controlled vocabulary, and a step outside it
 * fails at bind time with an error that reads like a parser complaint. Showing
 * the accepted forms — plus the macros and elements this project already has —
 * turns that into something answerable before saving.
 */
async function rvToggleSyntax() {
  const box = $('rvSyntax');
  const toggle = $('rvSyntaxToggle');
  const opening = box.hidden;
  box.hidden = !opening;
  toggle.setAttribute('aria-expanded', String(opening));
  if (!opening) return;

  // Show what we already have so opening is instant, then refresh. Caching for
  // the life of the page made the sheet lie: an element registered while
  // normalising a draft, or an action just approved, exists on the server the
  // moment it happens but stayed missing here until someone reloaded — and the
  // whole point of the sheet is to say what the project can do *now*.
  if (rvVocabulary) rvRenderSyntax();
  else {
    $('rvSyntaxBody').replaceChildren(
      el('div', { className: 'rv-syntax-empty', textContent: 'Đang tải…' }),
    );
  }

  try {
    rvVocabulary = await api('/api/vocabulary');
  } catch (err) {
    // A stale sheet still beats an empty one; only say so when there is nothing.
    if (!rvVocabulary) {
      $('rvSyntaxBody').replaceChildren(
        el('div', { className: 'rv-syntax-empty', textContent: `Không tải được hướng dẫn: ${err.message}` }),
      );
    }
    return;
  }
  rvRenderSyntax();
}

function rvRenderSyntax() {
  const body = $('rvSyntaxBody');
  if (!rvVocabulary) return;
  const query = rvSyntaxQuery.trim().toLocaleLowerCase();
  const hit = (...fields) => !query || fields.some((f) => (f ?? '').toLocaleLowerCase().includes(query));
  const sections = [];

  // Ordered by how often an author reaches for them, not by rule declaration
  // order — which would put "Khác" first purely because "I open the app" is
  // rule number one.
  const order = ['Thao tác', 'Nhập liệu', 'Di chuyển', 'Kiểm tra', 'Khác'];
  const groups = new Map(order.map((name) => [name, []]));
  for (const form of rvVocabulary.forms) {
    if (!hit(form.doc, form.hint, form.group)) continue;
    if (!groups.has(form.group)) groups.set(form.group, []);
    groups.get(form.group).push(form);
  }
  for (const [group, forms] of groups) {
    if (forms.length === 0) continue;
    sections.push(rvSyntaxSection(group, forms.map((form) =>
      rvSyntaxItem(rvPrettyDoc(form.doc), form.hint, rvFirstVariant(form.doc)))));
  }

  const actions = (rvVocabulary.actions ?? []).filter((a) => hit(a.phraseTemplate, a.label));
  if (actions.length > 0) {
    sections.push(rvSyntaxSection('Action đã duyệt của dự án', actions.map((action) =>
      rvSyntaxItem(action.phraseTemplate, action.label, rvActionExample(action)))));
  }

  // Elements are the long list, so they are capped rather than paged: anyone
  // hunting for a specific one types into the search box.
  const elements = (rvVocabulary.elements ?? []).filter((e) => hit(e.label, e.id, e.screen));
  if (elements.length > 0) {
    const shown = elements.slice(0, 30);
    const items = shown.map((element) =>
      rvSyntaxItem(`"${element.label}"`, `${element.screen} · ${element.id}`, `"${element.label}"`));
    if (elements.length > shown.length) {
      items.push(el('div', {
        className: 'rv-syntax-more',
        textContent: `… còn ${elements.length - shown.length} element nữa, gõ để tìm.`,
      }));
    }
    sections.push(rvSyntaxSection('Element đã có trên hệ thống', items));
  }

  body.replaceChildren(...(sections.length > 0
    ? sections
    : [el('div', { className: 'rv-syntax-empty', textContent: 'Không có mục nào khớp.' })]));
}

function rvSyntaxSection(title, children) {
  return el('div', {}, [
    el('div', { className: 'rv-syntax-group-title', textContent: title }),
    ...children,
  ]);
}

function rvSyntaxItem(code, desc, insert) {
  const node = el('button', { className: 'rv-syntax-item', type: 'button' }, [
    el('code', { textContent: code }),
    el('span', { className: 'rv-syntax-desc', textContent: desc }),
  ]);
  node.onclick = () => rvInsertSnippet(insert);
  return node;
}

/**
 * Spaces the alternation bars out for reading. Only the displayed copy is
 * touched: `doc` itself goes to the model verbatim, and "I swipe left|right"
 * is tighter there than four things that look like separate steps.
 */
function rvPrettyDoc(doc) {
  return doc.replace(/\s*\|\s*/g, ' | ');
}

/** `doc` may offer alternatives ("A | B"); inserting one of them is enough. */
function rvFirstVariant(doc) {
  return doc.split('|')[0].trim();
}

function rvActionExample(action) {
  let phrase = action.phraseTemplate;
  for (const param of action.parameters ?? []) {
    phrase = phrase.replaceAll(`{{${param.name}}}`, param.example ?? param.name);
  }
  return phrase;
}

/**
 * Inserts at the caret. A step goes on its own indented line; an element
 * reference is dropped inline, because that is what the author is in the middle
 * of typing when they reach for the element list.
 */
function rvInsertSnippet(snippet) {
  const editor = $('rvPanelEditor');
  const inline = snippet.startsWith('"');
  // An element reference replaces what is selected — that is the point of
  // selecting the "<element>" placeholder first. A whole step must not: the
  // create panel opens with the scenario title selected, and inserting a step
  // there would silently delete it.
  const caret = editor.selectionStart ?? editor.value.length;
  const start = inline ? caret : (editor.selectionEnd ?? caret);
  const end = inline ? (editor.selectionEnd ?? caret) : start;
  const before = editor.value.slice(0, start);
  const after = editor.value.slice(end);

  let text = snippet;
  if (!inline) {
    const atLineStart = before === '' || before.endsWith('\n');
    const blank = /(^|\n)[ \t]*$/.test(before);
    text = `${atLineStart || blank ? '' : '\n'}${blank && !atLineStart ? '' : '    '}And ${snippet}`;
    if (!after.startsWith('\n')) text += '\n';
  }

  editor.value = before + text + after;
  const nextCaret = start + text.length;
  editor.setSelectionRange(nextCaret, nextCaret);
  editor.focus();
  rvSyncEditorTagsFromText();
}

function rvClosePanel() {
  if (rvSaving) return;
  $('rvSyntax').hidden = true;
  $('rvSyntaxToggle').setAttribute('aria-expanded', 'false');
  rvEditing = null;
  rvEditorTags.clear();
  $('rvEditorTagInput').value = '';
  $('rvEditorTagSuggestions').hidden = true;
  $('rvPanel').classList.remove('open');
  $('rvBackdrop').classList.remove('open');
  $('rvScenarioPlan').replaceChildren();
  $('rvScenarioPlan').hidden = true;
  $('rvActionProposals').replaceChildren();
  $('rvActionProposals').hidden = true;
}

function rvSetSaving(active, title = '', detail = '') {
  rvSaving = active;
  const progress = $('rvSaveProgress');
  progress.hidden = !active;
  if (title) $('rvSaveProgressTitle').textContent = title;
  if (detail) $('rvSaveProgressDetail').textContent = detail;
  $('rvPanel').classList.toggle('is-saving', active);
  $('rvPanelClose').disabled = active;
  $('rvPanelCancel').disabled = active;
  $('rvPanelNormalize').disabled = active;
  $('rvPanelSave').disabled = active;
  $('rvEditorTagInput').disabled = active;
  $('rvPanelEditor').readOnly = active;
  $('rvPanelTargetFile').disabled = active;
  $('rvPanelNewFile').disabled = active;
}

function rvUpdateSaveProgress(title, detail) {
  $('rvSaveProgressTitle').textContent = title;
  $('rvSaveProgressDetail').textContent = detail;
}

async function rvSavePanel() {
  if (!rvEditing || rvSaving) return;
  rvCommitPendingEditorTag(false);
  const { mode, scenarioName } = rvEditing;
  const status0 = $('rvPanelStatus');
  const creatingFile = mode === 'create' && $('rvPanelTargetFile').value === RV_NEW_FEATURE;
  if (creatingFile && !rvEditing.filename) {
    setStatus(status0, $('rvPanelNewFileHint').textContent, false);
    return;
  }
  const filename = rvEditing.filename;
  rvSetSaving(
    true,
    'Đang chuẩn hoá kịch bản…',
    'Kiểm tra cú pháp, action và các element cần Playwright khám phá.',
  );
  const normalized = await rvNormalizePanel({ quiet: true });
  if (!normalized?.valid) {
    rvSetSaving(false);
    $('rvPanelSave').disabled = true;
    return;
  }
  const newBlock = $('rvPanelEditor').value.trim();
  // A brand new file needs its Feature header and Background; appending a bare
  // scenario to an empty string produces a file Gherkin cannot parse.
  const content = creatingFile
    ? rvNewFeatureContent(rvEditing.newFeatureTitle)
    : rvDrafts.get(filename) ?? '';
  const parsed = rvParseContent(newBlock);
  const status = $('rvPanelStatus');
  if (parsed.length !== 1) {
    rvSetSaving(false);
    setStatus(status, 'Mỗi lần chỉ thêm hoặc sửa một kịch bản.', false);
    return;
  }
  const nextName = parsed[0].name.trim();
  if (!nextName || (mode === 'create' && nextName === 'Nhập tên kịch bản')) {
    rvSetSaving(false);
    setStatus(status, 'Hãy nhập tên kịch bản cụ thể trước khi lưu.', false);
    return;
  }
  const duplicate = rvParseContent(content).some((scenario) =>
    scenario.name.toLocaleLowerCase() === nextName.toLocaleLowerCase()
      && !(mode === 'edit' && scenario.name === scenarioName)
  );
  if (duplicate) {
    rvSetSaving(false);
    setStatus(status, `Feature này đã có kịch bản “${nextName}”.`, false);
    return;
  }
  // Re-indent the block, never the rest of the file. `newBlock` arrives
  // trimmed, which strips the two spaces in front of its own `Scenario:` line
  // and left an appended scenario at column zero with its steps at four.
  // Formatting the whole file instead would also indent a feature-level tag
  // sitting at column 0 — rewriting lines the author never touched.
  const block = rvFormatGherkin(newBlock);
  const updated = mode === 'create'
    ? rvAppendScenario(content, block)
    : rvReplaceScenario(content, scenarioName, block);
  rvDrafts.set(filename, updated);

  rvUpdateSaveProgress(
    'Đang lưu kịch bản…',
    'Chuẩn hoá tags, cập nhật trạng thái duyệt và đồng bộ Page Object.',
  );
  try {
    const saved = await api('/api/feature', 'PUT', {
      filename,
      content: updated,
      ...(creatingFile ? { create: true } : {}),
      ...(!creatingFile ? { baseRevision: rvBaseRevisions.get(filename) ?? '' } : {}),
    });
    const savedContent = saved.content ?? updated;
    rvDrafts.set(filename, savedContent);
    rvBaseContents.set(filename, savedContent);
    rvBaseRevisions.set(filename, saved.revision ?? '');
    const added = Object.values(saved.pom?.pageMethodsAdded ?? {}).flat().length;
    const created = saved.pom?.pagesCreated?.length ?? 0;
    const savedReview = (saved.review ?? []).find((item) => item.scenarioName === nextName);
    const tagNote = saved.tagsNormalized ? ' · Tags đã được chuẩn hoá' : '';
    const message = saved.pomWarning
      ? saved.pomWarning
      : savedReview?.status === 'pending'
        ? `Đã ${mode === 'create' ? 'thêm kịch bản' : 'lưu'} · Đang chờ duyệt trước khi chạy và vào POM${tagNote}.`
        : added || created
          ? `Đã lưu · POM thêm ${created} page và ${added} method mới${tagNote}.`
          : `Đã lưu · POM chỉ giữ các kịch bản đã duyệt${tagNote}.`;
    rvUpdateSaveProgress('Đã lưu. Đang tải lại danh sách…', 'Màn hình sẽ được giữ nguyên để bạn xem kết quả.');
    await refresh();
    rvSetSaving(false);
    $('rvPanelSave').disabled = true;
    $('rvPanelSave').textContent = '✓ Đã lưu';
    $('rvPanelCancel').textContent = 'Đóng';
    setStatus(status, message, !saved.pomWarning);
  } catch (e) {
    rvSetSaving(false);
    setStatus(status, e.message, false);
    $('rvPanelSave').disabled = false;
  }
}

async function rvNormalizePanel({ quiet = false } = {}) {
  rvCommitPendingEditorTag(false);
  const editor = $('rvPanelEditor');
  const button = $('rvPanelNormalize');
  const status = $('rvPanelStatus');
  const original = editor.value;
  button.disabled = true;
  if (!quiet) setStatus(status, 'Đang chuẩn hoá…', null);
  try {
    const result = await api('/api/feature/normalize', 'POST', { content: original });
    editor.value = rvFormatGherkin(result.content);
    rvSyncEditorTagsFromText();
    rvRenderScenarioPlan(result.scenarioPlan);
    rvRenderActionProposals(result.actionProposals ?? []);
    if (!result.valid) {
      const proposalCount = result.actionProposals?.length ?? 0;
      setStatus(
        status,
        proposalCount
          ? `AI đã đề xuất ${proposalCount} action mới. Cần duyệt kế hoạch trước khi chạy.`
          : result.actionAnalysis?.reason
            ? `${result.actionAnalysis.reason} Action đã duyệt trước đó vẫn dùng được bình thường.`
          : rvNormalizationError(result.error),
        proposalCount ? null : false,
      );
      $('rvPanelSave').disabled = true;
      return result;
    }
    // A valid normalized draft is immediately saveable. This also recovers
    // from a stale disabled state left by an earlier editor session.
    if (!rvSaving) $('rvPanelSave').disabled = false;
    if (!quiet) {
      const count = result.changes?.length ?? 0;
      const source = result.usedAi ? ' bằng AI' : '';
      const pending = result.discoveredLater ?? [];
      const applied = result.appliedActions ?? [];
      const message = applied.length
        ? `Đã áp dụng ${applied.length} action dùng chung và mở rộng thành các bước có thể kiểm chứng.`
        : pending.length
        ? `Đã hiểu kịch bản. Playwright sẽ tự tìm ${pending.length} element mới khi chạy.`
        : count
          ? `Đã chuẩn hoá ${count} câu${source}.`
          : 'Kịch bản đã hợp lệ.';
      setStatus(status, message, true);
    }
    return result;
  } catch (e) {
    setStatus(status, e.message || 'Không thể chuẩn hoá kịch bản.', false);
    return { valid: false };
  } finally {
    button.disabled = rvSaving;
  }
}

function rvRenderScenarioPlan(plan) {
  const box = $('rvScenarioPlan');
  box.replaceChildren();
  if (!plan?.steps?.length) {
    box.hidden = true;
    return;
  }

  const kindLabels = {
    precondition: 'Điều kiện',
    navigation: 'Điều hướng',
    focusRegion: 'Vùng cần kiểm tra',
    action: 'Thao tác',
    assertion: 'Kết quả mong đợi',
  };
  const source = plan.source === 'ai' ? 'AI phân tích' : 'Phân tích cục bộ';
  const head = el('div', { className: 'rv-plan-head' }, [
    el('div', {}, [
      el('b', { textContent: 'AI hiểu kịch bản' }),
      el('span', { className: `rv-plan-source ${plan.source === 'ai' ? 'ai' : 'local'}`, textContent: source }),
    ]),
    el('button', { className: 'rv-plan-toggle', type: 'button', textContent: 'Thu gọn' }),
  ]);
  const body = el('div', { className: 'rv-plan-body' });
  const summary = el('div', { className: 'rv-plan-summary' }, [
    el('span', { className: 'rv-plan-summary-label', textContent: 'Mục tiêu' }),
    el('strong', { textContent: plan.goal || 'Kịch bản hiện tại' }),
  ]);
  if (plan.screen) summary.append(el('span', { className: 'rv-plan-screen', textContent: plan.screen }));
  body.append(summary);

  const reusable = [...new Set([...(plan.preconditions ?? []), ...(plan.reusableFlows ?? [])])];
  if (reusable.length) {
    body.append(el('div', { className: 'rv-plan-reuse' }, [
      el('span', { className: 'rv-plan-summary-label', textContent: 'Có thể tái sử dụng' }),
      el('div', { className: 'rv-plan-chips' }, reusable.map((item) =>
        el('span', { className: 'rv-plan-chip', textContent: item })
      )),
    ]));
  }

  const flow = el('ol', { className: 'rv-plan-flow' });
  for (const step of plan.steps) {
    const lowConfidence = Number(step.confidence) < 0.8;
    const details = [];
    if (step.scope && step.scope !== step.target) details.push(`trong “${step.scope}”`);
    if (step.expectedResult) details.push(step.expectedResult);
    const row = el('li', { className: `rv-plan-step${lowConfidence ? ' uncertain' : ''}` }, [
      el('span', { className: `rv-plan-kind ${step.kind}`, textContent: kindLabels[step.kind] ?? 'Bước' }),
      el('div', { className: 'rv-plan-step-copy' }, [
        el('strong', { textContent: step.target || step.action || `Dòng ${step.line}` }),
        ...(details.length ? [el('small', { textContent: details.join(' · ') })] : []),
        ...(lowConfidence ? [el('small', { className: 'rv-plan-warning', textContent: 'Cần người dùng kiểm tra lại cách hiểu này' })] : []),
      ]),
    ]);
    flow.append(row);
  }
  body.append(flow);

  for (const warning of plan.warnings ?? []) {
    body.append(el('p', { className: 'rv-plan-warning-line', textContent: warning }));
  }

  const toggle = head.querySelector('.rv-plan-toggle');
  toggle.onclick = () => {
    const collapsed = body.hidden = !body.hidden;
    toggle.textContent = collapsed ? 'Xem cách hiểu' : 'Thu gọn';
  };
  box.append(head, body);
  box.hidden = false;
}

function rvRenderActionProposals(proposals) {
  const box = $('rvActionProposals');
  box.replaceChildren();
  box.hidden = proposals.length === 0;
  for (const action of proposals) {
    const executable = action.kind !== 'primitive';
    const steps = [...(action.expansion ?? [])];
    if (action.postcondition && !steps.includes(action.postcondition)) steps.push(action.postcondition);
    const plan = el('ol', { className: 'rv-action-plan' }, steps.map((step) => el('li', { textContent: step })));
    const approve = el('button', {
      className: 'primary-btn narrow',
      type: 'button',
      textContent: executable ? 'Duyệt action' : 'Cần adapter',
      disabled: !executable,
      title: executable ? 'Cho phép tái sử dụng action này' : 'Driver chưa có capability để thực thi action này',
    });
    const reject = el('button', { className: 'ghost-btn danger narrow', type: 'button', textContent: 'Từ chối' });
    const state = el('span', { className: 'status' });
    approve.onclick = async () => {
      approve.disabled = true;
      reject.disabled = true;
      setStatus(state, 'Đang duyệt…', null);
      try {
        await api('/api/actions/review', 'POST', { id: action.id, decision: 'approve' });
        setStatus(state, 'Đã duyệt. Đang áp dụng…', true);
        await rvNormalizePanel({ quiet: true });
      } catch (error) {
        setStatus(state, error.message, false);
        approve.disabled = !executable;
        reject.disabled = false;
      }
    };
    reject.onclick = async () => {
      approve.disabled = true;
      reject.disabled = true;
      try {
        await api('/api/actions/review', 'POST', { id: action.id, decision: 'reject' });
        card.remove();
        if (!box.children.length) box.hidden = true;
        setStatus($('rvPanelStatus'), 'Đã từ chối action. Câu gốc vẫn chưa thể chạy.', false);
      } catch (error) {
        setStatus(state, error.message, false);
        approve.disabled = !executable;
        reject.disabled = false;
      }
    };
    const card = el('article', { className: 'rv-action-card' }, [
      el('div', { className: 'rv-action-head' }, [
        el('div', {}, [
          el('strong', { textContent: action.label }),
          el('span', { className: `rv-action-kind ${action.kind}`, textContent: action.kind === 'macro' ? 'Macro' : action.kind === 'alias' ? 'Alias' : 'Capability mới' }),
        ]),
        el('code', { textContent: action.phraseTemplate }),
      ]),
      action.reason ? el('p', { className: 'rv-action-reason', textContent: action.reason }) : null,
      el('div', { className: 'rv-action-plan-title', textContent: executable ? 'Kế hoạch thực thi và kiểm chứng' : 'Chưa có adapter an toàn để thực thi' }),
      plan,
      el('div', { className: 'rv-action-controls' }, [approve, reject, state]),
    ].filter(Boolean));
    box.append(card);
  }
}

function rvNormalizationError(error) {
  const unknown = String(error || '').match(/Unknown element "([^"]+)"/i);
  if (unknown) {
    return `Hệ thống chưa tạo được ý định element “${unknown[1]}”. Hãy bấm Chuẩn hoá lại; Playwright sẽ tự tìm element khi chạy.`;
  }
  return `Chưa thể chuẩn hoá: ${error || 'kịch bản không hợp lệ.'}`;
}

function rvEditorKeydown(event) {
  const editor = event.currentTarget;
  // While an input method is composing — Telex/VNI for Vietnamese, or any CJK
  // IME — Enter is the key that commits the pending syllable, not a newline.
  // Swallowing it makes the IME commit after our insertion, which duplicates
  // the word being typed onto the new line. keyCode 229 covers the browsers
  // that do not set isComposing.
  if (event.isComposing || event.keyCode === 229) return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    rvSavePanel();
    return;
  }
  if (event.key === 'Tab') {
    event.preventDefault();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const lineStart = editor.value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    const lineEndAt = editor.value.indexOf('\n', end);
    const lineEnd = lineEndAt === -1 ? editor.value.length : lineEndAt;
    const block = editor.value.slice(lineStart, lineEnd);
    if (event.shiftKey) {
      const next = block.replace(/^ {1,2}/gm, '');
      const removedBeforeStart = block.slice(0, start - lineStart).length - next.slice(0, start - lineStart).length;
      const removed = block.length - next.length;
      editor.value = editor.value.slice(0, lineStart) + next + editor.value.slice(lineEnd);
      editor.selectionStart = Math.max(lineStart, start - removedBeforeStart);
      editor.selectionEnd = Math.max(editor.selectionStart, end - removed);
    } else {
      const next = block.replace(/^/gm, '  ');
      const addedBeforeStart = next.slice(0, start - lineStart + 2).length - block.slice(0, start - lineStart).length;
      const added = next.length - block.length;
      editor.value = editor.value.slice(0, lineStart) + next + editor.value.slice(lineEnd);
      editor.selectionStart = start + addedBeforeStart;
      editor.selectionEnd = end + added;
    }
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    const start = editor.selectionStart;
    const line = editor.value.slice(0, start).split('\n').pop() ?? '';
    const text = line.trim();
    let indent = line.match(/^\s*/)?.[0] ?? '';
    // A scenario header and a tag open the step body, so the next line starts
    // at the normal four-space Gherkin level instead of inheriting two spaces.
    if (text.startsWith('@') || /^Scenario(?: Outline)?:/i.test(text)) indent = '    ';
    if (/^Examples:/i.test(text)) indent = '      ';
    editor.setRangeText(`\n${indent}`, start, editor.selectionEnd, 'end');
  }
}

function rvFormatGherkin(source) {
  return source.replace(/\r\n/g, '\n').split('\n').map((line) => {
    const text = line.trimEnd().trimStart();
    if (!text) return '';
    if (text.startsWith('@') || /^Scenario(?: Outline)?:/i.test(text)) return `  ${text}`;
    if (/^(?:Given|When|Then|And|But)\b|^Examples:/i.test(text)) return `    ${text}`;
    if (text.startsWith('|')) return `      ${text}`;
    return line.trimEnd();
  }).join('\n');
}

/* ── Gherkin helpers ──────────────────────────────────────────────── */

function rvParseContent(content) {
  const lines = content.split('\n');
  const scenarios = [];
  let current = null;
  let pendingTags = [];
  let featureTags = [];
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('@')) { pendingTags.push(...t.split(/\s+/).filter(x => x.startsWith('@'))); continue; }
    if (/^Feature:/.test(t)) {
      featureTags = [...new Set(pendingTags.map(rvNormalizeTag).filter((tag) =>
        tag && (tag.startsWith('@feature-') || ['@web', '@android', '@ios'].includes(tag))
      ))];
      pendingTags = [];
      continue;
    }
    const m = t.match(/^Scenario(?:\s+Outline)?:\s*(.+)$/);
    if (m) {
      if (current) scenarios.push(current);
      current = {
        name: m[1].trim(),
        tags: [...new Set([...featureTags, ...pendingTags].map(rvNormalizeTag).filter(Boolean))],
        steps: [],
      };
      pendingTags = [];
      continue;
    }
    if (/^Background:/.test(t)) { pendingTags = []; continue; }
    const sm = t.match(/^(Given|When|Then|And|But)\s+(.+)$/);
    if (sm && current) current.steps.push(`${sm[1]} ${sm[2]}`);
  }
  if (current) scenarios.push(current);
  return scenarios;
}

function rvFindScenarioBounds(lines, scenarioName) {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].trim().match(/^Scenario(?:\s+Outline)?:\s*(.+)$/);
    if (!m || m[1].trim() !== scenarioName.trim()) continue;
    // walk back for @tags
    let start = i;
    while (start > 0 && lines[start - 1].trim().startsWith('@')) start--;
    // walk forward for steps
    let end = i + 1;
    while (end < lines.length) {
      const t = lines[end].trim();
      if (/^Scenario(?:\s+Outline)?:|^Feature:|^Background:/.test(t)) break;
      if (t.startsWith('@')) {
        let peek = end + 1;
        while (peek < lines.length && lines[peek].trim().startsWith('@')) peek++;
        if (peek < lines.length && /^Scenario(?:\s+Outline)?:/.test(lines[peek].trim())) break;
      }
      end++;
    }
    return { start, end };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Device picker — only when a platform declares more than a name       */
/* ------------------------------------------------------------------ */

/**
 * Every mobile device the config can address, across both platforms.
 *
 * A platform with no `devices` list still has exactly one addressable device —
 * the one `deviceName` describes — and it is offered here under its platform's
 * name, matching what `devicesOf()` synthesises on the CLI side. That is what
 * makes the ordinary "one Android and one iPhone" run selectable without
 * anyone having to write a devices list first.
 */
function mobileTargets() {
  return ['android', 'ios'].flatMap((platform) => {
    const section = state?.config?.[platform];
    if (!section) return [];
    const listed = section.devices ?? [];
    if (listed.length > 0) {
      return listed.map((d) => ({ platform, id: d.id, deviceName: d.deviceName, named: true, spec: d }));
    }
    return [{ platform, id: platform, deviceName: section.deviceName, named: false, spec: section }];
  });
}

// A function declaration, not a const arrow: renderDevicePicker() runs while
// init() wires the runner, which is before this module finishes evaluating, so
// anything it reaches for has to be hoisted rather than still in its temporal
// dead zone. Same trap that `selectedDevices` had to be moved out of.
function targetToken(t) {
  return `${t.platform}:${t.id}`;
}

/**
 * The build each platform installs on a real device.
 *
 * Two fields rather than one, because a cross-platform run installs a `.apk` on
 * the phone and a `.ipa` on the iPhone in the same click — a single "app build"
 * box cannot describe that, and overwriting one with the other is how the farm
 * form ends up forgetting a build every time the platform changes.
 *
 * Empty is a real answer, not an unfinished one: when the app is already
 * installed the driver launches it by `appPackage` / `bundleId` and reinstalling
 * would only throw away its login session.
 */
/* ------------------------------------------------------------------ */
/* Bản build                                                           */
/* ------------------------------------------------------------------ */

/**
 * The one place an app build is uploaded.
 *
 * A build used to be uploaded from three screens into three config slots, so a
 * new release meant repeating the same upload until they agreed. One row per
 * environment, two packages each, and everything that installs an app — local
 * runs, workflows, Device Farm — reads what this page wrote.
 */
let buildsInventory = null;

async function loadBuilds() {
  const table = $('buildsTable');
  table.replaceChildren(el('p', { className: 'hint', textContent: 'Đang đọc…' }));
  try {
    buildsInventory = await api('/api/builds');
  } catch (e) {
    table.replaceChildren(el('p', { className: 'err', textContent: e.message }));
    return;
  }
  renderBuilds();
}

function renderBuilds() {
  const inv = buildsInventory;
  $('buildsRoot').textContent =
    `Bản build dùng cho local run, workflow và Device Farm. File cất ở ${inv.root}`;

  const table = el('table', { className: 'grid builds-grid' });
  table.append(el('thead', {}, el('tr', {}, [
    el('th', { textContent: 'Môi trường' }),
    el('th', { textContent: 'Android (.apk)' }),
    el('th', { textContent: 'iOS (.ipa)' }),
  ])));
  const body = el('tbody');
  for (const row of inv.environments) body.append(buildRow(row));
  table.append(body);
  $('buildsTable').replaceChildren(table);
}

function buildRow(row) {
  const tr = el('tr');
  const name = el('td');
  name.append(el('b', { textContent: (row.env || 'Dùng chung').toUpperCase() }));
  if (row.isDefault && row.env) {
    name.append(el('span', { className: 'build-default', textContent: 'mặc định' }));
  }
  tr.append(name);
  for (const platform of ['android', 'ios']) tr.append(buildCell(row, platform));
  return tr;
}

function buildCell(row, platform) {
  const td = el('td', { className: 'build-cell' });
  const build = row[platform];
  const missing = row.missing.find((m) => m.platform === platform);

  if (build) {
    td.append(el('span', { className: 'mono', textContent: build.path }));
    td.append(el('span', { className: 'faint', textContent: `${build.sizeMb} MB` }));
  } else if (missing) {
    // Said out loud rather than shown as empty: Appium fails on a path that is
    // not there minutes into a run, long after the typo that caused it.
    td.append(el('span', { className: 'build-missing', textContent: `✕ ${missing.path} — không thấy file` }));
  } else {
    td.append(el('span', { className: 'faint', textContent: 'Chưa có' }));
  }

  const pick = el('button', {
    className: 'ghost-btn narrow', type: 'button',
    textContent: build || missing ? 'Thay bản khác…' : 'Tải lên…',
  });
  const input = el('input', { type: 'file', hidden: true, accept: platform === 'ios' ? '.ipa' : '.apk' });
  const bar = el('progress', { max: 100, value: 0, className: 'app-progress', hidden: true });
  const note = el('span', { className: 'app-path-state' });

  pick.onclick = () => input.click();
  input.onchange = async () => {
    const chosen = input.files?.[0];
    // Chosen then cancelled leaves no file; clearing lets the same file be
    // picked again after a failed attempt.
    input.value = '';
    if (!chosen) return;
    pick.disabled = true;
    try {
      await uploadBuildTo(row, platform, chosen, bar, note);
      await loadBuilds();
      // Every other card reads the same store, so tell them it moved.
      await refresh();
    } catch {
      // uploadBuildTo already wrote the reason into `note`.
    } finally {
      pick.disabled = false;
    }
  };
  td.append(el('div', { className: 'build-actions' }, [pick, input]), bar, note);
  return td;
}

function uploadBuildTo(row, platform, file, bar, note) {
  // The default environment's build is the base config's, so it uploads with no
  // `env` and lands in the shared slot. `persist=1` says this page has no form
  // to save — unlike the environments editor, an upload here is finished when
  // it finishes.
  const env = row.isDefault ? '' : row.env;
  const query = `platform=${platform}&persist=1`
    + (env ? `&env=${encodeURIComponent(env)}` : '')
    + `&filename=${encodeURIComponent(file.name)}`;
  bar.hidden = false;
  bar.value = 0;
  note.className = 'app-path-state empty';
  note.textContent = `Đang tải ${file.name}…`;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/app/upload?${query}`);
    // XHR rather than fetch purely for onprogress: a 200MB ipa is long enough
    // that silence reads as a hang.
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) bar.value = (event.loaded / event.total) * 100;
    };
    xhr.onerror = () => {
      bar.hidden = true;
      note.className = 'app-path-state missing';
      note.textContent = 'Tải lên thất bại — mất kết nối tới server.';
      reject(new Error('network'));
    };
    xhr.onload = () => {
      bar.hidden = true;
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* handled below */ }
      if (xhr.status !== 200) {
        note.className = 'app-path-state missing';
        note.textContent = body.error ?? `Tải lên thất bại (HTTP ${xhr.status}).`;
        reject(new Error(note.textContent));
        return;
      }
      note.className = 'app-path-state ok';
      note.textContent = '✓ Đã lưu';
      resolve(body);
    };
    xhr.send(file);
  });
}

function renderAppPaths() {
  const field = $('appField');
  // Web installs nothing; every other platform drives a device that may need a
  // build pushed to it, including the one only reached by ticking it above.
  field.hidden = $('platform').value === 'web' && selectedDevices.size === 0;
  if (field.hidden) return;

  // Reports what will be installed, seconds before someone presses run. It does
  // not edit: builds are uploaded on one screen, and a second field writing the
  // same config value is how the two drift apart.
  const env = $('envField').hidden ? '' : $('runEnv').value;
  $('appFieldHint').textContent = env
    ? `Bản build của môi trường "${env}".`
    : 'Bản build sẽ cài lên máy. Trống nghĩa là app phải có sẵn trên máy.';

  for (const platform of ['android', 'ios']) {
    const build = env
      ? state?.envBuilds?.[env]?.[platform]
      : state?.appBuilds?.[platform];
    $(platform + 'App').textContent = (env ? build?.path : state?.config?.[platform]?.app) ?? '';

    const note = $(platform + 'AppState');
    const inherited = Boolean(env) && env !== state?.config?.defaultEnv && build && !build.own;
    if (inherited) {
      // The file exists and would install cleanly — that is the danger. Every
      // environment of this app shares one bundle id, so installing the default
      // environment's package here means logging into it with this
      // environment's account. The runner blocks it; say so before the click.
      note.className = 'app-path-state missing';
      note.textContent =
        `✕ Chưa có build riêng cho "${env}" — đang trỏ về ${build.path} của ` +
        `"${state?.config?.defaultEnv}". Chạy sẽ bị chặn; tải build lên ở màn hình Bản build.`;
    } else if (!build) {
      note.className = 'app-path-state empty';
      note.textContent = env
        ? `Môi trường "${env}" chưa đặt build — app phải cài sẵn trên máy.`
        : 'Chưa đặt — app phải cài sẵn trên máy.';
    } else if (build.exists) {
      note.className = 'app-path-state ok';
      note.textContent = `✓ Có file${build.sizeMb ? ` · ${build.sizeMb} MB` : ''}`;
    } else {
      note.className = 'app-path-state missing';
      note.textContent = `✕ Không tìm thấy ${build.path}`;
    }
  }
}

/**
 * Sends a build from the user's machine to the local server.
 *
 * A browser never reveals a real filesystem path, and asking someone to type
 * one is asking them to know where the project lives — so the file itself is
 * uploaded and the server decides the path. XHR rather than fetch purely for
 * `upload.onprogress`: a 200MB apk is long enough that silence reads as a hang.
 */
/**
 * Uploads a build for one environment.
 *
 * Same endpoint as the base-config uploader, with `env` set — which parks the
 * file under `build/<env>/` and, unlike the base case, leaves the config alone.
 * The environments editor is an unsaved form; writing half of it from an upload
 * would save edits nobody asked to save.
 */
function uploadEnvBuild(env, platform, file, bar, note) {
  const query =
    `platform=${platform}&env=${encodeURIComponent(env)}&filename=${encodeURIComponent(file.name)}`;
  bar.hidden = false;
  bar.value = 0;
  note.className = 'app-path-state empty';
  note.textContent = `Đang tải ${file.name} lên…`;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/app/upload?${query}`);
    // XHR rather than fetch purely for onprogress: a 100MB ipa is long enough
    // that silence reads as a hang.
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) bar.value = (event.loaded / event.total) * 100;
    };
    xhr.onerror = () => {
      bar.hidden = true;
      note.className = 'app-path-state missing';
      note.textContent = 'Tải lên thất bại — mất kết nối tới server.';
      reject(new Error('network'));
    };
    xhr.onload = () => {
      bar.hidden = true;
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* handled below */ }
      if (xhr.status !== 200) {
        note.className = 'app-path-state missing';
        note.textContent = body.error ?? `Tải lên thất bại (HTTP ${xhr.status}).`;
        reject(new Error(note.textContent));
        return;
      }
      resolve(body);
    };
    xhr.send(file);
  });
}

/**
 * Asks the machine which devices are attached, then ticks them.
 *
 * Shared by the button inside the picker and by the prerequisite checklist
 * lower down, so the two can never disagree about what "attached" means. The
 * checklist prints the full diagnostic — model, Android version, unauthorised
 * state; the picker only needs the one-line result, because the answer it cares
 * about is already visible as ticks on the chips beside it.
 */
async function detectDevices(platform) {
  if (platform === 'android') {
    const r = await api('/api/prereq/adb');
    const devices = r.devices ?? [];
    return { devices, ...selectAttached('android', devices.filter((d) => d.state === 'device').map((d) => d.id)) };
  }
  const r = await fetch('/api/prereq/ios-devices').then((res) => res.json());
  const lines = r.devices ?? [];
  // The server decides what "attached" means. Reading it off the printed lines
  // here counted offline phones and simulators as plugged in.
  return { lines, ...selectAttached('ios', r.attached ?? []) };
}

/**
 * Ticks the devices that are actually plugged in, after a device check.
 *
 * With a couple of phones you know which is which. With thirty, the picker is a
 * wall of near-identical names and the only thing that tells them apart is a
 * serial nobody has memorised — so the machine that just answered `adb devices`
 * should be the one that gets ticked, not the one you guessed.
 *
 * Replaces the selection rather than adding to it: a device that is not
 * attached cannot run anyway — run-parallel skips it — so keeping it ticked
 * would only promise a run that will not happen.
 *
 * Returns what it could not do, for the caller to report.
 */
function selectAttached(platform, udids) {
  attachedUdids = new Set([...attachedUdids].filter((u) => !isOfPlatform(u, platform)));
  for (const u of udids) attachedUdids.add(u);

  const targets = mobileTargets().filter((t) => t.platform === platform);
  const known = new Map(targets.map((t) => [t.spec.udid, t]));

  for (const t of targets) selectedDevices.delete(targetToken(t));
  let picked = 0;
  for (const u of udids) {
    const t = known.get(u);
    if (!t) continue;
    selectedDevices.add(targetToken(t));
    picked += 1;
  }
  // State only — the caller decides how much of the picker to redraw. Forcing a
  // full rebuild here wiped the search box mid-typing and threw away the result
  // line the caller was about to write into.
  return { picked, unknown: udids.filter((u) => !known.has(u)) };
}

/** Whether a remembered udid belongs to this platform's configured devices. */
function isOfPlatform(udid, platform) {
  return mobileTargets().some((t) => t.platform === platform && t.spec.udid === udid);
}

/**
 * The environment picker on the run card.
 *
 * Hidden entirely when the config defines no environments — which is every
 * config that has not opted in, and which must keep looking exactly as it did.
 *
 * The hint underneath is the point of the control. Because this app ships SIT,
 * UAT and prod under one bundle id and one version, nothing on the handset says
 * which one is installed; the only way to know is what TestPilot wrote down the
 * last time it installed something. Saying so before the run beats discovering
 * it from a login failure.
 */
function renderRunEnv() {
  const field = $('envField');
  const select = $('runEnv');
  const envs = Object.keys(state?.config?.environments ?? {});
  if (envs.length === 0) {
    field.hidden = true;
    select.replaceChildren();
    return;
  }
  field.hidden = false;

  const keep = select.value;
  select.replaceChildren();
  for (const name of envs) select.append(el('option', { value: name, textContent: name }));
  select.value = envs.includes(keep) ? keep : (state.config.defaultEnv ?? envs[0]);
  select.onchange = () => { renderRunEnvHint(); renderAppPaths(); };
  renderRunEnvHint();
}

function renderRunEnvHint() {
  const hint = $('envHint');
  const env = $('runEnv').value;
  const plat = $('platform').value;
  if (plat === 'web') {
    hint.textContent = 'Web đổi môi trường bằng baseUrl — không phải cài lại app.';
    return;
  }

  // Which handsets this run could touch: the ticked ones, or every device of
  // the platform when nothing is ticked.
  const targets = mobileTargets().filter((t) =>
    selectedDevices.size > 0 ? selectedDevices.has(targetToken(t)) : t.platform === plat,
  );
  const recorded = state?.deviceEnv ?? {};
  const stale = targets.filter((t) => t.spec.udid && recorded[t.spec.udid]?.env !== env);
  const unknown = stale.filter((t) => !recorded[t.spec.udid]);

  if (targets.length === 0) {
    hint.textContent = '';
  } else if (stale.length === 0) {
    hint.textContent = `Máy đã cài bản "${env}" — chạy luôn, không cài lại.`;
  } else {
    const names = stale.map((t) => t.spec.deviceName).join(', ');
    const isDefault = env === state?.config?.defaultEnv;
    hint.textContent =
      unknown.length < stale.length
        ? `${names} đang cài bản khác — sẽ cài lại app "${env}" trước khi chạy.`
        : isDefault
          // Unknown plus the default environment: almost always a handset that
          // has been running this build all along. Say it plainly, not as an
          // alarm — wiping its data to be sure would cost more than it saves.
          ? `Chưa ghi nhận ${names} cài bản nào; chạy trên app sẵn có, không cài lại.`
          : `Chưa ghi nhận ${names} cài bản nào — sẽ cài app "${env}" trước khi chạy.`;
  }
}

/**
 * The list of devices to run on, and hidden entirely when there is nothing to pick.
 *
 *
 * Ticks are the explicit targets and may span both platforms; the Platform
 * select above is what runs when nothing is ticked. Selections are stored
 * qualified as `platform:id` so an id that exists on both platforms — `main` on
 * a phone and on an iPhone — can never be mistaken for the other one.
 *
 * Hidden for web, which shards by browser rather than by device, and hidden
 * when the whole config describes a single machine: for those the runner must
 * look and behave exactly as it did, with no new control at all.
 */
function renderDevicePicker() {
  const field = $('deviceField');
  const picker = $('devicePicker');
  const targets = mobileTargets();
  const onWeb = $('platform').value === 'web';

  // A config edited between runs can drop a device that is still ticked.
  const valid = new Set(targets.map(targetToken));
  selectedDevices = new Set([...selectedDevices].filter((token) => valid.has(token)));

  if (onWeb || targets.length < 2) {
    field.hidden = true;
    picker.replaceChildren();
    selectedDevices.clear();
    $('deviceHint').textContent = '';
    return;
  }
  field.hidden = false;

  const groups = ['android', 'ios']
    .map((platform) => [platform, targets.filter((t) => t.platform === platform)])
    .filter(([, list]) => list.length > 0);

  // A lab with thirty phones renders thirty chips. Unbounded, that pushes the
  // Run button off the screen and turns picking two devices into a scroll hunt,
  // so the list is filtered, capped and scrolled inside its own box.
  const search = el('input', {
    className: 'device-search', type: 'search', value: deviceQuery,
    placeholder: 'Tìm theo tên, id hoặc udid…', autocomplete: 'off',
    'aria-label': 'Tìm thiết bị',
  });
  const bulk = el('button', { className: 'ghost-btn narrow device-bulk', type: 'button' });
  // The control sits with the thing it changes. It used to live only in the
  // checklist further down the page, so pressing it made ticks appear in a
  // section the reader was not looking at.
  const detect = el('button', {
    className: 'ghost-btn narrow device-detect', type: 'button',
    textContent: '⟳ Máy đang cắm',
    title: 'Dò thiết bị đang kết nối và tự chọn',
  });
  const detectNote = el('span', { className: 'device-detect-note' });
  const list = el('div', { className: 'device-list' });

  picker.replaceChildren(
    el('div', { className: 'device-tools' }, [search, bulk, detect, detectNote]),
    list,
  );

  /**
   * Redraws only what a selection or a filter can change.
   *
   * Rebuilding the whole picker replaced the search box with a fresh one on
   * every keystroke, so the caret was destroyed after the first character and
   * the field could only ever hold one letter. The input is built once and left
   * alone; everything downstream of it is what gets painted.
   */
  const paint = () => {
    const want = deviceQuery.trim().toLocaleLowerCase();
    const matches = (t) => !want || [t.id, t.deviceName, t.spec.udid]
      .some((v) => String(v ?? '').toLocaleLowerCase().includes(want));

    const shown = targets.filter(matches);
    const allShownPicked = shown.length > 0 && shown.every((t) => selectedDevices.has(targetToken(t)));
    bulk.textContent = allShownPicked ? 'Bỏ chọn' : `Chọn tất cả (${shown.length})`;
    bulk.onclick = () => {
      for (const t of shown) {
        const token = targetToken(t);
        if (allShownPicked) selectedDevices.delete(token);
        else selectedDevices.add(token);
      }
      paint();
    };

    const visibleGroups = groups
      .map(([platform, items]) => [platform, items.filter(matches)])
      .filter(([, items]) => items.length > 0);

    list.replaceChildren();
    if (visibleGroups.length === 0) {
      list.append(el('div', { className: 'device-empty', textContent: 'Không có thiết bị nào khớp.' }));
    }
    list.append(...visibleGroups.map(([platform, items]) => {
      const group = el('div', { className: 'device-group' });
      group.append(el('span', { className: 'device-group-label', textContent: platform }));
      for (const target of items) {
        const token = targetToken(target);
        const chip = el('button', {
          className: 'device-chip' + (selectedDevices.has(token) ? ' active' : ''),
          type: 'button',
          title: [target.spec.deviceName, target.spec.udid,
                  target.spec.systemPort ?? target.spec.wdaLocalPort]
            .filter(Boolean).join(' · '),
        });
        const attached = Boolean(target.spec.udid && attachedUdids.has(target.spec.udid));
        if (attached) chip.classList.add('attached');
        // One line, the id. The second line repeated the same model code in a
        // different case, and a friendlier name turned out to be whatever
        // someone had typed into the phone's settings — longer, not clearer.
        // Everything else about the device is a hover away, in the title.
        chip.append(el('span', { className: 'device-chip-id' }, [
          ...(attached ? [el('span', { className: 'device-dot', title: 'Đang cắm' })] : []),
          el('span', { textContent: target.named ? target.id : platform }),
        ]));
        chip.onclick = () => {
          if (selectedDevices.has(token)) selectedDevices.delete(token);
          else selectedDevices.add(token);
          paint();
        };
        group.append(chip);
      }
      return group;
    }));

    const chosen = [...selectedDevices];
    const platforms = new Set(chosen.map((token) => token.split(':')[0]));
    $('deviceHint').textContent =
      chosen.length === 0 ? `(chưa chọn — chạy ${$('platform').value} như bình thường)`
      : chosen.length === 1 ? '(1 máy — chạy tuần tự)'
      : platforms.size > 1
        ? `(${chosen.length} máy trên ${[...platforms].join(' + ')} — chạy song song)`
        : `(${chosen.length} máy — chạy song song, gộp kết quả sau khi xong)`;
    // Ticking a device changes which handsets the environment hint is about.
    if (!$('envField').hidden) renderRunEnvHint();
  };

  search.oninput = () => { deviceQuery = search.value; paint(); };

  detect.onclick = async () => {
    detect.disabled = true;
    detectNote.className = 'device-detect-note';
    detectNote.textContent = 'đang dò…';
    // Both platforms, because the button says "đang cắm" and a cable does not
    // care what the Platform select shows. Reading the select instead meant a
    // plugged-in Samsung went unnoticed while the select happened to say ios.
    const results = await Promise.allSettled([detectDevices('android'), detectDevices('ios')]);
    const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    if (ok.length === 0) {
      detectNote.classList.add('warn');
      detectNote.textContent = results[0]?.reason?.message ?? 'không dò được thiết bị.';
      detect.disabled = false;
      return;
    }
    const picked = ok.reduce((n, r) => n + r.picked, 0);
    const unknown = ok.flatMap((r) => r.unknown);
    paint();
    const parts = [picked > 0 ? `đã chọn ${picked} máy` : 'không thấy máy nào đang cắm'];
    if (unknown.length > 0) parts.push(`${unknown.length} máy chưa có trong config`);
    // One platform's tooling missing is not a reason to hide the other's answer.
    if (ok.length < results.length) parts.push('(một nền tảng không dò được)');
    detectNote.classList.add(picked > 0 ? 'ok' : 'warn');
    detectNote.textContent = parts.join(' · ');
    detect.disabled = false;
  };

  paint();
}

function rvExtractScenario(content, scenarioName) {
  const lines = content.split('\n');
  const bounds = rvFindScenarioBounds(lines, scenarioName);
  if (!bounds) return '';
  return lines.slice(bounds.start, bounds.end).join('\n').trim();
}

function rvRemoveScenario(content, scenarioName) {
  const lines = content.split('\n');
  const bounds = rvFindScenarioBounds(lines, scenarioName);
  if (!bounds) return content;
  // Also eat the blank line immediately before start
  let start = bounds.start;
  if (start > 0 && lines[start - 1].trim() === '') start--;
  const result = [...lines.slice(0, start), ...lines.slice(bounds.end)];
  while (result.length > 1 && result[result.length - 1].trim() === '' && result[result.length - 2].trim() === '') result.pop();
  return result.join('\n');
}

function rvReplaceScenario(content, scenarioName, newBlock) {
  const lines = content.split('\n');
  const bounds = rvFindScenarioBounds(lines, scenarioName);
  if (!bounds) return content;
  const newLines = newBlock.split('\n');
  const rest = lines.slice(bounds.end);
  // The replacement block arrives trimmed, so without this the scenario that
  // follows ends up welded to the last step of this one — a diff touching lines
  // nobody edited, on every save.
  if (rest.length > 0 && rest[0]?.trim()) newLines.push('');
  return [...lines.slice(0, bounds.start), ...newLines, ...rest].join('\n');
}

function rvAppendScenario(content, newBlock) {
  const base = content.trimEnd();
  // trimEnd, not trim: the block's own indentation is meaningful and has
  // already been normalised by the caller.
  return `${base}${base ? '\n\n' : ''}${newBlock.replace(/^\n+/, '').trimEnd()}\n`;
}

/* ------------------------------------------------------------------ */
/* E2E runner + reports                                                */
/* ------------------------------------------------------------------ */

/** Every tag used anywhere in the suite, sorted, deduplicated. */
function allSuiteTags() {
  const set = new Set();
  for (const f of (state?.features ?? [])) {
    for (const sc of (f.scenarios ?? [])) {
      for (const t of (sc.tags ?? [])) set.add(t);
    }
  }
  return [...set].sort();
}

/**
 * A tag multi-select backed by a hidden input.
 *
 * One implementation for two pickers that had drifted into two copies of the
 * same code. Both listed every tag in the suite with no search and no height
 * limit, which is fine at five tags and unusable at fifty: the panel simply
 * grew until it pushed the rest of the form off screen.
 *
 * The Scenario page had already solved this — search box, capped list, count —
 * so this follows that shape rather than inventing a third one.
 */
function mountTagPicker({ picker, hidden, box, placeholder, tags }) {
  const selected = new Set();
  let query = '';

  const sync = () => { hidden.value = [...selected].join(','); };

  function renderChips() {
    picker.replaceChildren();
    if (selected.size === 0) {
      picker.append(el('span', { className: 'tag-picker-placeholder', textContent: placeholder }));
      return;
    }
    for (const t of selected) {
      const remove = el('span', { className: 'tag-selected-remove', textContent: '×' });
      remove.onclick = (e) => { e.stopPropagation(); selected.delete(t); sync(); renderChips(); renderPanel(); };
      picker.append(el('span', { className: 'tag-selected' }, [el('span', { textContent: t }), remove]));
    }
  }

  function renderPanel() {
    const all = tags();
    const q = query.trim().toLowerCase().replace(/^@/, '');
    const shown = q ? all.filter((t) => t.toLowerCase().includes(q)) : all;

    box.replaceChildren();
    if (all.length === 0) {
      box.append(el('span', { className: 'tag-none', textContent: 'Chưa có tag nào trong feature files.' }));
      box.hidden = false;
      return;
    }

    // The search box only earns its space once the list is long enough to need
    // it; below that it is one more thing to look at.
    if (all.length > 8) {
      const search = el('input', {
        className: 'tag-search', type: 'search', placeholder: 'Tìm tag…',
        autocomplete: 'off', value: query,
      });
      search.oninput = () => { query = search.value; renderPanel(); search.focus(); };
      search.onmousedown = (e) => e.stopPropagation();
      box.append(search);
    }

    const list = el('div', { className: 'tag-pill-list' });
    for (const t of shown) {
      const pill = el('span', {
        className: 'tag-pill' + (selected.has(t) ? ' tag-pill-active' : ''),
        textContent: t,
      });
      pill.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (selected.has(t)) selected.delete(t); else selected.add(t);
        sync(); renderChips(); renderPanel();
      });
      list.append(pill);
    }
    if (shown.length === 0) {
      list.append(el('span', { className: 'tag-none', textContent: `Không có tag nào khớp "${query}".` }));
    }
    box.append(list);

    box.append(el('div', { className: 'tag-panel-foot' }, [
      el('span', { textContent: q ? `${shown.length}/${all.length} tag` : `${all.length} tag` }),
      ...(selected.size > 0 ? [(() => {
        const clear = el('button', { className: 'tag-clear', type: 'button', textContent: 'Bỏ chọn hết' });
        clear.onmousedown = (e) => e.preventDefault();
        clear.onclick = () => { selected.clear(); sync(); renderChips(); renderPanel(); };
        return clear;
      })()] : []),
    ]));
    box.hidden = false;
  }

  picker.setAttribute('tabindex', '0');
  picker.addEventListener('click', () => { renderPanel(); picker.focus(); });
  picker.addEventListener('blur', (e) => {
    if (!box.contains(e.relatedTarget)) box.hidden = true;
  });
  box.addEventListener('focusout', (e) => {
    if (!picker.contains(e.relatedTarget) && !box.contains(e.relatedTarget)) box.hidden = true;
  });

  renderChips();
  return { selected, refresh: () => { renderChips(); if (!box.hidden) renderPanel(); } };
}

function wireRunner() {
  // slowMo is meaningless headless, and headed is meaningless off-web, so the
  // controls appear only when they can actually do something.
  const syncHeaded = () => {
    const plat = $('platform').value;
    const web = plat === 'web';
    $('headed').disabled = !web;
    if (!web) $('headed').checked = false;
    $('slowMoField').hidden = !($('headed').checked && web);
    $('headedHint').hidden = web;
    $('prereqBlock').dataset.platform = plat;
  };
  $('platform').onchange = () => { syncHeaded(); renderDevicePicker(); renderRunEnv(); renderAppPaths(); };
  $('headed').onchange = syncHeaded;
  syncHeaded();
  renderDevicePicker();
  renderRunEnv();
  renderAppPaths();

  // One screen owns builds; this card links to it rather than being a second
  // way to change the same value.
  $('appManage').onclick = () => navigate('builds');

  mountTagPicker({
    picker: $('tagPicker'),
    hidden: $('tag'),
    box: $('tagSuggestions'),
    placeholder: 'Tất cả tag — bấm để lọc',
    tags: allSuiteTags,
  });

  // ── Prereq action buttons ──────────────────────────────────────────
  // Restart, not just start. An Appium wedged mid-chromedriver-download still
  // answers /status, so the start button correctly reports "already running"
  // and changes nothing — leaving a terminal as the only way out of a state
  // that is entirely normal to hit.
  $('btnAppiumRestart').onclick = async () => {
    const btn = $('btnAppiumRestart');
    const out = $('appiumOut');
    btn.disabled = true;
    btn.textContent = '⏳ Đang khởi động lại…';
    out.textContent = '';
    out.hidden = false;
    try {
      await streamInto('/api/prereq/appium/restart', out, null);
      btn.textContent = '↻ Khởi động lại';
    } catch (e) {
      if (!e.printed) append(out, '❌ ' + e.message, true);
      btn.textContent = '↻ Thử lại';
    } finally {
      btn.disabled = false;
    }
  };

  $('btnAppium').onclick = async () => {
    const btn = $('btnAppium');
    const out = $('appiumOut');
    btn.disabled = true;
    btn.textContent = '⏳ Đang khởi động…';
    out.dataset.state = 'starting';
    out.classList.remove('success', 'failure', 'warning');
    out.textContent = '';
    out.hidden = false;
    try {
      await streamInto('/api/prereq/appium', out, null);
      btn.textContent = '✓ Đang chạy';
      btn.style.color = '#1a7f45';
      out.dataset.state = 'running';
      out.classList.add('success');
      out.textContent = '✓ Appium đang hoạt động và sẵn sàng nhận test.';
    } catch (e) {
      btn.textContent = '▶ Thử lại';
      btn.disabled = false;
      btn.style.color = '';
      out.dataset.state = 'stopped';
      out.classList.add('failure');
      if (!e.printed) append(out, '❌ ' + e.message, true);
    }
  };

  async function refreshAppiumHealth() {
    const btn = $('btnAppium');
    const out = $('appiumOut');
    if (out.dataset.state === 'starting') return;
    try {
      const status = await fetch('/api/prereq/appium/status', { cache: 'no-store' }).then((response) => response.json());
      const wasRunning = out.dataset.state === 'running';
      if (status.running) {
        btn.disabled = true;
        btn.textContent = '✓ Đang chạy';
        btn.style.color = '#1a7f45';
        out.dataset.state = 'running';
        out.classList.remove('failure', 'warning');
        out.classList.add('success');
        out.hidden = false;
        out.textContent = '✓ Appium đang hoạt động và sẵn sàng nhận test.';
      } else {
        btn.disabled = false;
        btn.textContent = wasRunning ? '▶ Khởi động lại' : '▶ Khởi động';
        btn.style.color = '';
        out.dataset.state = 'stopped';
        out.classList.remove('success', 'failure');
        if (wasRunning || status.lastExit) {
          out.classList.add('warning');
          out.hidden = false;
          out.textContent = '⚠ Appium đã dừng. Bấm “Khởi động lại” trước khi chạy test.';
        } else {
          out.classList.remove('warning');
          out.hidden = true;
        }
      }
    } catch {
      // UI server may be hot-reloading. Keep the last known state and retry on
      // the next health tick instead of showing a false Appium failure.
    }
  }
  void refreshAppiumHealth();
  setInterval(() => void refreshAppiumHealth(), 5_000);

  async function refreshAndroidDevices() {
    const btn = $('btnAdb');
    const out = $('deviceOut');
    btn.disabled = true;
    btn.textContent = '⟳ Đang kiểm tra…';
    out.classList.remove('success', 'warning', 'failure');
    out.hidden = false;
    out.textContent = 'Đang kiểm tra…';
    try {
      const r = await api('/api/prereq/adb');
      const devs = r.devices ?? [];
      if (!devs.length) {
        out.classList.add('warning');
        out.textContent = '⚠ Không thấy thiết bị nào. Kết nối USB và bật USB Debugging.';
      } else {
        const ready = devs.filter((device) => device.state === 'device').length;
        out.classList.add(ready === devs.length ? 'success' : 'warning');
        const summary = ready === devs.length
          ? `✓ ${ready} thiết bị Android sẵn sàng`
          : `⚠ Phát hiện ${devs.length} thiết bị · ${ready} thiết bị sẵn sàng`;
        const lines = devs.flatMap((device, index) => {
          const maker = device.manufacturer
            ? device.manufacturer.charAt(0).toLocaleUpperCase() + device.manufacturer.slice(1)
            : '';
          const name = [maker, device.model].filter(Boolean).join(' ') || 'Thiết bị Android';
          const kind = device.kind === 'emulator' ? 'Emulator' : 'Thiết bị thật';
          const stateLabel = ({
            device: 'Sẵn sàng', offline: 'Đang offline', unauthorized: 'Chưa cấp quyền USB',
          })[device.state] ?? device.state;
          const prefix = devs.length > 1 ? `${index + 1}. ` : '';
          return [
            `${prefix}${name}${device.androidVersion ? ` · Android ${device.androidVersion}` : ''} · ${kind}`,
            `   ID: ${device.id} · ${stateLabel}`,
          ];
        });
        const { picked, unknown } = selectAttached(
          'android',
          devs.filter((device) => device.state === 'device').map((device) => device.id),
        );
        renderDevicePicker();
        const notes = [];
        if (picked > 0) notes.push(`→ Đã tự chọn ${picked} máy ở danh sách Thiết bị bên trên.`);
        if (unknown.length > 0) {
          notes.push(
            `→ ${unknown.length} máy đang cắm nhưng chưa có trong config: ${unknown.join(', ')}`,
            '   Chạy: npm run devices:sync',
          );
        }
        out.textContent = [summary, '', ...lines, ...(notes.length ? ['', ...notes] : [])].join('\n');
      }
    } catch (e) {
      out.classList.add('failure');
      out.textContent = '❌ ' + e.message;
    }
    btn.disabled = false;
    btn.textContent = '⟳ Kiểm tra lại';
  }
  $('btnAdb').onclick = () => void refreshAndroidDevices();

  $('btnXcode').onclick = async () => {
    const btn = $('btnXcode');
    const out = $('xcodeOut');
    btn.disabled = true;
    out.hidden = false;
    out.classList.remove('success', 'failure', 'warning');
    out.textContent = 'Đang kiểm tra…';
    try {
      const r = await api('/api/prereq/xcode');
      if (!r.ok) {
        out.classList.add('failure');
        out.textContent = `❌ ${r.reason}${r.path ? `\n   đang trỏ tới: ${r.path}` : ''}`;
      } else {
        // The SDK number is the part worth reading: a phone newer than it will
        // refuse WebDriverAgent no matter how correct everything else is.
        const major = Number(/iphoneos([0-9]+)/.exec(r.sdk ?? '')?.[1] ?? 0);
        out.classList.add(major && major < 17 ? 'warning' : 'success');
        out.textContent = `✓ ${r.version}\n   ${r.path}`
          + (r.sdk ? `\n   SDK cao nhất: ${r.sdk} → build được cho iOS ≤ ${major}.x` : '')
          + (major && major < 17
            ? `\n   ⚠ iPhone chạy iOS > ${major} sẽ không cài được WebDriverAgent — cần nâng Xcode.`
            : '');
      }
    } catch (e) {
      out.classList.add('failure');
      out.textContent = '❌ ' + e.message;
    }
    btn.disabled = false;
    btn.textContent = '⟳ Kiểm tra lại';
  };

  $('btnIos').onclick = async () => {
    const btn = $('btnIos');
    const out = $('deviceOut');
    btn.disabled = true;
    out.hidden = false;
    out.textContent = 'Đang kiểm tra…';
    try {
      const r = await fetch('/api/prereq/ios-devices').then(r => r.json());
      const lines = r.devices ?? [];
      // Only the ones the server says are plugged in: its listing also contains
      // the offline section, every simulator, and this Mac.
      const { picked, unknown } = selectAttached('ios', r.attached ?? []);
      renderDevicePicker();
      const notes = [];
      if (picked > 0) notes.push(`→ Đã tự chọn ${picked} máy ở danh sách Thiết bị bên trên.`);
      if (unknown.length > 0) {
        notes.push(`→ ${unknown.length} máy đang kết nối nhưng chưa có trong config.`,
                   '   Thêm vào ios.devices trong testpilot.config.json.');
      }
      out.textContent = [...lines, ...(notes.length ? ['', ...notes] : [])].join('\n')
        || '⚠ Không thấy thiết bị nào.';
    } catch (e) {
      out.textContent = '❌ ' + e.message;
    }
    btn.disabled = false;
  };

  $('btnDriver').onclick = async () => {
    const btn = $('btnDriver');
    const out = $('driverOut');
    const plat = $('platform').value;
    const driver = plat === 'ios' ? 'xcuitest' : 'uiautomator2';
    btn.disabled = true;
    btn.textContent = '⏳ Đang cài…';
    out.classList.remove('success', 'failure');
    out.textContent = '';
    out.hidden = false;
    try {
      await streamInto('/api/prereq/driver', out, { driver });
      btn.textContent = '✓ Đã cài';
      btn.style.color = '#1a7f45';
      out.classList.add('success');
      out.textContent = `✓ ${driver === 'xcuitest' ? 'XCUITest' : 'UiAutomator2'} đã sẵn sàng để sử dụng.`;
    } catch (e) {
      btn.textContent = '↓ Thử lại';
      btn.disabled = false;
      out.classList.add('failure');
      if (!e.printed) append(out, '❌ ' + e.message, true);
    }
  };

  const stopBtn = $('stopSuite');

  $('runSuite').onclick = async () => {
    const btn = $('runSuite');
    btn.disabled = true;
    stopBtn.hidden = false;
    const log = $('runLog');
    log.textContent = '';
    log.hidden = false;
    try {
      await saveSlowMo();
      await streamInto('/api/run', log, {
        platform: $('platform').value,
        tag: $('tag').value.trim() || undefined,
        headed: $('headed').checked,
        includeQuarantined: $('includeQuarantined').checked,
        devices: [...selectedDevices],
        ...($('envField').hidden ? {} : { env: $('runEnv').value }),
      });
    } catch (e) {
      if (!e.printed) log.append(el('span', { className: 'err', textContent: e.message + '\n' }));
    } finally {
      btn.disabled = false;
      btn.textContent = 'Chạy test';
      stopBtn.hidden = true;
      stopBtn.disabled = false;
      stopBtn.textContent = 'Dừng test';
      // Awaited, not fire-and-forget: the network log is picked from the run
      // list that refresh() rebuilds, and the run that just finished is the
      // one someone wants to look at.
      await refresh().catch(() => {});
      showLatestNetworkLog();
    }
  };

  stopBtn.onclick = async () => {
    stopBtn.disabled = true;
    stopBtn.textContent = 'Đang dừng…';
    try {
      await fetch('/api/run/stop', { method: 'POST' });
    } catch (e) {
      // If the server is unreachable the run is already dead.
    }
  };

  const localFp = flatpickr($('localRunDate'), {
    dateFormat: 'Y-m-d',
    allowInput: false,
    disableMobile: true,
    onReady(_, __, fp) { replaceMonthSelect(fp); },
    onMonthChange(_, __, fp) { syncMonthLabel(fp); },
    onChange: ([date], _value, fp) => {
      localRunDate = date ? fp.formatDate(date, 'Y-m-d') : '';
      localRunPage = 0;
      renderLocalHistory();
    },
  });
  $('localRunDateClear').onclick = () => {
    localFp.clear(); localRunDate = '';
    localPlatform = 'all';
    $('localPlatformFilter').querySelectorAll('.seg').forEach((p) => {
      p.classList.toggle('active', p.dataset.plt === 'all');
    });
    localRunPage = 0;
    renderLocalHistory();
  };

  $('localPlatformFilter').addEventListener('click', (e) => {
    const seg = e.target.closest('.seg');
    if (!seg) return;
    localPlatform = seg.dataset.plt;
    localRunPage = 0;
    $('localPlatformFilter').querySelectorAll('.seg').forEach((p) => {
      p.classList.toggle('active', p.dataset.plt === localPlatform);
    });
    renderLocalHistory();
  });
}

function fillRunner() {
  $('slowMo').value = state.config.web.slowMoMs;
  // wireRunner() runs before the first /api/state lands, so the picker's first
  // draw sees no config and correctly hides itself. Without redrawing here it
  // would stay hidden until something else happened to change the platform.
  renderDevicePicker();
  // Before renderAppPaths: it reads which environment is selected, and the
  // picker is what decides that.
  renderRunEnv();
  renderAppPaths();
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

function renderReports(wantedId) {
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

  const wanted = wantedId ? state.reports.find((r) => r.id === wantedId) : undefined;

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
        showRunDetail(r);
      };
      runbar.append(tr);
      // The asked-for run when there is one, the newest otherwise.
      if (wanted ? r.id === wanted.id : i === 0) tr.click();
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
    // The tab holding the asked-for run, else the first platform that actually
    // has something to show.
    const isDefault = runs.length > 0
      && !PLATFORMS.slice(0, i).some((p) => byPlatform.get(p).length > 0);
    if (wanted ? wanted.platform === platform : isDefault) b.click();
  });
}

/**
 * Chapter data applies to a whole-job recording only; the server says which
 * urls those are. Passing a run's timeline to a per-scenario clip would label a
 * twenty-second file with events from minutes into a different one.
 */
function videoOptsFor(report, url) {
  const whole = new Set(report.wholeVideoUrls ?? []);
  return whole.has(url)
    ? { testSeconds: report.testSeconds, chapters: report.chapters }
    : {};
}

/**
 * A recording with the same two affordances the generated report has: it opens
 * where the test starts, and it lists where each scenario sits inside it.
 *
 * The offset is worked out here rather than sent by the server, because it
 * depends on the video's duration and only the browser knows that once the
 * metadata has loaded. The file carries no absolute timestamp to line up
 * against, so this is an estimate — it says so, and nothing is trimmed: the
 * scrubber still goes back to zero, where an install problem would be visible.
 */
function videoWithChapters(url, opts = {}) {
  const fig = el('figure', { className: 'vid' });
  const video = el('video', { src: url, controls: true, preload: 'metadata', playsinline: true });
  fig.append(video);

  video.addEventListener('loadedmetadata', () => {
    const test = Number(opts.testSeconds);
    // Leave a couple of seconds of teardown out rather than risk landing after
    // the first thing worth seeing.
    const skip = Number.isFinite(test) && video.duration
      ? Math.max(0, video.duration - test - 2)
      : 0;

    if (skip >= 1) {
      video.currentTime = skip;
      fig.append(el('figcaption', {
        className: 'vid-note',
        textContent: `Bắt đầu ở ${skip.toFixed(0)}s — bỏ qua phần cài app và tạo session Appium (kéo về 0 để xem đủ).`,
      }));
    }

    const chapters = opts.chapters ?? [];
    if (chapters.length < 2) return;
    const list = el('ol', { className: 'chapters' });
    for (const chapter of chapters) {
      const at = skip + chapter.at;
      const mm = Math.floor(at / 60);
      const ss = Math.floor(at % 60);
      const button = el('button', {
        type: 'button',
        className: `v-${chapter.status}`,
        textContent: `${mm}:${String(ss).padStart(2, '0')}  ${chapter.name}`,
      });
      button.onclick = () => { video.currentTime = at; video.play(); };
      list.append(el('li', {}, [button]));
    }
    fig.append(list);
  }, { once: true });

  return fig;
}

function renderE2eHistory(runId) { renderReports(runId); }

function showRunDetail(r) {
  const detail = $('runDetail');
  const logPre = $('historyRunLog');
  const toggle = $('historyLogToggle');

  // No video block here on purpose. The report iframe directly above already
  // shows every recording: passing scenarios under "Bản ghi màn hình", failing
  // ones inside their own failure entry next to the screenshot that explains
  // them. Repeating the players a few hundred pixels lower showed the same
  // files twice in two different shapes.

  const lines = r.log ? r.log.split('\n') : [];
  // Rebuild log pre without ever leaving it empty (avoids pre.console:empty { display:none })
  const nodes = [];
  for (const line of lines) {
    const parts = line.split(/(https?:\/\/\S+)/g);
    for (const part of parts) {
      if (/^https?:\/\//.test(part)) {
        nodes.push(el('a', { href: part, target: '_blank', rel: 'noreferrer noopener', textContent: part }));
      } else if (part) {
        nodes.push(document.createTextNode(part));
      }
    }
    nodes.push(document.createTextNode('\n'));
  }
  logPre.replaceChildren(...nodes);
  logPre.hidden = lines.length === 0;

  toggle.hidden = lines.length === 0;
  toggle.onclick = () => {
    logPre.hidden = !logPre.hidden;
    toggle.textContent = (logPre.hidden ? '▶' : '▼') + ' Log';
  };

  const shots = $('runShots');
  shots.replaceChildren();
  if (r.shotUrls?.length) shots.append(screenshotGallery(r.shotUrls));
  shots.hidden = !r.shotUrls?.length;

  const net = $('runNetwork');
  net.replaceChildren();
  if (r.networkLogUrl) net.append(networkLogPanel(r.networkLogUrl));
  net.hidden = !r.networkLogUrl;

  detail.hidden = !r.log && !r.networkLogUrl && !r.shotUrls?.length;
}

/**
 * Shows the newest run's network log on the runner page itself.
 *
 * The viewer already existed on E2E History, one navigation away — which is one
 * navigation more than anyone makes while staring at the console output of the
 * run that just failed. Same component, put where the question is asked.
 */
function showLatestNetworkLog() {
  const box = $('localNetwork');
  box.replaceChildren();
  // The newest run, full stop. Selecting the newest run *with a network log*
  // and then drawing its screenshots meant a passing run — which records no
  // network log — showed the previous, failed run's pictures instead, labelled
  // "khi fail", under a console that had just said everything passed.
  const newest = [...(state?.reports ?? [])]
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0];
  const hasShots = Boolean(newest?.shotUrls?.length);
  box.hidden = !newest || (!hasShots && !newest.networkLogUrl);
  if (box.hidden) return;
  if (hasShots) box.append(screenshotGallery(newest.shotUrls));
  if (newest.networkLogUrl) box.append(networkLogPanel(newest.networkLogUrl));
}

/**
 * Thumbnails for every screenshot a run produced.
 *
 * The rendered report only embeds the shot attached to a failed step, so on a
 * passing run the output of `I take a screenshot named "..."` was written to
 * disk and shown nowhere — which reads as the step not having worked.
 *
 * Failure shots are labelled as such: they come from the executor rather than
 * from a step someone wrote, and mistaking one for the other sends you looking
 * for a scenario line that does not exist.
 */
function screenshotGallery(shots) {
  const grid = el('div', { className: 'shot-grid' });
  for (const s of shots) {
    const img = el('img', { src: s.url, loading: 'lazy', alt: s.name });
    const link = el('a', { href: s.url, target: '_blank', rel: 'noreferrer noopener' }, [img]);
    grid.append(el('figure', { className: 'shot-item' + (s.onFailure ? ' shot-failure' : '') }, [
      link,
      el('figcaption', { textContent: s.onFailure ? 'khi fail' : s.name }),
    ]));
  }
  return el('details', { className: 'net-details', open: true }, [
    el('summary', { textContent: `Ảnh chụp (${shots.length})` }),
    grid,
  ]);
}

/**
 * Collapsible viewer for a run's network log.
 *
 * Fetched when opened rather than with the run list: a busy scenario writes
 * hundreds of lines and nobody reads them until something has gone wrong.
 *
 * Failed and 4xx/5xx lines are coloured because they are the only reason to
 * open this. The log that finally explained a week of Device Farm failures had
 * one line that mattered — a login POST ending in ERR_CONNECTION_CLOSED —
 * sitting among two dozen successful asset fetches.
 */
function networkLogPanel(url) {
  const body = el('pre', { className: 'console net-log', textContent: 'Đang tải…' });
  const summary = el('summary', { textContent: 'Network log' });
  const box = el('details', { className: 'net-details' }, [summary, body]);

  let loaded = false;
  box.addEventListener('toggle', async () => {
    if (!box.open || loaded) return;
    loaded = true;
    try {
      const text = await fetch(url).then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      });
      renderNetworkLines(body, text);
    } catch (e) {
      loaded = false;
      body.replaceChildren(el('span', { className: 'err', textContent: 'Không đọc được log: ' + e.message }));
    }
  });
  return box;
}

function renderNetworkLines(pre, text) {
  const lines = text.split('\n').filter(Boolean);
  if (lines.length === 0) {
    pre.textContent = 'Log rỗng.';
    return;
  }
  let failed = 0;
  const nodes = lines.map((line) => {
    const bad = / FAILED /.test(line);
    const http = /\s([45]\d{2})\s/.exec(line);
    if (bad || http) failed += 1;
    return el('span', {
      className: bad ? 'net-failed' : http ? 'net-warn' : 'net-ok',
      textContent: line + '\n',
    });
  });
  const head = el('span', {
    className: failed > 0 ? 'net-failed' : 'net-ok',
    textContent: `${lines.length} request, ${failed} lỗi\n${'─'.repeat(40)}\n`,
  });
  pre.replaceChildren(head, ...nodes);
}

/* ------------------------------------------------------------------ */
/* AWS Device Farm                                                     */
/* ------------------------------------------------------------------ */

let farmDevices = [];
let farmPools = [];      // pool của project, kèm platforms để lọc
const picked = new Set();
let envRows = [];
/** Path the server wrote the uploaded APK/IPA to; empty means "keep the saved one". */

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
      if (!err.printed) log.textContent += `\n${err.message}`;
    } finally {
      $('awsLogin').disabled = false;
      // The whole point is the state afterwards, so do not make anyone go and
      // press the other button.
      await refreshAwsStatus();
    }
  };
  $('workflowFarm').addEventListener('change', syncFarmDetail);
  for (const input of document.querySelectorAll('#workflowPlatforms input[value]')) {
    input.addEventListener('change', refreshPreflight);
  }
  $('fRegion').addEventListener('change', refreshAwsStatus);
  $('fLoad').onclick = loadProjects;
  $('fProject').onchange = loadPools;
  $('fPlatform').onchange = () => {
    // The app extension and the device list both follow the OS choice, and a
    // pool of Android phones is meaningless once you switch to iOS.
    $('fExt').textContent = $('fPlatform').value === 'ios' ? '.ipa' : '.apk';
    // The build follows the OS too, now that each platform keeps its own.
    renderFarmBuild();
    farmDevices = [];
    picked.clear();
    renderDevices();
    renderPools();
  };
  $('fLoadDevices').onclick = loadDevices;
  $('fCreatePool').onclick = createPool;
  $('fSearch').oninput = renderDevices;
  $('fRealOnly').onchange = renderDevices;
  $('fEnvAdd').onclick = () => { envRows.push({ key: '', value: '' }); renderEnv(); };
  $('fRun').onclick = runFarm;
  // One screen owns uploading; this card links to it rather than offering a
  // second way in.
  $('fAppManage').onclick = () => navigate('builds');

  mountTagPicker({
    picker: $('fTagPicker'),
    hidden: $('fTag'),
    box: $('fTagSuggestions'),
    placeholder: 'Tất cả scenario — bấm để lọc',
    tags: allSuiteTags,
  });

  const farmFp = flatpickr($('farmRunDate'), {
    dateFormat: 'Y-m-d',
    allowInput: false,
    disableMobile: true,
    onReady(_, __, fp) { replaceMonthSelect(fp); },
    onMonthChange(_, __, fp) { syncMonthLabel(fp); },
    onChange: ([date], _value, fp) => {
      farmRunDate = date ? fp.formatDate(date, 'Y-m-d') : '';
      farmRunPage = 0;
      renderFarmHistory();
    },
  });
  $('farmRunDateClear').onclick = () => {
    farmFp.clear(); farmRunDate = '';
    farmPlatformFilter = 'all';
    $('farmPlatformFilter').querySelectorAll('.seg').forEach((p) => {
      p.classList.toggle('active', p.dataset.plt === 'all');
    });
    farmRunPage = 0;
    renderFarmHistory();
  };

  $('farmPlatformFilter').addEventListener('click', (e) => {
    const seg = e.target.closest('.seg');
    if (!seg) return;
    farmPlatformFilter = seg.dataset.plt;
    farmRunPage = 0;
    $('farmPlatformFilter').querySelectorAll('.seg').forEach((p) => {
      p.classList.toggle('active', p.dataset.plt === farmPlatformFilter);
    });
    renderFarmHistory();
  });
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
  // Read from the shared build store rather than from `farm.appPath`, so this
  // card and the Local Runner card can never describe different files.
  renderFarmBuild();

  envRows = Object.entries(f.env).map(([key, value]) => ({ key, value }));
  renderEnv();

  // The pickers hold ARNs that only make sense once their list is loaded; keep
  // the saved value visible as a single option until then.
  if (f.projectArn) keepOption($('fProject'), f.projectArn, shortArn(f.projectArn));
  if (f.devicePoolArn) keepOption($('fPool'), f.devicePoolArn, shortArn(f.devicePoolArn));

  // Auto-load projects + pools when there's a saved selection so the user
  // doesn't have to click "Tải project" on every page reload.
  if (f.projectArn) loadProjects().catch(() => {});
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
  const errBox = $('fConnErr');
  errBox.hidden = true;
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
    setStatus(status, '', null);
    errBox.textContent = e.message;
    errBox.hidden = false;
  }
}

/**
 * Lists only the pools that can run the chosen platform.
 *
 * A pool of Android phones offered while iOS is selected is not merely useless:
 * picking it schedules a run that AWS accepts, sits on for several minutes and
 * returns as SKIPPED with an empty result — which reads like a suite that found
 * nothing to do.
 *
 * A pool whose platform could not be determined is kept. The filter exists to
 * remove a known-wrong choice, not to hide anything it failed to classify.
 */
function renderPools() {
  const select = $('fPool');
  const platform = $('fPlatform').value;
  const fits = (pool) => !pool.platforms?.length || pool.platforms.includes(platform);
  const shown = farmPools.filter(fits);
  const hidden = farmPools.length - shown.length;

  select.replaceChildren(el('option', { value: '', textContent: '— chọn pool —' }));
  for (const p of shown) {
    select.append(el('option', { value: p.arn, textContent: `${p.name} (${p.type})` }));
  }
  if (shown.length === 0 && farmPools.length > 0) {
    select.append(el('option', { value: '', textContent: `— không pool nào cho ${platform} —` }));
  }

  // Only re-select the saved pool when it survives the filter; otherwise the
  // form would show a pool the run is about to be refused for.
  const saved = state?.config?.farm?.devicePoolArn;
  if (saved && shown.some((p) => p.arn === saved)) {
    keepOption(select, saved, shortArn(saved));
  } else if (saved && farmPools.some((p) => p.arn === saved)) {
    select.value = '';
  }

  const note = $('fPoolNote');
  if (note) {
    note.textContent = hidden > 0 ? `Đã ẩn ${hidden} pool không chạy được ${platform}.` : '';
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
    farmPools = pools;
    renderPools();
  } catch (e) {
    setStatus($('fConn'), '', null);
    const errBox = $('fConnErr');
    errBox.textContent = e.message;
    errBox.hidden = false;
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
    farmPools = [...farmPools, { ...pool, type: pool.type ?? 'PRIVATE', platforms: [$('fPlatform').value] }];
    keepOption($('fPool'), pool.arn, `${pool.name} (${picked.size} thiết bị)`);
    setStatus(status, `Đã tạo "${pool.name}" và chọn sẵn.`, true);
  } catch (e) {
    setStatus(status, e.message, false);
  }
}

/** What the farm will actually send, read from the one store. */
function renderFarmBuild() {
  const out = $('fAppPath');
  const platform = $('fPlatform').value;
  const build = state?.appBuilds?.[platform];
  if (!build) {
    out.textContent = `Chưa có build ${platform === 'ios' ? '.ipa' : '.apk'} cho môi trường mặc định.`;
    return;
  }
  out.textContent = build.exists
    ? `Đang dùng: ${build.path}${build.sizeMb ? ` · ${build.sizeMb} MB` : ''}`
    : `✕ Config trỏ tới ${build.path} nhưng không thấy file.`;
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
  const farmTag = $('fTag').value.trim();
  if (farmTag) env['TESTPILOT_TAG'] = farmTag;

  try {
    await streamInto('/api/farm/run', $('fLog'), {
      region: $('fRegion').value,
      projectArn: $('fProject').value,
      devicePoolArn: $('fPool').value,
      platform: $('fPlatform').value,
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
    refresh().catch(() => {});
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
  $('saveVisionKey').onclick = saveVisionKey;
  $('confluenceAuthSave').onclick = saveConfluenceAuth;
  void loadConfluenceAuth();
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
  $('toolConfluenceAttachments').value = m?.tools?.confluenceAttachments ?? '';
  $('toolFigmaImage').value = m?.tools?.figmaImage ?? '';
  syncMcpFields();

  $('pDocs').value = c.paths.docs;
  $('pFeatures').value = c.paths.features;
  $('pRegistry').value = c.paths.registry;
  $('pReports').value = c.paths.reports;

  $('cfgFile').textContent = state.configFile;
  $('apiKey').textContent = state.hasApiKey ? 'đã set' : 'chưa set — không sinh được testcase';
  $('geminiVisionKey').value = '';
  $('geminiVisionKey').placeholder = state.modelKeys?.gemini
    ? '•••••••• (Gemini key đã lưu)'
    : 'Gemini API key';
  setStatus(
    $('visionKeyStatus'),
    state.modelKeys?.gemini
      ? 'Gemini sẵn sàng phân tích ảnh Confluence/Figma.'
      : state.modelKeys?.anthropic
        ? 'Đang dùng Anthropic dự phòng. Thêm Gemini key để dùng provider mặc định.'
        : 'Chưa có vision key — workflow sẽ dừng nếu tài liệu chứa ảnh.',
    Boolean(state.modelKeys?.gemini || state.modelKeys?.anthropic),
  );
  $('elCount').textContent = String(state.elements);
  $('cfgErr').textContent = state.configError ?? '';
  $('cfgErr').hidden = !state.configError;
}

async function saveVisionKey() {
  const input = $('geminiVisionKey');
  const status = $('visionKeyStatus');
  const key = input.value.trim();
  if (!key) {
    setStatus(status, 'Nhập key mới hoặc giữ nguyên key đã lưu.', false);
    return;
  }
  const button = $('saveVisionKey');
  button.disabled = true;
  setStatus(status, 'Đang lưu…', null);
  try {
    await api('/api/model-key', 'POST', { provider: 'gemini', key });
    input.value = '';
    await refresh();
    setStatus(status, 'Đã lưu Gemini key. Sẵn sàng phân tích ảnh Confluence/Figma.', true);
  } catch (e) {
    setStatus(status, e.message, false);
  } finally {
    button.disabled = false;
  }
}

/**
 * The stored token is never sent back to the browser, so the field starts empty
 * even when one is set; the summary line is what tells the user which it is.
 */
async function loadConfluenceAuth() {
  try {
    const info = await api('/api/confluence-auth', 'GET');
    $('confluenceEmail').value = info.email || '';
    $('confluenceAuthState').textContent = info.hasToken ? '(đã cấu hình)' : '(chưa cấu hình)';
  } catch {
    $('confluenceAuthState').textContent = '';
  }
}

async function saveConfluenceAuth() {
  const status = $('confluenceAuthStatus');
  const button = $('confluenceAuthSave');
  const email = $('confluenceEmail').value.trim();
  const token = $('confluenceToken').value.trim();
  if (!email || !token) {
    setStatus(status, 'Cần cả email Atlassian và API token.', false);
    return;
  }
  button.disabled = true;
  setStatus(status, 'Đang lưu…', null);
  try {
    await api('/api/confluence-auth', 'POST', { email, token });
    $('confluenceToken').value = '';
    $('confluenceAuthState').textContent = '(đã cấu hình)';
    setStatus(status, 'Đã lưu. Lần sinh testcase tới sẽ đọc được ảnh trong trang Confluence.', true);
  } catch (e) {
    setStatus(status, e.message, false);
  } finally {
    button.disabled = false;
  }
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
      confluenceAttachments: $('toolConfluenceAttachments').value.trim(),
      figmaImage: $('toolFigmaImage').value.trim(),
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
    if (!$('toolConfluenceAttachments').value && guess.confluenceAttachments) {
      $('toolConfluenceAttachments').value = guess.confluenceAttachments;
    }
    if (!$('toolFigmaImage').value && guess.figmaImage) $('toolFigmaImage').value = guess.figmaImage;
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

/**
 * Success, plus anything binding had to guess at.
 *
 * Shown neutral rather than green: approving worked, but a label that matched
 * two different controls means a step may now be pointing at the wrong one, and
 * a green tick is how that goes unnoticed.
 */
function withPomWarnings(message, result) {
  const warnings = result.pomWarnings ?? [];
  if (warnings.length === 0) return { text: message, ok: true };
  return { text: `${message}\n⚠️ ${warnings.join('\n⚠️ ')}`, ok: null };
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
  let lastRun = null;
  let doneResult = null;

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
      else if (event === 'run') { lastRun = data; onRun?.(data); }
      // Printed here and nowhere else. An error frame arrives in sequence with
      // the log lines around it, so it belongs in the stream — but every caller
      // also printed it from its catch block, and the same sentence appeared
      // twice, once plain and once with a cross in front.
      else if (event === 'error') { failure = data; append(pre, '❌ ' + data, true); }
      else if (event === 'done') doneResult = data;
    }
  }
  if (failure) {
    const err = new Error(failure);
    // Tells the caller the message is already on screen. A failure raised
    // before the stream starts — a rejected request, a dropped connection —
    // carries no such mark and still has to be shown by whoever caught it.
    err.printed = true;
    throw err;
  }
  return { lastRun, done: doneResult };
}

/**
 * Keep a streaming console pinned to its newest line.
 *
 * Two scrolls are in play: the <pre> has its own overflow, and the page itself
 * has to follow when the console sits below the fold. A farm run streams for
 * minutes, so both are applied together rather than only for the local runner.
 */
function scrollLogToEnd(pre) {
  pre.scrollTop = pre.scrollHeight;
  const overshoot = pre.getBoundingClientRect().bottom - window.innerHeight + 8;
  if (overshoot > 0) window.scrollBy({ top: overshoot, behavior: 'instant' });
}

function append(pre, line, isError = false) {
  // Scrolling up to re-read earlier output must not be undone by the next line
  // arriving, so follow the tail only while the reader is already at it.
  const pinned = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 24;
  appendLine(pre, line, isError);
  if (pinned) scrollLogToEnd(pre);
}

function appendLine(pre, line, isError = false) {
  if (isError) {
    pre.append(el('span', { className: 'err', textContent: line + '\n' }));
    return;
  }

  // Structured markers emitted by the CLI
  const resultMatch = /^\[run:(passed|failed|flaky|skip|running)\] (.+)$/.exec(line);
  if (resultMatch) {
    const [, verdict, text] = resultMatch;
    const cls = verdict === 'passed' ? 'log-pass' : verdict === 'failed' ? 'log-fail' : verdict === 'flaky' ? 'log-flaky' : verdict === 'running' ? 'log-running' : 'log-skip';
    // The CLI prints its own status icon inside the text — "… name" while a
    // scenario runs, "✓ name" once it is done — so the two lines never compared
    // equal and every scenario was logged twice, once greyed and once in
    // colour. Match on the name with the icon stripped, and keep that name on
    // the element rather than re-deriving it from rendered text.
    const name = text.replace(/^[…✓✗~⊘]\s*/, '');
    if (verdict !== 'running') {
      const prev = [...pre.querySelectorAll('.log-running')]
        .findLast((s) => s.dataset.scenario === name);
      if (prev) {
        prev.className = cls;
        prev.textContent = text + '\n';
        delete prev.dataset.scenario;
        return;
      }
    }
    const row = el('span', { className: cls, textContent: text + '\n' });
    if (verdict === 'running') row.dataset.scenario = name;
    pre.append(row);
    return;
  }

  // The ✎ group is optional so runs recorded before unapproved-counting still parse.
  const summaryMatch = /^\[run:summary\] (\d+)✓ (\d+)✗ (\d+)~ (\d+)⊘(?: (\d+)✎)?$/.exec(line);
  if (summaryMatch) {
    const [, pass, fail, flaky, skip, unapproved] = summaryMatch;
    const row = el('span', { className: 'log-summary' });
    row.append(
      el('span', { className: 'log-pass', textContent: `${pass} pass` }),
      el('span', { textContent: '  ' }),
      el('span', { className: 'log-fail', textContent: `${fail} fail` }),
      ...(+flaky ? [el('span', { textContent: '  ' }), el('span', { className: 'log-flaky', textContent: `${flaky} flaky` })] : []),
      ...(+skip  ? [el('span', { textContent: '  ' }), el('span', { className: 'log-skip',  textContent: `${skip} bỏ qua` })] : []),
      ...(+unapproved ? [el('span', { textContent: '  ' }), el('span', { className: 'log-unapproved', textContent: `${unapproved} chưa duyệt` })] : []),
      '\n',
    );
    pre.append(el('span', { textContent: '─'.repeat(40) + '\n', className: 'log-dim' }), row);
    return;
  }

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
