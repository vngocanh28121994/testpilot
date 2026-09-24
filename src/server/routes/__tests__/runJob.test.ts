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
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
import { MemoryDeviceGrants } from '../../devices/memoryGrants.js';
import { MemorySessionStore } from '../../auth/session.js';
import { MemoryDeviceRegistry } from '../../devices/memoryRegistry.js';

function fakeRes(): {
  res: ServerResponse;
  events: Array<{ event: string; data: unknown }>;
  out: { status?: number; body: Record<string, unknown> };
} {
  const events: Array<{ event: string; data: unknown }> = [];
  // Route này có HAI kiểu phản hồi: SSE cho đường thành công, và JSON thường
  // cho lúc từ chối. Chỉ bắt SSE thì mọi khẳng định về câu từ chối đều nhìn
  // vào một mảng rỗng.
  const out: { status?: number; body: Record<string, unknown> } = { body: {} };
  let pending = '';
  let plain = '';
  const res = {
    writeHead(status: number) { out.status = status; return this; },
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
    end(chunk?: unknown) {
      if (chunk) plain += String(chunk);
      try { out.body = JSON.parse(plain) as Record<string, unknown>; } catch { /* SSE */ }
    },
  } as unknown as ServerResponse;
  return { res, events, out };
}

/** Config một-máy: chiếc máy thật là chiếc duy nhất đang cắm. */
const CONFIG = ConfigSchema.parse({
  web: { baseUrl: 'https://example.test' },
  android: { deviceName: 'Android Device' },
  ios: { deviceName: 'iPhone' },
});
const config = async () => CONFIG;

/**
 * Sổ thiết bị mặc định của các bài ở đây: một máy DÙNG CHUNG, để những bài
 * không nói gì về quyền vẫn chạy được đường thường.
 */
const defaultDevices = new MemoryDeviceRegistry();
await defaultDevices.report(
  { id: 'runner:lab', orgId: 'org-1', visibility: 'shared' },
  [{ platform: 'android', udid: 'emulator-5554', label: 'emulator' }],
);

