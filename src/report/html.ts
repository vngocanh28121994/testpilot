import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RunReport, ScenarioResult } from '../core/types.js';
import type { FlakeVerdict } from '../flaky/detector.js';

/**
 * A report exists to answer three questions in order:
 *   1. Can I ship?              -> the verdict counts at the top
 *   2. Which failures are real? -> flaky and broken are separated, never mixed
 *   3. What do I fix?           -> the heal suggestions, with the exact locator
 */
export async function writeHtmlReport(
  report: RunReport,
  verdicts: FlakeVerdict[],
  outDir: string,
): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, 'index.html');
  await writeFile(file, render(report, verdicts, outDir), 'utf8');
  await writeFile(
    path.join(outDir, 'report.json'),
    JSON.stringify({ report, verdicts }, null, 2),
    'utf8',
  );
  return file;
}

/**
 * Appends the device's own screen recordings to a report that is already written.
 *
 * Device Farm records the screen itself, and that recording only exists after
 * the run is over — long after the device rendered this report. It therefore
 * cannot be part of `render()`. Keeping the markup here rather than in the farm
 * client means a re-rendered report and a freshly pulled one look the same, and
 * the check makes it safe to call twice.
 */
export async function appendDeviceVideos(runDir: string): Promise<number> {
  const dir = path.join(runDir, 'artifacts', 'video');
  const indexFile = path.join(runDir, 'index.html');
  if (!existsSync(dir) || !existsSync(indexFile)) return 0;

  const files = (await readdir(dir)).filter((f) => /^devicefarm-.*\.mp4$/i.test(f)).sort();
  if (files.length === 0) return 0;

  let html = await readFile(indexFile, 'utf8');
  // Idempotent: pulling a run twice, or re-rendering after a pull, must not
  // stack the same recording up again.
  if (files.some((f) => html.includes(`artifacts/video/${f}`))) return 0;
  if (!html.includes(DEVICE_SLOT)) return 0;

  // Device Farm records the whole job: Appium starting, the app installing, the
  // session being built. On this app that is the first ~28 seconds of every
  // recording, and none of it is the test.
  const testSeconds = await testWindowSeconds(runDir);
  const chapters = await chaptersOf(runDir);
  const figures = files
    .map(
      (f) => `<figure><figcaption>Toàn màn hình thiết bị — ${esc(f)}</figcaption>
<video src="artifacts/video/${esc(f)}" controls preload="metadata" playsinline
       ${testSeconds ? `data-test-seconds="${testSeconds.toFixed(1)}"` : ''}
       ${chapters.length > 1 ? `data-chapters="${esc(JSON.stringify(chapters))}"` : ''}></video></figure>`,
    )
    .join('\n');

  html = html.replace(DEVICE_SLOT, `${figures}\n${DEVICE_SLOT}`);
  if (testSeconds && !html.includes(SEEK_MARKER)) html = html.replace('</main>', `${SEEK_SCRIPT}</main>`);
  // The section is no longer empty, so the note saying so has to go.
  html = html.replace(new RegExp(`<p class="empty" ${EMPTY_ATTR}>[^<]*</p>`), '');
  await writeFile(indexFile, html, 'utf8');
  return files.length;
}

/**
 * Artifact paths are stored relative to the working directory, but the report
 * lives in `reports/<platform>/`. Making them relative to the report keeps the
 * links working both when the file is opened straight off disk and when the UI
 * serves it — `/reports/web/../../artifacts/...` resolves to `/artifacts/...`.
 */
function assetHref(outDir: string, assetPath: string): string {
  return path.relative(outDir, path.resolve(assetPath)).split(path.sep).join('/');
}

