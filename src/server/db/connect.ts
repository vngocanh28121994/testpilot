/**
 * Kết nối Postgres, và chạy migration trước khi nhận request nào.
 *
 * Migration nằm trong đường khởi động chứ không phải một bước thủ công. Lý do
 * thực tế: một bản deploy quên chạy migration sẽ hỏng ở lần đọc bảng đầu tiên,
 * tức là với NGƯỜI DÙNG, chứ không phải với người deploy. `migrate()` gọi lại
 * nhiều lần là an toàn — đó là điều kiện để nó nằm được ở đây.
 */
import { Pool } from 'pg';
import { migrate, type SqlRunner } from './migrate.js';

export interface DbOptions {
  url: string;
  /** Dừng khi kết nối lâu hơn mức này. Mặc định hợp với một máy cùng mạng. */
  connectionTimeoutMs?: number;
}

export function dbOptionsFromEnv(env = process.env): DbOptions | undefined {
  const url = env.TESTPILOT_DATABASE_URL?.trim();
  return url ? { url } : undefined;
}

/** `SqlRunner` của `migrate.ts`, bọc quanh một pool. */
export function runnerFor(pool: Pool): SqlRunner {
  return {
    exec: async (sql) => { await pool.query(sql); },
    all: async (sql) => (await pool.query(sql)).rows as Array<Record<string, unknown>>,
  };
}

export async function connect(opts: DbOptions): Promise<Pool> {
  const pool = new Pool({
    connectionString: opts.url,
    connectionTimeoutMillis: opts.connectionTimeoutMs ?? 10_000,
  });
  // Một truy vấn thật trước khi nói "đã kết nối": `new Pool()` không mở kết
  // nối nào cả, nên nếu không hỏi gì thì lỗi cấu hình sẽ chỉ lộ ra ở request
  // đầu tiên của người dùng.
  await pool.query('SELECT 1');
  await migrate(runnerFor(pool), 'postgres');
  return pool;
}
