/**
 * Where the test actually starts inside a recording, and where each scenario
 * sits within it.
 *
 * A device recording covers the whole job: installing the app, standing up an
 * Appium session, then the run. On a short suite the interesting part can be
 * the last third of the file, and a two-minute video of six scenarios with no
 * markers is unreadable — you cannot tell which case is on screen, and a
 * scenario waiting out a timeout shows a perfectly still picture for a minute.
 *
 * Both facts are already in report.json, so they are derived rather than
 * stored. This module exists so the generated HTML report and the Horus UI read
 * them the same way: the report had the feature, the UI grew its own video
 * players without it, and the two quietly disagreed about what a recording
 * shows.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { RunReport } from '../core/types.js';

export interface Chapter {
  name: string;
  status: string;
  /** Seconds from the first scenario start, not from the start of the file. */
  at: number;
}

async function reportOf(runDir: string): Promise<RunReport | undefined> {
  const file = path.join(runDir, 'report.json');
  if (!existsSync(file)) return undefined;
  try {
    return (JSON.parse(await readFile(file, 'utf8')) as { report: RunReport }).report;
  } catch {
    return undefined;
  }
}

export async function chaptersOf(runDir: string): Promise<Chapter[]> {
  const report = await reportOf(runDir);
  if (!report) return [];
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
}

/** How many seconds of the recording are the test itself, counting from its end. */
export async function testWindowSeconds(runDir: string): Promise<number | undefined> {
  const report = await reportOf(runDir);
  if (!report) return undefined;
  const end = Date.parse(report.finishedAt);
  const starts = report.results
    .flatMap((r) => r.runs.map((run) => Date.parse(run.startedAt)))
    .filter((t) => !Number.isNaN(t));
  if (starts.length === 0 || Number.isNaN(end)) return undefined;
  const first = Math.min(...starts);
  return end <= first ? undefined : (end - first) / 1000;
}

/**
 * True for a recording of the whole job rather than of one scenario.
 *
 * Only these carry an install phase to skip past and several scenarios toindex
 * — a per-scenario clip is already at its own beginning and has exactly one
 * chapter, so marking it up with the run's timeline would label a 20-second
 * clip with events that happen minutes into a different file.
 */
export function isWholeRunRecording(file: string): boolean {
  return /^devicefarm-.*\.mp4$/i.test(file.split('/').pop() ?? '');
}
