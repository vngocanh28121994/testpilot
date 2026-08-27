/**
 * Prints every step of a run, with the distinction the HTML report makes and
 * an ad-hoc script usually loses: a healed step is not a failed one.
 *
 * Written after a throwaway printer marked `status: 'healed'` with a cross,
 * which read as "entering the password failed" — for a step whose password went
 * in fine and whose login returned 200. A step that fell back to a spare
 * locator and carried on is a success with a note attached, and the note is
 * worth reading: it names the locator that stopped matching.
 *
 *   npm run show:run                     # lượt chạy gần nhất
 *   npm run show:run -- runs/<thư mục>
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { RunReport, StepResult } from '../src/core/types.js';

const MARK: Record<string, string> = {
  passed: '✓',
  healed: '↻',
  flaky: '~',
  failed: '✗',
  skipped: '⊘',
};

async function latestRun(runsDir: string): Promise<string> {
  const entries = await readdir(runsDir);
  const dirs = entries.filter((e) => /^\d{4}-\d{2}-\d{2}T/.test(e)).sort();
  const last = dirs[dirs.length - 1];
  if (!last) throw new Error(`Chưa có lượt chạy nào trong ${runsDir}.`);
  return path.join(runsDir, last);
}

function line(index: number, step: StepResult): string {
  const mark = MARK[step.status] ?? '?';
  const ms = String(step.durationMs ?? 0).padStart(6);
  return `  ${mark} ${String(index).padStart(2)} [${ms}ms] ${step.step?.text ?? ''}`;
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  const dir = arg ?? (await latestRun('runs'));
  const file = path.join(dir, 'report.json');
  const { report } = JSON.parse(await readFile(file, 'utf8')) as { report: RunReport };

  console.log(`${dir}\n`);
  const totals: Record<string, number> = {};

  for (const result of report.results) {
    console.log(`## ${result.scenario.name} — ${result.platform}/${result.device} → ${result.verdict}`);
    result.runs.forEach((run, attempt) => {
      if (result.runs.length > 1) console.log(`  -- lần thử ${attempt + 1}: ${run.status ?? ''}`);
      run.steps.forEach((step, i) => {
        totals[step.status] = (totals[step.status] ?? 0) + 1;
        console.log(line(i + 1, step));
        // The reason the step is not a plain ✓ — printed underneath rather than
        // left to the reader to go and look up in report.json.
        if (step.heal) {
          console.log(`       ↳ ${step.heal.elementId}: `
            + `${step.heal.from.strategy}=${step.heal.from.value}  ✗`
            + `  →  ${step.heal.to.strategy}=${step.heal.to.value}  ✓`);
        }
        if (step.error) {
          const message = typeof step.error === 'string'
            ? step.error
            : (step.error as { message?: string }).message ?? '';
          console.log(`       ERR: ${message.split('\n')[0]}`);
        }
      });
    });
    console.log('');
  }

  const summary = Object.entries(totals)
    .map(([status, n]) => `${MARK[status] ?? '?'} ${n} ${status}`)
    .join('   ');
  console.log(summary || 'Không có bước nào.');
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
