/**
 * Worker: từ "job nằm trong hàng đợi" tới "job đã chạy xong".
 *
 * Runner được TIÊM bản giả, nên bài test này không chạm vào một chiếc điện
 * thoại nào và chạy trong vài mili giây. Thứ nó đo là phần dễ sai mà khó thấy:
 * job nào được nhận, log đi đâu, và trạng thái cuối là gì cho từng kiểu kết
 * thúc — xong, hỏng, bị dừng.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryJobQueue } from '../../server/queue/memoryQueue.js';
import { startWorker } from '../worker.js';
import type { Runner } from '../index.js';
import type { JobState } from '../../protocol/messages.js';

interface FakeRun {
  calls: Array<{ platform: string; tag?: string; device?: string }>;
  parallel: Array<{ platforms: string; tokens: string[] }>;
}

/** Runner giả: ghi lại lời gọi, in ra vài dòng, rồi trả mã thoát định sẵn. */
function fakeRunner(outcome: { code: number | null; stopped?: boolean } | Error): {
  runner: Runner; seen: FakeRun;
} {
  const seen: FakeRun = { calls: [], parallel: [] };
  const runner = {
    run: {
      parseDeviceToken: (token: string) => {
        const [platform, ...rest] = token.split(':');
        const id = rest.join(':');
        if (!id || (platform !== 'android' && platform !== 'ios')) return null;
        return { platform, id } as { platform: 'android' | 'ios'; id: string };
      },
      isNamedDevice: async () => true,
      startSuite: async (
        platform: string, tag: string | undefined, _headed: boolean,
        _quarantined: boolean, log: (line: string) => void, device?: string,
      ) => {
        seen.calls.push({ platform, tag, device });
        log('dòng đầu');
        log('dòng cuối');
        if (outcome instanceof Error) throw outcome;
        return { code: outcome.code, stopped: Boolean(outcome.stopped), reportPaths: [], runDirs: [] };
      },
      startParallel: async (
        platforms: string, tokens: string[], _tag: string | undefined,
        _quarantined: boolean, log: (line: string) => void,
      ) => {
        seen.parallel.push({ platforms, tokens });
        log('chạy song song');
        return undefined as never;
      },
      stop: async () => ({ stopped: 0 }) as never,
    },
  } as unknown as Runner;
  return { runner, seen };
}

function androidJob(deviceTokens: string[] = []) {
  return {
    orgId: 'org-1', kind: 'run_suite' as const, createdBy: 'u1',
    spec: {
      orgId: 'org-1', kind: 'run_suite' as const, createdBy: 'u1', timeoutMs: 60_000,
      deviceTokens, run: { platform: 'android', tag: '@smoke' },
    },
  };
}

