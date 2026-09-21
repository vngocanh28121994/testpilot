/**
 * Một job đi hết vòng: `JobSpec` vào, `JobEvent` ra, `JobResult` chốt lại.
 *
 * Bài test này không kiểm tra việc chạy test — nó kiểm tra ĐƯỜNG DÂY. Khi P3
 * thay `InProcessTransport` bằng bản chạy qua WebSocket, chính những khẳng
 * định dưới đây phải còn đúng với hiện thực kia; nếu không thì hai chế độ đã
 * lệch nhau, và lệch ở đúng chỗ khó nhìn thấy nhất.
 *
 * Runner ở đây là bản giả — cố ý. Runner thật mở tiến trình bấm vào thiết bị,
 * và một bài test về đường dây không nên phụ thuộc vào việc có điện thoại cắm
 * hay không.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InProcessTransport, WebSocketTransport } from '../transport.js';
import type { Runner } from '../index.js';
import type { JobEvent, JobSpec } from '../../protocol/messages.js';
import { PROTOCOL_VERSION } from '../../protocol/version.js';

interface Recorded {
  suite: unknown[][];
  parallel: unknown[][];
  stopped: number;
}

function fakeRunner(behaviour: { throws?: string } = {}): { runner: Runner; log: Recorded } {
  const log: Recorded = { suite: [], parallel: [], stopped: 0 };
  const runner = {
    prereq: {} as Runner['prereq'],
    farm: {} as Runner['farm'],
    builds: {} as Runner['builds'],
    run: {
      startSuite: async (...args: unknown[]) => {
        log.suite.push(args);
        const emit = args[4] as (line: string) => void;
        emit('[run] bắt đầu');
        emit('[run] xong');
        if (behaviour.throws) throw new Error(behaviour.throws);
        return { code: 0, stopped: false, reportPaths: [], runDirs: [] };
      },
      startParallel: async (...args: unknown[]) => {
        log.parallel.push(args);
        (args[4] as (line: string) => void)('[parallel] bắt đầu');
        return { code: 0, stopped: false, reportPaths: [], runDirs: [] };
      },
      stop: async () => { log.stopped += 1; return { stopped: true, wda: false }; },
      isNamedDevice: async () => true,
      parseDeviceToken: (token: string) => {
        const [platform, ...rest] = token.split(':');
        const id = rest.join(':');
        if (!id || (platform !== 'android' && platform !== 'ios')) return null;
        return { platform, id };
      },
    },
  } as unknown as Runner;
  return { runner, log };
}

function spec(overrides: Partial<JobSpec> = {}): JobSpec {
  return {
    jobId: 'job-1',
    orgId: 'org-1',
    kind: 'run_suite',
    createdBy: 'user-1',
    timeoutMs: 60_000,
    deviceTokens: [],
    run: { platform: 'web', tag: '@smoke' },
    ...overrides,
  };
}

describe('InProcessTransport — vòng đời một job', () => {
  it('log chảy ra thành JobEvent có seq tăng dần', async () => {
    const { runner } = fakeRunner();
    const events: JobEvent[] = [];
    const result = await new InProcessTransport('cfg.json', runner).submit(spec(), (e) => events.push(e));

    assert.equal(result.state, 'succeeded');
    assert.deepEqual(events.map((e) => e.seq), [1, 2]);
    assert.deepEqual(
      events.map((e) => (e.event.kind === 'log' ? e.event.line : '')),
      ['[run] bắt đầu', '[run] xong'],
    );
    assert.ok(events.every((e) => e.jobId === 'job-1'), 'mọi sự kiện phải mang đúng jobId');
  });

  /**
   * Một thiết bị KHÔNG được đi đường song song: đường ấy thêm hậu tố vào tên
   * thư mục và hoãn ghi dữ liệu dùng chung, hai cái giá không đổi lại được gì
   * khi chỉ có một máy.
   */
  it('một thiết bị đi đường đơn, nhiều thiết bị đi đường song song', async () => {
    const one = fakeRunner();
    await new InProcessTransport('cfg.json', one.runner)
      .submit(spec({ deviceTokens: ['android:pixel'] }), () => {});
    assert.equal(one.log.suite.length, 1);
    assert.equal(one.log.parallel.length, 0);

    const many = fakeRunner();
    await new InProcessTransport('cfg.json', many.runner)
      .submit(spec({ deviceTokens: ['android:pixel', 'ios:iphone'] }), () => {});
    assert.equal(many.log.parallel.length, 1);
    assert.equal(many.log.suite.length, 0);
    assert.equal(many.log.parallel[0]![0], 'android,ios', 'nền tảng lấy từ thiết bị đã chọn');
  });

  /** Lỗi của runner thành `state: failed` kèm nguyên văn, không ném ra ngoài. */
  it('job hỏng trả JobResult failed chứ không ném', async () => {
    const { runner } = fakeRunner({ throws: 'Appium không khởi động được' });
    const result = await new InProcessTransport('cfg.json', runner).submit(spec(), () => {});

    assert.equal(result.state, 'failed');
    assert.match(result.error ?? '', /Appium không khởi động được/);
  });

  it('huỷ thì dừng runner và job kết thúc ở trạng thái cancelled', async () => {
    const { runner, log } = fakeRunner();
    const transport = new InProcessTransport('cfg.json', runner);
    await transport.cancel('job-1', 'người dùng bấm dừng');
    const result = await transport.submit(spec(), () => {});

    assert.equal(log.stopped, 1);
    assert.equal(result.state, 'cancelled');
  });

  /** `kind` lạ là lỗi cấu hình hoặc một server nói giao thức khác — không đoán. */
  it('từ chối job kind không biết', async () => {
    const { runner, log } = fakeRunner();
    const result = await new InProcessTransport('cfg.json', runner)
      .submit(spec({ kind: 'crawl' }), () => {});

    assert.equal(result.state, 'failed');
    assert.match(result.error ?? '', /không nhận job kind="crawl"/);
    assert.equal(log.suite.length, 0, 'không được chạy gì khi kind lạ');
  });

  it('run_suite thiếu phần `run` thì hỏng có thông báo', async () => {
    const { runner } = fakeRunner();
    const result = await new InProcessTransport('cfg.json', runner)
      .submit(spec({ run: undefined }), () => {});
    assert.match(result.error ?? '', /thiếu phần `run`/);
  });
});

describe('WebSocketTransport — chưa dựng', () => {
  /**
   * Nói ra là chưa có, kèm tên giai đoạn. Một `TODO` im lặng ở đây sẽ thành
   * một lỗi "undefined is not a function" ở P3, cách xa nguyên nhân.
   */
  it('ném lỗi nói rõ nó thuộc P3.4', () => {
    const transport = new WebSocketTransport('wss://lab.example/runner');
    assert.throws(() => transport.submit(), /chưa dựng — đó là P3.4/);
    assert.throws(() => transport.cancel(), /chưa dựng/);
  });

  it('cùng khai báo phiên bản giao thức với bản in-process', () => {
    assert.equal(new WebSocketTransport('wss://x').protocolVersion, PROTOCOL_VERSION);
    assert.equal(new InProcessTransport('cfg.json').protocolVersion, PROTOCOL_VERSION);
  });
});
