import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * One directory per run, instead of one directory per platform.
 *
 * The previous layout wrote `reports/<platform>/index.html` and
 * `artifacts/<platform>/video/<scenario>.webm` — both fixed paths, so the
 * second run of a platform silently destroyed the evidence from the first. A
 * suite that is going to be run hundreds of times, and whose whole point is
 * telling you *why* run #57 failed, cannot keep exactly one run.
 *
 * A run directory is self-contained:
 *
 *   runs/2026-08-07T18-45-46Z-android-login/
 *     meta.json  index.html  report.json  artifacts/…
 *
 * Because the artifacts sit inside it, the report's links are relative to the
 * directory itself, so the whole thing can be zipped and sent to someone else
 * and still work.
 */

export interface RunMeta {
  /** Directory name — also the id, and sorts chronologically. */
  id: string;
  platform: string;
  kind: 'run' | 'farm';
  tag?: string;
  device?: string;
  status: 'running' | 'passed' | 'failed';
  startedAt: string;
  finishedAt?: string;
  counters?: { total: number; passed: number; failed: number; quarantined: number };
  /** Present when the run came back from Device Farm. */
  farmRunArn?: string;
}

export interface RetentionPolicy {
  /** Failures are the reason this store exists; they are kept the longest. */
  keepFailedDays: number;
  /** A passing run is a baseline. You need a few, not fifty. */
  keepPassedPerPlatform: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = { keepFailedDays: 30, keepPassedPerPlatform: 3 };

/**
 * `2026-08-07T18-45-46Z-android-login`.
 *
 * The timestamp leads so that a plain lexicographic sort — of `readdir`, of
 * `ls`, of the UI's list — is chronological order with no date parsing
 * anywhere. The platform and tag follow so the directory is identifiable at a
 * glance in a terminal.
 */
export function runDirName(startedAt: string, platform: string, tag?: string): string {
  const stamp = new Date(startedAt).toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z');
  const slug = tag ? `-${tag.replace(/^@/, '').replace(/[^a-zA-Z0-9]+/g, '-')}` : '';
  return `${stamp}-${platform}${slug}`;
}

export function runDirFor(root: string, startedAt: string, platform: string, tag?: string): string {
  return path.join(root, runDirName(startedAt, platform, tag));
}

export async function writeRunMeta(dir: string, meta: RunMeta): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');
}

/**
 * Rebuilds `runs/index.json` by scanning the directory.
 *
 * Derived from disk rather than appended to, so the index cannot drift from
 * what is actually there. Deleting a run directory by hand is a supported way
 * to delete a run.
 */
export async function reindex(root: string): Promise<RunMeta[]> {
  if (!existsSync(root)) return [];
  const metas: RunMeta[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(root, entry.name, 'meta.json');
    if (!existsSync(file)) continue;
    try {
      metas.push(JSON.parse(await readFile(file, 'utf8')) as RunMeta);
    } catch {
      // A half-written meta.json means the process died mid-run. Skipping it
      // loses one row; throwing would lose the whole history page.
    }
  }
  // By startedAt, not by id. Run directories are named so that a lexicographic
  // sort is chronological, but that is a convention about names; the timestamp
  // is data. A directory renamed or created by hand still sorts correctly here.
  metas.sort((a, b) => {
    const d = Date.parse(b.startedAt ?? '') - Date.parse(a.startedAt ?? '');
    return Number.isNaN(d) || d === 0 ? b.id.localeCompare(a.id) : d;
  });
  await writeFile(
    path.join(root, 'index.json'),
    JSON.stringify({ version: 1, runs: metas }, null, 2) + '\n',
    'utf8',
  );
  return metas;
}

export async function listRuns(root: string): Promise<RunMeta[]> {
  const file = path.join(root, 'index.json');
  if (!existsSync(file)) return reindex(root);
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as { runs?: RunMeta[] };
    return parsed.runs ?? [];
  } catch {
    return reindex(root);
  }
}

/**
 * Deletes run directories the policy no longer wants, and returns their ids.
 *
 * Directory and index entry go together — the index is rebuilt from disk at the
 * end — which is what stops the old failure mode where trimming the history
 * JSON to 50 entries left the artifacts behind as unattributable orphans.
 *
 * A run still marked `running` is never touched: it is either in progress right
 * now, or it is the crash you are trying to investigate.
 */
export async function prune(
  root: string,
  policy: RetentionPolicy = DEFAULT_RETENTION,
): Promise<string[]> {
  const runs = await reindex(root);
  const cutoff = Date.now() - policy.keepFailedDays * 86_400_000;
  const passedSeen = new Map<string, number>();
  const doomed: RunMeta[] = [];

  // Newest first, so "keep the newest N passing" is a running count.
  for (const r of runs) {
    if (r.status === 'running') continue;
    if (r.status === 'failed') {
      if (new Date(r.startedAt).getTime() < cutoff) doomed.push(r);
      continue;
    }
    const n = (passedSeen.get(r.platform) ?? 0) + 1;
    passedSeen.set(r.platform, n);
    if (n > policy.keepPassedPerPlatform) doomed.push(r);
  }

  for (const r of doomed) await rm(path.join(root, r.id), { recursive: true, force: true });
  if (doomed.length > 0) await reindex(root);
  return doomed.map((r) => r.id);
}

/**
 * Points `reports/latest-<platform>` at the newest run for that platform.
 *
 * Everything that used to hardcode `reports/<platform>/index.html` — bookmarks,
 * CI steps, muscle memory — keeps working, without any of them having to learn
 * how run directories are named.
 */
export async function linkLatest(
  reportsRoot: string,
  platform: string,
  runDir: string,
): Promise<void> {
  await mkdir(reportsRoot, { recursive: true });
  const link = path.join(reportsRoot, `latest-${platform}`);
  await unlink(link).catch(() => {});
  const target = path.relative(reportsRoot, path.resolve(runDir));
  // A symlink is cosmetic; on a filesystem that refuses one, the run directory
  // is still complete and the UI still finds it through the index.
  await symlink(target, link, 'dir').catch(() => {});
}
