import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chaptersOf, isWholeRunRecording, testWindowSeconds, type Chapter } from './videoIndex.js';
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

  const files = (await readdir(dir)).filter(isWholeRunRecording).sort();
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
  /* A healed step succeeded, so it is not red — but it leaned on a spare
     locator, which is worth noticing rather than reading as a plain pass. */
  .v-healed{color:var(--flake)}
  /* Not a failure, so not red — but it must not read as a clean pass either,
     which is exactly what an uncoloured cell would do. */
  .v-unverified{color:#d19a66}
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

<h2>Locator healing — this run</h2>
${heals(report)}

<h2>Bước không chứng minh được kết quả</h2>
${unverified(report)}

<h2>Câu hỏi lượt chạy chưa tự quyết được</h2>
${openQuestions(report)}
</main></body></html>`;
}

/**
 * Decisions the run deferred instead of guessing.
 *
 * Shown, not asked. A workflow that pauses on every uncertainty becomes an
 * obstruction, and three days of real runs produced no question worth stopping
 * for — so these accumulate here until there is evidence that a blocking gate
 * would earn its keep.
 */
function openQuestions(report: RunReport): string {
  const questions = report.openQuestions ?? [];
  if (questions.length === 0) {
    return '<p class="empty">Lượt chạy này không có điểm nào phải hỏi.</p>';
  }
  return questions.map((q) => `<div class="wrap">
  <p><strong>${esc(q.prompt)}</strong></p>
  ${q.scenario ? `<p class="dim">${esc(q.scenario)}${q.line ? ` · dòng ${q.line}` : ''}</p>` : ''}
  ${q.reason ? `<p>${esc(q.reason)}</p>` : ''}
  ${q.options?.length ? `<ul>${q.options.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>` : ''}
</div>`).join('\n');
}

/**
 * Steps that ran clean but proved nothing.
 *
 * These never reach the failures table — the run is green — so without a
 * section of their own they exist only in report.json. A tap whose outcome is
 * unobservable is how a click that did nothing stayed green for a whole day.
 */
function unverified(report: RunReport): string {
  const rows = report.results.flatMap((r) =>
    (r.runs.at(-1)?.steps ?? [])
      .filter((step) => step.status === 'unverified')
      .map((step) => ({ scenario: r.scenario.name, step })));
  if (rows.length === 0) {
    return '<p class="empty">Mọi hành động trong lượt chạy này đều có bằng chứng thay đổi.</p>';
  }
  return `<div class="wrap"><table>
<thead><tr><th>Scenario</th><th>Bước</th><th>Dòng</th></tr></thead>
<tbody>
${rows
  .map(({ scenario, step }) => `<tr>
  <td>${esc(scenario)}</td>
  <td class="v-unverified">${esc(step.step.text)}</td>
  <td>${step.step.line}</td>
</tr>`)
  .join('\n')}
</tbody></table></div>`;
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
      // Screenshots the scenario asked for on its way to failing. They are the
      // steps someone wrote precisely because that moment was worth seeing, and
      // showing them beside the failure shot is the difference between "it
      // broke here" and "here is what it looked like getting there".
      const staged = (last?.steps ?? [])
        .filter((st) => st.status !== 'failed' && st.screenshot)
        .map((st) => ({
          href: assetHref(outDir, st.screenshot!),
          label: st.step.text.replace(/^I take a screenshot named "(.*)"$/i, '$1'),
        }));
      const where = manyDevices ? `<span class="where">${esc(r.platform)}/${esc(r.device)}</span>` : '';
      // Only the first is expanded: a run with ten failures should open as a
      // list you can scan, not as ten screenshots you have to scroll past.
      return `<details${i === 0 ? ' open' : ''}>
  <summary class="fail-head"><strong>${i + 1}/${bad.length} ${esc(r.scenario.name)}</strong>${where}</summary>
  ${step ? `<p><code>${esc(step.step.keyword)} ${esc(step.step.text)}</code> — line ${step.step.line}</p>
  <pre>${esc(step.error?.message ?? '')}</pre>` : '<p class="empty">No failing step recorded.</p>'}
  <div class="media">
    ${shot ? `<figure class="shot"><figcaption>Screenshot khi fail — bấm để xem cỡ thật</figcaption><a href="${esc(shot)}" target="_blank"><img src="${esc(shot)}" loading="lazy" alt="Screenshot at failure"></a></figure>` : ''}
    ${staged.map((sh) => `<figure class="shot"><figcaption>${esc(sh.label)}</figcaption><a href="${esc(sh.href)}" target="_blank"><img src="${esc(sh.href)}" loading="lazy" alt="${esc(sh.label)}"></a></figure>`).join('\n    ')}
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
  const events = report.results.flatMap((result) =>
    result.runs.flatMap((run) => run.steps.flatMap((step) =>
      step.heal ? [{ platform: result.platform, step }] : [],
    )),
  );
  if (events.length === 0) {
    return '<p class="empty">No locator healing event was recorded in this run.</p>';
  }
  return `<div class="wrap"><table>
<thead><tr><th>Step</th><th>Element</th><th>Platform</th><th>Primary failed</th><th>Recovered with</th><th>Result</th></tr></thead>
<tbody>
${events
  .map(
    ({ platform, step }) => `<tr>
  <td>${esc(step.step.text)}</td>
  <td><code>${esc(step.heal!.elementId)}</code></td>
  <td>${esc(platform)}</td>
  <td><code>${esc(step.heal!.from.strategy)}=${esc(step.heal!.from.value)}</code></td>
  <td><code>${esc(step.heal!.to.strategy)}=${esc(step.heal!.to.value)}</code></td>
  <td class="v-${step.status}">${esc(step.status)}</td>
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
