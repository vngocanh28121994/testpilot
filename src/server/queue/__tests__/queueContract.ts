/**
 * Bộ khẳng định của hàng đợi, dùng chung cho MỌI hiện thực.
 *
 * Bản bộ nhớ chạy trong `npm test`, bản Postgres chạy trong
 * `npm run test:integration`. Cùng một file, nên "hai bên nói cùng một câu" là
 * thứ được chứng minh chứ không phải hy vọng — và khi chuyển từ bản local lên
 * server, chỗ lệch không còn chỗ nào để nấp.
 */
import assert from 'node:assert/strict';
import type { JobQueue } from '../queue.js';

const RUN_SUITE = {
  kind: 'run_suite' as const,
  createdBy: 'u1',
  orgId: 'org-1',
  spec: {
    orgId: 'org-1',
    kind: 'run_suite' as const,
    createdBy: 'u1',
    timeoutMs: 600_000,
    deviceTokens: [],
    run: { platform: 'android', tag: '@smoke' },
  },
};

function androidJob(overrides: Partial<typeof RUN_SUITE.spec> = {}) {
  return { ...RUN_SUITE, spec: { ...RUN_SUITE.spec, ...overrides } };
}

/**
 * Gọi từ một `describe` của bên gọi. Nhận hàm dựng kho mới cho mỗi bài.
 *
 * `it` truyền vào chứ không import: `node:test` và `vitest` khai báo bài test
 * theo hai cách khác nhau, và bộ khẳng định này không nên biết bên nào đang
 * chạy nó.
 */
