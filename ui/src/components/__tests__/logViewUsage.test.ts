import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Mọi log hiển thị qua một component duy nhất.
 *
 * Log từng được vẽ tay ở tám chỗ khác nhau, và chúng lệch nhau theo đúng những
 * cách người dùng nhìn thấy: chỗ tự cuộn chỗ không, chỗ tô màu kết quả chỗ in
 * nguyên văn `[run:passed]`, chỗ biến URL thành link chỗ để chữ chết. Network
 * log là chỗ sót cuối cùng được phát hiện.
 *
 * Test này quét mã nguồn thay vì render: cái cần chặn là một <pre> MỚI mọc ra ở
 * một panel nào đó, chứ không phải hành vi của một component cụ thể.
 */
describe('không còn nơi nào tự vẽ log', () => {
  const root = path.resolve('ui/src');
  /**
   * Được phép nhắc tới <pre>: chính LogView, trình soạn Gherkin (lớp tô màu của
   * nó), và bộ tách token — file cuối chỉ nói tới <pre> trong phần chú thích,
   * nhưng loại trừ theo tên vẫn rẻ và rõ hơn là đi phân biệt chú thích với mã.
   */
  const allowed = [
    'components/LogView.tsx',
    'components/GherkinEditor.tsx',
    'lib/gherkinTokens.ts',
  ];

  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return name === '__tests__' ? [] : walk(full);
      return /\.tsx?$/.test(name) ? [full] : [];
    });

  it('chỉ LogView và GherkinEditor được dựng <pre>', () => {
    const offenders = walk(root)
      .filter((file) => !allowed.some((ok) => file.endsWith(ok)))
      .filter((file) => /<pre[\s>]/.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(root, file));
    expect(offenders).toEqual([]);
  });
});
