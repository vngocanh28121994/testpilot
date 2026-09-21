/**
 * Khoá và mật khẩu, tách theo tổ chức, và KHÔNG nằm trong `process.env`.
 *
 * Hôm nay mọi khoá được nạp vào `process.env` lúc khởi động và ghi thêm vào đó
 * mỗi lần ai đó lưu một khoá mới. Với một người dùng trên máy của chính họ thì
 * điều đó vô hại — và tiện, vì mọi thư viện đều đọc `process.env`.
 *
 * Với một server nhiều người thì nó là ba vấn đề cùng lúc:
 *
 *  1. **Khoá của một người thành khoá của cả server.** Ai lưu sau thì khoá của
 *     người đó phục vụ mọi request, kể cả của tổ chức khác. Không ai được báo.
 *  2. **Không thu hồi được theo tổ chức.** `process.env` là một không gian
 *     phẳng: xoá khoá của tổ chức A cũng là xoá của B nếu hai bên trùng tên.
 *  3. **Rò ra tiến trình con.** Mọi `spawn` thừa hưởng toàn bộ `process.env`,
 *     nên một job của tổ chức A chạy với khoá của tổ chức B trong môi trường
 *     của nó, dù nó không cần và không được phép biết.
 *
 * Nên: một kho có khoá theo tổ chức, và ai cần khoá thì HỎI, thay vì đọc một
 * biến toàn cục mà không ai biết nó từ đâu tới.
 *
 * Xem [FARM-ARCHITECTURE.md](../../../FARM-ARCHITECTURE.md) mục 8 và
 * [FARM-PLAN.md](../../../FARM-PLAN.md) P2.3.
 */
import { Secrets } from '../../core/secrets.js';
import type { ServerMode } from '../http.js';

/** Tên khoá, không bao giờ là giá trị. Dùng trong log và trong `SecretGrant`. */
export type SecretName = string;

export interface SecretStore {
  /** Giá trị, chỉ trả cho người gọi đã biết mình cần gì. */
  get(orgId: string, name: SecretName): Promise<string | undefined>;
  /** Có hay không — đây là thứ DUY NHẤT được phép đi ra trình duyệt. */
  has(orgId: string, name: SecretName): Promise<boolean>;
  set(orgId: string, name: SecretName, value: string): Promise<void>;
  /** Tên các khoá đã cấu hình. Giá trị không đi kèm, có chủ ý. */
  names(orgId: string): Promise<SecretName[]>;
}

/**
 * Kho cho chế độ `embedded`: chính `.testpilot.secrets.json` đang dùng.
 *
 * Bỏ qua `orgId` vì ở chế độ ấy chỉ có một tổ chức (`local`) và một người. Nó
 * vẫn nhận tham số `orgId` để nơi gọi không phải biết mình đang nói chuyện với
 * kho nào — đó là toàn bộ điểm của interface này.
 */
export class FileSecretStore implements SecretStore {
  async get(_orgId: string, name: SecretName): Promise<string | undefined> {
    return (await Secrets.load()).apiKey(name);
  }

  async has(orgId: string, name: SecretName): Promise<boolean> {
    return Boolean(await this.get(orgId, name));
  }

  async set(_orgId: string, name: SecretName, value: string): Promise<void> {
    const secrets = await Secrets.load();
    secrets.setApiKey(name, value);
    await secrets.save();
  }

  async names(_orgId: string): Promise<SecretName[]> {
    const secrets = await Secrets.load();
    return [...MANAGED_SECRETS].filter((name) => Boolean(secrets.apiKey(name)));
  }
}

/**
 * Kho trong RAM, tách theo tổ chức. Dùng cho test và cho bản dựng tạm.
 *
 * Bản thật của chế độ `server` là secret manager (AWS Secrets Manager, hoặc
 * Postgres có mã hoá cho bản tự host) — P2.6. Interface không đổi.
 */
export class MemorySecretStore implements SecretStore {
  private readonly rows = new Map<string, string>();

  /**
   * Khoá gộp bằng JSON, không bằng một ký tự phân cách.
   *
   * Bản đầu dùng byte NUL và bị `sourceIntegrity` chặn — đúng, vì một byte
   * không in được nằm trong mã nguồn là thứ không ai đọc ra khi xem diff.
   * Nhưng lý do sâu hơn vẫn còn: mọi dấu phân cách đều có thể xuất hiện trong
   * dữ liệu, và khi ấy hai cặp (org, name) khác nhau gộp thành một khoá. JSON
   * không có chỗ cho nhập nhằng ấy.
   */
  private key(orgId: string, name: SecretName): string {
    return JSON.stringify([orgId, name]);
  }

  async get(orgId: string, name: SecretName): Promise<string | undefined> {
    return this.rows.get(this.key(orgId, name));
  }

  async has(orgId: string, name: SecretName): Promise<boolean> {
    return this.rows.has(this.key(orgId, name));
  }

  async set(orgId: string, name: SecretName, value: string): Promise<void> {
    this.rows.set(this.key(orgId, name), value);
  }

  async names(orgId: string): Promise<SecretName[]> {
    return [...this.rows.keys()]
      .map((key) => JSON.parse(key) as [string, SecretName])
      .filter(([org]) => org === orgId)
      .map(([, name]) => name)
      .sort();
  }
}

/** Những khoá hệ thống này quản. Tên lạ vẫn lưu được, nhưng không được liệt kê. */
export const MANAGED_SECRETS = [
  'ANTHROPIC_API_KEY',
  'DEEPSEEK_API_KEY',
  'GEMINI_API_KEY',
  'CONFLUENCE_EMAIL',
  'CONFLUENCE_API_TOKEN',
] as const;

/**
 * Có được nạp khoá vào `process.env` hay không.
 *
 * `embedded` thì có: một người, một máy, và mọi thư viện đọc `process.env`.
 * `server` thì KHÔNG, vì ba lý do ở đầu file — và việc này phải là một câu
 * lệnh nhìn thấy được, không phải một nhánh `if` nằm sâu trong hàm nạp.
 */
export function mayAdoptIntoEnv(mode: ServerMode): boolean {
  return mode === 'embedded';
}

/**
 * Bộ khoá cấp cho ĐÚNG một job, theo đúng những tên nó cần.
 *
 * Trả về cả túi thì rẻ hơn một dòng code và đắt hơn nhiều về sau: một job chỉ
 * cần đọc Confluence sẽ mang theo khoá model của cả tổ chức xuống máy cá nhân
 * của một người, và ở đó nó nằm trong `process.env` của một tiến trình mà
 * không ai còn nhớ tới.
 *
 * Tên nào không có thì vắng mặt — không phải chuỗi rỗng. Chuỗi rỗng sẽ đi tiếp
 * xuống dưới rồi hỏng ở chỗ khác, với một thông báo nói về HTTP 401 chứ không
 * nói về một khoá chưa cấu hình.
 */
export async function secretsForJob(
  store: SecretStore,
  orgId: string,
  names: readonly SecretName[],
): Promise<Record<string, string>> {
  const granted: Record<string, string> = {};
  for (const name of names) {
    const value = await store.get(orgId, name);
    if (value) granted[name] = value;
  }
  return granted;
}
