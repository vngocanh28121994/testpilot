/**
 * Script di trú: mặc định không ghi, chạy lại không nhân đôi.
 *
 * Hai tính chất này là thứ quyết định một script di trú dùng được hay không.
 * Một lần di trú thật hiếm khi xong trong một lần chạy — người ta chạy thử,
 * thấy thiếu, sửa, chạy lại — nên "chạy lại an toàn" không phải tiện nghi mà
 * là điều kiện. Và "mặc định không ghi" là thứ đứng giữa một lệnh gõ nhầm và
 * một cơ sở dữ liệu thật.
 *
 * `.integration` vì cần Postgres: `docker compose up -d`.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';

const run = promisify(execFile);
const URL_ = process.env.TESTPILOT_DATABASE_URL
  ?? 'postgres://testpilot:testpilot-dev@localhost:5432/testpilot';
const ORG = `org-migrate-${Date.now()}`;

let pool: Pool;

async function counts(): Promise<{ registry: number; jobs: number }> {
  const { rows } = await pool.query<{ registry: string; jobs: string }>(
    `SELECT (SELECT count(*) FROM registry_object WHERE org_id = $1) AS registry,
            (SELECT count(*) FROM job WHERE org_id = $1) AS jobs`,
    [ORG],
  );
  return { registry: Number(rows[0]?.registry ?? 0), jobs: Number(rows[0]?.jobs ?? 0) };
}

function runScript(args: string[] = []) {
  return run('npx', ['tsx', 'scripts/migrate-json-to-db.ts', ...args], {
    env: { ...process.env, TESTPILOT_DATABASE_URL: URL_, TESTPILOT_ORG_ID: ORG },
    timeout: 120_000,
  });
}

before(async () => { pool = new Pool({ connectionString: URL_ }); });

after(async () => {
  await pool.query('DELETE FROM job WHERE org_id = $1', [ORG]);
  await pool.query('DELETE FROM registry_object WHERE org_id = $1', [ORG]);
  await pool.query('DELETE FROM membership WHERE org_id = $1', [ORG]);
  await pool.query('DELETE FROM org WHERE id = $1', [ORG]);
  await pool.end();
});

describe('script di trú JSON → Postgres', () => {
  it('không có --apply thì không ghi gì', async () => {
    const { stdout } = await runScript();
    assert.match(stdout, /Chưa ghi gì/);
    assert.deepEqual(await counts(), { registry: 0, jobs: 0 });
  });

  it('có --apply thì ghi, và nói ra đã ghi bao nhiêu', async () => {
    const { stdout } = await runScript(['--apply']);
    assert.match(stdout, /Trong DB sau khi ghi/);

    const after = await counts();
    assert.equal(after.registry, 1, 'registry là MỘT bản ghi có phiên bản');
    assert.ok(after.jobs >= 0);
  });

  /** Chạy lại là chuyện thường; nhân đôi dữ liệu thì không. */
  it('chạy lại lần hai không nhân đôi', async () => {
    const before = await counts();
    await runScript(['--apply']);
    assert.deepEqual(await counts(), before);
  });

  /**
   * Lượt chạy local KHÔNG được di trú, và đó là quyết định chứ không phải bỏ
   * sót: `RunMeta` mô tả một thư mục trên đĩa máy chạy test, còn ở chế độ
   * server thư mục ấy không nằm trên server. Di trú chúng là tạo ra những bản
   * ghi trỏ vào đường dẫn không tồn tại.
   */
  it('nói rõ lượt chạy local không được di trú', async () => {
    const { stdout } = await runScript();
    assert.match(stdout, /KHÔNG di trú/);
  });

  it('thiếu TESTPILOT_DATABASE_URL thì dừng, kèm cách sửa', async () => {
    await assert.rejects(
      () => run('npx', ['tsx', 'scripts/migrate-json-to-db.ts'], {
        env: { ...process.env, TESTPILOT_DATABASE_URL: '' },
        timeout: 60_000,
      }),
      (err: Error & { stderr?: string }) => {
        assert.match(err.stderr ?? '', /docker compose up -d/);
        return true;
      },
    );
  });
});

describe('an toàn của script', () => {
  /** Đọc mã nguồn: cờ ghi phải là thứ người dùng gõ ra, không phải mặc định. */
  it('mặc định là chế độ xem', () => {
    const source = readFileSync('scripts/migrate-json-to-db.ts', 'utf8');
    assert.match(source, /const APPLY = process\.argv\.includes\('--apply'\)/);
    assert.doesNotMatch(source, /const APPLY = true/);
  });

  /** Mọi lệnh ghi phải đi qua `ON CONFLICT`, nếu không lần chạy thứ hai sẽ nổ. */
  it('mọi INSERT đều xử lý xung đột', () => {
    const source = readFileSync('scripts/migrate-json-to-db.ts', 'utf8');
    const inserts = [...source.matchAll(/INSERT INTO (\w+)[\s\S]*?(?=`)/g)];
    for (const insert of inserts) {
      assert.match(
        insert[0],
        /ON CONFLICT/,
        `INSERT INTO ${insert[1]} không xử lý xung đột — chạy lại lần hai sẽ hỏng`,
      );
    }
  });
});
