import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { FARM_STAGES, History, type WorkflowRun } from '../core/history.js';
import { farmSecretEnv } from '../core/secrets.js';
import { poolPlatformMismatch } from '../farm/target.js';
import { collectFarmRun, scheduleFarmRun } from '../farm/devicefarm.js';
import type { TestPilotConfig } from '../config.js';
import { cleanLog } from './prereq.js';

/**
 * Chạy suite trên AWS Device Farm.
 *
 * Ở `src/runner/` chứ không ở `src/server/routes/` vì một lý do cụ thể: nó
 * đóng gói bundle bằng `npm run farm:bundle` — một tiến trình con trên chính
 * máy đang chạy. Phần ĐỌC của Device Farm (danh sách project, pool, thiết bị)
 * chỉ là gọi AWS SDK qua mạng, nên phần ấy ở lại control plane.
 *
 * Ranh giới không nằm ở "có phải Device Farm không", mà ở "có sinh tiến trình
 * trên máy này không".
 */
/** What a farm run left behind: its history record, and whether it passed. */
export interface FarmHandoff {
  id: string;
  passed: boolean;
}

export function spawnStep(bin: string, args: string[], log: (l: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    log(`$ ${bin} ${args.join(' ')}`);
    const child = spawn(bin, args, { env: process.env });
    const pipe = (chunk: Buffer) => chunk.toString().split('\n').filter(Boolean).forEach(log);
    child.stdout.on('data', pipe);
    child.stderr.on('data', pipe);
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${bin} ${args.join(' ')} thoát với mã ${code}.`)),
    );
  });
}

export async function runOnFarm(
  cfg: TestPilotConfig,
  bundle: boolean,
  log: (line: string) => void,
  stage: (run: WorkflowRun) => void,
): Promise<FarmHandoff> {
  const history = await History.load();
  const run = history.start(
    cfg.farm.runName || `${cfg.farm.platform}-farm`,
    'farm',
    FARM_STAGES,
  );
  run.platform = cfg.farm.platform;
  await history.save();
  stage(run);

  const record = (line: string) => {
    run.log.push(line);
    log(line);
  };
  /** Device Farm's stages are sequential, so entering one closes the previous. */
  const enter = (index: number) => {
    for (let i = 0; i < index; i++) {
      if (run.stages[i]!.status === 'running') run.stages[i]!.status = 'done';
    }
    if (run.stages[index]) run.stages[index]!.status = 'running';
    stage(run);
    // Persist on every transition. A farm run takes many minutes, and saving
    // only at the end left the history table reading "running 0/4" throughout —
    // indistinguishable from a job that never started.
    void history.save();
  };

  try {
    enter(0);
    if (bundle) {
      await spawnStep('npm', ['run', 'farm:bundle'], record);
    } else {
      record('Bỏ qua bước đóng gói — dùng lại zip có sẵn.');
    }

    const result = await scheduleFarmRun(
      // runs/ and not runs/<platform>/: the tree coming back from the device
      // already contains its own run directory, whose name carries the
      // platform. Joining a platform on here would nest it a second time.
      {
        ...cfg.farm,
        env: { ...cfg.farm.env, ...(await farmSecretEnv(cfg, record)) },
        runsDir: cfg.paths.runs,
        flakeDb: cfg.paths.flakeDb,
        healingDb: cfg.paths.healingDb,
        reportsDir: cfg.paths.reports,
        retention: cfg.retention,
      },
      { log: record, stage: enter },
    );

    for (const s of run.stages) if (s.status === 'running') s.status = 'done';
    record(`status=${result.status} result=${result.result}`);
    record(
      `AWS lifecycle counters (không phải testcase TestPilot) ${JSON.stringify(result.counters)}`,
    );

    // Include the URL, not just the name. Device Farm keeps the video and the
    // logs on its side, and a name alone means digging through the AWS console
    // to find the one artifact that explains the failure. These are presigned
    // and expire in a few hours, which is why the log says so.
    const interesting = new Set(['VIDEO', 'TESTSPEC_OUTPUT', 'DEVICE_LOG', 'CUSTOMER_ARTIFACT']);
    const linked = result.artifacts.filter((a) => interesting.has(a.type));
    for (const a of linked.slice(0, 12)) record(`${a.type.padEnd(18)} ${a.name} → ${a.url}`);
    if (linked.length > 0) record('(link Device Farm là presigned, hết hạn sau vài giờ)');
    for (const a of result.artifacts.filter((a) => !interesting.has(a.type)).slice(0, 20)) {
      record(`${a.type.padEnd(18)} ${a.name}`);
    }

    run.status = result.result === 'PASSED' ? 'passed' : 'failed';
    if (result.result !== 'PASSED') run.error = `Device Farm trả về ${result.result}.`;

    // Persist the full orchestration log next to each run directory so E2E
    // History can show it without requiring history.json cross-referencing.
    for (const dir of result.runDirs) {
      await writeFile(path.join(dir, 'log.txt'), run.log.join('\n'), 'utf8').catch(() => {});
    }
    // Link workflow run → device run directories so the UI can show videos and
    // report links without relying on fragile time-window matching.
    run.runDirs = result.runDirs.map((d) => path.basename(d));
  } catch (err) {
    for (const s of run.stages) if (s.status === 'running') s.status = 'failed';
    run.status = 'failed';
    run.error = (err as Error).message;
    throw err;
  } finally {
    run.finishedAt = new Date().toISOString();
    stage(run);
    await history.save();
  }
  // The id, so a workflow that handed off can link to this record instead of
  // duplicating its stages — and the verdict, because a farm run that finishes
  // with failing tests does not throw. Returning only the id let a workflow
  // call this, see no exception, and report itself green while the farm record
  // beside it said failed.
  return { id: run.id, passed: run.status === 'passed' };
}
