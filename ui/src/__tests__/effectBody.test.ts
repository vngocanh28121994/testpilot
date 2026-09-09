import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * `useEffect` phải có thân KHỐI.
 *
 * Giá trị trả về của một effect là hàm dọn dẹp. Thân rút gọn —
 * `useEffect(() => expr, deps)` — lặng lẽ biến kết quả của `expr` thành
 * cleanup, và không có gì cảnh báo: TypeScript chấp nhận, ESLint không nói gì,
 * và phần lớn thời gian `expr` trả undefined nên chạy tốt.
 *
 * Cho tới khi không.
 *
 *   useEffect(() => focus.current?.scrollIntoView({ behavior: 'smooth' }), [id]);
 *
 * Dòng này chạy đúng ở mọi trình duyệt tôi thử. Trong Chrome của người dùng,
 * `scrollIntoView` trả về một Promise. React giữ Promise đó làm cleanup rồi gọi
 * nó lúc gỡ component, và cả trang lịch sử vỡ khi bấm sang màn khác:
 *
 *   TypeError: destroy_ is not a function
 *     at commitHookEffectListUnmount
 *     at commitPassiveUnmountEffectsInsideOfDeletedTree_begin
 *
 * Mất gần một ngày để tìm ra, vì stack không chứa một khung nào của ứng dụng:
 * hàm gây lỗi sinh ra từ một lần render đã xong từ lâu. Phải duyệt cây fiber
 * ngay trên máy người dùng mới chỉ được mặt.
 *
 * Nên luật ở đây không phải "gọi hàm nào thì được", mà là: đừng để giá trị trả
 * về của effect phụ thuộc vào một biểu thức không ai kiểm soát.
 */
describe('useEffect không được dùng thân rút gọn', () => {
  // 'ui/src', không phải 'src': vitest chạy với cwd ở gốc repo, nên 'src' trỏ
  // vào backend — nơi không có một useEffect nào, và cả bộ test xanh vờ.
  const root = path.resolve('ui/src');

  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return name === '__tests__' ? [] : walk(full);
      return /\.tsx?$/.test(name) ? [full] : [];
    });

  it('mọi effect đều mở bằng {', () => {
    const offenders = walk(root).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return [...source.matchAll(/use(?:Layout)?Effect\(\s*(?:async\s*)?\(\s*\)\s*=>\s*(.)/g)]
        .filter((match) => match[1] !== '{')
        .map((match) => `${path.relative(root, file)}: ${source.slice(match.index, (match.index ?? 0) + 70)}`);
    });
    expect(offenders).toEqual([]);
  });

  /** `useEffect(async …)` trả Promise theo đúng nghĩa đen — cùng một cái bẫy. */
  it('không có effect async', () => {
    const offenders = walk(root)
      .filter((file) => /use(?:Layout)?Effect\(\s*async/.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(root, file));
    expect(offenders).toEqual([]);
  });

  /**
   * Truyền thẳng một hàm có sẵn cũng là thân rút gọn trá hình: giá trị nó trả
   * về đi thẳng vào chỗ cleanup mà chỗ gọi không nhìn thấy.
   */
  it('không truyền thẳng hàm có sẵn làm effect', () => {
    const offenders = walk(root).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return [...source.matchAll(/use(?:Layout)?Effect\(\s*([A-Za-z_$][\w$]*)\s*,/g)]
        .map((match) => `${path.relative(root, file)}: useEffect(${match[1]}, …)`);
    });
    expect(offenders).toEqual([]);
  });
});
