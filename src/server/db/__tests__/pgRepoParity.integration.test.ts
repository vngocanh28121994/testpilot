/**
 * Bản Postgres phải nói đúng câu mà bản file nói.
 *
 * Đây là lời hứa của P0.2 được đem ra kiểm: route gọi repo, và repo nào cũng
 * cho cùng một kết quả. Nếu hai bên lệch, chỗ lệch sẽ lộ ra khi ai đó chuyển
 * từ bản local lên server — muộn nhất có thể, và với dữ liệu thật.
 *
 * `.integration` nên `npm test` bỏ qua: cần `docker compose up -d`. Chạy bằng
 * `npm run test:integration`.
 *
 * Và một điều bản file KHÔNG làm được, nên chỉ kiểm ở đây: hai lệnh ghi đồng
 * thời. Bản file đọc-rồi-ghi nên vẫn còn khe hở giữa hai bước; `WHERE revision
 * = $base` của Postgres thì không.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { connect } from '../connect.js';
import { PgJobRepo, PgRegistryRepo } from '../pgRepo.js';
import { RevisionConflictError } from '../repo.js';
import { FileRegistryRepo } from '../fileRepo.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ElementRegistry } from '../../../core/types.js';
import type { WorkflowRun } from '../../../core/history.js';

const URL_ = process.env.TESTPILOT_DATABASE_URL
  ?? 'postgres://testpilot:testpilot-dev@localhost:5432/testpilot';

let pool: Pool;
const ORG = `org-test-${Date.now()}`;

function registryWith(id: string, label: string, health?: unknown): ElementRegistry {
  const element: Record<string, unknown> = {
    id, label, screen: 'p',
    candidates: { web: [{ strategy: 'testId', value: id, weight: 0.9, origin: 'authored' }] },
  };
  if (health) element.health = health;
  return { version: 1, screens: {}, elements: { [id]: element } } as unknown as ElementRegistry;
}

before(async () => {
  pool = await connect({ url: URL_ });
  await pool.query(
    `INSERT INTO org (id, name, created_at) VALUES ($1, 'Test', $2) ON CONFLICT DO NOTHING`,
    [ORG, new Date().toISOString()],
  );
  await pool.query(
    `INSERT INTO app_user (id, email, name, created_at) VALUES ('u-test', 'u@test.dev', 'U', $1)
     ON CONFLICT DO NOTHING`,
    [new Date().toISOString()],
  );
});

after(async () => {
  await pool.query('DELETE FROM job WHERE org_id = $1', [ORG]);
  await pool.query('DELETE FROM registry_object WHERE org_id = $1', [ORG]);
  await pool.query('DELETE FROM org WHERE id = $1', [ORG]);
  await pool.end();
});

describe('PgRegistryRepo ngang bằng FileRegistryRepo', () => {
  it('tổ chức chưa có gì trả registry rỗng, không ném', async () => {
    const repo = new PgRegistryRepo(pool, `${ORG}-trong`);
    const read = await repo.read();
    assert.deepEqual(read.data.elements, {});
    assert.equal(read.revision, undefined, 'chưa có gì thì chưa có phiên bản để đối chiếu');
  });

  it('ghi rồi đọc lại cho đúng thứ đã ghi — giống hệt bản file', async () => {
    const pg = new PgRegistryRepo(pool, ORG);
    const file = new FileRegistryRepo(path.join(await mkdtemp(path.join(tmpdir(), 'tp-')), 'e.json'));

    const data = registryWith('p.more', 'Thêm mã');
    const a = await pg.write(data);
    const b = await file.write(data);

    assert.deepEqual((await pg.read()).data, (await file.read()).data);
    assert.equal(a.revision, b.revision, 'cùng nội dung phải cho cùng phiên bản');
  });

  it('ghi dựa trên bản cũ thì 409, và bản của người kia còn nguyên', async () => {
    const repo = new PgRegistryRepo(pool, ORG);
    const first = await repo.write(registryWith('p.a', 'A'));
    await repo.write(registryWith('p.b', 'B'));

    await assert.rejects(
      () => repo.write(registryWith('p.c', 'C'), first.revision),
      (err: Error) => err instanceof RevisionConflictError,
    );
    assert.ok((await repo.read()).data.elements['p.b'], 'bản thắng phải còn');
  });

  /**
   * Thứ bản file KHÔNG bảo đảm được.
   *
   * Hai lệnh ghi cùng dựa trên một phiên bản, chạy song song. Đúng MỘT cái
   * được thắng; cái kia phải biết mình thua. Bản file đọc-rồi-ghi có một khe
   * hở giữa hai bước — nhỏ tới mức không ai gặp trên một máy, đủ lớn khi có
   * hai mươi người dùng chung.
   */
  it('hai lệnh ghi đồng thời: đúng một cái thắng', async () => {
    const repo = new PgRegistryRepo(pool, ORG);
    const base = await repo.write(registryWith('p.base', 'Base'));

    const results = await Promise.allSettled([
      repo.write(registryWith('p.x', 'X'), base.revision),
      repo.write(registryWith('p.y', 'Y'), base.revision),
    ]);
    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r) => r.status === 'rejected');

    assert.equal(won.length, 1, 'phải có đúng một bên thắng');
    assert.equal(lost.length, 1, 'bên kia phải biết mình thua, không ghi đè im lặng');
    assert.ok((lost[0] as PromiseRejectedResult).reason instanceof RevisionConflictError);
  });

  it('gộp delta cộng dồn bộ đếm, không làm mất element cũ', async () => {
    // `registry_object.org_id` có khoá ngoại: một tổ chức phải tồn tại trước
    // khi có dữ liệu. Đó là ràng buộc ĐÚNG — nó chặn dữ liệu mồ côi — và bản
    // đầu của bài test này quên mất, nên nó fail vì lỗi của chính nó.
    await pool.query(
      `INSERT INTO org (id, name, created_at) VALUES ($1, 'T', $2) ON CONFLICT DO NOTHING`,
      [`${ORG}-merge`, new Date().toISOString()],
    );
    const repo = new PgRegistryRepo(pool, `${ORG}-merge`);
    await repo.write(registryWith('p.a', 'A', { resolutions: 2, heals: 1, winners: { 'testId=p.a': 2 } }));

    const merged = await repo.merge(
      registryWith('p.b', 'B', { resolutions: 3, heals: 0, winners: { 'testId=p.b': 3 } }),
    );

    assert.ok(merged.data.elements['p.a'], 'gộp không được làm mất element đang có');
    assert.equal(merged.data.elements['p.a']?.health?.resolutions, 2);
    assert.equal(merged.data.elements['p.b']?.health?.resolutions, 3);
    await pool.query('DELETE FROM registry_object WHERE org_id = $1', [`${ORG}-merge`]);
    await pool.query('DELETE FROM org WHERE id = $1', [`${ORG}-merge`]);
  });

  /** Hai runner kết thúc cùng lúc là chuyện bình thường, không phải ngoại lệ. */
  it('hai lượt gộp đồng thời không mất phần học được của bên nào', async () => {
    const org = `${ORG}-song-song`;
    await pool.query(
      `INSERT INTO org (id, name, created_at) VALUES ($1, 'T', $2) ON CONFLICT DO NOTHING`,
      [org, new Date().toISOString()],
    );
    const repo = new PgRegistryRepo(pool, org);
    await repo.write(registryWith('p.base', 'Base'));

    await Promise.all([
      repo.merge(registryWith('p.tu-runner-1', 'R1')),
      repo.merge(registryWith('p.tu-runner-2', 'R2')),
    ]);

    const after = await repo.read();
    assert.ok(after.data.elements['p.tu-runner-1'], 'mất phần học của runner 1');
    assert.ok(after.data.elements['p.tu-runner-2'], 'mất phần học của runner 2');
    await pool.query('DELETE FROM registry_object WHERE org_id = $1', [org]);
    await pool.query('DELETE FROM org WHERE id = $1', [org]);
  });
});