function render(report: RunReport, verdicts: FlakeVerdict[], outDir: string): string {
  const byKey = new Map(verdicts.map((v) => [`${v.scenarioId}::${v.platform}::${v.device}`, v]));
  const counts = {
    passed: report.results.filter((r) => r.verdict === 'passed').length,
    flaky: report.results.filter((r) => r.verdict === 'flaky').length,
    failed: report.results.filter((r) => r.verdict === 'failed').length,
  };

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TestPilot — ${esc(report.runId)}</title>
<style>
  :root { color-scheme: light dark; --bg:#fff; --fg:#111; --muted:#666; --line:#e5e5e5;
          --pass:#137333; --fail:#c5221f; --flake:#b06000; --card:#fafafa; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#111; --fg:#eee; --muted:#999; --line:#2a2a2a; --card:#191919;
            --pass:#5bb974; --fail:#f28b82; --flake:#fdd663; }
  }
  body { margin:0; padding:2rem 1.25rem; background:var(--bg); color:var(--fg);
         font:15px/1.55 ui-sans-serif,system-ui,-apple-system,sans-serif; }
  main { max-width: 68rem; margin: 0 auto; }
  h1 { font-size:1.4rem; margin:0 0 .25rem; }
  .sub { color:var(--muted); margin:0 0 1.5rem; font-size:.875rem; }
  .tiles { display:flex; gap:.75rem; flex-wrap:wrap; margin-bottom:2rem; }
  .tile { border:1px solid var(--line); border-radius:10px; padding:.75rem 1.1rem; background:var(--card); }
  .tile b { display:block; font-size:1.6rem; line-height:1.2; }
  .passed b{color:var(--pass)} .failed b{color:var(--fail)} .flaky b{color:var(--flake)}
  h2 { font-size:1.05rem; margin:2rem 0 .75rem; }
  table { width:100%; border-collapse:collapse; font-size:.875rem; }
  th,td { text-align:left; padding:.5rem .6rem; border-bottom:1px solid var(--line); vertical-align:top; }
  th { color:var(--muted); font-weight:600; }
  .wrap { overflow-x:auto; }
  .tag { font-size:.75rem; padding:.1rem .45rem; border-radius:999px; border:1px solid var(--line); }
  .v-passed{color:var(--pass)} .v-failed{color:var(--fail)} .v-flaky{color:var(--flake)}
  details { border:1px solid var(--line); border-radius:8px; padding:.6rem .8rem; margin:.4rem 0; background:var(--card); }
  summary { cursor:pointer; }
  code { font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace; }
  /* Wrapping, not scrolling. The useful half of a resolver error is the
     "Tried: <candidates>" tail, and behind a horizontal scrollbar inside an
     iframe it is information the reader never learns exists. */
  pre { white-space:pre-wrap; overflow-wrap:anywhere; background:var(--card); padding:.6rem; border-radius:6px; }
  .empty { color:var(--muted); font-style:italic; }
.media { display: flex; gap: 16px; flex-wrap: wrap; margin: 12px 0 4px; }
.media figure { margin: 0; }
.media figcaption { font-size: 12px; color: #6b7280; margin-bottom: 6px; }
.warn {
  border: 1px solid #f0c36d; background: #fdf6e3; border-radius: 8px;
  padding: 12px 16px; margin: 8px 0 4px;
}
.warn ul { margin: 8px 0; padding-left: 20px; }
.media img, .media video {
  display: block; max-width: 360px; width: 100%; border: 1px solid #e5e7eb;
  border-radius: 8px; background: #000;
}
/* A phone screenshot at full height is taller than the viewport, so two
   failures bury everything after them. The figure links to the full image. */
.shot img {
  /* A definite height, not max-height. With width:auto an unloaded image is
     0x0, so it never intersects the viewport, so loading=lazy never fires and
     it stays 0x0 — the thumbnail locks itself out. */
  height: 260px; width: auto; max-width: 100%; object-fit: contain;
}
.fail-head { display:flex; gap:.5rem; align-items:baseline; flex-wrap:wrap; }
.fail-head .where { color:var(--muted); font-size:.85rem; font-weight:400; }
.chapters { list-style:none; margin:8px 0 0; padding:0; max-width:520px; }
.chapters li { margin:0; }
.chapters button {
  display:block; width:100%; text-align:left; font:inherit; font-size:13px;
  padding:5px 8px; border:0; border-radius:6px; background:none; cursor:pointer;
  font-variant-numeric:tabular-nums;
}
.chapters button:hover { background:var(--card); }
</style></head>
<body><main>
<h1>TestPilot run ${esc(report.runId)}</h1>
<p class="sub">${esc(report.startedAt)} → ${esc(report.finishedAt)}</p>

<div class="tiles">
  <div class="tile passed"><b>${counts.passed}</b>passed</div>
  <div class="tile flaky"><b>${counts.flaky}</b>flaky</div>
  <div class="tile failed"><b>${counts.failed}</b>failed</div>
</div>

<h2>Scenarios</h2>
<div class="wrap"><table>
<thead><tr><th>Scenario</th><th>Platform</th><th>Device</th><th>Verdict</th><th>Flake rate</th><th>Attempts</th></tr></thead>
<tbody>
${report.results.map((r) => row(r, byKey.get(`${r.scenario.id}::${r.platform}::${r.device}`))).join('\n')}
</tbody></table></div>

${quarantine(report)}

<h2>Failures</h2>
${failures(report.results, outDir)}

<h2>Bản ghi màn hình</h2>
${recordings(report.results, outDir)}

<h2>Locator healing — proposed fixes</h2>
${heals(report)}
</main></body></html>`;
}

function row(r: ScenarioResult, v?: FlakeVerdict): string {
  const rate = v ? `${Math.round(v.flakeRate * 100)}% of ${v.runs}` : '—';
  const note = v?.brokenNotFlaky ? ' <span class="tag">broken, not flaky</span>' : '';
  return `<tr>
  <td>${esc(r.scenario.name)}${note}</td>
  <td>${esc(r.platform)}</td>
  <td>${esc(r.device)}</td>
  <td class="v-${r.verdict}">${r.verdict}</td>
  <td>${rate}</td>
  <td>${r.runs.length}</td>
</tr>`;
}

/**
 * Held-back scenarios, shown above the failures and impossible to miss.
 *
 * A quarantined scenario produces no result at all, so without this the report
 * for a suite that has quietly stopped running half its tests looks exactly
 * like the report for a healthy one.
 */
function quarantine(report: RunReport): string {
  const held = report.quarantined ?? [];
  if (held.length === 0) return '';

  const rows = held
    .map((q) => `<li><strong>${esc(q.name)}</strong> — ${esc(q.platform)}/${esc(q.device)}</li>`)
    .join('\n');

  return `<h2>Quarantined — không chạy lần này</h2>
<div class="warn">
  <p>${held.length} scenario bị flake detector giữ lại nên <strong>không có kết quả</strong> ở trên.
     Con số passed/failed vì thế không phản ánh toàn bộ bộ test.</p>
  <ul>${rows}</ul>
  <p class="empty">Chạy kèm <code>--include-quarantined</code> để ép chạy lại chúng.</p>
</div>`;
}

function failures(results: ScenarioResult[], outDir: string): string {
  const bad = results.filter((r) => r.verdict !== 'passed');
  if (bad.length === 0) return '<p class="empty">Nothing failed.</p>';

  // One device per run is the normal case, so repeating it on every row is
  // noise that pushes the scenario name — the thing you are scanning for — onto
  // a second line. It is only worth printing when runs actually differ.
  const manyDevices = new Set(bad.map((r) => `${r.platform}/${r.device}`)).size > 1;

  return bad
    .map((r, i) => {
      const last = r.runs[r.runs.length - 1];
      const step = last?.steps.find((s) => s.status === 'failed');
      const shot = step?.screenshot ? assetHref(outDir, step.screenshot) : '';
      const where = manyDevices ? `<span class="where">${esc(r.platform)}/${esc(r.device)}</span>` : '';
      // Only the first is expanded: a run with ten failures should open as a
      // list you can scan, not as ten screenshots you have to scroll past.
      return `<details${i === 0 ? ' open' : ''}>
  <summary class="fail-head"><strong>${i + 1}/${bad.length} ${esc(r.scenario.name)}</strong>${where}</summary>
  ${step ? `<p><code>${esc(step.step.keyword)} ${esc(step.step.text)}</code> — line ${step.step.line}</p>
  <pre>${esc(step.error?.message ?? '')}</pre>` : '<p class="empty">No failing step recorded.</p>'}
  <div class="media">
    ${shot ? `<figure class="shot"><figcaption>Screenshot — bấm để xem cỡ thật</figcaption><a href="${esc(shot)}" target="_blank"><img src="${esc(shot)}" loading="lazy" alt="Screenshot at failure"></a></figure>` : ''}
    ${videoFigures(r, outDir)}
  </div>
</details>`;
    })
    .join('\n');
}

/**
 * Every attempt's recording, not just the last: when a retry passes, the video
 * worth watching belongs to the attempt that failed.
 */
function videoFigures(r: ScenarioResult, outDir: string): string {
  return r.runs
    .filter((run) => run.video)
    .map((run) => {
      const href = assetHref(outDir, run.video!);
      return `<figure><figcaption>Video — lần thử ${run.attempt} (${run.status})</figcaption>
<video src="${esc(href)}" controls preload="metadata" playsinline></video></figure>`;
    })
    .join('\n');
}

/**
 * Every recording of the run, in one section.
 *
 * There used to be two: per-scenario videos here, and the device's own screen
 * recording under its own heading further down. They ended up next to each
 * other saying opposite things — "No recordings for passing scenarios" directly
 * above a recording. A reader does not care which component produced a video.
 *
 * The device recording does not exist yet when this renders (it is a Device
 * Farm artifact, produced after the run ends), so the marker below is where
 * appendDeviceVideos splices it into this same section later.
 */
function recordings(results: ScenarioResult[], outDir: string): string {
  const withVideo = results.filter((r) => r.verdict === 'passed' && r.runs.some((x) => x.video));
  const perScenario = withVideo
    .map(
      (r) => `<details>
  <summary><strong>${esc(r.scenario.name)}</strong> — ${esc(r.platform)}/${esc(r.device)}</summary>
  <div class="media">${videoFigures(r, outDir)}</div>
</details>`,
    )
    .join('\n');

  const empty =
    perScenario === ''
      ? `<p class="empty" ${EMPTY_ATTR}>Chưa có bản ghi nào cho lượt chạy này.</p>`
      : '';
  return `${perScenario}\n<div class="media">${DEVICE_SLOT}</div>\n${empty}`;
}

/** Where appendDeviceVideos splices in, and the note it has to clear. */
/**
 * Seconds from the first scenario starting to the run ending.
 *
 * Not the runner's own wall clock, which starts much earlier: creating the
 * Appium session takes around eighteen seconds on a device, and during all of
 * it the screen shows nothing to do with the test. Anchoring on the runner made
 * the recording jump to second 8 when the app did not appear until second 28.
 *
 * `runs[].startedAt` is the moment a scenario attempt actually began — after
 * the session exists — so it is the first frame worth looking at.
 */
interface Chapter {
  name: string;
  status: string;
  /** Seconds after the first scenario started. */
  at: number;
}

/**
 * Where each scenario sits inside the device recording.
 *
 * A two-minute video of six scenarios with no markers is unreadable: you cannot
 * tell which case is running, and on this suite two thirds of the running time
 * is one scenario waiting out a timeout with the screen perfectly still. The
 * per-attempt start times are already in the report, so the recording can have
 * a table of contents instead of a scrubber and a guess.
 */
async function chaptersOf(runDir: string): Promise<Chapter[]> {
  const file = path.join(runDir, 'report.json');
  if (!existsSync(file)) return [];
  try {
    const { report } = JSON.parse(await readFile(file, 'utf8')) as { report: RunReport };
    const entries = report.results.flatMap((r) =>
      r.runs.map((run) => ({
        name: r.scenario.name,
        status: run.status,
        t: Date.parse(run.startedAt),
      })),
    );
    const valid = entries.filter((e) => !Number.isNaN(e.t)).sort((a, b) => a.t - b.t);
    const first = valid[0]?.t;
    if (first === undefined) return [];
    return valid.map((e) => ({ name: e.name, status: e.status, at: (e.t - first) / 1000 }));
  } catch {
    return [];
  }
}

async function testWindowSeconds(runDir: string): Promise<number | undefined> {
  const file = path.join(runDir, 'report.json');
  if (!existsSync(file)) return undefined;
  try {
    const { report } = JSON.parse(await readFile(file, 'utf8')) as { report: RunReport };
    const end = Date.parse(report.finishedAt);
    const starts = report.results
      .flatMap((r) => r.runs.map((run) => Date.parse(run.startedAt)))
      .filter((t) => !Number.isNaN(t));
    if (starts.length === 0 || Number.isNaN(end)) return undefined;
    const first = Math.min(...starts);
    return end <= first ? undefined : (end - first) / 1000;
  } catch {
    return undefined;
  }
}

const DEVICE_SLOT = '<!--device-recordings-->';
const SEEK_MARKER = 'data-device-seek';

/**
 * Starts the device recording where the test does.
 *
 * The offset is derived in the page rather than baked in, because the video's
 * length is only known once the browser has the metadata and the file carries
 * no absolute timestamp to line it up with. It is an estimate, so it is said to
 * be one, and nothing is cut — the recording is whole and the scrubber goes
 * back to zero. Trimming the file would have thrown away the install phase,
 * which is exactly where an install problem would show.
 */
const SEEK_SCRIPT = `<script ${SEEK_MARKER}>
for (const v of document.querySelectorAll('video[data-test-seconds]')) {
  v.addEventListener('loadedmetadata', () => {
    const test = Number(v.dataset.testSeconds);
    // Leave a couple of seconds of teardown out of the arithmetic rather than
    // risk landing after the first thing worth seeing.
    const skip = Math.max(0, v.duration - test - 2);
    const fig = v.parentElement;

    if (skip >= 1) {
      v.currentTime = skip;
      const note = document.createElement('figcaption');
      note.textContent = 'Bắt đầu ở ' + skip.toFixed(0) + 's — bỏ qua phần cài app và tạo session Appium (kéo về 0 để xem đủ).';
      fig.append(note);
    }

    let chapters = [];
    try { chapters = JSON.parse(v.dataset.chapters || '[]'); } catch (e) { chapters = []; }
    if (chapters.length < 2) return;

    // A scenario that only asserts shows an app sitting still, and one that
    // waits out a timeout shows nothing at all for a minute. Naming each
    // stretch is the difference between a recording and a puzzle.
    const list = document.createElement('ol');
    list.className = 'chapters';
    for (const c of chapters) {
      const at = skip + c.at;
      const mm = Math.floor(at / 60), ss = Math.floor(at % 60);
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'v-' + c.status;
      b.textContent = mm + ':' + String(ss).padStart(2, '0') + '  ' + c.name;
      b.onclick = () => { v.currentTime = at; v.play(); };
      li.append(b);
      list.append(li);
    }
    fig.append(list);
  }, { once: true });
}
</script>`;
const EMPTY_ATTR = 'data-recordings-empty';

function heals(report: RunReport): string {
  if (report.healSuggestions.length === 0) {
    return '<p class="empty">No locator needed healing this run.</p>';
  }
  return `<div class="wrap"><table>
<thead><tr><th>Element</th><th>Platform</th><th>Current</th><th>Proposed</th><th>Heals</th><th>Why</th></tr></thead>
<tbody>
${report.healSuggestions
  .map(
    (h) => `<tr>
  <td><code>${esc(h.elementId)}</code></td>
  <td>${esc(h.platform)}</td>
  <td><code>${esc(h.current.strategy)}=${esc(h.current.value)}</code></td>
  <td><code>${esc(h.proposed.strategy)}=${esc(h.proposed.value)}</code></td>
  <td>${h.successes}</td>
  <td>${esc(h.rationale)}</td>
</tr>`,
  )
  .join('\n')}
</tbody></table></div>`;
}

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
