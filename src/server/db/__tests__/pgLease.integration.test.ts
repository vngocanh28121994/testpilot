/**
 * Lease trên Postgres, và điều bản bộ nhớ KHÔNG chứng minh được.
 *
 * `MemoryLeaseRepo` loại trừ bằng một `Map` trong một tiến trình. Ở chế độ
 * server có nhiều tiến trình sau load balancer, nên thứ duy nhất còn phân xử
 * được là DB. Bài test đáng giá nhất ở đây là hai mươi bên cùng đòi một chiếc
 * máy trong cùng một phần nghìn giây: đúng một bên phải thắng, và mười chín
 * bên còn lại phải nhận được câu "ai đang giữ".
 *
 * `.integration` nên `npm test` bỏ qua: cần `docker compose up -d`. Chạy bằng
 * `npm run test:integration`.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { connect } from '../connect.js';
import { PgLeaseRepo } from '../pgRepo.js';
import { MemoryLeaseRepo } from '../leaseRepo.js';
import { LeaseTakenError, LEASE_TTL_MS, type LeaseHolder, type LeaseRepo } from '../repo.js';

const URL_ = process.env.TESTPILOT_DATABASE_URL
  ?? 'postgres://testpilot:testpilot-dev@localhost:5432/testpilot';

let pool: Pool;
const ORG = `org-lease-${Date.now()}`;
const ME: LeaseHolder = { kind: 'human', userId: 'u-me' };
const YOU: LeaseHolder = { kind: 'human', userId: 'u-you' };
const T0 = new Date('2026-09-22T10:00:00.000Z');
const later = (ms: number) => new Date(T0.getTime() + ms);

before(async () => {
  pool = await connect({ url: URL_ });
  const at = new Date().toISOString();
  await pool.query('INSERT INTO org (id, name, created_at) VALUES ($1, $2, $3)', [ORG, 'Lease', at]);
  for (const [id, email] of [['u-me', 'me@test.dev'], ['u-you', 'you@test.dev']]) {
    await pool.query(
      `INSERT INTO app_user (id, email, name, created_at) VALUES ($1, $2, $1, $3)
       ON CONFLICT DO NOTHING`,
      [id, email, at],
    );
  }
  await pool.query(
    `INSERT INTO runner (id, org_id, name, mode, os, arch, protocol_version, agent_version,
       token_hash, visibility, state, created_at)
     VALUES ($1, $2, 'lab', 'lab', 'darwin', 'arm64', '1.0.0', '0.1.0', 'h', 'shared', 'online', $3)`,
    [`run-${ORG}`, ORG, at],
  );
  for (const device of ['dev-1', 'dev-2']) {
    await pool.query(
      `INSERT INTO device (id, runner_id, org_id, platform, name, visibility, state, updated_at)
       VALUES ($1, $2, $3, 'android', $1, 'shared', 'idle', $4)`,
      [`${ORG}-${device}`, `run-${ORG}`, ORG, at],
    );
  }
});

after(async () => {
  await pool.query('DELETE FROM lease WHERE org_id = $1', [ORG]);
  await pool.query('DELETE FROM device WHERE org_id = $1', [ORG]);
  await pool.query('DELETE FROM runner WHERE org_id = $1', [ORG]);
  await pool.query('DELETE FROM org WHERE id = $1', [ORG]);
  await pool.end();
});

function repo(): PgLeaseRepo {
  return new PgLeaseRepo(pool, ORG);
}

const DEV = `${ORG}-dev-1`;
const DEV2 = `${ORG}-dev-2`;

describe('PgLeaseRepo', () => {
  it('giữ, gia hạn, nhả — đường thường ngày', async () => {
    const leases = repo();
    const lease = await leases.acquire(DEV, ME, T0);
    assert.deepEqual(lease.holder, ME);

    const renewed = await leases.renew(lease.id, ME, later(30_000));
    assert.ok(renewed);
    assert.ok(Date.parse(renewed.expiresAt) > Date.parse(lease.expiresAt));

    assert.equal(await leases.release(lease.id, ME), true);
    assert.equal(await leases.find(DEV, later(30_001)), undefined);
  });

  /**
   * Hai mươi bên tranh một chiếc máy. Đây là lý do lease nằm ở DB.
   *
   * `Promise.all` trên cùng một pool cho ra những transaction thật sự chồng
   * nhau, nên nếu phép loại trừ chỉ là "đọc rồi ghi" trong mã của ta thì bài
   * này đỏ. Nó xanh nhờ `UNIQUE (device_id)` — một khẳng định mã không lách
   * được.
   */
  it('hai mươi bên đòi cùng lúc: đúng một bên thắng', async () => {
    const leases = repo();
    await leases.release((await leases.acquire(DEV2, ME, T0)).id);

    const racers = Array.from({ length: 20 }, (_unused, i) => ({
      kind: 'human' as const, userId: `racer-${i}`,
    }));
    for (const racer of racers) {
      await pool.query(
        `INSERT INTO app_user (id, email, name, created_at) VALUES ($1, $2, $1, $3)
         ON CONFLICT DO NOTHING`,
        [racer.userId, `${racer.userId}@test.dev`, new Date().toISOString()],
      );
    }

    const results = await Promise.allSettled(
      racers.map((racer) => leases.acquire(DEV2, racer, T0)),
    );
    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r) => r.status === 'rejected');

    assert.equal(won.length, 1, `phải đúng một bên thắng, thực tế ${won.length}`);
    assert.equal(lost.length, 19);
    for (const loss of lost) {
      assert.ok(
        (loss as PromiseRejectedResult).reason instanceof LeaseTakenError,
        'bên thua phải biết máy đang có người, không nhận một lỗi lạ',
      );
    }
    // Và DB chỉ có MỘT dòng cho chiếc máy ấy.
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM lease WHERE device_id = $1',
      [DEV2]);
    assert.equal(rows[0].n, 1);

    await leases.release((won[0] as PromiseFulfilledResult<{ id: string }>).value.id);
  });

  it('hết hạn thì bên khác lấy được, dù dòng cũ vẫn còn trong bảng', async () => {
    const leases = repo();
    await leases.acquire(DEV, ME, T0);

    // Ngay trước hạn: vẫn của ME.
    assert.deepEqual((await leases.find(DEV, later(LEASE_TTL_MS - 1)))?.holder, ME);
    // Sau hạn: YOU lấy được. Chỉ mục `UNIQUE (device_id)` vẫn còn dòng cũ, nên
    // nếu việc dọn hạn không nằm cùng transaction với việc giữ thì câu này đỏ.
    const next = await leases.acquire(DEV, YOU, later(LEASE_TTL_MS + 1));
    assert.deepEqual(next.holder, YOU);

    await leases.release(next.id);
  });

  it('lease đã hết hạn thì không gia hạn được, kể cả bởi người từng giữ', async () => {
    const leases = repo();
    const lease = await leases.acquire(DEV, ME, T0);

    assert.equal(await leases.renew(lease.id, ME, later(LEASE_TTL_MS + 1)), undefined);
    await leases.reap(later(LEASE_TTL_MS + 1));
  });

  /**
   * Cùng bộ khẳng định, hai hiện thực.
   *
   * Không so từng trường của lease — `id` là UUID nên không thể trùng. So
   * NHỮNG GÌ XẢY RA: ai giữ được, ai bị từ chối, khi nào máy rỗi lại.
   */
  it('nói cùng một câu với bản bộ nhớ', async () => {
    const both: LeaseRepo[] = [repo(), new MemoryLeaseRepo(ORG)];
    for (const leases of both) {
      const first = await leases.acquire(DEV, ME, T0);
      assert.deepEqual(first.holder, ME);

      await assert.rejects(() => leases.acquire(DEV, YOU, later(1)), LeaseTakenError);
      assert.equal(await leases.release(first.id, YOU), false);
      assert.equal(await leases.renew(first.id, YOU, later(1)), undefined);

      const again = await leases.acquire(DEV, ME, later(5_000));
      assert.equal(again.id, first.id, 'người đang giữ bấm lại là gia hạn');

      assert.equal(await leases.release(first.id, ME), true);
      assert.equal(await leases.find(DEV, later(5_001)), undefined);
    }
  });

  /**
   * Chế độ server, lần đầu có người bấm Giữ máy: "insert or update on table
   * lease violates foreign key constraint lease_v2_device_id_fkey". Cả hệ thống
   * gọi thiết bị bằng UDID; bảng `device` khoá bằng `runner::udid`.
   */
  it('giữ bằng udid: tìm đúng dòng thiết bị, trả lại udid cho người gọi', async () => {
    const udid = `UDID-${ORG}`;
    const rowId = `run-${ORG}::${udid}`;
    await pool.query(
      `INSERT INTO device (id, runner_id, org_id, platform, name, udid, visibility, state, updated_at)
       VALUES ($1, $2, $3, 'ios', 'iPhone', $4, 'shared', 'idle', $5)`,
      [rowId, `run-${ORG}`, ORG, udid, new Date().toISOString()],
    );
    const leases = repo();
    const lease = await leases.acquire(udid, ME, T0);
    assert.equal(lease.deviceId, udid, 'người gọi nhận lại đúng mã họ đã gửi');
    assert.equal((await leases.find(udid, later(1_000)))?.id, lease.id);
    assert.ok((await leases.list(later(1_000))).some((l) => l.deviceId === udid));

    // Người khác giữ cùng máy bằng udid: bị chặn như thường, không lách qua mã dòng.
    await assert.rejects(leases.acquire(udid, YOU, later(1_000)), LeaseTakenError);
    await assert.rejects(leases.acquire(rowId, YOU, later(1_000)), LeaseTakenError);
    assert.equal(await leases.release(lease.id, ME), true);
  });

  it('thiết bị không có trong sổ: câu nói được việc cần làm, không phải lỗi khoá ngoại', async () => {
    await assert.rejects(repo().acquire('khong-co-may-nay', ME, T0), /Không tìm thấy thiết bị .*Tìm lại/);
  });
});
