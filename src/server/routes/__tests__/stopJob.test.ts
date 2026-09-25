/**
 * Nút Dừng dừng ĐÚNG job của người bấm — không phải mọi thứ máy chủ đang chạy.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryJobQueue } from '../../queue/memoryQueue.js';
import { trackJob, untrackJob } from '../../../runner/jobControl.js';
import { stopJob } from '../run.js';

const ME = { orgId: 'org-1', userId: 'u1' };

function job(createdBy = 'u1') {
  return {
    orgId: 'org-1', kind: 'run_suite' as const, createdBy,
    spec: {
      orgId: 'org-1', kind: 'run_suite' as const, createdBy, timeoutMs: 60_000,
      deviceTokens: [], run: { platform: 'android', tag: '@smoke' },
    },
  };
}

describe('stopJob', () => {
  it('job còn chờ thì huỷ luôn', async () => {
    const queue = new MemoryJobQueue();
    const { id } = await queue.create(job());
    const result = await stopJob(queue, id, ME, false);
    assert.equal(result.outcome, 'cancelled');
    assert.equal((await queue.find(id))?.state, 'cancelled');
  });

  it('job đang chạy ở tiến trình này thì dừng RIÊNG nó', async () => {
    const queue = new MemoryJobQueue();
    const mine = await queue.create(job());
    const other = await queue.create(job());
    await queue.claim({ runnerId: 'local' });
    await queue.claim({ runnerId: 'local' });
    const mineAbort = trackJob(mine.id);
    const otherAbort = trackJob(other.id);
    try {
      const result = await stopJob(queue, mine.id, ME, false);
      assert.equal(result.outcome, 'stopping');
      assert.equal(mineAbort.signal.aborted, true);
      assert.equal(otherAbort.signal.aborted, false, 'job bên cạnh không được bị dừng theo');
    } finally {
      untrackJob(mine.id);
      untrackJob(other.id);
    }
  });

  it('job đang chạy ở runner khác thì nói thẳng là chưa dừng từ xa được', async () => {
    const queue = new MemoryJobQueue();
    const { id } = await queue.create(job());
    await queue.claim({ runnerId: 'laptop-cua-binh' });
    const result = await stopJob(queue, id, ME, false);
    assert.equal(result.outcome, 'elsewhere');
    assert.match(result.message, /chưa dừng từ xa được/);
    assert.equal((await queue.find(id))?.state, 'running');
  });

  it('job của người khác: chỉ admin mới dừng được', async () => {
    const queue = new MemoryJobQueue();
    const { id } = await queue.create(job('u2'));
    assert.equal((await stopJob(queue, id, ME, false)).outcome, 'forbidden');
    assert.equal((await queue.find(id))?.state, 'queued');
    assert.equal((await stopJob(queue, id, ME, true)).outcome, 'cancelled');
  });

  it('job đã xong hoặc không tồn tại thì nói đúng như vậy', async () => {
    const queue = new MemoryJobQueue();
    const { id } = await queue.create(job());
    await queue.finish(id, { type: 'job.result', jobId: id, state: 'succeeded' });
    assert.equal((await stopJob(queue, id, ME, false)).outcome, 'finished');
    assert.equal((await stopJob(queue, 'khong-co', ME, false)).outcome, 'missing');
  });
});
