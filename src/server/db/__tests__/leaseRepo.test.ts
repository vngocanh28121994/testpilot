/**
 * Hợp đồng lease, đo trên bản bộ nhớ.
 *
 * Cùng bộ khẳng định này chạy lại với bản Postgres trong
 * [pgLease.integration.test.ts](./pgLease.integration.test.ts) — vì hai hiện
 * thực khác nhau mà chỉ một bên được đo là cách chắc chắn để chúng lệch nhau.
 *
 * Thứ đáng đo nhất ở đây không phải "giữ được máy", mà là những lần KHÔNG được
 * giữ: người khác đang giữ, lease đã hết hạn, người gia hạn không phải người
 * đang giữ. Cả ba đều là đường mà một chiếc máy bị hai bên dùng cùng lúc.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryLeaseRepo } from '../leaseRepo.js';
import { fileRepos } from '../fileRepo.js';
import { LeaseTakenError, LEASE_TTL_MS, type LeaseHolder } from '../repo.js';

const ME: LeaseHolder = { kind: 'human', userId: 'user-1' };
const YOU: LeaseHolder = { kind: 'human', userId: 'user-2' };
const JOB: LeaseHolder = { kind: 'job', jobId: 'job-1' };
const T0 = new Date('2026-09-22T10:00:00.000Z');
const later = (ms: number) => new Date(T0.getTime() + ms);

describe('MemoryLeaseRepo', () => {
  it('giữ được máy rỗi, và nói rõ hạn', async () => {
    const repo = new MemoryLeaseRepo();
    const lease = await repo.acquire('dev-1', ME, T0);

    assert.equal(lease.deviceId, 'dev-1');
    assert.deepEqual(lease.holder, ME);
    assert.equal(Date.parse(lease.expiresAt) - T0.getTime(), LEASE_TTL_MS);
  });

  it('người thứ hai không lấy được, và biết ai đang giữ', async () => {
    const repo = new MemoryLeaseRepo();
    await repo.acquire('dev-1', ME, T0);

    await assert.rejects(
      () => repo.acquire('dev-1', YOU, later(1000)),
      (err: unknown) => {
        assert.ok(err instanceof LeaseTakenError);
        assert.deepEqual(err.current.holder, ME);
        // Câu lỗi mặc định nói việc cần làm, không in mã người dùng hay giờ
        // UTC. Ai giữ nằm trong `err.current`, để route viết câu có tên người
        // và tên máy.
        assert.doesNotMatch(err.message, /user-1|T\d\d:\d\d/);
        assert.match(err.message, /Chờ/);
        return true;
      },
    );
  });

  /** Job và người tranh nhau qua CÙNG một phép loại trừ — xem migration 0002. */
  it('job không chen được vào máy đang có người giữ, và ngược lại', async () => {
    const repo = new MemoryLeaseRepo();
    await repo.acquire('dev-1', ME, T0);
    await assert.rejects(() => repo.acquire('dev-1', JOB, T0), LeaseTakenError);

    const other = new MemoryLeaseRepo();
    await other.acquire('dev-2', JOB, T0);
    await assert.rejects(() => other.acquire('dev-2', ME, T0), LeaseTakenError);
  });

  /** Một cú F5 không được làm mất quyền điều khiển của chính người vừa lấy nó. */
  it('chính người đang giữ bấm lại thì là gia hạn, không phải xung đột', async () => {
    const repo = new MemoryLeaseRepo();
    const first = await repo.acquire('dev-1', ME, T0);
    const again = await repo.acquire('dev-1', ME, later(5_000));

    assert.equal(again.id, first.id, 'cùng một lease, không phải lease mới');
    assert.equal(again.acquiredAt, first.acquiredAt);
    assert.ok(Date.parse(again.expiresAt) > Date.parse(first.expiresAt));
  });

  it('hết hạn thì máy rỗi, và người khác lấy được', async () => {
    const repo = new MemoryLeaseRepo();
    await repo.acquire('dev-1', ME, T0);

    assert.equal(await repo.find('dev-1', later(LEASE_TTL_MS - 1)) !== undefined, true);
    assert.equal(await repo.find('dev-1', later(LEASE_TTL_MS)), undefined);

    const taken = await repo.acquire('dev-1', YOU, later(LEASE_TTL_MS + 1));
    assert.deepEqual(taken.holder, YOU);
  });

  it('nhịp tim giữ máy, ngừng nhịp thì nhả', async () => {
    const repo = new MemoryLeaseRepo();
    const lease = await repo.acquire('dev-1', ME, T0);

    // Gia hạn mỗi 30s: qua mốc 60s mà vẫn còn giữ.
    assert.ok(await repo.renew(lease.id, ME, later(30_000)));
    assert.ok(await repo.find('dev-1', later(70_000)), 'còn nhịp thì còn giữ');

    // Gập laptop ở giây 30: tới giây 91 máy phải rỗi.
    assert.equal(await repo.find('dev-1', later(91_000)), undefined);
  });

  it('người không giữ thì không gia hạn được', async () => {
    const repo = new MemoryLeaseRepo();
    const lease = await repo.acquire('dev-1', ME, T0);

    assert.equal(await repo.renew(lease.id, YOU, later(1000)), undefined);
    assert.equal(await repo.renew('lease-khong-ton-tai', ME, later(1000)), undefined);
  });

  /**
   * Gia hạn một lease đã hết hạn phải THẤT BẠI, không phải hồi sinh nó.
   *
   * Nếu hồi sinh được thì có một đường lấy lại máy mà người khác có thể đã giữ
   * trong khoảng hở — và bên bị mất máy không nhận được câu nào.
   */
  it('lease đã hết hạn thì không gia hạn được nữa', async () => {
    const repo = new MemoryLeaseRepo();
    const lease = await repo.acquire('dev-1', ME, T0);
    await repo.acquire('dev-1', YOU, later(LEASE_TTL_MS + 1));

    assert.equal(await repo.renew(lease.id, ME, later(LEASE_TTL_MS + 2)), undefined);
    assert.deepEqual((await repo.find('dev-1', later(LEASE_TTL_MS + 2)))?.holder, YOU);
  });

  it('nhả thì máy rỗi ngay, và chỉ người giữ nhả được', async () => {
    const repo = new MemoryLeaseRepo();
    const lease = await repo.acquire('dev-1', ME, T0);

    assert.equal(await repo.release(lease.id, YOU), false, 'người khác không nhả hộ được');
    assert.equal(await repo.release(lease.id, ME), true);
    assert.equal(await repo.find('dev-1', later(1)), undefined);
  });

  /** Cưỡng chế: quyền gọi kiểm ở route, kho chỉ làm. */
  it('cưỡng chế nhả không cần là người giữ', async () => {
    const repo = new MemoryLeaseRepo();
    const lease = await repo.acquire('dev-1', ME, T0);

    assert.equal(await repo.release(lease.id), true);
    assert.equal(await repo.find('dev-1', later(1)), undefined);
  });

  it('danh sách chỉ gồm lease còn hiệu lực', async () => {
    const repo = new MemoryLeaseRepo();
    await repo.acquire('dev-1', ME, T0);
    await repo.acquire('dev-2', YOU, later(30_000));

    assert.equal((await repo.list(later(31_000))).length, 2);
    // dev-1 hết hạn ở 60s, dev-2 ở 90s.
    assert.deepEqual((await repo.list(later(61_000))).map((l) => l.deviceId), ['dev-2']);
    assert.deepEqual(await repo.list(later(91_000)), []);
  });
});