export function queueContract(
  it: (name: string, fn: () => Promise<void>) => void,
  fresh: () => Promise<JobQueue>,
): void {
  it('job mới nằm ở queued, và mang jobId trong spec', async () => {
    const queue = await fresh();
    const job = await queue.create(androidJob());

    assert.equal(job.state, 'queued');
    assert.equal(job.attempt, 1);
    assert.equal(job.spec.jobId, job.id, 'spec phải mang chính id của job, nếu không runner báo về sai chỗ');
    assert.ok(job.requestedAt);
    assert.equal(job.startedAt, undefined);
  });

  /** Đây là điều kiện hoàn thành của P3.1, viết thành một khẳng định. */
  it('không có runner nào thì job NẰM YÊN ở queued', async () => {
    const queue = await fresh();
    const job = await queue.create(androidJob());

    // Không ai `claim`. Trạng thái không được tự đổi.
    assert.equal((await queue.find(job.id))?.state, 'queued');
    assert.deepEqual((await queue.list({ state: ['queued'] })).map((j) => j.id), [job.id]);
  });

  it('runner đòi thì job thành running, và mang tên runner', async () => {
    const queue = await fresh();
    const job = await queue.create(androidJob());

    const claimed = await queue.claim({ runnerId: 'runner-1' });
    assert.equal(claimed?.id, job.id);
    assert.equal(claimed?.state, 'running');
    assert.equal(claimed?.runnerId, 'runner-1');
    assert.ok(claimed?.startedAt);
  });

  it('hàng đợi rỗng thì trả undefined, không phải lỗi', async () => {
    const queue = await fresh();
    assert.equal(await queue.claim({ runnerId: 'runner-1' }), undefined);
  });

  /**
   * Phép loại trừ: hai runner đòi cùng lúc thì mỗi bên được một job khác nhau,
   * và không job nào bị nhận hai lần. Đây là lý do hàng đợi nằm ở kho chứ
   * không phải trong RAM của một tiến trình.
   */
  it('một job chỉ một runner nhận', async () => {
    const queue = await fresh();
    await queue.create(androidJob());
    await queue.create(androidJob());

    const claims = await Promise.all([
      queue.claim({ runnerId: 'a' }),
      queue.claim({ runnerId: 'b' }),
      queue.claim({ runnerId: 'c' }),
    ]);
    const ids = claims.filter(Boolean).map((job) => job!.id);

    assert.equal(ids.length, 2, 'hai job thì đúng hai lượt đòi được');
    assert.equal(new Set(ids).size, 2, 'không job nào được nhận hai lần');
  });

  it('job cũ nhất được nhận trước', async () => {
    const queue = await fresh();
    const first = await queue.create(androidJob({ tag: '@first' } as never));
    await queue.create(androidJob({ tag: '@second' } as never));

    assert.equal((await queue.claim({ runnerId: 'a' }))?.id, first.id);
  });

  /**
   * Runner chỉ chạy web không được nhận job Android: nó sẽ fail giữa chừng, và
   * job quay lại hàng đợi để lại bị chính nó nhận.
   */
  it('không nhận job của nền tảng mình không chạy được', async () => {
    const queue = await fresh();
    await queue.create(androidJob());

    assert.equal(await queue.claim({ runnerId: 'web-only', platforms: ['web'] }), undefined);
    assert.ok(await queue.claim({ runnerId: 'full', platforms: ['web', 'android'] }));
  });

  it('job không chạm thiết bị thì runner nào cũng nhận được', async () => {
    const queue = await fresh();
    await queue.create({
      orgId: 'org-1', kind: 'gen', createdBy: 'u1',
      spec: { orgId: 'org-1', kind: 'gen', createdBy: 'u1', timeoutMs: 60_000, deviceTokens: [] },
    });
    assert.ok(await queue.claim({ runnerId: 'web-only', platforms: ['web'] }));
  });

  /**
   * Điều kiện hoàn thành của P3.3, viết thành một khẳng định.
   *
   * Một người bắn năm mươi job không được làm người kế tiếp chờ hết năm mươi
   * lượt — họ không làm gì sai, họ chỉ bấm chậm hơn.
   */
  it('công bằng: người bắn nhiều job không chặn người bắn ít', async () => {
    const queue = await fresh();
    for (let i = 0; i < 5; i += 1) {
      await queue.create({ ...androidJob(), createdBy: 'nguoi-ban-nhieu' });
    }
    await queue.create({ ...androidJob(), createdBy: 'nguoi-ban-it' });

    // Lượt đầu: chưa ai chạy gì, nên job cũ nhất thắng.
    const first = await queue.claim({ runnerId: 'r1' });
    assert.equal(first?.createdBy, 'nguoi-ban-nhieu');

    // Lượt thứ hai: người kia đã có một job chạy, nên tới lượt người ít việc —
    // dù job của họ đặt SAU cả năm job trên.
    const second = await queue.claim({ runnerId: 'r2' });
    assert.equal(second?.createdBy, 'nguoi-ban-it');
  });

  it('cùng số job đang chạy thì ai đặt trước được trước', async () => {
    const queue = await fresh();
    const early = await queue.create({ ...androidJob(), createdBy: 'a' });
    await queue.create({ ...androidJob(), createdBy: 'b' });

    assert.equal((await queue.claim({ runnerId: 'r1' }))?.id, early.id);
  });

  /** Lớp thứ hai: chặn người giữ job chạy thật lâu để chiếm hết công suất. */
  it('hạn mức job đồng thời cho mỗi người', async () => {
    const queue = await fresh();
    await queue.create({ ...androidJob(), createdBy: 'mot-minh' });
    await queue.create({ ...androidJob(), createdBy: 'mot-minh' });

    assert.ok(await queue.claim({ runnerId: 'r1', maxPerUser: 1 }));
    assert.equal(
      await queue.claim({ runnerId: 'r2', maxPerUser: 1 }), undefined,
      'đã chạm hạn thì không nhận thêm, dù hàng đợi còn job',
    );
    // Không đặt hạn thì vẫn nhận được: hạn là tuỳ chọn, không phải mặc định.
    assert.ok(await queue.claim({ runnerId: 'r3' }));
  });

  it('job đã nhận thì không ai đòi lại được', async () => {
    const queue = await fresh();
    await queue.create(androidJob());
    await queue.claim({ runnerId: 'a' });

    assert.equal(await queue.claim({ runnerId: 'b' }), undefined);
  });

  it('xong thì đóng lại kèm kết quả', async () => {
    const queue = await fresh();
    const job = await queue.create(androidJob());
    await queue.claim({ runnerId: 'a' });

    const done = await queue.finish(job.id, {
      type: 'job.result', jobId: job.id, state: 'succeeded',
      scenarios: { total: 3, passed: 3, failed: 0, skipped: 0 },
    });

    assert.equal(done?.state, 'succeeded');
    assert.ok(done?.finishedAt);
    assert.equal(done?.result?.scenarios?.passed, 3);
    assert.equal(await queue.claim({ runnerId: 'b' }), undefined, 'job đã đóng không quay lại hàng đợi');
  });

  it('hỏng thì giữ lại câu lỗi', async () => {
    const queue = await fresh();
    const job = await queue.create(androidJob());
    await queue.claim({ runnerId: 'a' });
    const done = await queue.finish(job.id, {
      type: 'job.result', jobId: job.id, state: 'failed', error: 'Không tìm thấy thiết bị.',
    });

    assert.equal(done?.state, 'failed');
    assert.equal(done?.error, 'Không tìm thấy thiết bị.');
  });

  /**
   * Trả job về hàng đợi khi lỗi là của RIÊNG runner ấy — hết đĩa, mất mạng.
   * `attempt` tăng, để một job hỏng mãi không nằm im mà không ai biết.
   */
  it('trả lại hàng đợi thì máy khác nhận được, và attempt tăng', async () => {
    const queue = await fresh();
    const job = await queue.create(androidJob());
    await queue.claim({ runnerId: 'a' });

    const back = await queue.release(job.id, 'Hết dung lượng đĩa.');
    assert.equal(back?.state, 'queued');
    assert.equal(back?.attempt, 2);
    assert.equal(back?.runnerId, undefined);
    assert.equal(back?.error, 'Hết dung lượng đĩa.', 'lần sau hỏng nữa thì phải biết lần trước hỏng vì gì');

    assert.equal((await queue.claim({ runnerId: 'b' }))?.id, job.id);
  });

  /**
   * Hoãn khác trả-lại-hàng-đợi ở đúng một điểm, và điểm ấy quan trọng:
   * `attempt` không tăng. Máy đang có người cầm là chuyện tạm thời, không phải
   * một lần thử hỏng — đo được ở lần chạy thật đầu tiên của P3.2, khi
   * `attempt` lên 33 trong tám giây và log lặp lại cùng một câu.
   */
  it('hoãn thì không tính là một lần thử, và không đòi lại được ngay', async () => {
    const queue = await fresh();
    const job = await queue.create(androidJob());
    await queue.claim({ runnerId: 'a' });

    const waiting = await queue.defer(job.id, 'Máy đang có người cầm.', 30_000);
    assert.equal(waiting?.state, 'queued');
    assert.equal(waiting?.attempt, 1, 'chờ máy không phải một lần thử');
    assert.equal(waiting?.error, 'Máy đang có người cầm.');
    assert.equal(waiting?.runnerId, undefined);

    assert.equal(await queue.claim({ runnerId: 'b' }), undefined, 'chưa tới hạn thì chưa đòi được');
  });

  it('hết hạn hoãn thì đòi lại được', async () => {
    const queue = await fresh();
    const job = await queue.create(androidJob());
    await queue.claim({ runnerId: 'a' });
    await queue.defer(job.id, 'Máy đang bận.', 0);

    assert.equal((await queue.claim({ runnerId: 'b' }))?.id, job.id);
  });

  /** Trả lại hàng đợi vì lỗi THẬT thì xoá mốc hoãn: nó là một lần thử mới. */
  it('trả lại hàng đợi xoá mốc hoãn', async () => {
    const queue = await fresh();
    const job = await queue.create(androidJob());
    await queue.claim({ runnerId: 'a' });
    await queue.defer(job.id, 'Máy đang bận.', 30_000);
    await queue.release(job.id, 'Hết đĩa.');

    const back = await queue.claim({ runnerId: 'b' });
    assert.equal(back?.id, job.id);
    assert.equal(back?.attempt, 2);
  });

  it('job đã đóng thì không trả lại hàng đợi được', async () => {
    const queue = await fresh();
    const job = await queue.create(androidJob());
    await queue.claim({ runnerId: 'a' });
    await queue.finish(job.id, { type: 'job.result', jobId: job.id, state: 'succeeded' });

    assert.equal(await queue.release(job.id, 'thử trả lại'), undefined);
  });

  /** Một job còn `running` sau khi tiến trình chết là một dòng nói dối. */
  it('dọn job treo sau khi tiến trình chết', async () => {
    const queue = await fresh();
    const job = await queue.create(androidJob());
    await queue.claim({ runnerId: 'a' });
    const queued = await queue.create(androidJob());

    assert.equal(await queue.interruptStale(), 1);
    assert.equal((await queue.find(job.id))?.state, 'interrupted');
    assert.ok((await queue.find(job.id))?.error);
    assert.equal((await queue.find(queued.id))?.state, 'queued', 'job chưa ai nhận thì không đụng tới');
  });

  it('lọc theo trạng thái và giới hạn số dòng', async () => {
    const queue = await fresh();
    const a = await queue.create(androidJob());
    await queue.create(androidJob());
    await queue.claim({ runnerId: 'r' });

    assert.deepEqual((await queue.list({ state: ['running'] })).map((j) => j.id), [a.id]);
    assert.equal((await queue.list({ limit: 1 })).length, 1);
    assert.equal((await queue.list()).length, 2);
  });
}

