/**
 * `POST /api/run` sau khi nó thành "tạo job".
 *
 * Hai điều phải giữ nguyên, và chúng là lý do bài test này tồn tại:
 *
 *  1. **Hình dạng đường dây không đổi.** Vẫn là SSE với `log` và `done`, nên
 *     giao diện không phải sửa gì. Đổi hình dạng ở đây là đổi hai thứ cùng
 *     lúc — engine và giao diện — rồi không biết cái nào làm hỏng.
 *  2. **Một lượt test đỏ KHÔNG phải lỗi của request.** `done {ok:true}` kể cả
 *     khi job `failed`: dòng log đã nói rõ, và ném thêm một lỗi ở tầng request
 *     sẽ chồng một toast đỏ lên chính cái log đang giải thích.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { runRoutes } from '../run.js';
import { MemoryJobQueue } from '../../queue/memoryQueue.js';
import { MemoryLeaseRepo } from '../../db/leaseRepo.js';
import { ConfigSchema } from '../../../config.js';
import { startWorker } from '../../../runner/worker.js';
import type { Repos } from '../../db/repo.js';
import type { Runner } from '../../../runner/index.js';
import type { RouteContext } from '../types.js';
import { MemoryRunnerRegistry } from '../../runners/memoryRegistry.js';

function fakeRes(): { res: ServerResponse; events: Array<{ event: string; data: unknown }> } {
  const events: Array<{ event: string; data: unknown }> = [];
  let pending = '';
  const res = {
    writeHead() { return this; },
    write(chunk: string) {
      pending += chunk;
      for (const block of pending.split('\n\n')) {
        const event = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        if (event && data) events.push({ event, data: JSON.parse(data) });
      }
      pending = '';
      return true;
    },
    end() {},
  } as unknown as ServerResponse;
  return { res, events };
}

/** Config một-máy: chiếc máy thật là chiếc duy nhất đang cắm. */
const CONFIG = ConfigSchema.parse({
  web: { baseUrl: 'https://example.test' },
  android: { deviceName: 'Android Device' },
  ios: { deviceName: 'iPhone' },
});
const config = async () => CONFIG;

function context(queue: MemoryJobQueue): RouteContext {
  return {
    configFile: 'testpilot.config.json',
    configProfile: { owner: 't', source: 'personal' },
    identity: { userId: 'u1', orgId: 'org-1', email: 'u@x.dev', role: 'runner_user' },
    repos: { queue } as unknown as Repos,
    runners: new MemoryRunnerRegistry(),
  };
}

function runner(outcome: { code: number | null; stopped?: boolean }): Runner {
  return {
    run: {
      parseDeviceToken: (token: string) => {
        const [platform, ...rest] = token.split(':');
        const id = rest.join(':');
        if (!id || (platform !== 'android' && platform !== 'ios')) return null;
        return { platform, id } as { platform: 'android' | 'ios'; id: string };
      },
      isNamedDevice: async () => true,
      startSuite: async (
        _platform: string, _tag: string | undefined, _headed: boolean,
        _quarantined: boolean, log: (line: string) => void,
      ) => {
        log('đang chạy test…');
        return { code: outcome.code, stopped: Boolean(outcome.stopped), reportPaths: [], runDirs: [] };
      },
      startParallel: async () => undefined as never,
      stop: async () => ({ stopped: 0 }) as never,
    },
    control: {
      devices: async () => [{ platform: 'android' as const, udid: 'emulator-5554', label: 'x' }],
    },
  } as unknown as Runner;
}

async function postRun(queue: MemoryJobQueue, body: unknown) {
  const { res, events } = fakeRes();
  const req = Readable.from([Buffer.from(JSON.stringify(body), 'utf8')]) as IncomingMessage;
  // Giữ vòng lặp sự kiện sống trong lúc chờ.
  //
  // Nhịp của worker là `unref()` — đúng cho production, vì một server đang rỗi
  // phải tắt được bằng Ctrl-C ngay thay vì chờ hết nhịp. Nhưng ở test thì
  // KHÔNG có server HTTP nào giữ vòng lặp, nên Node thấy mọi việc đã xong
  // trong lúc route vẫn đang chờ job, và báo "promise still pending".
  const keepAlive = setInterval(() => {}, 20);
  try {
    await runRoutes['POST /api/run']!(req, res, new URL('http://x/api/run'), context(queue));
  } finally {
    clearInterval(keepAlive);
  }
  return events;
}

async function getJobs(queue: MemoryJobQueue, query = '') {
  let body: Record<string, unknown> = {};
  const res = {
    writeHead() { return this; },
    end(chunk?: unknown) { if (chunk) body = JSON.parse(String(chunk)) as Record<string, unknown>; },
  } as unknown as ServerResponse;
  await runRoutes['GET /api/jobs']!(
    {} as IncomingMessage, res, new URL(`http://x/api/jobs${query}`), context(queue),
  );
  return body;
}

