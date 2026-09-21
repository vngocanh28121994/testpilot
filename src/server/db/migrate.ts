/**
 * Chạy migration, không phụ thuộc driver DB nào.
 *
 * Không kéo `node-pg-migrate` vào: nó buộc phải có Postgres để chạy, mà chế độ
 * `embedded` dùng SQLite, và một công cụ migration không chạy được ở một nửa
 * số nơi triển khai thì nửa kia phải tự xoay — đúng lúc hai schema bắt đầu
 * lệch nhau. Thứ cần ở đây nhỏ hơn nhiều so với một thư viện: đọc file theo
 * thứ tự, bỏ qua file đã chạy, ghi lại đã chạy gì.
 *
 * Người gọi đưa vào một `SqlRunner` — bốn dòng bọc quanh `pg.Client` hoặc
 * `node:sqlite`. Nhờ vậy test chạy trên SQL THẬT chứ không trên một bản giả.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { renderSql, type Dialect } from './dialect.js';

export interface SqlRunner {
  /** Chạy một hoặc nhiều câu lệnh, không trả kết quả. */
  exec(sql: string): void | Promise<void>;
  /** Trả về các dòng; chỉ dùng để đọc bảng `schema_migration`. */
  all(sql: string): Array<Record<string, unknown>> | Promise<Array<Record<string, unknown>>>;
}

export const MIGRATIONS_DIR = path.join(import.meta.dirname, 'migrations');

/**
 * Sổ ghi migration nào đã chạy.
 *
 * Tạo bằng chính `IF NOT EXISTS` chứ không phải một migration riêng: cái bảng
 * dùng để biết "đã chạy gì" mà lại phải chạy qua cơ chế ấy là một vòng tròn.
 */
const BOOKKEEPING = `
CREATE TABLE IF NOT EXISTS schema_migration (
  name     TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);`;

export async function migrationFiles(dir = MIGRATIONS_DIR): Promise<string[]> {
  const names = await readdir(dir);
  // Thứ tự theo tên file, nên tên bắt đầu bằng số bốn chữ số. Thứ tự chạy là
  // một phần của lược đồ: 0002 giả định 0001 đã xong.
  return names.filter((name) => name.endsWith('.sql')).sort();
}

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

/**
 * Chạy những migration chưa chạy. Gọi lại nhiều lần là an toàn — đó là điều
 * kiện để nó nằm được trong đường khởi động của server.
 */
export async function migrate(
  runner: SqlRunner,
  dialect: Dialect,
  dir = MIGRATIONS_DIR,
): Promise<MigrateResult> {
  await runner.exec(BOOKKEEPING);
  const done = new Set(
    (await runner.all('SELECT name FROM schema_migration')).map((row) => String(row.name)),
  );

  const applied: string[] = [];
  const skipped: string[] = [];
  for (const name of await migrationFiles(dir)) {
    if (done.has(name)) {
      skipped.push(name);
      continue;
    }
    const sql = renderSql(await readFile(path.join(dir, name), 'utf8'), dialect);
    await runner.exec(sql);
    await runner.exec(
      `INSERT INTO schema_migration (name, applied_at) VALUES ('${name}', '${new Date().toISOString()}')`,
    );
    applied.push(name);
  }
  return { applied, skipped };
}