/**
 * Hồi quy của một lỗi chỉ lộ ra khi chạy thật.
 *
 * `fileRepos()` được dựng lại ở mỗi request. Bản đầu trả về một
 * `MemoryLeaseRepo` MỚI mỗi lần, nên trên server thật: lấy máy xong, hỏi lại
 * thì máy rỗi — và lần lấy thứ hai sinh ra một lease thứ hai cho cùng chiếc
 * máy. Mọi test đều xanh, vì mỗi test dùng một repo cho cả bài.
 */
describe('fileRepos: lease sống qua nhiều request', () => {
  it('hai bộ repo dựng riêng vẫn thấy cùng một lease', async () => {
    const paths = { registry: 'registry/elements.json', runs: 'runs' };
    const first = fileRepos(paths);
    const second = fileRepos(paths);

    const lease = await first.leases.acquire('dev-chung', ME, T0);
    assert.ok(
      await second.leases.find('dev-chung', later(1_000)),
      'request thứ hai không thấy lease của request thứ nhất',
    );
    await assert.rejects(
      () => second.leases.acquire('dev-chung', YOU, later(1_000)),
      LeaseTakenError,
      'hai request tranh nhau một chiếc máy thì phải có một bên thua',
    );

    await first.leases.release(lease.id, ME);
  });
});
