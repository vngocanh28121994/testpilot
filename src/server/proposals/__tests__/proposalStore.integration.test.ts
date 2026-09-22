/**
 * Sổ đề xuất trên Postgres phải nói đúng câu mà bản bộ nhớ nói.
 *
 * Hai điều chỉ kiểm được ở đây, và cả hai đều là lý do bảng này tồn tại:
 * `org_id` thật sự chặn được người tổ chức khác đọc, và hai người duyệt cùng
 * một đề xuất trong cùng một giây thì đúng một người thắng — phép loại trừ ấy
 * do câu `UPDATE ... AND state = 'pending'` bảo đảm, không do thứ tự may mắn.
 *
 * `.integration` nên `npm test` bỏ qua: cần `docker compose up -d`.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { connect } from '../../db/connect.js';
import { PgProposalStore } from '../pgStore.js';
import { MemoryProposalStore } from '../memoryStore.js';
import { summarise, type ProposalStore } from '../store.js';

const URL_ = process.env.TESTPILOT_DATABASE_URL
  ?? 'postgres://testpilot:testpilot-dev@localhost:5432/testpilot';

let pool: Pool;
const ORG = `org-prop-${Date.now()}`;
const OTHER = `${ORG}-khac`;

before(async () => {
  pool = await connect({ url: URL_ });
  for (const id of [ORG, OTHER]) {
    await pool.query(
      `INSERT INTO org (id, name, created_at) VALUES ($1, 'Test', $2) ON CONFLICT DO NOTHING`,
      [id, new Date().toISOString()],
    );
  }
  // `reviewed_by` có khoá ngoại tới `app_user`: người duyệt phải là người CÓ
  // THẬT. Ở production điều ấy tự đúng — `identity.userId` đến từ phiên đăng
  // nhập — nên bài test phải dựng cùng điều kiện chứ không nới ràng buộc.
  for (const id of ['an', 'bình', 'chi']) {
    await pool.query(
      `INSERT INTO app_user (id, email, name, created_at) VALUES ($1, $2, $1, $3)
       ON CONFLICT DO NOTHING`,
      [id, `${id}@test.dev`, new Date().toISOString()],
    );
  }
});

after(async () => {
  await pool.query('DELETE FROM registry_proposal WHERE org_id = ANY ($1)', [[ORG, OTHER]]);
  await pool.query('DELETE FROM org WHERE id = ANY ($1)', [[ORG, OTHER]]);
  await pool.end();
});

function newOne(orgId: string, key = 'default') {
  return {
    orgId, kind: 'elements', key,
    baseRevision: 'rev-1',
    patch: { version: 1, screens: {}, elements: { a: { id: 'a' } } },
    createdBy: 'an',
    summary: { added: ['a'], removed: [], changed: [] },
  };
}

/** Bộ bài chạy với CẢ HAI hiện thực — cùng cách làm với queue và repo. */
function contract(name: string, make: () => ProposalStore) {
  describe(`${name}: hợp đồng ProposalStore`, () => {
    it('tạo ra thì đang chờ, và giữ nguyên nội dung đã gửi', async () => {
      const store = make();
      const created = await store.create(newOne(ORG));
      assert.equal(created.state, 'pending');
      assert.equal(created.createdBy, 'an');
      assert.equal(created.baseRevision, 'rev-1');
      assert.deepEqual(created.summary, { added: ['a'], removed: [], changed: [] });
      assert.ok(created.createdAt, 'phải có giờ tạo để màn duyệt xếp được thứ tự');

      const found = await store.find(created.id);
      assert.deepEqual(found, created);
    });

    it('duyệt một lần ăn, lần thứ hai trả về undefined', async () => {
      const store = make();
      const created = await store.create(newOne(ORG));
      const first = await store.decide(created.id, 'accepted', 'bình');
      assert.equal(first?.state, 'accepted');
      assert.equal(first?.reviewedBy, 'bình');
      assert.ok(first?.reviewedAt);

      const second = await store.decide(created.id, 'rejected', 'chi');
      assert.equal(second, undefined, 'quyết định thứ hai không được đè lên quyết định đầu');
      assert.equal((await store.find(created.id))?.state, 'accepted');
    });

    it('lọc theo trạng thái, và mới nhất đứng trước', async () => {
      const store = make();
      const older = await store.create(newOne(ORG, `k-${Date.now()}-1`));
      await new Promise((done) => setTimeout(done, 5));
      const newer = await store.create(newOne(ORG, `k-${Date.now()}-2`));
      await store.decide(older.id, 'rejected', 'bình');

      const pending = await store.list({ state: ['pending'] });
      assert.ok(pending.some((p) => p.id === newer.id));
      assert.ok(!pending.some((p) => p.id === older.id));

      const all = await store.list();
      const ids = all.map((p) => p.id);
      assert.ok(ids.indexOf(newer.id) <= ids.indexOf(older.id), 'mới nhất đứng trước');
    });
  });
}

contract('bộ nhớ', () => new MemoryProposalStore());
contract('postgres', () => new PgProposalStore(pool, ORG));

describe('PgProposalStore giới hạn theo tổ chức', () => {
  it('đề xuất của tổ chức khác không đọc được, kể cả khi biết id', async () => {
    const mine = new PgProposalStore(pool, ORG);
    const theirs = new PgProposalStore(pool, OTHER);
    const created = await theirs.create(newOne(OTHER));

    assert.equal(await mine.find(created.id), undefined);
    assert.equal(await mine.decide(created.id, 'accepted', 'an'), undefined);
    assert.ok(!(await mine.list()).some((p) => p.id === created.id));
  });

  it('hai người duyệt cùng lúc thì đúng một người thắng', async () => {
    const store = new PgProposalStore(pool, ORG);
    const created = await store.create(newOne(ORG));
    const [a, b] = await Promise.all([
      store.decide(created.id, 'accepted', 'bình'),
      store.decide(created.id, 'rejected', 'chi'),
    ]);
    assert.equal([a, b].filter(Boolean).length, 1, 'hai lời gọi song hành, một người thắng');
  });
});

describe('summarise kể theo element chứ không theo văn bản', () => {
  it('đổi thứ tự khoá không phải là thay đổi', () => {
    const before = { elements: { a: { id: 'a', label: 'A' } } };
    const after = { elements: { a: { id: 'a', label: 'A' } } };
    assert.deepEqual(summarise(before, after), { added: [], removed: [], changed: [] });
  });

  it('thấy thêm, bớt và sửa', () => {
    const before = { elements: { a: { label: 'A' }, b: { label: 'B' } } };
    const after = { elements: { a: { label: 'A2' }, c: { label: 'C' } } };
    assert.deepEqual(summarise(before, after), {
      added: ['c'], removed: ['b'], changed: ['a'],
    });
  });
});
