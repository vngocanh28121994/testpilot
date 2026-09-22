/**
 * Hàng đợi bản bộ nhớ, đo bằng bộ khẳng định dùng chung.
 *
 * Cùng file khẳng định ấy chạy lại với Postgres trong
 * [pgQueue.integration.test.ts](./pgQueue.integration.test.ts).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryJobQueue, localQueue } from '../memoryQueue.js';
import { queueContract, logContract } from './queueContract.js';

describe('MemoryJobQueue', () => {
  queueContract(it, async () => new MemoryJobQueue());
  logContract(it, async () => new MemoryJobQueue());
});

describe('localQueue', () => {
  /**
   * Hồi quy viết TRƯỚC khi lỗi xảy ra, vì nó đã xảy ra hai lần rồi với
   * `OrphanTracker` và `MemoryLeaseRepo`: `fileRepos()` được dựng lại ở mỗi
   * request, nên thứ giữ trạng thái trong RAM phải có đúng một bản ở tầm
   * module. Một hàng đợi mới mỗi request nghĩa là job vừa tạo biến mất ở
   * request kế tiếp.
   */
  it('là một bản duy nhất cho cả tiến trình', async () => {
    const job = await localQueue.create({
      orgId: 'org-1', kind: 'gen', createdBy: 'u1',
      spec: { orgId: 'org-1', kind: 'gen', createdBy: 'u1', timeoutMs: 1_000, deviceTokens: [] },
    });
    const { localQueue: again } = await import('../memoryQueue.js');
    assert.ok(await again.find(job.id), 'lần import thứ hai phải thấy job của lần đầu');
    await again.finish(job.id, { type: 'job.result', jobId: job.id, state: 'cancelled' });
  });
});
