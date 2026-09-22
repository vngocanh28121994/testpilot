/**
 * Điều duy nhất đáng canh ở đây: KHÔNG mở kho khi không ai hỏi dữ liệu.
 *
 * Đây là hồi quy của một lỗi thật, và nó thuộc loại không tự lộ: nếu `lazyRepos`
 * lặng lẽ dựng sớm trở lại, mọi test khác vẫn xanh — chỉ `/api/health` trong
 * container là lại nói về file cấu hình.
 */
import { MemoryProposalStore } from '../../proposals/memoryStore.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lazyRepos } from '../lazyRepos.js';
import type { Repos } from '../repo.js';

function stub(onOpen: () => void): () => Repos {
  return () => {
    onOpen();
    return {
      registry: {
        read: async () => ({ data: { elements: {} } as never, revision: 'r1' }),
        write: async (next) => ({ data: next, revision: 'r2' }),
        merge: async (delta) => ({ data: delta, revision: 'r3' }),
      },
      jobs: { list: async () => [], find: async () => undefined, closeInterrupted: async () => 0 },
      runs: { list: async () => [], find: async () => undefined },
      leases: {
        acquire: async () => { throw new Error('không dùng ở test này'); },
        renew: async () => undefined,
        release: async () => false,
        list: async () => [],
        find: async () => undefined,
        reap: async () => 0,
      },
      proposals: new MemoryProposalStore(),
      queue: {
        create: async () => { throw new Error('không dùng ở test này'); },
        find: async () => undefined,
        list: async () => [],
        claim: async () => undefined,
        finish: async () => undefined,
        defer: async () => undefined,
        release: async () => undefined,
        interruptStale: async () => 0,
        appendLog: async () => {},
        onLog: async () => () => {},
        onState: async () => () => {},
      },
    };
  };
}

describe('lazyRepos', () => {
  it('không mở kho khi handler không đọc dữ liệu', () => {
    let opened = 0;
    const repos = lazyRepos(stub(() => { opened += 1; }));
    // Chạm vào cả ba nhánh mà không gọi phương thức nào.
    void repos.registry; void repos.jobs; void repos.runs; void repos.leases; void repos.queue;
    assert.equal(opened, 0);
  });

  it('mở kho ở lời gọi đầu tiên, và chỉ một lần', async () => {
    let opened = 0;
    const repos = lazyRepos(stub(() => { opened += 1; }));
    assert.equal((await repos.registry.read()).revision, 'r1');
    assert.equal(opened, 1);
    await repos.jobs.list();
    await repos.runs.list();
    assert.equal(opened, 1, 'mỗi nhánh mở kho riêng thì mỗi request nhân số kết nối');
  });

  it('lỗi mở kho nổi ra ở chỗ cần dữ liệu, không ở lúc điều phối', async () => {
    const repos = lazyRepos(() => { throw new Error('No config at /app/...'); });
    await assert.rejects(() => repos.registry.read(), /No config/);
  });

  it('chuyển đủ tham số xuống repo thật', async () => {
    const seen: unknown[] = [];
    const repos = lazyRepos(() => ({
      registry: {
        read: async () => ({ data: {} as never, revision: undefined }),
        write: async (next, base) => { seen.push(next, base); return { data: next, revision: 'x' }; },
        merge: async (delta) => ({ data: delta, revision: 'x' }),
      },
      jobs: { list: async () => [], find: async () => undefined, closeInterrupted: async () => 0 },
      runs: { list: async () => [], find: async () => undefined },
      leases: {
        acquire: async () => { throw new Error('không dùng ở test này'); },
        renew: async () => undefined,
        release: async () => false,
        list: async () => [],
        find: async () => undefined,
        reap: async () => 0,
      },
      proposals: new MemoryProposalStore(),
      queue: {
        create: async () => { throw new Error('không dùng ở test này'); },
        find: async () => undefined,
        list: async () => [],
        claim: async () => undefined,
        finish: async () => undefined,
        defer: async () => undefined,
        release: async () => undefined,
        interruptStale: async () => 0,
        appendLog: async () => {},
        onLog: async () => () => {},
        onState: async () => () => {},
      },
    }));
    const payload = { elements: {} } as never;
    await repos.registry.write(payload, 'rev-7');
    assert.deepEqual(seen, [payload, 'rev-7']);
  });
});
