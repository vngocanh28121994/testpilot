/**
 * Bảng quyền mượn máy trên Postgres phải nói đúng câu bản bộ nhớ nói.
 *
 * Và một điều chỉ kiểm được ở đây: quyền mượn SỐNG QUA khởi động lại. Đó là lý
 * do nó nằm trong DB trong khi chính sổ THIẾT BỊ thì chỉ nằm trong bộ nhớ —
 * danh sách máy dựng lại được từ báo cáo của runner sau mười giây, còn một
 * quyết định cho mượn thì không dựng lại được từ đâu cả.
 *
 * `.integration` nên `npm test` bỏ qua: cần `docker compose up -d`.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { connect } from '../../db/connect.js';
import { PgDeviceGrants } from '../pgGrants.js';
import { MemoryDeviceGrants } from '../memoryGrants.js';
import type { DeviceGrants } from '../grants.js';

const URL_ = process.env.TESTPILOT_DATABASE_URL
  ?? 'postgres://testpilot:testpilot-dev@localhost:5432/testpilot';

let pool: Pool;
const ORG = `org-grant-${Date.now()}`;
const OTHER = `${ORG}-khac`;

before(async () => {
  pool = await connect({ url: URL_ });
  for (const id of [ORG, OTHER]) {
    await pool.query(
      `INSERT INTO org (id, name, created_at) VALUES ($1, 'Test', $2) ON CONFLICT DO NOTHING`,
      [id, new Date().toISOString()],
    );
  }
  // `user_id` có khoá ngoại tới `app_user`: người được mượn phải là người CÓ
  // THẬT. Ở production điều ấy tự đúng — mã người dùng đến từ phiên đăng nhập.
  for (const id of ['an', 'binh', 'chi']) {
    await pool.query(
      `INSERT INTO app_user (id, email, name, created_at) VALUES ($1, $2, $1, $3)
       ON CONFLICT DO NOTHING`,
      [id, `${id}@test.dev`, new Date().toISOString()],
    );
  }
});

after(async () => {
  await pool.query('DELETE FROM device_grant WHERE org_id = ANY ($1)', [[ORG, OTHER]]);
  await pool.query('DELETE FROM org WHERE id = ANY ($1)', [[ORG, OTHER]]);
  await pool.end();
});

/** Bộ bài chạy với CẢ HAI hiện thực — cùng cách làm với queue, repo, proposal. */
function contract(name: string, make: () => DeviceGrants) {
  describe(`${name}: hợp đồng DeviceGrants`, () => {
    it('cho mượn rồi thấy trong danh sách của người ấy', async () => {
      const grants = make();
      const udid = `iphone-${Math.random().toString(36).slice(2, 8)}`;
      await grants.grant({ orgId: ORG, udid, userId: 'binh', grantedBy: 'an' });

      assert.ok((await grants.forUser(ORG, 'binh')).has(udid));
      assert.ok(!(await grants.forUser(ORG, 'chi')).has(udid), 'người thứ ba không hưởng lây');
    });

    it('cho mượn hai lần không đổi mốc thời gian', async () => {
      // "Từ bao giờ" là thứ người ta hỏi khi soát lại quyền, và một lần bấm
      // nhầm không được làm mới cái mốc ấy.
      const grants = make();
      const udid = `iphone-${Math.random().toString(36).slice(2, 8)}`;
      const first = await grants.grant({ orgId: ORG, udid, userId: 'binh', grantedBy: 'an' });
      const second = await grants.grant({ orgId: ORG, udid, userId: 'binh', grantedBy: 'chi' });

      assert.equal(second.createdAt, first.createdAt);
      assert.equal(second.grantedBy, 'an', 'người cho mượn đầu tiên mới là người chịu trách nhiệm');
      assert.equal((await grants.forDevice(ORG, udid)).length, 1);
    });

    it('thu lại thì hết, và thu cái không có thì nói không', async () => {
      const grants = make();
      const udid = `iphone-${Math.random().toString(36).slice(2, 8)}`;
      await grants.grant({ orgId: ORG, udid, userId: 'binh', grantedBy: 'an' });

      assert.equal(await grants.revoke(ORG, udid, 'binh'), true);
      assert.equal(await grants.revoke(ORG, udid, 'binh'), false);
      assert.ok(!(await grants.forUser(ORG, 'binh')).has(udid));
    });
  });
}

contract('bộ nhớ', () => new MemoryDeviceGrants());
contract('postgres', () => new PgDeviceGrants(async () => pool));

describe('PgDeviceGrants giới hạn theo tổ chức', () => {
  it('quyền của tổ chức này không hiện ở tổ chức kia', async () => {
    const grants = new PgDeviceGrants(async () => pool);
    const udid = 'iphone-chung-ten';
    // Cùng một chuỗi udid ở hai tổ chức: udid do thiết bị đặt tên, nên hai tổ
    // chức trùng chuỗi là chuyện có thật, không phải một ca dựng cho vui.
    await grants.grant({ orgId: ORG, udid, userId: 'binh', grantedBy: 'an' });

    assert.ok((await grants.forUser(ORG, 'binh')).has(udid));
    assert.ok(!(await grants.forUser(OTHER, 'binh')).has(udid));
    assert.equal(await grants.revoke(OTHER, udid, 'binh'), false, 'không thu được của tổ chức khác');
    assert.ok((await grants.forUser(ORG, 'binh')).has(udid), 'và cái bên này vẫn còn nguyên');
  });

  it('sống qua một lần dựng lại kho', async () => {
    // Chính là lý do bảng này nằm trong DB: mất nó nghĩa là người đang mượn
    // máy bỗng thôi nhìn thấy nó, giữa buổi làm việc, mà không ai đụng gì.
    const udid = `iphone-ben-${Date.now()}`;
    await new PgDeviceGrants(async () => pool).grant({
      orgId: ORG, udid, userId: 'binh', grantedBy: 'an',
    });
    assert.ok((await new PgDeviceGrants(async () => pool).forUser(ORG, 'binh')).has(udid));
  });
});
