import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Platform, RunReport } from './types.js';
import type { RunMeta } from './runstore.js';
import { writeRunMeta } from './runstore.js';
import { interruptedReportFromCheckpoint, readRunCheckpoint } from './runCheckpoint.js';
import { writeHtmlReport } from '../report/html.js';

const INTERRUPTION_REASON =
  'Tiến trình chạy đã dừng trước khi hoàn tất (server khởi động lại, máy bị tắt hoặc tiến trình bị kết thúc).';

/**
 * Materialise readable reports for runs that startup just marked interrupted.
 *
 * New runs use structured run-state.json. The log parser exists only so runs
 * made before that checkpoint file was introduced do not remain invisible; it
 * is labelled as reconstructed and never manufactures ScenarioResult details.
 */
export async function recoverInterruptedRunReports(
  root: string,
  onlyIds?: Iterable<string>,
): Promise<string[]> {
  if (!existsSync(root)) return [];
  const allow = onlyIds ? new Set(onlyIds) : undefined;
  const recovered: string[] = [];

  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || (allow && !allow.has(entry.name))) continue;
    const runDir = path.join(root, entry.name);
    try {
      const meta = await readMeta(runDir);
      if (!meta || meta.status !== 'interrupted') continue;
      if (existsSync(path.join(runDir, 'index.html'))) continue;

      const checkpoint = await readRunCheckpoint(runDir);
      const finishedAt = meta.finishedAt ?? new Date().toISOString();
      const report = checkpoint
        ? interruptedReportFromCheckpoint(checkpoint, finishedAt, INTERRUPTION_REASON)
        : await legacyInterruptedReport(runDir, meta, finishedAt);

      await writeHtmlReport(report, [], runDir);
      const passed = report.results.filter((result) => result.verdict === 'passed').length
        + (report.interruption?.logRecoveredResults?.filter((result) => result.verdict === 'passed').length ?? 0);
      const failed = report.results.filter((result) => result.verdict === 'failed').length
        + (report.interruption?.logRecoveredResults?.filter((result) => result.verdict === 'failed').length ?? 0);
      const flaky = report.results.filter((result) => result.verdict === 'flaky').length
        + (report.interruption?.logRecoveredResults?.filter((result) => result.verdict === 'flaky').length ?? 0);
      const knownTotal = passed + failed + flaky + report.quarantined.length
        + (report.interruption?.activeScenario ? 1 : 0)
        + (report.interruption?.notRun.length ?? 0);

      await writeRunMeta(runDir, {
        ...meta,
        ...(checkpoint?.device ? { device: checkpoint.device } : {}),
        finishedAt,
        ...(checkpoint ? {
          counters: {
            total: knownTotal,
            passed,
            failed,
            quarantined: report.quarantined.length,
          },
        } : {}),
      });
      recovered.push(meta.id);
    } catch {
      // A corrupt artifact must not prevent the UI server from starting and
      // recovering other independent runs.
    }
  }

  return recovered;
}

async function readMeta(runDir: string): Promise<RunMeta | undefined> {
  try {
    return JSON.parse(await readFile(path.join(runDir, 'meta.json'), 'utf8')) as RunMeta;
  } catch {
    return undefined;
  }
}

async function legacyInterruptedReport(
  runDir: string,
  meta: RunMeta,
  finishedAt: string,
): Promise<RunReport> {
  const recovered = new Map<string, 'passed' | 'failed' | 'flaky'>();
  let activeScenario: { name: string } | undefined;
  try {
    const log = await readFile(path.join(runDir, 'log.txt'), 'utf8');
    for (const line of log.split(/\r?\n/)) {
      const running = line.match(/^\[run:running\]\s+…\s+(.+)$/u);
      if (running?.[1]) {
        activeScenario = { name: running[1].trim() };
        continue;
      }
      const terminal = line.match(/^\[run:(passed|failed|flaky)\]\s+\S+\s+(.+)$/u);
      if (!terminal?.[1] || !terminal[2]) continue;
      const name = terminal[2].trim();
      recovered.set(name, terminal[1] as 'passed' | 'failed' | 'flaky');
      if (activeScenario?.name === name) activeScenario = undefined;
    }
  } catch {
    // Metadata-only report is still more truthful than hiding the run.
  }

  return {
    runId: meta.id,
    startedAt: meta.startedAt,
    finishedAt,
    status: 'interrupted',
    results: [],
    healSuggestions: [],
    quarantined: [],
    interruption: {
      reason: INTERRUPTION_REASON,
      platform: asPlatform(meta.platform),
      ...(meta.device ? { device: meta.device } : {}),
      ...(activeScenario ? { activeScenario } : {}),
      notRun: [],
      ...(recovered.size > 0 ? {
        logRecoveredResults: [...recovered].map(([name, verdict]) => ({ name, verdict })),
      } : {}),
      source: recovered.size > 0 || activeScenario ? 'log' : 'metadata',
    },
  };
}

function asPlatform(value: string): Platform {
  return value === 'android' || value === 'ios' ? value : 'web';
}
