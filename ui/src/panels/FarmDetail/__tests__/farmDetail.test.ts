import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Cùng một lượt chạy, xem ở màn lịch sử local và ở màn chi tiết farm thì thấy
 * hai lượng thông tin khác nhau — và chỗ thiếu lại đúng là chỗ khó dựng lại
 * nhất: máy nằm ở AWS, không cắm vào đâu để xem lại.
 *
 * Ảnh chụp lúc hỏng trả lời nhanh nhất câu "màn hình đang ở đâu khi nó đỏ".
 * Hôm nay chính nó cho thấy app đã đăng nhập và vào tới Bảng giá, trong khi log
 * chỉ nói "bấm lỗi".
 */
const here = path.dirname(new URL(import.meta.url).pathname);
const farm = readFileSync(path.join(here, '..', 'index.tsx'), 'utf8');
const history = readFileSync(
  path.join(here, '../../RunnerHistory/index.tsx'),
  'utf8',
);

describe('màn chi tiết farm', () => {
  it('có ảnh chụp và network log như màn lịch sử local', () => {
    expect(farm).toMatch(/<RunShots report=\{report\}/);
    expect(farm).toMatch(/report\.networkLogUrl/);
  });

  it('dùng player có mốc, không phải thẻ video trần', () => {
    expect(farm).toMatch(/<RunVideo key=\{url\} url=\{url\} report=\{report\}/);
    expect(farm).not.toMatch(/<video /);
  });

  /** Một lưới ảnh, hai màn dùng: lệch nhau lần nữa là lại mất công so sánh. */
  it('hai màn dùng chung một lưới ảnh', () => {
    expect(history).toMatch(/<RunShots report=\{report\}/);
    expect(history).not.toMatch(/shotLabel/);
  });
});
