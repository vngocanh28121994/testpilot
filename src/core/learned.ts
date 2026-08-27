import { existsSync } from 'node:fs';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Registry } from './registry.js';
import { RuntimeRegistry } from '../discovery/RuntimeRegistry.js';
import { FlakeDetector, type FlakePolicy } from '../flaky/detector.js';
import { HealingStore } from '../healing/HealingStore.js';
import type { ElementRegistry, RunReport } from './types.js';
import type { RuntimeRegistryData } from '../discovery/RuntimeRegistry.js';

/**
 * What one run of the suite learned, parked next to its report.
 *
 * Four stores outlive a run: the element registry, the runtime registry, the
 * flake history and the healing history. Each is persisted by rewriting its
 * whole file, which is fine for one run at a time and destructive the moment
 * two devices finish together — the later writer's file has no trace of what
 * the earlier one found, and nothing reports that anything was lost.
 *
 * So a run that shares its stores with siblings writes here instead, and one
 * coordinator folds every sibling in afterwards, in sequence. Only the element
 * and runtime registries need carrying: flakiness and healing are both derived
 * from the run's results, and those are already in report.json.
 */
export interface LearnedFromRun {
  version: 1;
  /** Not the registry as it now stands — only what this run added to it. */
  registry: ElementRegistry;
  runtime: RuntimeRegistryData;
}

export const LEARNED_FILE = 'learned.json';

export async function writeLearned(
  runDir: string,
  learned: Omit<LearnedFromRun, 'version'>,
): Promise<void> {
  const body: LearnedFromRun = { version: 1, ...learned };
  await writeFile(path.join(runDir, LEARNED_FILE), JSON.stringify(body, null, 2) + '\n', 'utf8');
}

export interface MergeSummary {
  runIds: string[];
  elementsMerged: number;
  runtimeEntriesMerged: number;
  healingEventsIngested: number;
  skipped: Array<{ runId: string; reason: string }>;
}

/**
 * Folds the learnings of several runs into the shared stores, once.
 *
 * Deliberately sequential and single-process: that is the whole mechanism.
 * Reading, merging and writing each store exactly once is what stops the
 * last-writer-wins race that made the parallel run unsafe in the first place.
 *
 * A run directory missing its learned.json is reported rather than skipped in
 * silence — it means that device wrote nothing, and a suite quietly learning
 * from two devices out of three is the failure this whole path exists to avoid.
 */
export async function mergeRunLearnings(opts: {
  runDirs: string[];
  runsRoot: string;
  registryPath: string;
  runtimeRegistryPath: string;
  flakeDbPath: string;
  healingDbPath: string;
  flakePolicy: FlakePolicy;
}): Promise<MergeSummary> {
  const summary: MergeSummary = {
    runIds: [],
    elementsMerged: 0,
    runtimeEntriesMerged: 0,
    healingEventsIngested: 0,
    skipped: [],
  };

  const registry = await Registry.load(opts.registryPath);
  const runtime = await RuntimeRegistry.load(opts.runtimeRegistryPath);
  const flake = await FlakeDetector.load(opts.flakeDbPath, opts.flakePolicy);
  const healing = await HealingStore.load(opts.healingDbPath);
  const merged: string[] = [];

  for (const dir of opts.runDirs) {
    const runId = path.basename(dir);
    summary.runIds.push(runId);

    const learnedFile = path.join(dir, LEARNED_FILE);
    if (existsSync(learnedFile)) {
      try {
        const learned = JSON.parse(await readFile(learnedFile, 'utf8')) as LearnedFromRun;
        registry.mergeFrom(learned.registry);
        runtime.mergeFrom(learned.runtime);
        summary.elementsMerged += Object.keys(learned.registry.elements ?? {}).length;
        summary.runtimeEntriesMerged += Object.keys(learned.runtime.entries ?? {}).length;
        merged.push(dir);
      } catch (err) {
        summary.skipped.push({ runId, reason: `learned.json unreadable: ${(err as Error).message}` });
      }
    } else {
      summary.skipped.push({ runId, reason: 'no learned.json' });
    }

    const report = await readReport(dir);
    if (!report) {
      summary.skipped.push({ runId, reason: 'no report.json' });
      continue;
    }
    // Flakiness is per scenario/platform/device, so three devices contribute
    // three independent histories and none of them overwrites another.
    flake.ingest(report.results ?? []);
    summary.healingEventsIngested += healing.ingest(
      runId,
      report.results ?? [],
      report.finishedAt,
    );
  }

  await registry.save();
  await runtime.save();
  await flake.save();
  await healing.save();

  // Consumed, so remove it. A delta is only correct applied once: candidates
  // would dedupe on a second pass, but the health counters would be added
  // again, and a run that merged twice would look twice as reliable as it was.
  // Healing has its own guard (a run id it has ingested is skipped); the
  // registry has none, and this is it.
  for (const dir of merged) {
    await rm(path.join(dir, LEARNED_FILE), { force: true });
  }

  return summary;
}

async function readReport(runDir: string): Promise<RunReport | undefined> {
  const file = path.join(runDir, 'report.json');
  if (!existsSync(file)) return undefined;
  try {
    const raw = JSON.parse(await readFile(file, 'utf8')) as { report?: RunReport } | RunReport;
    return 'report' in raw && raw.report ? raw.report : (raw as RunReport);
  } catch {
    return undefined;
  }
}

/** Run directories under `runsRoot` that carry a learned.json, newest last. */
export async function runDirsWithLearnings(runsRoot: string): Promise<string[]> {
  if (!existsSync(runsRoot)) return [];
  const out: string[] = [];
  for (const entry of await readdir(runsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(runsRoot, entry.name);
    if (existsSync(path.join(dir, LEARNED_FILE))) out.push(dir);
  }
  return out.sort();
}
