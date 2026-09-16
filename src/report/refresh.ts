import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { RunReport } from '../core/types.js';
import type { FlakeVerdict } from '../flaky/detector.js';
import {
  appendDeviceVideos,
  REPORT_RENDER_MARKER,
  writeHtmlReport,
} from './html.js';

export interface KnownIssueLookup {
  active(id: string, contentHash: string): { note: string } | undefined;
}

const refreshing = new Map<string, Promise<boolean>>();

/**
 * Upgrade a static historical report to the current renderer exactly once.
 *
 * `report.json` remains the source of truth. Only the presentation is rebuilt;
 * screenshots, recordings, logs and verdict data are not regenerated. Device
 * videos are appended again because they are collected after the original HTML
 * was written.
 */
export function refreshHtmlReportIfStale(
  runDir: string,
  knownIssues: KnownIssueLookup,
): Promise<boolean> {
  const existing = refreshing.get(runDir);
  if (existing) return existing;
  const work = refresh(runDir, knownIssues).finally(() => refreshing.delete(runDir));
  refreshing.set(runDir, work);
  return work;
}

async function refresh(runDir: string, knownIssues: KnownIssueLookup): Promise<boolean> {
  const indexFile = path.join(runDir, 'index.html');
  const jsonFile = path.join(runDir, 'report.json');
  if (!existsSync(indexFile) || !existsSync(jsonFile)) return false;

  const current = await readFile(indexFile, 'utf8').catch(() => '');
  if (current.includes(REPORT_RENDER_MARKER)) return false;

  const stored = JSON.parse(await readFile(jsonFile, 'utf8')) as {
    report?: RunReport;
    verdicts?: FlakeVerdict[];
  };
  if (!stored.report) return false;

  const known = new Map<string, string>();
  for (const result of stored.report.results) {
    const hash = result.scenario.contentHash;
    if (!hash) continue;
    const issue = knownIssues.active(result.scenario.id, hash);
    if (issue) known.set(result.scenario.id, issue.note);
  }

  await writeHtmlReport(stored.report, stored.verdicts ?? [], runDir, known);
  await appendDeviceVideos(runDir);
  return true;
}