/**
 * Phần log sống. Từ P3.4 cả hai kho đều có: bản bộ nhớ giữ trong RAM, bản
 * Postgres ghi vào `job_event` và hỏi lại mỗi nửa giây.
 *
 * Vì bản Postgres hỏi theo nhịp, những khẳng định ở đây phải CHỜ chứ không
 * đọc ngay — nên chúng dùng `until()`.
 */
async function until(check: () => boolean, within = 4_000): Promise<void> {
  const deadline = Date.now() + within;
  while (!check() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export function logContract(
  it: (name: string, fn: () => Promise<void>) => void,
  fresh: () => Promise<JobQueue>,
): void {
  it('người nghe nhận được cả phần đã có lẫn phần đến sau', async () => {
    const queue = await fresh();
    const job = await queue.create(androidJob());
    await queue.appendLog(job.id, 'dòng một');
    await queue.appendLog(job.id, 'dòng hai');

    const seen: string[] = [];
    const off = await queue.onLog(job.id, (line) => seen.push(line));
    await queue.appendLog(job.id, 'dòng ba');
    await until(() => seen.length >= 3);

    assert.deepEqual(seen, ['dòng một', 'dòng hai', 'dòng ba']);
    off();
    await queue.appendLog(job.id, 'dòng bốn');
    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.equal(seen.length, 3, 'thôi nghe thì không nhận nữa');
  });

  /**
   * Gửi lại một lô đã tới nơi là chuyện BÌNH THƯỜNG của một runner mất mạng.
   * Cùng một `seq` chỉ được ghi một lần, nếu không log nhân đôi sau mỗi lần
   * mạng chập — và người đọc không có cách nào biết dòng nào là thật.
   */
  it('cùng seq gửi hai lần chỉ ghi một lần', async () => {
    const queue = await fresh();
    const job = await queue.create(androidJob());

    const seen: string[] = [];
    const off = await queue.onLog(job.id, (line) => seen.push(line));
    await queue.appendLog(job.id, 'một', 1);
    await queue.appendLog(job.id, 'hai', 2);
    // Runner không nhận được xác nhận nên gửi lại cả lô.
    await queue.appendLog(job.id, 'một', 1);
    await queue.appendLog(job.id, 'hai', 2);
    await queue.appendLog(job.id, 'ba', 3);
    await until(() => seen.length >= 3);

    assert.deepEqual(seen, ['một', 'hai', 'ba']);
    off();
  });

  it('báo mỗi lần job đổi trạng thái', async () => {
    const queue = await fresh();
    const job = await queue.create(androidJob());

    const states: string[] = [];
    const off = await queue.onState(job.id, (record) => states.push(record.state));
    await queue.claim({ runnerId: 'a' });
    await until(() => states.includes('running'));
    await queue.finish(job.id, { type: 'job.result', jobId: job.id, state: 'succeeded' });
    await until(() => states.includes('succeeded'));

    assert.deepEqual(states, ['running', 'succeeded']);
    off();
  });
}
