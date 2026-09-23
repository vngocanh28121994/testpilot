/**
 * Ba chỗ Postgres và SQLite nói khác nhau, gom hết vào đây.
 *
 * Vì sao phải chạy được cả hai: chế độ `embedded` là bản local mà người dùng
 * mở bằng `npm run ui` trên máy của họ, và bắt họ cài Postgres để dùng một
 * công cụ chạy một mình là đổi một thứ đang dùng được lấy một thứ phải cài
 * đặt. Nhưng hai schema tách rời thì sẽ lệch — kiểu lệch chỉ lộ ra khi ai đó
 * chuyển từ local lên server và mất dữ liệu. Nên: một file SQL, ba chỗ thay.
 *
 * Danh sách cố tình ngắn. Mỗi token thêm vào đây là một chỗ hai DB có thể lệch
 * nhau mà migration không nói ra, nên nếu một câu SQL cần nhiều hơn ba token
 * này thì thường là nó đang dùng tính năng riêng của một bên — và đó là lúc
 * nên viết lại câu SQL, không phải thêm token.
 */
export type Dialect = 'postgres' | 'sqlite';

const TOKENS: Record<Dialect, Record<string, string>> = {
  postgres: {
    json: 'JSONB',
    // Mốc thời gian do ứng dụng sinh ra dưới dạng chuỗi ISO-8601 UTC, nên kiểu
    // ở đây chỉ cần giữ nguyên chuỗi. Dùng TIMESTAMPTZ sẽ kéo theo chuyện múi
    // giờ của phiên kết nối — thứ mà một runner ở máy khác không kiểm soát được.
    timestamp: 'TEXT',
    bool: 'BOOLEAN',
  },
  sqlite: {
    json: 'TEXT',
    timestamp: 'TEXT',
    // SQLite không có kiểu boolean; INTEGER 0/1 là cách chuẩn.
    bool: 'INTEGER',
  },
};

/**
 * Thay `{{json}}`, `{{timestamp}}`, `{{bool}}`. Token lạ là lỗi, không phải bỏ qua.
 *
 * KHÔNG thay bên trong bình luận `--`. Nghe như một chi tiết nhỏ, và nó đã
 * chặn một migration thật: một dòng bình luận GIẢI THÍCH vì sao không nên thêm
 * token mới đã tự biến thành một token lạ, và migration chết trước khi chạy
 * câu SQL nào. Bình luận là chỗ người ta viết về token — đó là lý do duy nhất
 * cần, và nó đủ.
 */
export function renderSql(sql: string, dialect: Dialect): string {
  return sql
    .split('\n')
    .map((line) => {
      const at = line.indexOf('--');
      const code = at >= 0 ? line.slice(0, at) : line;
      const comment = at >= 0 ? line.slice(at) : '';
      return replaceTokens(code, dialect) + comment;
    })
    .join('\n');
}

function replaceTokens(sql: string, dialect: Dialect): string {
  return sql.replace(/\{\{(\w+)\}\}/g, (_match, token: string) => {
    const value = TOKENS[dialect][token];
    if (!value) {
      throw new Error(
        `Migration dùng token "{{${token}}}" mà dialect.ts không biết. `
          + `Các token hợp lệ: ${Object.keys(TOKENS[dialect]).join(', ')}.`,
      );
    }
    return value;
  });
}

/** Những token có thật, để test khẳng định không còn cú pháp riêng nào lọt vào SQL. */
export function knownTokens(): string[] {
  return Object.keys(TOKENS.postgres);
}
