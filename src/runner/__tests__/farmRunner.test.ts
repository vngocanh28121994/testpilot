/**
 * Device Farm đội lốt runner.
 *
 * AWS được TIÊM ở đây, nên bài test này không gọi tới Oregon và không tiêu một
 * đồng nào. Thứ nó đo là phần mà một lần chạy thật sẽ chứng minh rất đắt: job
 * chỉ được nhận khi farm thật sự sẵn sàng, và một job sai nền tảng bị từ chối
 * TRƯỚC khi có gì được tải lên.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigSchema, type TestPilotConfig } from '../../config.js';
import { farmRunner } from '../farmRunner.js';
import { MemoryJobQueue } from '../../server/queue/memoryQueue.js';
import { MemoryLeaseRepo } from '../../server/db/leaseRepo.js';
import { startWorker } from '../worker.js';

const cfg = ConfigSchema.parse({
  web: { baseUrl: 'https://example.test' },
  farm: {
    region: 'us-west-2',
    projectArn: 'arn:aws:devicefarm:us-west-2:1:project:abc',
    devicePoolArn: 'arn:aws:devicefarm:us-west-2:1:devicepool:abc',
    platform: 'android',
  },
});

function fakeFarm(passed: boolean) {
  const calls: Array<{ bundle: boolean; runName: string }> = [];
  const run = (async (
    config: TestPilotConfig,
    bundle: boolean,
    log: (line: string) => void,
  ) => {
    calls.push({ bundle, runName: config.farm.runName });
    log('[farm] đang tải bundle lên Device Farm…');
    log('[farm] thiết bị đã nhận việc');
    return { id: 'arn:run:1', passed };
  }) as never;
  return { run, calls };
}

function runnerFor(passed: boolean, config = cfg) {
  const farm = fakeFarm(passed);
  return {
    farm,
    runner: farmRunner({
      configFile: 'x.json',
      run: farm.run,
      loadCfg: async () => config,
    }),
  };
}

describe('farmRunner', () => {
  it('chạy được thì log của farm chảy về đúng đường của job', async () => {
    const { runner, farm } = runnerFor(true);
    const lines: string[] = [];
    const outcome = await runner.run.startSuite(
      'android', '@smoke', false, false, (line) => lines.push(line),
    );

    assert.equal(outcome.code, 0);
    assert.deepEqual(lines, [
      '[farm] đang tải bundle lên Device Farm…',
      '[farm] thiết bị đã nhận việc',
    ]);
    assert.equal(farm.calls.length, 1);
    assert.equal(farm.calls[0]!.bundle, true, 'phải đóng gói lại trước khi gửi');
  });

  it('test đỏ trên farm thì mã thoát khác 0', async () => {
    const { runner } = runnerFor(false);
    const outcome = await runner.run.startSuite('android', undefined, false, false, () => {});
    assert.equal(outcome.code, 1);
  });

  /**
   * Job iOS vào một pool Android là tiêu tiền để nhận một lỗi: bundle được tải
   * lên, thiết bị khởi động, rồi mọi kịch bản hỏng.
   */
  it('job sai nền tảng bị từ chối TRƯỚC khi tải gì lên', async () => {
    const { runner, farm } = runnerFor(true);
    await assert.rejects(
      () => runner.run.startSuite('ios', undefined, false, false, () => {}),
      /device pool đang cấu hình cho android/,
    );
    assert.equal(farm.calls.length, 0, 'không được gọi tới AWS');
  });

  it('config chưa chọn project hay pool thì nói rõ, không gọi AWS', async () => {
    const empty = ConfigSchema.parse({ web: { baseUrl: 'https://example.test' } });
    const { runner, farm } = runnerFor(true, empty);
    await assert.rejects(
      () => runner.run.startSuite('android', undefined, false, false, () => {}),
      /projectArn/,
    );
    assert.equal(farm.calls.length, 0);
  });

  /** Thiết bị nằm ở AWS: mọi câu hỏi về máy tại chỗ đều là câu hỏi sai chỗ. */
  it('không giả vờ có thiết bị tại chỗ', async () => {
    const { runner } = runnerFor(true);
    assert.deepEqual(await runner.control.devices(), []);
    // Từ chối bằng lời hứa bị từ chối, không bằng cú ném đồng bộ: một cú ném
    // đồng bộ từ một hàm khai `Promise` vượt qua mọi `.catch()` quanh nó.
    await assert.rejects(() => runner.control.tap({ platform: 'android', udid: 'x' }, 1, 1),
      /không cắm vào máy này/);
    await assert.rejects(() => runner.run.stop(), /không cắm vào máy này/);
    assert.equal(runner.run.parseDeviceToken('android:x'), null);
  });
});

describe('worker với runner tự quản thiết bị', () => {
  /**
   * Không phân giải udid và không giữ chỗ — khoá một chiếc máy ta không sở hữu
   * là khoá một thứ không tồn tại, và nó sẽ chặn chính job kế tiếp.
   */
  it('job farm chạy mà không giữ chỗ thiết bị nào', async () => {
    const queue = new MemoryJobQueue();
    const leases = new MemoryLeaseRepo();
    const { runner } = runnerFor(true);

    const job = await queue.create({
      orgId: 'org-1', kind: 'run_suite', createdBy: 'u1',
      spec: {
        orgId: 'org-1', kind: 'run_suite', createdBy: 'u1', timeoutMs: 60_000,
        deviceTokens: [], run: { platform: 'android', tag: '@smoke' },
      },
    });

    const worker = startWorker({
      queue, leases, runnerId: 'farm-01', configFile: 'x.json',
      pollMs: 5, runner, managesOwnDevices: true,
      // Khai tay: `control.devices()` của farm rỗng theo đúng nghĩa đen, nên
      // để worker tự đo sẽ ra `['web']` và job Android nằm chờ mãi.
      platforms: ['android'],
    });
    try {
      const deadline = Date.now() + 3_000;
      let state = 'queued';
      while (Date.now() < deadline) {
        state = (await queue.find(job.id))?.state ?? 'queued';
        if (!['queued', 'running', 'assigned'].includes(state)) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(state, 'succeeded');
      assert.deepEqual(await leases.list(), [], 'không được giữ chỗ chiếc máy nào');
    } finally {
      worker.stop();
    }
  });
});
