/**
 * A cheap record must not evict an expensive one.
 *
 * History kept the newest 50 runs out of a single bucket, so the kind that runs
 * most often won. On this project that was Device Farm: 31 farm records had
 * squeezed the workflow history down to 12, and a workflow is minutes of
 * document reading, two model calls, a generated suite and a human review.
 * Re-running a suite twenty times should not cost the record of the run that
 * produced it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { retain, type WorkflowRun } from '../history.js';

/** Newest first, as `list()` produces. */
function runs(spec: Array<WorkflowRun['kind']>): WorkflowRun[] {
  return spec.map((kind, index) => ({
    id: `${kind}-${index}`,
    feature: kind,
    kind,
    // Descending timestamps so index 0 is the newest.
    startedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, spec.length - index)).toISOString(),
    status: 'passed',
    stages: [],
    log: [],
  }));
}

const count = (kept: WorkflowRun[], kind: WorkflowRun['kind']) =>
  kept.filter((run) => run.kind === kind).length;

describe('what survives a full history', () => {
  it('keeps the workflows a flood of farm runs would have evicted', () => {
    // The shape that caused the report: far more farm runs than workflows, and
    // more records in total than the cap.
    const kept = retain(runs([
      ...Array<WorkflowRun['kind']>(60).fill('farm'),
      ...Array<WorkflowRun['kind']>(20).fill('workflow'),
    ]));
    assert.equal(count(kept, 'workflow'), 20, 'không được mất workflow nào');
    assert.ok(kept.length <= 50, 'vẫn phải trong trần');
  });

  it('still caps the total', () => {
    const kept = retain(runs(Array<WorkflowRun['kind']>(200).fill('farm')));
    assert.equal(kept.length, 50);
  });

  it('protects only as many workflows as the quota promises', () => {
    // Beyond the quota a workflow is an ordinary record again, competing on
    // recency like everything else — the guarantee is a floor, not a licence to
    // grow without limit.
    const kept = retain(runs(Array<WorkflowRun['kind']>(80).fill('workflow')));
    assert.equal(kept.length, 50);
  });

  it('keeps the newest of each, not an arbitrary slice', () => {
    const all = runs([...Array<WorkflowRun['kind']>(60).fill('farm'), 'workflow']);
    const kept = retain(all);
    assert.equal(kept[0]?.id, all[0]?.id, 'bản ghi mới nhất luôn còn');
    assert.ok(kept.some((run) => run.kind === 'workflow'));
  });
});

describe('ordering', () => {
  it('returns the list in the order it was given', () => {
    // The file stays newest-first so a diff of history.json remains readable.
    const all = runs(['workflow', 'farm', 'farm', 'workflow']);
    const kept = retain(all);
    assert.deepEqual(kept.map((r) => r.id), all.map((r) => r.id));
  });

  it('leaves a short history completely alone', () => {
    const all = runs(['workflow', 'run', 'gen']);
    assert.deepEqual(retain(all), all);
  });
});
