/**
 * Chọn kho dữ liệu: file JSON hay Postgres.
 *
 * Tách khỏi `src/ui/server.ts` để quyết định này ĐO ĐƯỢC. Nó chỉ có ba nhánh,
 * nhưng một nhánh sai ở đây là dữ liệu của tổ chức A nằm trong file của tổ chức
 * B — kiểu hỏng không báo lỗi, không ai thấy, và không sửa được sau khi đã xảy
 * ra. Một hàm thuần thì viết được test cho cả ba nhánh mà không cần dựng DB.
 */
import type { Pool } from 'pg';
import { connect, type DbOptions } from './connect.js';
import { fileRepos } from './fileRepo.js';
import { pgRepos } from './pgRepo.js';
import type { Repos } from './repo.js';
import type { Identity } from '../auth/roles.js';
import type { ServerMode } from '../http.js';

export interface WiringOptions {
  mode: ServerMode;
  /** `TESTPILOT_DATABASE_URL`. Bắt buộc ở chế độ server. */
  db?: DbOptions;
  /** Đường dẫn từ config của người đang chạy — chỉ dùng ở chế độ embedded. */
  paths: () => Promise<{ registry: string; runs: string }>;
  /** Mở kết nối. Tham số hoá để test được nhánh server mà không cần DB thật. */
  open?: (db: DbOptions) => Promise<Pool>;
}

/**
 * Chế độ server mà thiếu DB thì DỪNG, không lặng lẽ dùng file.
 *
 * Quay về file ở chế độ server là đường rò dữ liệu giữa các tổ chức: mọi
 * `orgId` sẽ đọc và ghi cùng một file trên đĩa của máy chủ. Nên thiếu cấu hình
 * là một câu trả lời to và sớm — với người deploy, chứ không phải với người
 * dùng ở request đầu tiên.
 */
export function repoFactory(opts: WiringOptions): (identity: Identity) => Promise<Repos> {
  if (opts.mode === 'server' && !opts.db) {
    throw new Error(
      'TESTPILOT_MODE=server nhưng thiếu TESTPILOT_DATABASE_URL. '
        + 'Chế độ server phải có Postgres: dùng file JSON nghĩa là mọi tổ chức '
        + 'đọc ghi cùng một chỗ. Xem infra/README.md.',
    );
  }

  if (opts.mode === 'embedded' || !opts.db) {
    return async () => fileRepos(await opts.paths());
  }

  const db = opts.db;
  const open = opts.open ?? connect;
  // Một pool cho cả tiến trình, mở ở lần dùng đầu. `lazyRepos` trong
  // `dispatch` hoãn tới lời gọi đầu tiên, nên một route không đọc dữ liệu —
  // `GET /api/health` — vẫn trả lời được khi DB còn chưa lên.
  let pool: Promise<Pool> | undefined;
  return async (identity) => {
    pool ??= open(db);
    return pgRepos(await pool, identity.orgId);
  };
}
