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
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MemoryJobQueue } from '../../server/queue/memoryQueue.js';
import { MemoryLeaseRepo } from '../../server/db/leaseRepo.js';
import { ConfigSchema } from '../../config.js';
import { startWorker } from '../worker.js';
import type { Runner } from '../index.js';
import type { JobState } from '../../protocol/messages.js';

/**
 * Config một-máy không khai udid — hình dạng mà mọi config chưa nâng cấp đều
 * có. Danh tính thật của chiếc máy khi ấy là chiếc duy nhất đang cắm.
 */
const CONFIG = ConfigSchema.parse({
  web: { baseUrl: 'https://example.test' },
  android: { deviceName: 'Android Device' },
});
const config = async () => CONFIG;

interface FakeRun {
  calls: Array<{ platform: string; tag?: string; device?: string }>;
  parallel: Array<{ platforms: string; tokens: string[] }>;
}

/** Runner giả: ghi lại lời gọi, in ra vài dòng, rồi trả mã thoát định sẵn. */
function fakeRunner(
  outcome: { code: number | null; stopped?: boolean } | Error,
  /** Máy "đang cắm" mà runner giả nhìn thấy. */
  devices: string[] = ['emulator-5554'],
): { runner: Runner; seen: FakeRun } {
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
      // Runner giả coi mọi máy job nêu tên là máy có trong config của nó, nên
      // `--device` nhận đúng cái tên ấy — cùng hành vi mà `isNamedDevice: true`
      // mô tả trước đây.
      configIdFor: async (picked: { id: string }) => picked.id,
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
    control: {
      devices: async () => devices.map((udid) => ({
        platform: 'android' as const, udid, label: udid,
      })),
    },
    // Môi trường mặc định là ĐỦ, để những bài không nói gì về nó vẫn đi đường
    // thường. Bài về môi trường thiếu thì tự dựng runner riêng.
    prereq: {
      appiumStatus: async () => ({ running: true, managed: true }),
      xcode: async () => ({ ok: true }),
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
    const worker = startWorker({ queue, leases: new MemoryLeaseRepo(), runnerId: 'local', configFile: 'x.json', config, pollMs: 5, runner });
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
    const worker = startWorker({ queue, leases: new MemoryLeaseRepo(), runnerId: 'local', configFile: 'x.json', config, pollMs: 5, runner });
    try {
      await settled(queue, job.id);
      // Dòng đầu là của worker nói về chỗ giữ máy — từ P3.3, một job không nêu
      // máy vẫn giữ được chỗ, vì chiếc máy thật được phân giải từ config và
      // danh sách đang cắm. Phần sau là log của chính lượt chạy.
      assert.match(lines[0]!, /Đã giữ chỗ/);
      assert.deepEqual(lines.slice(1), ['dòng đầu', 'dòng cuối']);
    } finally {
      worker.stop();
    }
  });

  it('mã thoát khác 0 thì job hỏng, kèm mã trong câu lỗi', async () => {
    const queue = new MemoryJobQueue();
    const job = await queue.create(androidJob());
    const { runner } = fakeRunner({ code: 1 });
    const worker = startWorker({ queue, leases: new MemoryLeaseRepo(), runnerId: 'local', configFile: 'x.json', config, pollMs: 5, runner });
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
    const worker = startWorker({ queue, leases: new MemoryLeaseRepo(), runnerId: 'local', configFile: 'x.json', config, pollMs: 5, runner });
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
    const worker = startWorker({ queue, leases: new MemoryLeaseRepo(), runnerId: 'local', configFile: 'x.json', config, pollMs: 5, runner });
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
    const worker = startWorker({ queue, leases: new MemoryLeaseRepo(), runnerId: 'local', configFile: 'x.json', config, pollMs: 5, runner });
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
    const { runner, seen } = fakeRunner({ code: 0 }, ['emulator-5554', 'emulator-5556']);
    const worker = startWorker({ queue, leases: new MemoryLeaseRepo(), runnerId: 'local', configFile: 'x.json', config, pollMs: 5, runner });
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
    const worker = startWorker({ queue, leases: new MemoryLeaseRepo(), runnerId: 'local', configFile: 'x.json', config, pollMs: 5, runner });
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
    const worker = startWorker({ queue, leases: new MemoryLeaseRepo(), runnerId: 'local', configFile: 'x.json', config, pollMs: 5, runner });
    worker.stop();

    const job = await queue.create(androidJob());
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal((await queue.find(job.id))?.state, 'queued');
  });
});

