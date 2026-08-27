import type { ApiValidationError } from '@core/ui/contracts.js';

/**
 * Lỗi từ tầng API, mang theo đủ ngữ cảnh để nơi khác quyết định được.
 *
 * `path` tồn tại vì `queryClient` cần biết route nào vừa hỏng để áp policy
 * retry (route AWS/prereq/farm không retry — xem lib/queryClient.ts). Không có
 * nó thì policy chỉ có thể đoán qua thông báo lỗi.
 */
export class ApiRequestError extends Error {
  readonly path: string;
  readonly status: number;
  /** Từng dòng lỗi zod của PUT /api/config. Rỗng với các route khác. */
  readonly issues: string[];
  /**
   * Đánh dấu thông báo ĐÃ hiện trên màn hình rồi (console của một job đang
   * stream in nó ra theo đúng thứ tự với các dòng log quanh nó). Giữ nguyên
   * quy ước `err.printed` của app.js:5738 — thiếu nó thì mỗi lỗi xuất hiện hai
   * lần, một lần trong log và một lần ở toast.
   */
  printed = false;

  constructor(message: string, path: string, status: number, issues: string[] = []) {
    super(message);
    this.name = 'ApiRequestError';
    this.path = path;
    this.status = status;
    this.issues = issues;
  }
}

/**
 * Giữ đúng hành vi của `api()` ở app.js:335, gồm CẢ hai nhánh lỗi.
 *
 * `issues` phải được ưu tiên hơn `error`: nó là mảng lỗi zod của
 * PUT /api/config và là thứ duy nhất chỉ ra trường nào sai. Rút gọn xuống
 * `data.error` là biến một danh sách sửa được thành "Config không hợp lệ".
 */
async function unwrap<T>(res: Response, path: string): Promise<T> {
  // 204 và body rỗng: .json() sẽ ném, mà đó không phải lỗi của server.
  const raw: unknown = await res.json().catch(() => ({}));

  if (!res.ok) {
    const e = raw as Partial<ApiValidationError>;
    const issues = Array.isArray(e.issues) ? e.issues : [];
    const message = issues.length ? issues.join('\n') : (e.error ?? res.statusText);
    throw new ApiRequestError(message, path, res.status, issues);
  }
  return raw as T;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return unwrap<T>(res, path);
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  getText: async (path: string) => {
    const res = await fetch(path);
    if (!res.ok) throw new ApiRequestError(res.statusText, path, res.status);
    return res.text();
  },
};

/** Ghép query string, bỏ qua các khoá undefined. */
export function qs(params: Record<string, string | number | boolean | undefined>): string {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) out.set(k, String(v));
  }
  const s = out.toString();
  return s ? `?${s}` : '';
}