/** Chờ job rời khỏi hàng đợi. Nhịp worker là 5ms nên việc này mất vài ms. */
async function settled(queue: MemoryJobQueue, id: string, within = 3_000): Promise<JobState> {
  const deadline = Date.now() + within;
  for (;;) {
    const job = await queue.find(id);
    if (job && !['queued', 'assigned', 'running'].includes(job.state)) return job.state;
    if (Date.now() > deadline) return job?.state ?? 'queued';
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('worker', () => {
  /** Điều kiện hoàn thành của P3.1, đo từ hai phía. */
  it('không có worker thì job nằm yên; bật worker lên thì job chạy', async () => {
    const queue = new MemoryJobQueue();
    const job = await queue.create(androidJob());

    // Chưa có worker: đợi một lúc, trạng thái không được tự đổi.
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal((await queue.find(job.id))?.state, 'queued');

    const { runner, seen } = fakeRunner({ code: 0 });
    const worker = startWorker({ queue, runnerId: 'local', configFile: 'x.json', pollMs: 5, runner });
    try {
      assert.equal(await settled(queue, job.id), 'succeeded');
      assert.deepEqual(seen.calls, [{ platform: 'android', tag: '@smoke', device: undefined }]);
    } finally {
      worker.stop();
    }
  });

  it('log của job đi vào hàng đợi, không mất', async () => {
    const queue = new MemoryJobQueue();
    const job = await queue.create(androidJob());
    const lines: string[] = [];
    await queue.onLog(job.id, (line) => lines.push(line));

    const { runner } = fakeRunner({ code: 0 });
    const worker = startWorker({ queue, runnerId: 'local', configFile: 'x.json', pollMs: 5, runner });
    try {
      await settled(queue, job.id);
      assert.deepEqual(lines, ['dòng đầu', 'dòng cuối']);
    } finally {
      worker.stop();
    }
  });

  it('mã thoát khác 0 thì job hỏng, kèm mã trong câu lỗi', async () => {
    const queue = new MemoryJobQueue();
    const job = await queue.create(androidJob());
    const { runner } = fakeRunner({ code: 1 });
    const worker = startWorker({ queue, runnerId: 'local', configFile: 'x.json', pollMs: 5, runner });
    try {
      assert.equal(await settled(queue, job.id), 'failed');
      assert.match((await queue.find(job.id))?.error ?? '', /mã 1/);
    } finally {
      worker.stop();
    }
  });

  /**
   * Mã 2 là "không có gì hỏng, nhưng có kịch bản chưa duyệt nên chưa chạy".
   * Coi nó là hỏng sẽ làm một job hoàn toàn bình thường hiện lên màu đỏ.
   */
  it('mã 2 vẫn là xong, không phải hỏng', async () => {
    const queue = new MemoryJobQueue();
    const job = await queue.create(androidJob());
    const { runner } = fakeRunner({ code: 2 });
    const worker = startWorker({ queue, runnerId: 'local', configFile: 'x.json', pollMs: 5, runner });
    try {
      assert.equal(await settled(queue, job.id), 'succeeded');
    } finally {
      worker.stop();
    }
  });

  it('bị dừng thì là cancelled, không phải failed', async () => {
    const queue = new MemoryJobQueue();
    const job = await queue.create(androidJob());
    const { runner } = fakeRunner({ code: null, stopped: true });
    const worker = startWorker({ queue, runnerId: 'local', configFile: 'x.json', pollMs: 5, runner });
    try {
      assert.equal(await settled(queue, job.id), 'cancelled');
    } finally {
      worker.stop();
    }
  });

  /** Một job ném không được làm chết vòng lặp — nó còn phải phục vụ job sau. */
  it('job ném thì đóng lại là failed, và worker vẫn chạy job kế tiếp', async () => {
    const queue = new MemoryJobQueue();
    const first = await queue.create(androidJob());
    const { runner } = fakeRunner(new Error('adb không thấy máy'));
    const worker = startWorker({ queue, runnerId: 'local', configFile: 'x.json', pollMs: 5, runner });
    try {
      assert.equal(await settled(queue, first.id), 'failed');
      assert.match((await queue.find(first.id))?.error ?? '', /adb không thấy máy/);

      const second = await queue.create(androidJob());
      assert.equal(await settled(queue, second.id), 'failed', 'vòng lặp phải còn sống');
    } finally {
      worker.stop();
    }
  });

  it('nhiều máy thì đi đường chạy song song', async () => {
    const queue = new MemoryJobQueue();
    const job = await queue.create(androidJob(['android:emulator-5554', 'android:emulator-5556']));
    const { runner, seen } = fakeRunner({ code: 0 });
    const worker = startWorker({ queue, runnerId: 'local', configFile: 'x.json', pollMs: 5, runner });
    try {
      assert.equal(await settled(queue, job.id), 'succeeded');
      assert.deepEqual(seen.parallel, [{
        platforms: 'android',
        tokens: ['android:emulator-5554', 'android:emulator-5556'],
      }]);
      assert.deepEqual(seen.calls, [], 'một máy và nhiều máy là hai đường khác nhau');
    } finally {
      worker.stop();
    }
  });

  /** Nhận rồi im lặng không chạy gì là kiểu hỏng tệ nhất của một hàng đợi. */
  it('job loại chưa làm được thì nói ra, không nhận rồi im', async () => {
    const queue = new MemoryJobQueue();
    const job = await queue.create({
      orgId: 'org-1', kind: 'crawl', createdBy: 'u1',
      spec: { orgId: 'org-1', kind: 'crawl', createdBy: 'u1', timeoutMs: 1_000, deviceTokens: [] },
    });
    const { runner } = fakeRunner({ code: 0 });
    const worker = startWorker({ queue, runnerId: 'local', configFile: 'x.json', pollMs: 5, runner });
    try {
      assert.equal(await settled(queue, job.id), 'failed');
      assert.match((await queue.find(job.id))?.error ?? '', /crawl/);
    } finally {
      worker.stop();
    }
  });

  it('dừng worker thì job mới không bị nhận nữa', async () => {
    const queue = new MemoryJobQueue();
    const { runner } = fakeRunner({ code: 0 });
    const worker = startWorker({ queue, runnerId: 'local', configFile: 'x.json', pollMs: 5, runner });
    worker.stop();

    const job = await queue.create(androidJob());
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal((await queue.find(job.id))?.state, 'queued');
  });
});