describe('POST /api/run tạo job', () => {
  it('chạy xong thì log chảy qua SSE và kết thúc bằng done', async () => {
    const queue = new MemoryJobQueue();
    const worker = startWorker({
      queue, leases: new MemoryLeaseRepo(), runnerId: 'local', configFile: 'x.json', config,
      pollMs: 5, runner: runner({ code: 0 }),
    });
    try {
      const events = await postRun(queue, { platform: 'android', tag: '@smoke' });
      const logs = events.filter((e) => e.event === 'log').map((e) => String(e.data));

      assert.match(logs[0]!, /đã vào hàng đợi/);
      assert.ok(logs.some((line) => line.includes('runner local đã nhận')));
      assert.ok(logs.includes('đang chạy test…'), 'log của chính lượt chạy phải tới nơi');
      assert.deepEqual(events.at(-1), { event: 'done', data: { ok: true } });
    } finally {
      worker.stop();
    }
  });

  /** Test đỏ là kết quả, không phải lỗi hệ thống. */
  it('test đỏ vẫn kết thúc bằng done ok, không phải error', async () => {
    const queue = new MemoryJobQueue();
    const worker = startWorker({
      queue, leases: new MemoryLeaseRepo(), runnerId: 'local', configFile: 'x.json', config,
      pollMs: 5, runner: runner({ code: 1 }),
    });
    try {
      const events = await postRun(queue, { platform: 'android' });
      assert.deepEqual(events.at(-1), { event: 'done', data: { ok: true } });
      assert.equal(events.filter((e) => e.event === 'error').length, 0);

      const jobs = (await getJobs(queue)).jobs as Array<{ state: string; error?: string }>;
      assert.equal(jobs[0]!.state, 'failed', 'nhưng job thì phải ghi là hỏng');
      assert.match(jobs[0]!.error ?? '', /mã 1/);
    } finally {
      worker.stop();
    }
  });

  /**
   * Máy trong bài này phải là máy ĐANG CẮM của runner giả.
   *
   * Bản đầu dùng `ios:0001` cho tiện, và từ P3.3 thì job ấy nằm CHỜ máy iOS
   * cắm vào — đúng hành vi mong muốn, nhưng nó làm route không bao giờ trả về
   * và bài test treo tới hết hạn. Một bài test treo mười phút là cái giá của
   * một chi tiết tưởng là không quan trọng.
   */
  it('body của nút chạy đi trọn vẹn vào spec', async () => {
    const queue = new MemoryJobQueue();
    const worker = startWorker({
      queue, leases: new MemoryLeaseRepo(), runnerId: 'local', configFile: 'x.json', config,
      pollMs: 5, runner: runner({ code: 0 }),
    });
    try {
      await postRun(queue, {
        platform: 'android', tag: '@p0', headed: true, includeQuarantined: true,
        env: 'uat', appSource: 'upload', devices: ['android:emulator-5554'],
      });
      const [job] = await queue.list();
      assert.deepEqual(job!.spec.run, {
        platform: 'android', tag: '@p0', headed: true, includeQuarantined: true,
        env: 'uat', appSource: 'upload',
      });
      assert.deepEqual(job!.spec.deviceTokens, ['android:emulator-5554']);
      assert.equal(job!.spec.orgId, 'org-1');
      assert.equal(job!.createdBy, 'u1');
    } finally {
      worker.stop();
    }
  });
});

describe('GET /api/jobs', () => {
  it('nói rõ cái gì đang chờ và cái gì đã xong, nhưng KHÔNG trả spec', async () => {
    const queue = new MemoryJobQueue();
    await queue.create({
      orgId: 'org-1', kind: 'run_suite', createdBy: 'u1',
      spec: {
        orgId: 'org-1', kind: 'run_suite', createdBy: 'u1', timeoutMs: 1_000,
        deviceTokens: ['android:emulator-5554'],
        run: { platform: 'android', tag: '@smoke' },
        // Snapshot mang cả registry; nó không được đi ra ngoài qua route này.
        snapshot: { registryRevision: 'r1', registry: { bi: 'mat' }, features: [] },
      },
    });

    const body = await getJobs(queue);
    const jobs = body.jobs as Array<Record<string, unknown>>;
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]!.state, 'queued');
    assert.equal(jobs[0]!.platform, 'android');
    assert.deepEqual(jobs[0]!.devices, ['android:emulator-5554']);
    assert.ok(!('spec' in jobs[0]!), 'spec mang snapshot registry, không đi ra ngoài');
    assert.ok(!JSON.stringify(body).includes('bi'), 'không rò snapshot qua bất kỳ trường nào');
  });

  it('lọc được theo trạng thái', async () => {
    const queue = new MemoryJobQueue();
    const spec = {
      orgId: 'org-1', kind: 'run_suite' as const, createdBy: 'u1', timeoutMs: 1_000,
      deviceTokens: [], run: { platform: 'web' },
    };
    await queue.create({ orgId: 'org-1', kind: 'run_suite', createdBy: 'u1', spec });
    const second = await queue.create({ orgId: 'org-1', kind: 'run_suite', createdBy: 'u1', spec });
    await queue.finish(second.id, { type: 'job.result', jobId: second.id, state: 'succeeded' });

    const queued = (await getJobs(queue, '?state=queued')).jobs as unknown[];
    assert.equal(queued.length, 1);
    const done = (await getJobs(queue, '?state=succeeded,failed')).jobs as unknown[];
    assert.equal(done.length, 1);
  });
});
