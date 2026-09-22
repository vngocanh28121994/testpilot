/**
 * Đầu trang phải nói cùng một câu với mục menu dẫn tới nó.
 *
 * Bài này canh một thứ nhỏ và dễ trôi: tên trang từng được gõ ở HAI chỗ — một
 * lần trong `NAV`, một lần trong `AppShell title=` của chính trang — nên menu
 * nói "Thiết bị & hàng đợi" còn đầu trang nói "Thiết bị và hàng đợi", menu nói
 * "Device Farm" còn đầu trang nói "AWS Device Farm". Không ai gõ sai; hai chuỗi
 * ấy chỉ được gõ vào hai ngày khác nhau.
 *
 * Và mọi trang phải có `description`. Câu phụ ấy là chỗ duy nhất trả lời "trang
 * này để làm gì" cho người mới mở nó; trang thiếu nó trông như bị cắt dở.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NAV } from '@/lib/nav';

const PANELS = path.resolve(__dirname, '../../../panels');

/** Đọc mã của một panel, bỏ phần bình luận để không tự khớp với chính mình. */
function codeOf(file: string): string {
  return fs
    .readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function panelFiles(): string[] {
  return fs
    .readdirSync(PANELS)
    .map((dir) => path.join(PANELS, dir, 'index.tsx'))
    .filter((file) => fs.existsSync(file) && codeOf(file).includes('<AppShell'));
}

describe('tiêu đề trang theo một nguồn', () => {
  it('trang có mục trong menu thì lấy tên từ navTitle, không gõ lại', () => {
    const labels = new Set(NAV.map((item) => item.label));
    const retyped: string[] = [];
    for (const file of panelFiles()) {
      for (const [, title] of codeOf(file).matchAll(/title="([^"]+)"/g)) {
        if (title && labels.has(title)) retyped.push(`${path.basename(path.dirname(file))}: "${title}"`);
      }
    }
    expect(retyped, 'dùng navTitle(id) thay vì gõ lại tên đã có trong NAV').toEqual([]);
  });

  it('mọi trang đều có câu mô tả cạnh tiêu đề', () => {
    const missing = panelFiles()
      .filter((file) => {
        const code = codeOf(file);
        const shell = code.slice(code.indexOf('<AppShell'));
        return !shell.slice(0, shell.indexOf('>')).includes('description');
      })
      .map((file) => path.basename(path.dirname(file)));
    expect(missing).toEqual([]);
  });
});