function context(
  queue: MemoryJobQueue,
  devices = defaultDevices,
  who = 'u1',
  configFile = 'testpilot.config.json',
): RouteContext {
  return {
    configFile,
    configProfile: { owner: 't', source: 'personal' },
    identity: { userId: who, orgId: 'org-1', email: `${who}@x.dev`, role: 'runner_user' },
    repos: { queue } as unknown as Repos,
    runners: new MemoryRunnerRegistry(),
    devices,
    grants: new MemoryDeviceGrants(),
      sessions: new MemorySessionStore(),
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

async function postRun(
  queue: MemoryJobQueue,
  body: unknown,
  devices = defaultDevices,
  who = 'u1',
  configFile = 'testpilot.config.json',
) {
  const { res, events, out } = fakeRes();
  const req = Readable.from([Buffer.from(JSON.stringify(body), 'utf8')]) as IncomingMessage;
  // Giữ vòng lặp sự kiện sống trong lúc chờ.
  //
  // Nhịp của worker là `unref()` — đúng cho production, vì một server đang rỗi
  // phải tắt được bằng Ctrl-C ngay thay vì chờ hết nhịp. Nhưng ở test thì
  // KHÔNG có server HTTP nào giữ vòng lặp, nên Node thấy mọi việc đã xong
  // trong lúc route vẫn đang chờ job, và báo "promise still pending".
  const keepAlive = setInterval(() => {}, 20);
  try {
    await runRoutes['POST /api/run']!(
      req, res, new URL('http://x/api/run'), context(queue, devices, who, configFile),
    );
  } finally {
    clearInterval(keepAlive);
  }
  return Object.assign(events, { refused: out });
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
      // `device`, không `upload`: bài này đo đường đi của TỪNG TRƯỜNG. "Bản
      // đã tải lên" kéo theo cả việc tra bản build trên máy chủ, và có bài
      // riêng ở dưới.
      await postRun(queue, {
        platform: 'android', tag: '@p0', headed: true, includeQuarantined: true,
        env: 'uat', appSource: 'device', devices: ['android:emulator-5554'],
      });
      const [job] = await queue.list();
      assert.deepEqual(job!.spec.run, {
        platform: 'android', tag: '@p0', headed: true, includeQuarantined: true,
        env: 'uat', appSource: 'device',
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

describe('quyền dùng thiết bị khi tạo job', () => {
  /**
   * Nửa thứ hai của điều kiện P4.2: B không ĐẶT ĐƯỢC job trên máy riêng của A.
   *
   * Chặn ở lúc TẠO chứ không lúc chạy: một job đã vào hàng đợi là một job
   * người khác nhìn thấy trong danh sách chờ, kèm tên chiếc máy riêng của
   * người ta — và đó đã là rò rỉ, dù nó không bao giờ chạy.
   */
  it('không đặt được job lên máy riêng của người khác', async () => {
    const devices = new MemoryDeviceRegistry();
    await devices.report(
      { id: 'runner:an', orgId: 'org-1', ownerUserId: 'an', visibility: 'private' },
      [{ platform: 'android', udid: 'may-cua-an', label: 'Pixel của An' }],
    );

    const queue = new MemoryJobQueue();
    const events = await postRun(
      queue, { platform: 'android', devices: ['android:may-cua-an'] }, devices, 'binh',
    );

    assert.equal((await queue.list()).length, 0, 'job không được tạo');
    assert.equal(events.refused.status, 403);
    const text = JSON.stringify(events.refused.body);
    assert.match(text, /không có trong danh sách máy của bạn/);
    // Không nói máy ấy CÓ THẬT hay không: phân biệt hai trường hợp là nói cho
    // người lạ biết máy nào tồn tại.
    assert.ok(!text.includes('An'), 'không được rò tên chủ máy');
  });

  /**
   * Màn hình gửi `id` TRONG CONFIG, sổ thiết bị khoá theo udid.
   *
   * Đã hỏng thật: mọi lượt chạy Android đặt từ giao diện đều bị từ chối bằng
   * câu "không có trong danh sách máy của bạn", kể cả với chiếc máy đang cắm
   * ngay trước mặt — vì `android:sm-s918b` bị đem đi tra như thể nó là một
   * udid. Cùng phép quy đổi mà scheduler dùng.
   */
  it('mã máy trong config được quy đổi sang udid trước khi kiểm quyền', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tp-run-cfg-'));
    const configFile = path.join(dir, 'testpilot.config.json');
    // Đúng hình dạng config của một đội có khai máy: `id` để người đọc nhận
    // ra, `udid` là thứ adb và runner nói.
    await writeFile(configFile, JSON.stringify({
      web: { baseUrl: 'https://x.dev' },
      android: {
        devices: [{ id: 'may-lab', deviceName: 'Pixel', udid: 'emulator-5554' }],
      },
    }), 'utf8');

    // Worker đọc config của MÁY CHẠY, không phải của server — nên nó cũng
    // phải thấy `may-lab`, nếu không job vào hàng đợi rồi nằm chờ một chiếc
    // máy nó không biết tên.
    const runnerConfig = ConfigSchema.parse({
      web: { baseUrl: 'https://x.dev' },
      android: { devices: [{ id: 'may-lab', deviceName: 'Pixel', udid: 'emulator-5554' }] },
    });

    const queue = new MemoryJobQueue();
    const worker = startWorker({
      queue, leases: new MemoryLeaseRepo(), runnerId: 'local', configFile: 'x.json',
      config: async () => runnerConfig,
      pollMs: 5, runner: runner({ code: 0 }),
    });
    try {
      // Sổ thiết bị chỉ biết `emulator-5554`; màn hình gửi `may-lab`.
      const events = await postRun(
        queue, { platform: 'android', devices: ['android:may-lab'] },
        defaultDevices, 'u1', configFile,
      );
      // 200 chứ không 403: `refused` ở đây chỉ là lần `writeHead` đầu tiên,
      // và với một lượt chạy thành công nó là đầu luồng SSE.
      assert.notEqual(events.refused?.status, 403, 'không được từ chối chiếc máy đang cắm');
      assert.equal((await queue.list()).length, 1);
    } finally {
      worker.stop();
    }
  });

  it('chủ máy thì đặt được job lên chính máy mình', async () => {
    const devices = new MemoryDeviceRegistry();
    // udid phải là chiếc máy mà runner giả THẤY đang cắm: nếu không, job vào
    // hàng đợi rồi nằm chờ một chiếc máy chưa cắm — đúng hành vi của P3.3, và
    // bài test sẽ treo tới hết hạn thay vì đỏ.
    await devices.report(
      { id: 'runner:an', orgId: 'org-1', ownerUserId: 'an', visibility: 'private' },
      [{ platform: 'android', udid: 'emulator-5554', label: 'Pixel của An' }],
    );

    const queue = new MemoryJobQueue();
    const worker = startWorker({
      queue, leases: new MemoryLeaseRepo(), runnerId: 'local', configFile: 'x.json', config,
      pollMs: 5, runner: runner({ code: 0 }),
    });
    try {
      await postRun(
        queue, { platform: 'android', devices: ['android:emulator-5554'] }, devices, 'an',
      );
      assert.equal((await queue.list()).length, 1);
    } finally {
      worker.stop();
    }
  });

  it('máy chưa báo cáo bao giờ cũng bị từ chối', async () => {
    const queue = new MemoryJobQueue();
    await postRun(
      queue, { platform: 'android', devices: ['android:khong-co-that'] },
      new MemoryDeviceRegistry(),
    );
    assert.equal((await queue.list()).length, 0);
  });
});

/**
 * "Bản đã tải lên" là bản trên MÁY CHỦ — nó phải đi theo job.
 *
 * Không có nó, runner ở laptop khác cài bản build nằm trên đĩa của chính nó,
 * có thể là bản cũ ba tuần, rồi báo kết quả như thể đã chạy trên bản vừa tải.
 */
describe('POST /api/run và bản build', () => {
  async function withBuildConfig(app?: string) {
    const dir = await mkdtemp(path.join(tmpdir(), 'tp-build-'));
    const configFile = path.join(dir, 'cfg.json');
    await writeFile(configFile, JSON.stringify({
      web: { baseUrl: 'https://example.test' },
      android: { deviceName: 'Android Device', ...(app ? { app } : {}) },
    }));
    return { dir, configFile };
  }

  it('gắn bản build máy chủ vào job, kèm cỡ và hash', async () => {
    const { dir, configFile } = await withBuildConfig();
    const apk = path.join(dir, 'app.apk');
    await writeFile(apk, 'nội dung bản build');
    await writeFile(configFile, JSON.stringify({
      web: { baseUrl: 'https://example.test' }, android: { deviceName: 'x', app: apk },
    }));
    const queue = new MemoryJobQueue();
    try {
      // Không bật worker: bài này đo thứ được ĐẶT vào hàng đợi.
      const pending = postRun(queue, {
        platform: 'android', appSource: 'upload', devices: ['android:emulator-5554'],
      }, defaultDevices, 'u1', configFile);
      await waitUntil(async () => (await queue.list()).length > 0);
      const [job] = await queue.list();
      const build = job!.spec.run!.appBuilds!.android!;
      assert.equal(build.name, 'app.apk');
      assert.equal(build.size, Buffer.byteLength('nội dung bản build'));
      assert.equal(build.sha256, createHash('sha256').update('nội dung bản build').digest('hex'));
      await close(queue, job!.id);
      await pending;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('máy ở runner KHÁC mà máy chủ không có bản build thì từ chối, không đặt job', async () => {
    const { dir, configFile } = await withBuildConfig();
    const queue = new MemoryJobQueue();
    try {
      const events = await postRun(queue, {
        platform: 'android', appSource: 'upload', devices: ['android:emulator-5554'],
      }, defaultDevices, 'u1', configFile);
      assert.equal(events.refused.status, 400);
      assert.match(String(events.refused.body.error), /bản build/);
      assert.equal((await queue.list()).length, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('máy cắm ở CHÍNH máy chủ thì vẫn chạy như trước, không cần gửi bản build', async () => {
    // Simulator iOS dùng bản `.app` là một thư mục — thứ chưa gửi qua mạng
    // được — nhưng máy ở đây thì chẳng cần gửi đi đâu. Chặn ở đây là một hồi
    // quy cho đúng cách chạy dùng hằng ngày.
    const { dir, configFile } = await withBuildConfig();
    const local = new MemoryDeviceRegistry();
    await local.report(
      { id: 'runner:local', orgId: 'org-1', visibility: 'shared' },
      [{ platform: 'android', udid: 'emulator-5554', label: 'emulator' }],
    );
    const queue = new MemoryJobQueue();
    try {
      const pending = postRun(queue, {
        platform: 'android', appSource: 'upload', devices: ['android:emulator-5554'],
      }, local, 'u1', configFile);
      await waitUntil(async () => (await queue.list()).length > 0);
      const [job] = await queue.list();
      assert.equal(job!.spec.run!.appBuilds, undefined);
      await close(queue, job!.id);
      await pending;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/** Đóng job thay cho một worker, để lượt POST đang chờ nó kết thúc. */
async function close(queue: MemoryJobQueue, id: string): Promise<void> {
  await queue.claim({ runnerId: 'test' });
  await queue.finish(id, { type: 'job.result', jobId: id, state: 'succeeded' });
}

async function waitUntil(check: () => Promise<boolean>, within = 2_000): Promise<void> {
  const deadline = Date.now() + within;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('hết giờ chờ');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * Máy ở NHIỀU máy tính trong một lượt chạy: một job cho mỗi runner.
 *
 * Một job chỉ được một runner nhận, và runner ấy đòi MỌI máy của job cắm ở
 * chính nó. Một job chứa Android ở máy chủ và iPhone ở laptop thì bị cả hai
 * runner hoãn mãi — mỗi bên thấy một chiếc "chưa cắm" — và lượt chạy treo không
 * một lời. Ô chọn máy gom theo máy tính làm tổ hợp ấy chọn được bằng hai cú bấm.
 */
describe('POST /api/run chia máy theo runner', () => {
  async function twoRunners() {
    const devices = new MemoryDeviceRegistry();
    await devices.report(
      { id: 'runner:lab', orgId: 'org-1', visibility: 'shared' },
      [{ platform: 'android', udid: 'emulator-5554', label: 'emulator' }],
    );
    await devices.report(
      { id: 'runner:mac', orgId: 'org-1', visibility: 'shared' },
      [{ platform: 'ios', udid: 'SIM-1', label: 'iPhone 15' }],
    );
    return devices;
  }

  async function closeAll(queue: MemoryJobQueue): Promise<void> {
    for (const job of await queue.list()) {
      await queue.claim({ runnerId: 'test' });
      await queue.finish(job.id, { type: 'job.result', jobId: job.id, state: 'succeeded' });
    }
  }

  it('máy của hai runner thành hai job, mỗi job đúng máy của runner ấy', async () => {
    const queue = new MemoryJobQueue();
    const devices = await twoRunners();
    const pending = postRun(queue, {
      platform: 'android', devices: ['android:emulator-5554', 'ios:SIM-1'],
    }, devices);
    await waitUntil(async () => (await queue.list()).length === 2);
    const jobs = await queue.list();
    const byTokens = new Map(jobs.map((job) => [job.spec.deviceTokens.join(','), job]));
    assert.ok(byTokens.has('android:emulator-5554'));
    assert.ok(byTokens.has('ios:SIM-1'));
    // Nền tảng của mỗi job là của chính nhóm ấy: nó quyết định runner nào
    // được mời nhận job.
    assert.equal(byTokens.get('ios:SIM-1')!.spec.run!.platform, 'ios');
    assert.equal(byTokens.get('android:emulator-5554')!.spec.run!.platform, 'android');
    await closeAll(queue);
    const events = await pending;
    // Hai luồng log gộp lại, và mỗi dòng nói nó của máy nào.
    const logs = events.filter((e) => e.event === 'log').map((e) => String(e.data));
    assert.ok(logs.some((line) => line.startsWith('[runner:lab]')));
    assert.ok(logs.some((line) => line.startsWith('[runner:mac]')));
  });

  it('máy cùng một runner vẫn ở chung một job', async () => {
    const queue = new MemoryJobQueue();
    const devices = await twoRunners();
    await devices.report(
      { id: 'runner:mac', orgId: 'org-1', visibility: 'shared' },
      [
        { platform: 'ios', udid: 'SIM-1', label: 'iPhone 15' },
        { platform: 'android', udid: 'PIXEL-1', label: 'Pixel' },
      ],
    );
    const pending = postRun(queue, {
      platform: 'android', devices: ['android:PIXEL-1', 'ios:SIM-1'],
    }, devices);
    await waitUntil(async () => (await queue.list()).length > 0);
    // Cho route thêm một nhịp: nếu nó định tạo job thứ hai thì đã tạo.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const jobs = await queue.list();
    assert.equal(jobs.length, 1);
    assert.deepEqual(jobs[0]!.spec.deviceTokens.sort(), ['android:PIXEL-1', 'ios:SIM-1']);
    await closeAll(queue);
    await pending;
  });

  it('bản đã tải lên: mỗi job mang bản build của ĐÚNG những nền tảng nó chạy', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tp-both-'));
    const apk = path.join(dir, 'app.apk');
    const ipa = path.join(dir, 'App.ipa');
    await writeFile(apk, 'android');
    await writeFile(ipa, 'ios');
    const configFile = path.join(dir, 'cfg.json');
    await writeFile(configFile, JSON.stringify({
      web: { baseUrl: 'https://example.test' },
      android: { deviceName: 'a', app: apk }, ios: { deviceName: 'i', app: ipa },
    }));
    const queue = new MemoryJobQueue();
    try {
      const pending = postRun(queue, {
        platform: 'android', appSource: 'upload', devices: ['android:emulator-5554', 'ios:SIM-1'],
      }, await twoRunners(), 'u1', configFile);
      await waitUntil(async () => (await queue.list()).length === 2);
      for (const job of await queue.list()) {
        const [platform] = job.spec.deviceTokens[0]!.split(':');
        assert.deepEqual(Object.keys(job.spec.run!.appBuilds ?? {}), [platform]);
      }
      await closeAll(queue);
      await pending;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('một nhóm không gửi được bản build thì KHÔNG tạo job nào — không để nửa lượt trong hàng đợi', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tp-half-'));
    const apk = path.join(dir, 'app.apk');
    await writeFile(apk, 'android');
    const configFile = path.join(dir, 'cfg.json');
    await writeFile(configFile, JSON.stringify({
      web: { baseUrl: 'https://example.test' }, android: { deviceName: 'a', app: apk },
    }));
    const queue = new MemoryJobQueue();
    try {
      const events = await postRun(queue, {
        platform: 'android', appSource: 'upload', devices: ['android:emulator-5554', 'ios:SIM-1'],
      }, await twoRunners(), 'u1', configFile);
      assert.equal(events.refused.status, 400);
      assert.equal((await queue.list()).length, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
