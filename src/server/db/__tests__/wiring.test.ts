/**
 * Ba nhánh của việc chọn kho, và nhánh thứ ba là nhánh đáng canh.
 *
 * Chế độ server mà quay về file JSON nghĩa là mọi `orgId` đọc ghi cùng một chỗ
 * trên đĩa máy chủ. Nó không báo lỗi, không ai thấy, và không sửa được sau khi
 * đã xảy ra — nên nó phải là một cú ném, và cú ném phải xảy ra lúc khởi động.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { repoFactory } from '../wiring.js';
import { localLeases } from '../leaseRepo.js';
import type { Identity } from '../../auth/roles.js';

const PATHS = async () => ({ registry: 'registry/elements.json', runs: 'runs' });
const WHO: Identity = { userId: 'u1', orgId: 'org-1', email: 'u@x.dev', role: 'admin' };

describe('repoFactory', () => {
  it('embedded dùng file JSON, và dùng CHUNG một kho lease', async () => {
    const repos = await repoFactory({ mode: 'embedded', paths: PATHS })(WHO);
    assert.equal(repos.leases, localLeases, 'mỗi request một kho lease là mất lease giữa hai request');
  });

  it('embedded không cần DB, kể cả khi có biến môi trường', async () => {
    const repos = await repoFactory({
      mode: 'embedded',
      db: { url: 'postgres://khong-dung-toi' },
      paths: PATHS,
      open: () => { throw new Error('không được mở DB ở chế độ embedded'); },
    })(WHO);
    assert.ok(repos.registry);
  });

  it('server thiếu TESTPILOT_DATABASE_URL thì ném ngay, không quay về file', () => {
    assert.throws(
      () => repoFactory({ mode: 'server', paths: PATHS }),
      /TESTPILOT_DATABASE_URL/,
    );
  });

  it('server mở DB một lần cho cả tiến trình, và chia kho theo tổ chức', async () => {
    let opened = 0;
    const factory = repoFactory({
      mode: 'server',
      db: { url: 'postgres://gia-lap' },
      paths: PATHS,
      open: async () => { opened += 1; return {} as Pool; },
    });

    const a = await factory(WHO);
    const b = await factory({ ...WHO, orgId: 'org-2' });

    assert.equal(opened, 1, 'mỗi request một pool là cạn kết nối Postgres');
    assert.notEqual(a.registry, b.registry, 'hai tổ chức không được dùng chung kho');
  });

  /** Kho mở chậm: `GET /api/health` phải trả lời được khi DB còn chưa lên. */
  it('không mở DB cho tới khi có người hỏi dữ liệu', () => {
    let opened = 0;
    repoFactory({
      mode: 'server',
      db: { url: 'postgres://gia-lap' },
      paths: PATHS,
      open: async () => { opened += 1; return {} as Pool; },
    });
    assert.equal(opened, 0);
  });
});
