/**
 * Khối nội dung phải có màu nền của riêng nó.
 *
 * Từ khi thêm theme, AppShell vẽ một nền chấm động phía sau mọi trang. Bất cứ
 * khối nào chỉ có `rounded-* border` mà không có `bg-*` đều để hoa văn đó xuyên
 * qua: chữ chìm, viền chìm, và trang trông như bị mờ. Đã xảy ra ba lần — bảng
 * Bản build, danh sách lượt chạy local, rồi các thẻ trong lịch sử — nên nó là
 * một dạng lỗi lặp lại chứ không phải sự cố lẻ.
 *
 * Test đọc mã thay vì render, vì thứ cần chặn là một khối MỚI mọc ra ở đâu đó
 * thiếu nền, chứ không phải trạng thái hiện tại của một trang cụ thể.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : walk(full);
    return /\.tsx$/.test(name) ? [full] : [];
  });

/** Chỉ xét khối có padding — tức là một BỀ MẶT chứa nội dung, không phải viền trang trí. */
const SURFACE = /className="([^"]*\brounded-(?:lg|xl)\b[^"]*\bborder\b[^"]*\bp-[0-9][^"]*)"/g;

describe('bề mặt nội dung không để nền xuyên qua', () => {
  it('mọi khối bo góc có viền và padding đều khai màu nền', () => {
    const offenders: string[] = [];
    for (const file of walk(path.resolve('ui/src/panels'))) {
      const code = readFileSync(file, 'utf8');
      for (const m of code.matchAll(SURFACE)) {
        const cls = m[1]!;
        if (!/\bbg-[a-z]/.test(cls)) {
          offenders.push(`${path.relative(path.resolve('ui/src'), file)}: ${cls.slice(0, 60)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
