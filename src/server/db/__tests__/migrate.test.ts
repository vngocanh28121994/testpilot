/**
 * Migration chạy trên SQL THẬT, không trên một bản giả.
 *
 * `node:sqlite` có sẵn trong Node 22 nên không cần thêm dependency nào, và nó
 * thực sự thực thi DDL: một câu `CREATE TABLE` sai cú pháp hay một ràng buộc
 * viết nhầm sẽ ném ngay ở đây. Một bản giả chỉ ghi lại chuỗi SQL đã nhận và
 * xác nhận rằng ta đã gọi đúng hàm — điều đã biết trước khi chạy.
 *
 * Phần Postgres không chạy được ở đây (không có server), nên test chỉ khẳng
 * định phần dịch cú pháp cho Postgres là hợp lệ và không còn token nào sót.
 * Chạy thật với Postgres thuộc về P2.6, khi `docker compose` có mặt.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { knownTokens, renderSql } from '../dialect.js';
import { MIGRATIONS_DIR, migrate, migrationFiles, type SqlRunner } from '../migrate.js';

function sqlite(): { db: DatabaseSync; runner: SqlRunner } {
  const db = new DatabaseSync(':memory:');
  // Khoá ngoại phải BẬT thì mới kiểm tra được; SQLite mặc định tắt, và tắt thì
  // mọi REFERENCES trong schema chỉ còn là chú thích.
  db.exec('PRAGMA foreign_keys = ON');
  return {
    db,
    runner: {
      exec: (sql) => db.exec(sql),
      all: (sql) => db.prepare(sql).all() as Array<Record<string, unknown>>,
    },
  };
}

function tables(db: DatabaseSync): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
    name: string;
  }>)
    .map((row) => row.name)
    .sort();
}

describe('migration 0001 trên SQLite thật', () => {
  it('dựng đủ bảng của mô hình dữ liệu', async () => {
    const { db, runner } = sqlite();
    const result = await migrate(runner, 'sqlite');

    assert.deepEqual(result.applied, ['0001_init.sql']);
    for (const table of [
      'org', 'app_user', 'membership', 'runner', 'runner_capability',
      'device', 'device_tag', 'job', 'job_device', 'job_event',
      'lease', 'artifact', 'registry_object', 'registry_proposal',
      'secret_ref', 'audit_log',
    ]) {
      assert.ok(tables(db).includes(table), `thiếu bảng ${table}`);
    }
  });

  /** Nằm trong đường khởi động server thì gọi lại phải không làm gì thêm. */
  it('chạy lần hai không áp dụng lại', async () => {
    const { runner } = sqlite();
    await migrate(runner, 'sqlite');
    const second = await migrate(runner, 'sqlite');

    assert.deepEqual(second.applied, []);
    assert.deepEqual(second.skipped, ['0001_init.sql']);
  });

  /**
   * Ràng buộc quan trọng nhất của cả schema.
   *
   * Một chiếc điện thoại chỉ chạy được một test tại một thời điểm, và điều đó
   * phải do DB bảo đảm. Nếu chỉ dựa vào mã scheduler nhớ giữ thì hai scheduler
   * chạy song song — hoặc một bản deploy chồng lên bản cũ — sẽ cấp cùng một
   * máy cho hai job, và triệu chứng là test đỏ ngẫu nhiên chứ không phải lỗi.
   */
  it('một thiết bị chỉ có một lease', async () => {
    const { db, runner } = sqlite();
    await migrate(runner, 'sqlite');
    seedOrgUserRunnerDevice(db);
    insertJob(db, 'job-1');
    insertJob(db, 'job-2');

    db.exec(lease('lease-1', 'dev-1', 'job-1'));
    assert.throws(
      () => db.exec(lease('lease-2', 'dev-1', 'job-2')),
      /UNIQUE|constraint/i,
      'DB phải từ chối lease thứ hai cho cùng một thiết bị',
    );
  });

  /** `seq` là thứ cho phép nối lại log; trùng seq trong một job là mất thứ tự. */
  it('job_event không cho trùng seq trong cùng một job', async () => {
    const { db, runner } = sqlite();
    await migrate(runner, 'sqlite');
    seedOrgUserRunnerDevice(db);
    insertJob(db, 'job-1');

    db.exec(event('job-1', 1, 'log'));
    db.exec(event('job-1', 2, 'log'));
    assert.throws(() => db.exec(event('job-1', 2, 'warning')), /UNIQUE|constraint/i);
  });

  /** `state` sai chính tả phải bị chặn ở DB, không đợi tới lúc đọc ra. */
  it('trạng thái ngoài danh sách bị từ chối', async () => {
    const { db, runner } = sqlite();
    await migrate(runner, 'sqlite');
    seedOrgUserRunnerDevice(db);

    assert.throws(
      () => db.exec(`INSERT INTO job (id, org_id, created_by, kind, state, priority, requested_at,
        payload, attempt) VALUES ('job-x', 'org-1', 'user-1', 'run_suite', 'dang_chay', 0,
        '2026-09-21T00:00:00.000Z', '{}', 1)`),
      /CHECK|constraint/i,
    );
  });

  /** Job biến mất thì log của nó cũng phải đi theo, không để lại dòng mồ côi. */
  it('xoá job thì job_event đi theo', async () => {
    const { db, runner } = sqlite();
    await migrate(runner, 'sqlite');
    seedOrgUserRunnerDevice(db);
    insertJob(db, 'job-1');
    db.exec(event('job-1', 1, 'log'));

    db.exec("DELETE FROM job WHERE id = 'job-1'");
    const left = db.prepare('SELECT count(*) AS c FROM job_event').get() as { c: number };
    assert.equal(left.c, 0);
  });
});

