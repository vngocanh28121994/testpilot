/**
 * Phiên đăng nhập của tiến trình này.
 *
 * Một instance duy nhất, tách khỏi nơi dùng: route đăng nhập TẠO phiên, còn
 * cửa quyền ĐỌC phiên, và hai bên phải nhìn vào cùng một kho. Hai bản `new`
 * riêng sẽ cho ra một hệ thống đăng nhập xong vẫn báo chưa đăng nhập — đúng
 * kiểu lỗi mà `OrphanTracker` đã dạy một lần ở P1.
 *
 * **Ở chế độ `server` đây là một bảng trong Postgres.** Bản trong RAM hỏng
 * theo hai cách mà không cấu hình nào sửa được: một lần deploy bình thường
 * đăng xuất toàn bộ người đang dùng, và chạy hai instance thì người đăng nhập
 * ở instance này gọi API rơi vào instance kia sẽ nhận 401 — không phải thỉnh
 * thoảng, mà là một nửa số request.
 *
 * Ở chế độ `embedded` thì vẫn là RAM, và đó là lựa chọn đúng ở đó: không có
 * đăng nhập nào cả, người dùng luôn là `local`, và một bảng phiên trong một
 * DB không tồn tại là một phụ thuộc thêm để đổi lấy không gì.
 */
import type { Pool } from 'pg';
import { MemorySessionStore, type Session, type SessionStore } from './session.js';
import { PgSessionStore } from './pgSession.js';
import type { Identity } from './roles.js';
import type { PoolProvider } from '../db/pool.js';
import type { ServerMode } from '../http.js';

/**
 * Kho phiên hoãn tới lời gọi đầu tiên.
 *
 * Cùng lý do với `lazyRepos`: `GET /api/health` và đường runner (token riêng,
 * không qua phiên) phải trả lời được khi DB còn chưa lên. Một kho phiên mở
 * kết nối lúc khởi động biến việc "DB chậm lên" thành "server không khởi
 * động", và load balancer đọc câu đó rồi kết luận sai.
 */
class LazySessionStore implements SessionStore {
  private pending?: Promise<SessionStore>;

  constructor(private readonly build: () => Promise<SessionStore>) {}

  private open(): Promise<SessionStore> {
    return (this.pending ??= this.build());
  }

  async create(identity: Identity, now?: number): Promise<Session> {
    return (await this.open()).create(identity, now);
  }

  async find(id: string, now?: number): Promise<Session | undefined> {
    return (await this.open()).find(id, now);
  }

  async revoke(id: string): Promise<void> {
    return (await this.open()).revoke(id);
  }

  async revokeUser(userId: string): Promise<void> {
    return (await this.open()).revokeUser(userId);
  }

  async reapExpired(now?: number): Promise<number> {
    const store = await this.open();
    // Kho bên dưới không dọn được thì đây là việc không phải làm, không phải
    // việc làm hỏng: trả 0 chứ đừng ném vào giữa vòng dọn.
    return store.reapExpired ? store.reapExpired(now) : 0;
  }
}

export interface SessionWiring {
  mode: ServerMode;
  /** Pool dùng chung của tiến trình. Thiếu nó ở chế độ server là một lỗi cấu hình. */
  pool?: PoolProvider;
  /** Tiêm để test nhánh server mà không cần DB thật. */
  build?: (pool: Pool) => SessionStore;
}

/**
 * Chọn kho phiên theo chế độ.
 *
 * Chế độ `server` mà thiếu DB thì DỪNG, không lặng lẽ dùng RAM. Quay về RAM ở
 * đó là dựng một hệ thống đăng nhập chạy được trên máy người deploy và hỏng
 * ngay khi có instance thứ hai — kiểu hỏng chỉ lộ ra dưới tải, tức là lúc tệ
 * nhất. Cùng luật với `repoFactory`.
 */
export function sessionStore(wiring: SessionWiring): SessionStore {
  if (wiring.mode !== 'server') return new MemorySessionStore();

  const pool = wiring.pool;
  if (!pool) {
    throw new Error(
      'TESTPILOT_MODE=server nhưng thiếu TESTPILOT_DATABASE_URL. Phiên đăng nhập '
        + 'phải nằm trong Postgres: giữ trong RAM nghĩa là mỗi lần deploy đăng xuất '
        + 'tất cả mọi người, và hai instance thì đăng nhập ở bên này gọi API bên kia '
        + 'nhận 401. Xem infra/README.md.',
    );
  }
  const build = wiring.build ?? ((ready: Pool) => new PgSessionStore(ready));
  return new LazySessionStore(async () => build(await pool()));
}
