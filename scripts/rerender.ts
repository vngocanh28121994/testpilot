import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { appendDeviceVideos, writeHtmlReport } from '../src/report/html.js';
import type { RunReport } from '../src/core/types.js';
import type { FlakeVerdict } from '../src/flaky/detector.js';

/**
 * Rebuilds every run's HTML from the `report.json` beside it.
 *
 *   npm run rerender
 *
 * The report template changes — a layout fix, a new section — and without this
 * those changes only ever apply to runs that have not happened yet, while the
 * history you actually look at keeps the old rendering forever. `report.json`
 * holds the verdicts, so the HTML is a view and can be rebuilt at will.
 *
 * Verdicts are never recomputed here. They were decided on the device, against
 * the flake history as it stood at that moment, and recalculating them now
 * would quietly rewrite what a past run concluded.
 */
async function main(): Promise<void> {
  const cfg = await loadConfig('testpilot.config.json');
  const root = cfg.paths.runs;
  if (!existsSync(root)) {
    console.log(`[rerender] chưa có ${root}/`);
    return;
  }

  let done = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    const file = path.join(dir, 'report.json');
    if (!existsSync(file)) continue;

    try {
      const { report, verdicts } = JSON.parse(await readFile(file, 'utf8')) as {
        report: RunReport;
        verdicts: FlakeVerdict[];
      };
      await writeHtmlReport(report, verdicts ?? [], dir);
      const videos = await appendDeviceVideos(dir);
      console.log(`[rerender] ${entry.name}${videos ? ` (+${videos} video)` : ''}`);
      done++;
    } catch (err) {
      // One unreadable run must not stop the rest from being rebuilt.
      console.warn(`[rerender] bỏ qua ${entry.name}: ${(err as Error).message}`);
    }
  }
  console.log(`[rerender] xong ${done} run.`);
}

main().catch((err: Error) => {
  console.error(`[rerender] ${err.message}`);
  process.exit(1);
});
