/**
 * Phiên đăng nhập trong Postgres phải nói đúng câu bản RAM nói.
 *
 * Và một điều chỉ kiểm được ở đây, cũng là lý do bảng này tồn tại: phiên SỐNG
 * QUA một lần dựng lại kho. Bản trong RAM hỏng theo hai cách mà không cấu hình
 * nào sửa được — một lần deploy bình thường đăng xuất toàn bộ người đang dùng,
 * và chạy hai instance thì người đăng nhập ở instance này gọi API rơi vào
 * instance kia sẽ nhận 401.
 *
 * `.integration` nên `npm test` bỏ qua: cần `docker compose up -d`.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { connect } from '../../db/connect.js';
import { PgSessionStore } from '../pgSession.js';
import { MemorySessionStore, SESSION_TTL_MS, type SessionStore } from '../session.js';
import type { Identity } from '../roles.js';

const URL_ = process.env.TESTPILOT_DATABASE_URL
  ?? 'postgres://testpilot:testpilot-dev@localhost:5432/testpilot';

let pool: Pool;
const ORG = `org-session-${Date.now()}`;

function person(userId: string): Identity {
  return { userId: `${userId}-${ORG}`, orgId: ORG, email: `${userId}@x.dev`, role: 'maintainer' };
}

before(async () => {
  pool = await connect({ url: URL_ });
});

after(async () => {
  await pool.query('DELETE FROM session WHERE org_id = $1', [ORG]);
  await pool.end();
});

/** Bộ bài chạy với CẢ HAI hiện thực — cùng cách làm với queue, repo, proposal. */
function contract(name: string, make: () => SessionStore) {
  describe(`${name}: hợp đồng SessionStore`, () => {
    it('tạo rồi tra lại được bằng chính mã ấy', async () => {
      const store = make();
      const created = await store.create(person('an'));
      const found = await store.find(created.id);
      assert.equal(found?.identity.userId, created.identity.userId);
      assert.equal(found?.identity.role, 'maintainer');
      assert.equal(found?.expiresAt, created.expiresAt);
    });

    it('mã sai thì không có gì, và không ném', async () => {
      const store = make();
      await store.create(person('an'));
      assert.equal(await store.find('khong-phai-ma-that'), undefined);
    });

    it('hết hạn thì coi như không có', async () => {
      const store = make();
      const created = await store.create(person('an'));
      const sau = Date.now() + SESSION_TTL_MS + 1_000;
      assert.equal(await store.find(created.id, sau), undefined);
    });

    it('thu hồi thì mất ngay, không đợi hết hạn', async () => {
      // Đây là lý do cookie chỉ mang mã phiên chứ không mang JWT tự chứa: một
      // token tự chứa thì "đuổi khỏi tổ chức" chỉ có hiệu lực lúc nó hết hạn.
      const store = make();
      const created = await store.create(person('an'));
      await store.revoke(created.id);
      assert.equal(await store.find(created.id), undefined);
    });

    it('thu hồi theo người thì cắt hết máy của họ, và chỉ của họ', async () => {
      const store = make();
      const laptop = await store.create(person('binh'));
      const desktop = await store.create(person('binh'));
      const khac = await store.create(person('chi'));

      await store.revokeUser(person('binh').userId);
      assert.equal(await store.find(laptop.id), undefined);
      assert.equal(await store.find(desktop.id), undefined);
      assert.ok(await store.find(khac.id), 'phiên của người khác không được đụng tới');
    });
  });
}

contract('bộ nhớ', () => new MemorySessionStore());
contract('postgres', () => new PgSessionStore(pool));

describe('PgSessionStore: những thứ chỉ Postgres kiểm được', () => {
  it('phiên sống qua một lần dựng lại kho — chính là lý do bảng này tồn tại', async () => {
    const created = await new PgSessionStore(pool).create(person('an'));
    // Kho mới = tiến trình mới. Người dùng không phải đăng nhập lại sau deploy.
    const found = await new PgSessionStore(pool).find(created.id);
    assert.equal(found?.identity.userId, created.identity.userId);
  });

  it('bảng chỉ giữ HASH, không giữ mã phiên', async () => {
    const created = await new PgSessionStore(pool).create(person('an'));
    const { rows } = await pool.query<{ id_hash: string }>(
      'SELECT id_hash FROM session WHERE org_id = $1 AND user_id = $2',
      [ORG, created.identity.userId],
    );
    // Một bảng có thể bị đọc: log truy vấn, bản backup, một lần SELECT * chia
    // sẻ nhầm. Mã phiên là thứ đăng nhập được ngay.
    assert.ok(rows.some((row) => row.id_hash === createHash('sha256').update(created.id).digest('hex')));
    assert.ok(!rows.some((row) => row.id_hash === created.id), 'mã thô không được nằm trong bảng');
  });

  it('dọn phiên hết hạn theo lô', async () => {
    const store = new PgSessionStore(pool);
    await store.create(person('cu'), Date.now() - SESSION_TTL_MS - 60_000);
    const con = await store.create(person('moi'));

    assert.ok(await store.reapExpired() >= 1);
    assert.ok(await store.find(con.id), 'phiên còn hạn không được dọn theo');
  });
});
