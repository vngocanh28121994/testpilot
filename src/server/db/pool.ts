/**
 * MỘT pool Postgres cho cả tiến trình, mở ở lần dùng đầu tiên.
 *
 * Trước đây `repoFactory` giữ pool của riêng nó trong một biến đóng. Điều đó
 * đúng khi chỉ có kho dữ liệu nói chuyện với DB; nó thành sai ngay khi phiên
 * đăng nhập cũng cần DB, vì lúc ấy mỗi bên mở một pool và số kết nối tới
 * Postgres nhân đôi mà không ai quyết định điều đó.
 *
 * Mở ở lần dùng ĐẦU TIÊN chứ không lúc khởi động: `GET /api/health` phải trả
 * lời được khi DB còn chưa lên — cùng lý do với `lazyRepos`.
 */
import type { Pool } from 'pg';
import { connect, type DbOptions } from './connect.js';

export type PoolProvider = () => Promise<Pool>;

/**
 * Nhớ cả LỜI HỨA chứ không chỉ giá trị.
 *
 * Hai lời gọi song hành trong cùng một request — kho đọc registry, cửa quyền
 * đọc phiên — mà mỗi bên mở một pool riêng là nhân đôi số kết nối cho mỗi
 * request đầu tiên.
 */
export function poolProvider(
  db: DbOptions,
  open: (db: DbOptions) => Promise<Pool> = connect,
): PoolProvider {
  let pending: Promise<Pool> | undefined;
  return () => (pending ??= open(db));
}