describe('worker và chỗ giữ thiết bị', () => {
  const HUMAN = { kind: 'human' as const, userId: 'an' };

  /**
   * Lỗ hổng mà P3.2 bịt, viết thành một khẳng định.
   *
   * Trước bước này, worker chạy job mà không hề lấy lease: một người đang cầm
   * chiếc điện thoại qua màn Điều khiển vẫn bị một job chạy đè lên. Job không
   * đỏ — nó chỉ chạy sai, vì màn hình không ở nơi nó tưởng.
   */
  it('máy đang có người cầm thì job KHÔNG chạy, và quay lại hàng đợi', async () => {
    const queue = new MemoryJobQueue();
    const leases = new MemoryLeaseRepo();
    await leases.acquire('emulator-5554', HUMAN);

    const job = await queue.create(androidJob(['android:emulator-5554']));
    const { runner, seen } = fakeRunner({ code: 0 });
    const worker = startWorker({
      queue, leases, runnerId: 'local', configFile: 'x.json', config, pollMs: 5, deferMs: 10, runner,
    });
    try {
      // Đợi đủ lâu để worker thử vài lượt.
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.deepEqual(seen.calls, [], 'không một lượt chạy nào được bắt đầu');

      const record = await queue.find(job.id);
      assert.equal(record?.state, 'queued', 'job phải quay lại hàng đợi, không phải hỏng');
      assert.match(record?.error ?? '', /an/, 'lý do phải nói ai đang giữ');
      // `attempt` KHÔNG tăng: máy bận là chuyện tạm thời, không phải một lần
      // thử hỏng. Bản đầu tăng nó mỗi 250ms và lần chạy thật cho ra attempt=33
      // trong tám giây — một hạn mức thử lại sẽ cháy vì lý do không liên quan.
      assert.equal(record?.attempt, 1, 'chờ máy không phải một lần thử');
    } finally {
      worker.stop();
    }
  });

  /**
   * Job gọi tên máy bằng udid thì lượt chạy vẫn phải GHIM đúng máy ấy.
   *
   * Trước đây `--device` chỉ nhận `id` trong config, nên một job nhắm udid
   * chạy KHÔNG ghim: Appium tự chọn lấy một chiếc trong số đang cắm. Người
   * dùng chọn emulator, lượt chạy diễn ra trên chiếc điện thoại thật bên
   * cạnh, và report trả về trông hoàn toàn bình thường — kiểu hỏng không ai
   * bắt được từ kết quả.
   */
  it('job nêu udid thì lượt chạy ghim đúng máy ấy', async () => {
    const queue = new MemoryJobQueue();
    const job = await queue.create(androidJob(['android:emulator-5554']));
    const { runner, seen } = fakeRunner({ code: 0 });
    const wrapped = {
      ...runner,
      run: {
        ...runner.run,
        // Config của máy chạy: udid `emulator-5554` mang `id` là `may-lab`.
        configIdFor: async (picked: { id: string }) =>
          (picked.id === 'emulator-5554' ? 'may-lab' : undefined),
      },
    } as typeof runner;

    const worker = startWorker({
      queue, leases: new MemoryLeaseRepo(), runnerId: 'local', configFile: 'x.json',
      config, pollMs: 5, runner: wrapped,
    });
    try {
      assert.equal(await settled(queue, job.id), 'succeeded');
      assert.equal(seen.calls[0]?.device, 'may-lab', '`--device` phải nhận id trong config');
    } finally {
      worker.stop();
    }
  });

  /**
   * Không ghim được, mà lại nhiều máy cùng cắm: DỪNG.
   *
   * Chạy tiếp là để Appium tự chọn giữa những chiếc đang cắm — tức là có thể
   * chạy trên đúng chiếc máy mà người dùng vừa cố ý không chọn.
   */
  it('không ghim được và nhiều máy cùng cắm thì từ chối, không đoán', async () => {
    const queue = new MemoryJobQueue();
    const job = await queue.create(androidJob(['android:emulator-5554']));
    const { runner, seen } = fakeRunner({ code: 0 }, ['emulator-5554', 'emulator-5556']);
    const wrapped = {
      ...runner,
      run: { ...runner.run, configIdFor: async () => undefined },
    } as typeof runner;

    const worker = startWorker({
      queue, leases: new MemoryLeaseRepo(), runnerId: 'local', configFile: 'x.json',
      config, pollMs: 5, runner: wrapped,
    });
    try {
      assert.equal(await settled(queue, job.id), 'failed');
      assert.equal(seen.calls.length, 0, 'không được chạm vào máy nào');
      const closed = await queue.find(job.id);
      assert.match(String(closed?.error), /chưa có trong cấu hình/);
    } finally {
      worker.stop();
    }
  });

  it('máy rảnh thì job giữ chỗ trước khi chạy, và nhả sau khi xong', async () => {
    const queue = new MemoryJobQueue();
    const leases = new MemoryLeaseRepo();
    const job = await queue.create(androidJob(['android:emulator-5554']));

    let heldWhileRunning: string | undefined;
    const { runner } = fakeRunner({ code: 0 });
    // Chụp lại ai đang giữ máy ĐÚNG lúc lượt chạy đang chạy.
    const wrapped = {
      ...runner,
      run: {
        ...runner.run,
        startSuite: async (...args: Parameters<typeof runner.run.startSuite>) => {
          const lease = await leases.find('emulator-5554');
          heldWhileRunning = lease?.holder.kind === 'job' ? lease.holder.jobId : undefined;
          return runner.run.startSuite(...args);
        },
      },
    } as typeof runner;

    const worker = startWorker({
      queue, leases, runnerId: 'local', configFile: 'x.json', config, pollMs: 5, runner: wrapped,
    });
    try {
      assert.equal(await settled(queue, job.id), 'succeeded');
      assert.equal(heldWhileRunning, job.id, 'job phải giữ máy trong lúc chạy');
      assert.equal(await leases.find('emulator-5554'), undefined, 'xong thì phải nhả');
    } finally {
      worker.stop();
    }
  });

  /** Một job ném mà không nhả máy là chiếc điện thoại bị khoá 60 giây mỗi lần hỏng. */
  it('job ném thì vẫn nhả máy', async () => {
    const queue = new MemoryJobQueue();
    const leases = new MemoryLeaseRepo();
    const job = await queue.create(androidJob(['android:emulator-5554']));
    const { runner } = fakeRunner(new Error('adb chết'));
    const worker = startWorker({
      queue, leases, runnerId: 'local', configFile: 'x.json', config, pollMs: 5, runner,
    });
    try {
      assert.equal(await settled(queue, job.id), 'failed');
      assert.equal(await leases.find('emulator-5554'), undefined);
    } finally {
      worker.stop();
    }
  });

  /**
   * Giữ được một nửa rồi chờ nửa kia là cách hai job khoá chéo nhau: mỗi bên
   * cầm một chiếc máy bên kia cần, và cả hai chờ mãi.
   */
  it('nhiều máy: giữ tất cả hoặc không giữ gì', async () => {
    const queue = new MemoryJobQueue();
    const leases = new MemoryLeaseRepo();
    // Chiếc thứ hai đã có người cầm.
    await leases.acquire('emulator-5556', HUMAN);

    const job = await queue.create(androidJob(['android:emulator-5554', 'android:emulator-5556']));
    const { runner, seen } = fakeRunner({ code: 0 }, ['emulator-5554', 'emulator-5556']);
    const worker = startWorker({
      queue, leases, runnerId: 'local', configFile: 'x.json', config, pollMs: 5, runner,
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.deepEqual(seen.parallel, [], 'không được chạy khi thiếu một máy');
      assert.equal((await queue.find(job.id))?.state, 'queued');
      assert.equal(
        await leases.find('emulator-5554'), undefined,
        'chiếc đã giữ được phải nhả ra, nếu không nó khoá luôn máy khác',
      );
    } finally {
      worker.stop();
    }
  });

  /**
   * Mất nhịp gia hạn là mất máy: một người khác có thể đã được cấp chiếc ấy.
   * Chạy tiếp lúc đó là hai bên cùng bấm trên một màn hình.
   */
  it('bị cưỡng chế nhả giữa chừng thì dừng lượt chạy và job thành interrupted', async () => {
    const queue = new MemoryJobQueue();
    const leases = new MemoryLeaseRepo();
    const job = await queue.create(androidJob(['android:emulator-5554']));

    let stopped = 0;
    let release: (() => void) | undefined;
    const slow = new Promise<void>((resolve) => { release = resolve; });
    const runner = {
      run: {
        parseDeviceToken: (token: string) => {
          const [platform, ...rest] = token.split(':');
          const id = rest.join(':');
          if (!id || (platform !== 'android' && platform !== 'ios')) return null;
          return { platform, id } as { platform: 'android' | 'ios'; id: string };
        },
        isNamedDevice: async () => true,
      // Runner giả coi mọi máy job nêu tên là máy có trong config của nó, nên
      // `--device` nhận đúng cái tên ấy — cùng hành vi mà `isNamedDevice: true`
      // mô tả trước đây.
      configIdFor: async (picked: { id: string }) => picked.id,
        startSuite: async () => {
          await slow;
          return { code: 0, stopped: true, reportPaths: [], runDirs: [] };
        },
        startParallel: async () => undefined as never,
        stop: async () => { stopped += 1; release?.(); return { stopped: 1 } as never; },
      },
      control: {
        devices: async () => [{ platform: 'android' as const, udid: 'emulator-5554', label: 'x' }],
      },
    } as unknown as Parameters<typeof startWorker>[0]['runner'];

    const worker = startWorker({
      queue, leases, runnerId: 'local', configFile: 'x.json', config, pollMs: 5, renewMs: 10, runner,
    });
    try {
      // Chờ job giữ được máy rồi mới cưỡng chế nhả — đúng cảnh admin bấm thu hồi.
      for (let i = 0; i < 100 && !(await leases.find('emulator-5554')); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      const lease = await leases.find('emulator-5554');
      assert.ok(lease, 'job phải giữ được máy trước đã');
      await leases.release(lease.id);

      assert.equal(await settled(queue, job.id), 'interrupted');
      assert.ok(stopped > 0, 'phải DỪNG lượt chạy, không chỉ ghi nhận');
      assert.match((await queue.find(job.id))?.error ?? '', /Mất chỗ giữ thiết bị/);
    } finally {
      worker.stop();
    }
  });
});

describe('worker ghép job với thiết bị (P3.3)', () => {
  /**
   * Lỗi im lặng mà P3.3 sửa, viết thành một khẳng định.
   *
   * Config thật của dự án này đặt `id` là `sm-s918b` còn `udid` là
   * `R5CW525G35Y`. Màn Điều khiển giữ chỗ theo udid — nó lấy danh sách từ
   * `adb devices` — còn job trước P3.3 giữ theo id. Hai cái tên khác nhau cho
   * cùng một chiếc máy nghĩa là hai bên khoá hai thứ khác nhau, và không có
   * lỗi nào hiện ra: job vẫn chạy, chỉ là chạy đè lên tay người đang bấm.
   */
  it('người cầm máy theo UDID chặn được job chọn máy theo ID của config', async () => {
    const withUdid = ConfigSchema.parse({
      web: { baseUrl: 'https://example.test' },
      android: {
        deviceName: 'X',
        devices: [{ id: 'sm-s918b', deviceName: 'SM_S918B', udid: 'R5CW525G35Y' }],
      },
    });
    const queue = new MemoryJobQueue();
    const leases = new MemoryLeaseRepo();
    // Người dùng cầm máy qua màn Điều khiển: khoá theo UDID.
    await leases.acquire('R5CW525G35Y', { kind: 'human', userId: 'an' });

    // Job chọn máy theo ID của config.
    const job = await queue.create(androidJob(['android:sm-s918b']));
    const { runner, seen } = fakeRunner({ code: 0 }, ['R5CW525G35Y']);
    const worker = startWorker({
      queue, leases, runnerId: 'local', configFile: 'x.json', config: async () => withUdid,
      pollMs: 5, deferMs: 10, runner,
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.deepEqual(seen.calls, [], 'không một lượt chạy nào được bắt đầu');
      assert.equal((await queue.find(job.id))?.state, 'queued');
      assert.match((await queue.find(job.id))?.error ?? '', /an/);
    } finally {
      worker.stop();
    }
  });

  /** Máy chưa cắm là CHỜ: đặt job trước, cắm máy sau, và nó tự chạy. */
  it('máy chưa cắm thì job chờ, không hỏng', async () => {
    const queue = new MemoryJobQueue();
    const job = await queue.create(androidJob(['android:emulator-9999']));
    const { runner, seen } = fakeRunner({ code: 0 }, ['emulator-5554']);
    const worker = startWorker({
      queue, leases: new MemoryLeaseRepo(), runnerId: 'local', configFile: 'x.json', config,
      pollMs: 5, deferMs: 10, runner,
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 60));
      assert.deepEqual(seen.calls, []);
      const record = await queue.find(job.id);
      assert.equal(record?.state, 'queued', 'chờ, không hỏng');
      assert.equal(record?.attempt, 1);
      assert.match(record?.error ?? '', /chưa cắm|không có trong config/);
    } finally {
      worker.stop();
    }
  });

  /**
   * Nhưng một spec KHÔNG BAO GIỜ chạy được thì phải hỏng, không nằm chờ mãi:
   * config khai hai máy mà job không chọn chiếc nào.
   */
  it('spec mơ hồ thì hỏng ngay, kèm danh sách để chọn', async () => {
    const twoDevices = ConfigSchema.parse({
      web: { baseUrl: 'https://example.test' },
      android: {
        deviceName: 'X',
        devices: [
          { id: 'may-mot', deviceName: 'A', udid: 'UD1' },
          { id: 'may-hai', deviceName: 'B', udid: 'UD2' },
        ],
      },
    });
    const queue = new MemoryJobQueue();
    const job = await queue.create(androidJob());
    const { runner, seen } = fakeRunner({ code: 0 }, ['UD1', 'UD2']);
    const worker = startWorker({
      queue, leases: new MemoryLeaseRepo(), runnerId: 'local', configFile: 'x.json',
      config: async () => twoDevices, pollMs: 5, runner,
    });
    try {
      assert.equal(await settled(queue, job.id), 'failed');
      assert.deepEqual(seen.calls, []);
      assert.match((await queue.find(job.id))?.error ?? '', /may-mot, may-hai/);
    } finally {
      worker.stop();
    }
  });

  /**
   * Năng lực khai ra phải là điều ĐO ĐƯỢC. Không có iPhone nào cắm thì không
   * nhận job iOS — nhận rồi fail sau ba phút chờ WebDriverAgent là ba phút
   * thiết bị của cả đội bị giữ vô ích.
   */
  it('không có máy iOS thì không nhận job iOS', async () => {
    const queue = new MemoryJobQueue();
    const job = await queue.create({
      orgId: 'org-1', kind: 'run_suite', createdBy: 'u1',
      spec: {
        orgId: 'org-1', kind: 'run_suite', createdBy: 'u1', timeoutMs: 60_000,
        deviceTokens: [], run: { platform: 'ios' },
      },
    });
    const { runner, seen } = fakeRunner({ code: 0 }, ['emulator-5554']);
    const worker = startWorker({
      queue, leases: new MemoryLeaseRepo(), runnerId: 'local', configFile: 'x.json', config,
      pollMs: 5, runner,
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 60));
      assert.equal((await queue.find(job.id))?.state, 'queued', 'job iOS phải nằm chờ máy khác');
      assert.deepEqual(seen.calls, []);
    } finally {
      worker.stop();
    }
  });
});

describe('worker và môi trường của máy (P4.5)', () => {
  /**
   * Điều kiện hoàn thành của P4.5: máy thiếu driver thì job bị từ chối NGAY,
   * kèm câu nói việc cần làm — không phải một lỗi Appium ở phút thứ ba, thứ
   * không nói được rằng chiếc máy ở đầu kia thiếu gì.
   */
  it('Appium chưa chạy thì job android hỏng ngay, kèm cách sửa', async () => {
    const queue = new MemoryJobQueue();
    const { runner, seen } = fakeRunner({ code: 0 });
    const broken = {
      ...runner,
      prereq: {
        appiumStatus: async () => ({ running: false, managed: false }),
        xcode: async () => ({ ok: true }),
      },
    } as typeof runner;

    const job = await queue.create(androidJob(['android:emulator-5554']));
    const worker = startWorker({
      queue, leases: new MemoryLeaseRepo(), runnerId: 'local', configFile: 'x.json', config,
      pollMs: 5, runner: broken,
    });
    try {
      assert.equal(await settled(queue, job.id), 'failed');
      assert.deepEqual(seen.calls, [], 'không được bắt đầu lượt chạy nào');
      assert.match((await queue.find(job.id))?.error ?? '', /Appium chưa chạy/);
      // `failed` chứ không `queued`: thiếu Appium không tự khỏi, nên trả job
      // về hàng đợi chỉ tạo một vòng lặp bận rộn.
      assert.equal((await queue.find(job.id))?.attempt, 1);
    } finally {
      worker.stop();
    }
  });

  /** Web không cần Appium, nên nó vẫn chạy trên đúng chiếc máy ấy. */
  it('job web vẫn chạy khi Appium chưa bật', async () => {
    const queue = new MemoryJobQueue();
    const { runner } = fakeRunner({ code: 0 });
    const broken = {
      ...runner,
      prereq: {
        appiumStatus: async () => ({ running: false, managed: false }),
        xcode: async () => ({ ok: true }),
      },
    } as typeof runner;

    const job = await queue.create({
      orgId: 'org-1', kind: 'run_suite', createdBy: 'u1',
      spec: {
        orgId: 'org-1', kind: 'run_suite', createdBy: 'u1', timeoutMs: 60_000,
        deviceTokens: [], run: { platform: 'web' },
      },
    });
    const worker = startWorker({
      queue, leases: new MemoryLeaseRepo(), runnerId: 'local', configFile: 'x.json', config,
      pollMs: 5, runner: broken,
    });
    try {
      assert.equal(await settled(queue, job.id), 'succeeded');
    } finally {
      worker.stop();
    }
  });
});

describe('worker trong mô hình nhiều runner', () => {
  /**
   * Máy chủ không có Xcode nhận một job iOS nhắm chiếc iPhone cắm ở laptop
   * người khác. Bản trước ĐÁNH HỎNG job ấy vì "thiếu Xcode" — câu đúng về máy
   * chủ, nhưng không liên quan gì tới chiếc máy job cần. Job không phải của
   * mình thì trả về hàng đợi cho runner đúng nhận.
   */
  it('máy không cắm ở đây thì HOÃN, kể cả khi máy này thiếu driver', async () => {
    const queue = new MemoryJobQueue();
    const { runner, seen } = fakeRunner({ code: 0 }, ['emulator-5554']);
    const broken = {
      ...runner,
      prereq: {
        appiumStatus: async () => ({ running: false, managed: false }),
        xcode: async () => ({ ok: true }),
      },
    } as typeof runner;

    const job = await queue.create(androidJob(['android:R5CY21WADDY']));
    const worker = startWorker({
      queue, leases: new MemoryLeaseRepo(), runnerId: 'local', configFile: 'x.json', config,
      pollMs: 5, deferMs: 10_000, runner: broken,
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 80));
      const now = await queue.find(job.id);
      assert.equal(now?.state, 'queued', 'job phải về hàng đợi, không bị đánh hỏng');
      assert.doesNotMatch(now?.error ?? '', /Appium/);
      assert.deepEqual(seen.calls, []);
    } finally {
      worker.stop();
    }
  });

  /**
   * Workflow Studio sinh file feature ở máy chủ; điện thoại cắm ở laptop khác.
   * Job mang file ấy trong snapshot, và runner phải chạy ĐÚNG file ấy — không
   * phải thư mục `features/` của chính nó, nơi file ấy không tồn tại.
   */
  it('job mang snapshot chạy trên bản sao gửi kèm, rồi dọn sạch', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'tp-worker-'));
    const configFile = path.join(tmp, 'cfg.json');
    await writeFile(configFile, JSON.stringify({ web: { baseUrl: 'https://example.test' } }));

    const queue = new MemoryJobQueue();
    const seen: Array<{ feature?: string; configFile?: string; defer?: boolean; existed: boolean }> = [];
    const { runner } = fakeRunner({ code: 0 });
    const capturing = {
      ...runner,
      run: {
        ...runner.run,
        startSuite: async (...args: unknown[]) => {
          const cfgPath = args[11] as string | undefined;
          seen.push({
            feature: args[7] as string | undefined,
            configFile: cfgPath,
            defer: args[10] as boolean,
            existed: Boolean(cfgPath && existsSync(cfgPath)),
          });
          return { code: 0, stopped: false, reportPaths: [], runDirs: [] };
        },
      },
    } as unknown as typeof runner;

    const job = await queue.create({
      orgId: 'org-1', kind: 'run_suite', createdBy: 'u1',
      spec: {
        orgId: 'org-1', kind: 'run_suite', createdBy: 'u1', timeoutMs: 60_000,
        deviceTokens: ['android:emulator-5554'],
        run: { platform: 'android', feature: 'moi-sinh.feature' },
        snapshot: {
          registryRevision: 'r1',
          registry: { elements: {} },
          features: [{ name: 'moi-sinh.feature', content: 'Feature: x\n' }],
        },
      },
    });
    const worker = startWorker({
      queue, leases: new MemoryLeaseRepo(), runnerId: 'local', configFile, config,
      pollMs: 5, runner: capturing, jobsRoot: tmp,
    });
    try {
      assert.equal(await settled(queue, job.id), 'succeeded');
      assert.equal(seen.length, 1);
      assert.equal(seen[0]!.feature, 'moi-sinh.feature');
      assert.ok(seen[0]!.configFile?.startsWith(path.join(tmp, job.id)), 'chạy bằng config của job');
      assert.equal(seen[0]!.existed, true, 'config của job phải có mặt lúc chạy');
      // Hoãn ghi: registry của lượt này là bản chép sẽ bị xoá.
      assert.equal(seen[0]!.defer, true);
      assert.equal(existsSync(path.join(tmp, job.id)), false, 'thư mục job phải được dọn');
    } finally {
      worker.stop();
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
