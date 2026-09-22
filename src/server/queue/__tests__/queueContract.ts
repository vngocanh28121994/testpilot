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
 * Phần log sống, tách riêng: bản Postgres sẽ hiện thực nó bằng `job_event` ở
 * P3.4 cùng với transport của runner, nên hôm nay chỉ bản bộ nhớ có.
 */
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

    assert.deepEqual(seen, ['dòng một', 'dòng hai', 'dòng ba']);
    off();
    await queue.appendLog(job.id, 'dòng bốn');
    assert.equal(seen.length, 3, 'thôi nghe thì không nhận nữa');
  });

  it('báo mỗi lần job đổi trạng thái', async () => {
    const queue = await fresh();
    const job = await queue.create(androidJob());

    const states: string[] = [];
    await queue.onState(job.id, (record) => states.push(record.state));
    await queue.claim({ runnerId: 'a' });
    await queue.finish(job.id, { type: 'job.result', jobId: job.id, state: 'succeeded' });

    assert.deepEqual(states, ['running', 'succeeded']);
  });
}
