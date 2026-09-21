/**
 * `npm test` phải chạy MỌI file test, không phải một danh sách chép tay.
 *
 * Trước 2026-09-21 `scripts.test` liệt kê tay 149 đường dẫn. Trên đĩa có 178
 * file: 29 file chưa bao giờ được chạy, trong đó 24 file xanh và không ai biết
 * chúng còn xanh hay không — người viết chúng tin là đã có lưới, và không có.
 * Kiểu hỏng này im lặng theo đúng nghĩa: thêm một file test mới mà quên sửa
 * package.json thì mọi thứ vẫn "xanh".
 *
 * 5 file còn lại là `*.integration.test.ts`: chúng cần máy Android thật và
 * Appium đang chạy, nên bị loại có chủ ý — bằng một quy ước đặt tên mà glob
 * đọc được, thay vì bằng việc không nhắc tới chúng.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts as Record<
  string,
  string | undefined
>;

/** Thiếu script là một kiểu hỏng riêng, và phải nói ra bằng tên của nó. */
function script(name: string): string {
  const value = scripts[name];
  assert.ok(value, `package.json không còn script "${name}"`);
  return value;
}

describe('npm test quét bằng glob', () => {
  it('không liệt kê file test bằng tay', () => {
    const listed = script('test').split(/\s+/).filter((token) => token.endsWith('.test.ts'));
    assert.deepEqual(listed, [], `còn ${listed.length} đường dẫn chép tay trong scripts.test`);
  });

  it('glob phủ mọi file test trừ integration', () => {
    assert.match(script('test'), /"src\/\*\*\/!\(\*\.integration\)\.test\.ts"/);
  });

  /** Loại ra thì phải có đường chạy riêng, nếu không là bỏ hẳn chứ không phải hoãn. */
  it('integration có script riêng để còn chạy được khi có máy', () => {
    assert.match(script('test:integration'), /\*\.integration\.test\.ts/);
  });
});
