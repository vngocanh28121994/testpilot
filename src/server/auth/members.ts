/**
 * Ai thuộc tổ chức nào, với vai gì.
 *
 * SSO trả lời "người này là ai". Câu "ai được làm gì" là của TestPilot, và đó
 * là một quyết định chứ không phải một thiếu sót: xin IT tạo một group mới
 * trong SSO của công ty có thể mất vài tuần, còn thêm một dòng ở đây mất một
 * giây. Token vẫn mang claim `roles` để P5 dựng đường ánh xạ tự động — nhưng
 * đường ấy là tiện ích, không phải điều kiện để hệ thống chạy.
 *
 * Ở P2.4 chỗ này thành bảng `membership`. Interface không đổi.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Role } from './roles.js';

export interface MemberDirectory {
  /** `undefined` nghĩa là người này chưa thuộc tổ chức — KHÔNG phải vai thấp nhất. */
  roleFor(orgId: string, email: string): Promise<Role | undefined>;
  setRole(orgId: string, email: string, role: Role): Promise<void>;
  list(orgId: string): Promise<Array<{ email: string; role: Role }>>;
}

/** Email so khớp không phân biệt hoa thường; khoảng trắng hai đầu bị cắt. */
function normalize(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Người được cấp vai `admin` sẵn, đọc từ biến môi trường.
 *
 * Đây là lời giải cho bài toán con gà và quả trứng: server mới dựng thì chưa
 * ai là admin, mà thêm admin lại cần quyền admin. Danh sách này là đường vào
 * đầu tiên, và nó nằm ở biến môi trường — nơi người dựng server chạm được còn
 * người dùng thì không.
 */
export function bootstrapAdmins(env = process.env): string[] {
  return (env.TESTPILOT_BOOTSTRAP_ADMINS ?? '')
    .split(',')
    .map(normalize)
    .filter(Boolean);
}

export class FileMemberDirectory implements MemberDirectory {
  constructor(
    private readonly file = path.join('.testpilot', 'members.json'),
    private readonly bootstrap: string[] = bootstrapAdmins(),
  ) {}

  private async read(): Promise<Record<string, Record<string, Role>>> {
    if (!existsSync(this.file)) return {};
    try {
      return JSON.parse(await readFile(this.file, 'utf8')) as Record<string, Record<string, Role>>;
    } catch {
      // File hỏng thì coi như rỗng, KHÔNG coi như "ai cũng là admin". Một file
      // JSON lỗi cú pháp không được phép trở thành một cánh cửa mở.
      return {};
    }
  }

  async roleFor(orgId: string, email: string): Promise<Role | undefined> {
    const key = normalize(email);
    if (this.bootstrap.includes(key)) return 'admin';
    return (await this.read())[orgId]?.[key];
  }

  async setRole(orgId: string, email: string, role: Role): Promise<void> {
    const rows = await this.read();
    rows[orgId] = { ...(rows[orgId] ?? {}), [normalize(email)]: role };
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(rows, null, 2) + '\n', 'utf8');
  }

  async list(orgId: string): Promise<Array<{ email: string; role: Role }>> {
    const rows = (await this.read())[orgId] ?? {};
    const listed = Object.entries(rows).map(([email, role]) => ({ email, role }));
    for (const email of this.bootstrap) {
      if (!listed.some((row) => row.email === email)) listed.push({ email, role: 'admin' });
    }
    return listed.sort((a, b) => a.email.localeCompare(b.email));
  }
}

export class MemoryMemberDirectory implements MemberDirectory {
  private readonly rows = new Map<string, Role>();

  constructor(private readonly bootstrap: string[] = []) {}

  private key(orgId: string, email: string): string {
    return JSON.stringify([orgId, normalize(email)]);
  }

  async roleFor(orgId: string, email: string): Promise<Role | undefined> {
    if (this.bootstrap.includes(normalize(email))) return 'admin';
    return this.rows.get(this.key(orgId, email));
  }

  async setRole(orgId: string, email: string, role: Role): Promise<void> {
    this.rows.set(this.key(orgId, email), role);
  }

  async list(orgId: string): Promise<Array<{ email: string; role: Role }>> {
    return [...this.rows.entries()]
      .map(([key, role]) => ({ parsed: JSON.parse(key) as [string, string], role }))
      .filter(({ parsed }) => parsed[0] === orgId)
      .map(({ parsed, role }) => ({ email: parsed[1], role }))
      .sort((a, b) => a.email.localeCompare(b.email));
  }
}