describe('dịch cú pháp hai dialect', () => {
  it('Postgres không còn token nào sót lại', async () => {
    const raw = await readFile(path.join(MIGRATIONS_DIR, '0001_init.sql'), 'utf8');
    const rendered = renderSql(raw, 'postgres');

    assert.doesNotMatch(rendered, /\{\{/, 'còn token chưa thay');
    assert.match(rendered, /JSONB/, 'Postgres phải dùng JSONB cho cột json');
  });

  it('SQLite không còn token nào sót lại', async () => {
    const raw = await readFile(path.join(MIGRATIONS_DIR, '0001_init.sql'), 'utf8');
    const rendered = renderSql(raw, 'sqlite');

    assert.doesNotMatch(rendered, /\{\{/);
    assert.doesNotMatch(rendered, /JSONB/, 'SQLite không có JSONB');
  });

  /** Token lạ là lỗi chính tả trong migration. Bỏ qua nó là tạo ra một cột kiểu rỗng. */
  it('token không biết thì ném, không lặng lẽ bỏ qua', () => {
    assert.throws(() => renderSql('CREATE TABLE t (a {{khong_co}})', 'sqlite'), /dialect\.ts không biết/);
    assert.ok(knownTokens().includes('json'));
  });

  /**
   * Cú pháp riêng của một bên lọt vào file chung là kiểu hỏng chỉ lộ ra ở nơi
   * triển khai kia — thường là muộn nhất có thể.
   */
  it('migration không dùng cú pháp riêng của Postgres', async () => {
    const raw = await readFile(path.join(MIGRATIONS_DIR, '0001_init.sql'), 'utf8');
    const sqlOnly = raw.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');

    for (const forbidden of [/\bSERIAL\b/i, /\bTIMESTAMPTZ\b/i, /\bNOW\(\)/i, /\[\]/, /\bJSONB\b/i]) {
      assert.doesNotMatch(sqlOnly, forbidden, `dùng cú pháp riêng: ${forbidden}`);
    }
  });

  it('tên file migration bắt đầu bằng số thứ tự', async () => {
    for (const name of await migrationFiles()) {
      assert.match(name, /^\d{4}_/, `${name}: thứ tự chạy là một phần của lược đồ`);
    }
  });
});

/* ------------------------------------------------------------------ */

function seedOrgUserRunnerDevice(db: DatabaseSync): void {
  const at = '2026-09-21T00:00:00.000Z';
  db.exec(`INSERT INTO org (id, name, created_at) VALUES ('org-1', 'Org', '${at}')`);
  db.exec(`INSERT INTO app_user (id, email, name, created_at)
    VALUES ('user-1', 'a@example.com', 'A', '${at}')`);
  db.exec(`INSERT INTO runner (id, org_id, name, mode, os, arch, protocol_version, agent_version,
    token_hash, visibility, state, created_at)
    VALUES ('run-1', 'org-1', 'lab', 'lab', 'darwin', 'arm64', '1.0.0', '0.1.0',
            'hash', 'shared', 'online', '${at}')`);
  db.exec(`INSERT INTO device (id, runner_id, org_id, platform, name, visibility, state, updated_at)
    VALUES ('dev-1', 'run-1', 'org-1', 'android', 'Pixel 7', 'shared', 'idle', '${at}')`);
}

function insertJob(db: DatabaseSync, id: string): void {
  db.exec(`INSERT INTO job (id, org_id, created_by, kind, state, priority, requested_at,
    payload, attempt)
    VALUES ('${id}', 'org-1', 'user-1', 'run_suite', 'queued', 0,
            '2026-09-21T00:00:00.000Z', '{}', 1)`);
}

function lease(id: string, deviceId: string, jobId: string): string {
  return `INSERT INTO lease (id, device_id, job_id, acquired_at, expires_at)
    VALUES ('${id}', '${deviceId}', '${jobId}', '2026-09-21T00:00:00.000Z',
            '2026-09-21T00:01:00.000Z')`;
}

function event(jobId: string, seq: number, type: string): string {
  return `INSERT INTO job_event (job_id, seq, at, type, payload)
    VALUES ('${jobId}', ${seq}, '2026-09-21T00:00:00.000Z', '${type}', '{}')`;
}
