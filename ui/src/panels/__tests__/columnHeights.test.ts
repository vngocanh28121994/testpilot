import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Một thẻ dài đẩy cả bố cục lệch.
 *
 * Lưới hai cột ở Farm và Local Runner dùng `items-start`, nên mỗi thẻ cao đúng
 * bằng nội dung của nó. Thẻ trái (trạng thái AWS / cấu hình lượt chạy) ngắn hơn
 * nhiều so với thẻ phải (danh sách thiết bị / kiểm tra môi trường), và phần
 * dưới nó là một mảng trống giữa hai đường viền lệch nhau.
 *
 * Cho thẻ ngắn giãn hết chiều cao thì chỗ trống nằm BÊN TRONG thẻ, không còn là
 * một lỗ hổng trong bố cục.
 */
const here = path.dirname(new URL(import.meta.url).pathname);
const read = (p: string) => readFileSync(path.join(here, '..', p), 'utf8');

describe('lưới hai cột ở màn chạy', () => {
  for (const [name, file, titles] of [
    ['Farm', 'Farm/index.tsx', ['aws-title', 'device-title']],
    ['Local Runner', 'Runner/index.tsx', ['run-config-title', 'preflight-title']],
  ] as const) {
    it(`${name}: hai thẻ cao bằng nhau`, () => {
      const source = read(file);
      // `items-start` là thứ khoá mỗi thẻ vào chiều cao nội dung của nó.
      expect(source).not.toMatch(/grid items-start gap-6 xl:grid-cols-2/);
      for (const title of titles) {
        expect(source).toMatch(new RegExp(`<Card className="h-full" aria-labelledby="${title}"`));
      }
    });
  }
});
