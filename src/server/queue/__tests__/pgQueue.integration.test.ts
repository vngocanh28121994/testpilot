/**
 * Hàng đợi trên Postgres THẬT, đo bằng cùng bộ khẳng định với bản bộ nhớ.
 *
 * Và một điều bản bộ nhớ không chứng minh được: mười runner đòi job trong cùng
 * một phần nghìn giây. `SKIP LOCKED` là thứ làm cho mỗi bên nhận một job khác
 * nhau thay vì chín bên xếp hàng chờ bên thứ nhất.
 *
 * `.integration` nên `npm test` bỏ qua: cần `docker compose up -d`.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { connect } from '../../db/connect.js';
import { PgJobQueue } from '../pgQueue.js';
import { queueContract } from './queueContract.js';

const URL_ = process.env.TESTPILOT_DATABASE_URL
  ?? 'postgres://testpilot:testpilot-dev@localhost:5432/testpilot';

let pool: Pool;
const ORG = `org-queue-${Date.now()}`;

/** Runner mà bộ khẳng định dùng tên. `runner_id` có khoá ngoại, nên phải có thật. */
const RUNNERS = ['runner-1', 'a', 'b', 'c', 'r', 'web-only', 'full', ...Array.from(
  { length: 10 }, (_unused, i) => `racer-${i}`,
)];

before(async () => {
  pool = await connect({ url: URL_ });
  const at = new Date().toISOString();
  await pool.query('INSERT INTO org (id, name, created_at) VALUES ($1, $2, $3)', [ORG, 'Queue', at]);
  await pool.query(
    `INSERT INTO app_user (id, email, name, created_at) VALUES ('u1', 'u1@test.dev', 'U', $1)
     ON CONFLICT DO NOTHING`,
    [at],
  );
  for (const id of RUNNERS) {
    await pool.query(
      `INSERT INTO runner (id, org_id, name, mode, os, arch, protocol_version, agent_version,
         token_hash, visibility, state, created_at)
       VALUES ($1, $2, $1, 'lab', 'darwin', 'arm64', '1.1.0', '0.1.0', 'h', 'shared', 'online', $3)`,
      [id, ORG, at],
    );
  }
});

after(async () => {
  await pool.query('DELETE FROM job WHERE org_id = $1', [ORG]);
  await pool.query('DELETE FROM runner WHERE org_id = $1', [ORG]);
  await pool.query('DELETE FROM org WHERE id = $1', [ORG]);
  await pool.end();
});

describe('PgJobQueue', () => {
  // Mỗi bài một "tổ chức" riêng: bộ khẳng định giả định kho rỗng lúc bắt đầu,
  // mà xoá bảng giữa các bài thì hai bài chạy song song sẽ xoá của nhau.
  let n = 0;
  queueContract(it, async () => {
    n += 1;
    const org = `${ORG}-${n}`;
    await pool.query('INSERT INTO org (id, name, created_at) VALUES ($1, $2, $3)',
      [org, 'Queue', new Date().toISOString()]);
    for (const id of RUNNERS) {
      await pool.query(
        `INSERT INTO runner (id, org_id, name, mode, os, arch, protocol_version, agent_version,
           token_hash, visibility, state, created_at)
         VALUES ($1, $2, $1, 'lab', 'darwin', 'arm64', '1.1.0', '0.1.0', 'h', 'shared', 'online', $3)`,
        [`${org}-${id}`, org, new Date().toISOString()],
      );
    }
    // Bọc lại để tên runner của bộ khẳng định khớp với dòng vừa tạo.
    const queue = new PgJobQueue(pool, org);
    return {
      ...queue,
      create: (job) => queue.create({ ...job, orgId: org }),
      claim: (by) => queue.claim({ ...by, runnerId: `${org}-${by.runnerId}` }),
      find: (id) => queue.find(id),
      list: (filter) => queue.list(filter),
      finish: (id, result) => queue.finish(id, result),
      release: (id, reason) => queue.release(id, reason),
      interruptStale: () => queue.interruptStale(),
      appendLog: async () => {},
      onLog: async () => () => {},
      onState: async () => () => {},
    };
  });

  /**
   * Mười runner đòi cùng lúc, hai job trong hàng.
   *
   * Đúng hai bên thắng, và không job nào bị nhận hai lần. Thiếu `SKIP LOCKED`
   * thì bài này vẫn xanh — nhưng tám bên còn lại sẽ XẾP HÀNG chờ, và ở một
   * phòng máy thật điều đó biến thành độ trễ mà không ai giải thích được.
   */
  it('mười runner đòi cùng lúc: mỗi job chỉ một bên nhận', async () => {
    const org = `${ORG}-race`;
    const at = new Date().toISOString();
    await pool.query('INSERT INTO org (id, name, created_at) VALUES ($1, $2, $3)', [org, 'Race', at]);
    for (let i = 0; i < 10; i += 1) {
      await pool.query(
        `INSERT INTO runner (id, org_id, name, mode, os, arch, protocol_version, agent_version,
           token_hash, visibility, state, created_at)
         VALUES ($1, $2, $1, 'lab', 'darwin', 'arm64', '1.1.0', '0.1.0', 'h', 'shared', 'online', $3)`,
        [`${org}-racer-${i}`, org, at],
      );
    }
    const queue = new PgJobQueue(pool, org);
    const spec = {
      orgId: org, kind: 'run_suite' as const, createdBy: 'u1', timeoutMs: 60_000,
      deviceTokens: [], run: { platform: 'android' },
    };
    await queue.create({ orgId: org, kind: 'run_suite', createdBy: 'u1', spec });
    await queue.create({ orgId: org, kind: 'run_suite', createdBy: 'u1', spec });

    const claimed = await Promise.all(Array.from({ length: 10 }, (_unused, i) =>
      queue.claim({ runnerId: `${org}-racer-${i}` })));
    const ids = claimed.filter(Boolean).map((job) => job!.id);

    assert.equal(ids.length, 2, `phải đúng hai bên nhận được, thực tế ${ids.length}`);
    assert.equal(new Set(ids).size, 2, 'không job nào được nhận hai lần');
  });
});
