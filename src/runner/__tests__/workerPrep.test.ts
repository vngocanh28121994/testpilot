/**
 * Việc chuẩn bị (tunnel, Appium, Cài đặt iOS) làm trên ĐÚNG máy cắm thiết bị.
 *
 * Trước đây nút "Mở Terminal" luôn mở Terminal trên máy chủ, kể cả khi iPhone
 * cắm ở laptop người khác. Giờ máy chủ đặt một job `prereq` nhắm udid ấy, và
 * chỉ runner đang cắm nó làm; runner khác trả job về hàng đợi.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { startWorker } from '../worker.js';
import { MemoryJobQueue } from '../../server/queue/memoryQueue.js';
import { MemoryLeaseRepo } from '../../server/db/leaseRepo.js';
import { ConfigSchema } from '../../config.js';
import type { Runner } from '../index.js';

const CONFIG = ConfigSchema.parse({ web: { baseUrl: 'https://example.test' }, android: { deviceName: 'Android Device' } });
const config = async () => CONFIG;

function prepRunner(attached: string[]) {
  const did: string[] = [];
  const runner = {
    run: { parseDeviceToken: () => null },
    control: {
      devices: async () => attached.map((udid) => ({ platform: 'ios' as const, udid, label: udid })),
    },
    prereq: {
      appiumStatus: async () => ({ running: true, managed: true }),
      xcode: async () => ({ ok: true }),
      startAppium: async (log: (l: string) => void) => { did.push('start_appium'); log('appium lên'); },
      restartAppium: async () => { did.push('restart_appium'); },
      openTunnelTerminal: async () => { did.push('ios_tunnel'); return { ok: true, command: 'x' }; },
      openIosSettings: async () => { did.push('ios_trust'); return { ok: true }; },
    },
  } as unknown as Runner;
  return { runner, did };
}

function prepJob(op: string, udid = 'IPHONE-1') {
  return {
    orgId: 'org-1', kind: 'prereq' as const, createdBy: 'u1',
    spec: {
      orgId: 'org-1', kind: 'prereq' as const, createdBy: 'u1', timeoutMs: 60_000,
      deviceTokens: [`ios:${udid}`], prep: { op } as never,
    },
  };
}

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, within = 3_000): Promise<T> {
  const deadline = Date.now() + within;
  for (;;) {
    const value = await fn();
    if (ok(value) || Date.now() > deadline) return value;
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('worker — job chuẩn bị', () => {
  it('máy cắm ở đây: mở Terminal tunnel trên CHÍNH máy này, và job xong', async () => {
    const queue = new MemoryJobQueue();
    const { runner, did } = prepRunner(['IPHONE-1']);
    const job = await queue.create(prepJob('ios_tunnel'));
    const worker = startWorker({ queue, leases: new MemoryLeaseRepo(), runnerId: 'laptop', configFile: 'x.json', config, pollMs: 5, runner });
    try {
      const done = await waitFor(() => queue.find(job.id), (j) => j?.state === 'succeeded');
      assert.equal(done?.state, 'succeeded');
      assert.deepEqual(did, ['ios_tunnel']);
    } finally { worker.stop(); }
  });

  it('máy KHÔNG cắm ở đây: không làm gì, trả job về hàng đợi cho runner đúng', async () => {
    const queue = new MemoryJobQueue();
    const { runner, did } = prepRunner(['IPHONE-KHAC']);
    const job = await queue.create(prepJob('ios_tunnel'));
    const worker = startWorker({ queue, leases: new MemoryLeaseRepo(), runnerId: 'server', configFile: 'x.json', config, pollMs: 5, runner, deferMs: 10_000 });
    try {
      const back = await waitFor(() => queue.find(job.id), (j) => j?.state === 'queued' && Boolean(j.error));
      assert.equal(back?.state, 'queued');
      assert.deepEqual(did, [], 'máy chủ không được mở Terminal cho iPhone của người khác');
    } finally { worker.stop(); }
  });

  it('việc không có trong danh sách đóng: từ chối, không chạy gì', async () => {
    const queue = new MemoryJobQueue();
    const { runner, did } = prepRunner(['IPHONE-1']);
    const job = await queue.create(prepJob('rm_rf'));
    const worker = startWorker({ queue, leases: new MemoryLeaseRepo(), runnerId: 'laptop', configFile: 'x.json', config, pollMs: 5, runner });
    try {
      const done = await waitFor(() => queue.find(job.id), (j) => j?.state === 'failed');
      assert.equal(done?.state, 'failed');
      assert.deepEqual(did, []);
    } finally { worker.stop(); }
  });
});