describe('PgJobRepo', () => {
  const run: WorkflowRun = {
    id: 'run-1', feature: 'a.feature', kind: 'workflow', status: 'running',
    startedAt: new Date().toISOString(), stages: [], log: [],
  } as unknown as WorkflowRun;

  it('lưu rồi đọc lại giữ nguyên hình dạng WorkflowRun', async () => {
    const repo = new PgJobRepo(pool, ORG);
    await repo.save(run, 'u-test');
    const found = await repo.find('run-1');
    assert.equal(found?.feature, 'a.feature');
    assert.equal(found?.status, 'running');
  });

  /** Một dòng còn `running` sau khi tiến trình chết là một dòng nói dối. */
  it('đóng lượt treo, và nói ra nguyên nhân', async () => {
    const repo = new PgJobRepo(pool, ORG);
    assert.equal(await repo.closeInterrupted(), 1);

    const closed = await repo.find('run-1');
    assert.equal(closed?.status, 'failed');
    assert.match(closed?.error ?? '', /bị bỏ dở/);
    assert.equal(await repo.closeInterrupted(), 0, 'chạy lại không đóng thêm gì');
  });

  it('không thấy job của tổ chức khác', async () => {
    const other = new PgJobRepo(pool, 'org-khong-lien-quan');
    assert.equal(await other.find('run-1'), undefined);
    assert.deepEqual(await other.list(), []);
  });
});
