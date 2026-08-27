/**
 * Two History instances, one file.
 *
 * A workflow keeps its own History for its record, and the Device Farm handoff
 * opens another for the farm run. Each instance holds only the runs it loaded,
 * so a write that dumps the instance's array wholesale deletes whatever the
 * other one added — the farm record disappeared the moment the workflow saved
 * again, taking the only trace of a run that had already spent device minutes.
 */
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { test } from 'node:test';

import { History } from '../history.js';

const FILE = 'artifacts/test-history-concurrent.json';

async function fresh(): Promise<void> {
  await rm(FILE, { force: true });
}

test('a run added by another instance survives this one saving', async () => {
  await fresh();
  const workflow = await History.load(FILE);
  const workflowRun = workflow.start('feature-x', 'workflow', ['a', 'b']);
  await workflow.save();

  const farmSide = await History.load(FILE);
  const farmRun = farmSide.start('android-farm', 'farm', ['p', 'q']);
  farmRun.status = 'failed';
  await farmSide.save();

  // The workflow now records the handoff and saves — the write that used to
  // erase the farm record.
  workflowRun.farmRunId = farmRun.id;
  workflowRun.status = 'passed';
  await workflow.save();

  const reloaded = await History.load(FILE);
  assert.ok(reloaded.find(farmRun.id), 'farm run must survive the workflow save');
  assert.equal(reloaded.find(farmRun.id)!.status, 'failed');
  assert.equal(reloaded.find(workflowRun.id)!.status, 'passed');
  assert.equal(reloaded.find(workflowRun.id)!.farmRunId, farmRun.id);
  await fresh();
});

test('the live instance wins for runs it owns, rather than the older copy on disk', async () => {
  await fresh();
  const a = await History.load(FILE);
  const run = a.start('feature-y', 'workflow', ['s']);
  await a.save();

  // Someone else reads the running state and writes it back unchanged.
  const b = await History.load(FILE);
  await b.save();

  run.status = 'passed';
  await a.save();

  const reloaded = await History.load(FILE);
  assert.equal(reloaded.find(run.id)!.status, 'passed');
  assert.equal(reloaded.list().length, 1, 'merging must not duplicate a run');
  await fresh();
});

test('merging does not resurrect runs retention dropped', async () => {
  await fresh();
  const writer = await History.load(FILE);
  // Comfortably past both caps, so retention certainly discards some.
  for (let i = 0; i < 120; i++) {
    const r = writer.start(`farm-${i}`, 'farm', ['x']);
    r.startedAt = new Date(Date.now() - i * 60_000).toISOString();
  }
  await writer.save();
  const first = (await History.load(FILE)).list().length;

  // A second save must not pull the discarded ones back out of the file.
  await writer.save();
  assert.equal((await History.load(FILE)).list().length, first);
  await fresh();
});
