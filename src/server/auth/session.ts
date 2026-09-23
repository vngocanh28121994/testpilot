/**
 * Phiên đăng nhập: cookie mang một mã ngẫu nhiên, phần còn lại ở phía server.
 *
 * Cố ý KHÔNG dùng JWT tự ký đặt trong cookie. Một token tự chứa thì không thu
 * hồi được: đuổi một người khỏi tổ chức xong, token của họ vẫn hợp lệ cho tới
 * lúc hết hạn, và "hết hạn" là con số ta chọn lúc phát chứ không phải lúc cần.
 * Với một công cụ chạy được lệnh trên máy và tiêu tiền thiết bị, thu hồi tức
 * thì đáng giá hơn việc tiết kiệm một lượt đọc store.
 *
 * Cookie chỉ mang mã phiên, nên nó vô giá trị nếu không có store — và store là
 * chỗ ta xoá được.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Identity } from './roles.js';

export const SESSION_COOKIE = 'testpilot_session';

/** 12 tiếng: đủ một ngày làm việc, không đủ để một máy bị bỏ quên qua đêm. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export interface Session {
  id: string;
  identity: Identity;
  createdAt: number;
  expiresAt: number;
}

export interface SessionStore {
  create(identity: Identity, now?: number): Promise<Session>;
  find(id: string, now?: number): Promise<Session | undefined>;
  revoke(id: string): Promise<void>;
  /** Đuổi mọi phiên của một người — dùng khi họ rời tổ chức hoặc lộ máy. */
  revokeUser(userId: string): Promise<void>;
  /**
   * Dọn phiên đã hết hạn. Trả về số dòng đã xoá.
   *
   * Tuỳ chọn, vì nó chỉ có nghĩa với một kho BỀN. Bản trong RAM tự quên khi
   * tiến trình chết, còn một bảng thì chỉ lớn lên: `find()` xoá dòng hết hạn
   * khi có ai hỏi tới nó, nhưng phiên bị BỎ QUÊN thì không ai hỏi tới bao
   * giờ — và đó đúng là loại chiếm phần lớn số dòng.
   */
  reapExpired?(now?: number): Promise<number>;
}

/**
 * Chỉ giữ HASH của mã phiên.
 *
 * Store rồi sẽ là một bảng trong Postgres, và một bảng có thể bị đọc: log truy
 * vấn, bản backup, một lần `SELECT *` chia sẻ nhầm. Mã phiên là thứ đăng nhập
 * được ngay, nên đối xử với nó như mật khẩu — không như một khoá chính.
 */
function hash(id: string): string {
  return createHash('sha256').update(id).digest('hex');
}

export class MemorySessionStore implements SessionStore {
  private readonly rows = new Map<string, Session>();

  async create(identity: Identity, now = Date.now()): Promise<Session> {
    // 32 byte ngẫu nhiên: đủ để không đoán được, và đây là thứ duy nhất đứng
    // giữa một người lạ và quyền chạy test trên thiết bị thật.
    const id = randomBytes(32).toString('base64url');
    const session: Session = { id, identity, createdAt: now, expiresAt: now + SESSION_TTL_MS };
    this.rows.set(hash(id), session);
    return session;
  }

  async find(id: string, now = Date.now()): Promise<Session | undefined> {
    const row = this.rows.get(hash(id));
    if (!row) return undefined;
    if (row.expiresAt <= now) {
      // Hết hạn thì xoá luôn, đừng để nó nằm lại chờ một lượt dọn nào đó.
      this.rows.delete(hash(id));
      return undefined;
    }
    return row;
  }

  async revoke(id: string): Promise<void> {
    this.rows.delete(hash(id));
  }

  async revokeUser(userId: string): Promise<void> {
    for (const [key, row] of this.rows) {
      if (row.identity.userId === userId) this.rows.delete(key);
    }
  }
}

/**
 * Đọc mã phiên từ header Cookie.
 *
 * Tự tách chuỗi thay vì kéo thêm thư viện: cookie ở đây có đúng một tên cần
 * đọc, và mỗi dependency trong đường xác thực là một thứ phải theo dõi bản vá.
 */
export function sessionIdFromCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) {
      const value = rest.join('=').trim();
      return value || undefined;
    }
  }
  return undefined;
}

/**
 * Cookie phiên, với ba thuộc tính không được phép quên.
 *
 *  - `HttpOnly`: JavaScript của trang không đọc được. Một lỗ XSS ở đâu đó
 *    trong giao diện thì không kéo theo việc mất phiên.
 *  - `Secure`: chỉ đi qua HTTPS. Bỏ khi chạy localhost, vì lúc ấy không có
 *    HTTPS và cookie sẽ đơn giản là không được gửi.
 *  - `SameSite=Lax`: một trang khác không thể khiến trình duyệt gọi API này
 *    kèm cookie. Đây là phần chống CSRF rẻ nhất và hiệu quả nhất.
 */
export function sessionCookie(id: string, opts: { secure: boolean; maxAgeMs?: number }): string {
  const maxAge = Math.floor((opts.maxAgeMs ?? SESSION_TTL_MS) / 1000);
  return [
    `${SESSION_COOKIE}=${id}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    ...(opts.secure ? ['Secure'] : []),
  ].join('; ');
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/**
 * So sánh hai chuỗi bí mật mà không để lộ chúng giống nhau tới đâu.
 *
 * Dùng cho token của runner ở P4. `===` dừng ngay ở byte đầu khác nhau, và
 * khoảng thời gian ấy đo được qua mạng nếu kẻ tấn công thử đủ nhiều lần.
 */
export function secretEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
