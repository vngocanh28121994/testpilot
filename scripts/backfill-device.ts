import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DeviceFarmClient } from '@aws-sdk/client-device-farm';
import { loadConfig } from '../src/config.js';
import { listJobs } from '../src/farm/devicefarm.js';
import { reindex, type RunMeta } from '../src/core/runstore.js';

/**
 * Replaces the placeholder device name in old runs with the real one.
 *
 *   npm run backfill:device
 *
 * Runs recorded before the per-job pull all say "Android Device" — the default
 * string from the config file, invented by the runner, identical on every phone
 * in a pool. Device Farm keeps its job records for about a month, and a job
 * knows which handset it ran on, so the history can be corrected rather than
 * left lying.
 *
 * Only runs carrying a `farmRunArn` can be fixed; a local run never had a
 * device to name. A run whose ARN maps to several jobs is skipped rather than
 * guessed at — one directory cannot honestly claim one of three devices.
 */
async function main(): Promise<void> {
  const cfg = await loadConfig('testpilot.config.json');
  const root = cfg.paths.runs;
  if (!existsSync(root)) return console.log(`[backfill] chưa có ${root}/`);

  const client = new DeviceFarmClient({ region: cfg.farm.region });
  const jobsByRun = new Map<string, Awaited<ReturnType<typeof listJobs>>>();
  let fixed = 0;

  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(root, entry.name, 'meta.json');
    if (!existsSync(file)) continue;

    const meta = JSON.parse(await readFile(file, 'utf8')) as RunMeta;
    if (!meta.farmRunArn) {
      console.log(`  bỏ qua ${entry.name} — không phải run Device Farm`);
      continue;
    }

    let jobs = jobsByRun.get(meta.farmRunArn);
    if (!jobs) {
      jobs = await listJobs(client, meta.farmRunArn).catch(() => []);
      jobsByRun.set(meta.farmRunArn, jobs);
    }
    if (jobs.length === 0) {
      console.log(`  bỏ qua ${entry.name} — AWS không còn bản ghi job (thường giữ ~30 ngày)`);
      continue;
    }
    if (jobs.length > 1) {
      console.log(`  bỏ qua ${entry.name} — run có ${jobs.length} thiết bị, không đoán được cái nào`);
      continue;
    }

    const job = jobs[0]!;
    const device = job.deviceName + (job.os ? ` (Android ${job.os})` : '');
    if (meta.device === device) continue;
    console.log(`  ${entry.name}: "${meta.device ?? '—'}" → "${device}"`);
    meta.device = device;
    await writeFile(file, JSON.stringify(meta, null, 2) + '\n', 'utf8');
    fixed++;
  }

  await reindex(root);
  console.log(`[backfill] sửa ${fixed} run.`);
}

main().catch((err: Error) => {
  console.error(`[backfill] ${err.message}`);
  process.exit(1);
});
