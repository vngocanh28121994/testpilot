import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Đường dẫn tính từ chính file test: vitest chạy với cwd là thư mục ui/. */
const here = path.dirname(new URL(import.meta.url).pathname);

/**
 * Giới hạn phạm vi trên farm từng phải tự gõ tay hai lần.
 *
 * Người dùng phải tự nhớ đúng tên biến `TESTPILOT_TAG`, rồi tự gõ đúng tên tag
 * vào ô "giá trị" bên cạnh. Gõ sai một ký tự thì farm lặng lẽ chạy cả bộ — và
 * chỉ biết sau vài chục phút cùng tiền thiết bị đã tiêu.
 *
 * Test đọc mã nguồn vì màn Farm cần cả router lẫn nhiều truy vấn; thứ đáng canh
 * ở đây là các mắt nối, không phải việc dựng lại cả màn hình.
 */
const source = readFileSync(path.join(here, '..', 'index.tsx'), 'utf8');

describe('Farm — lọc theo tag', () => {
  it('dùng chung ô chọn tag với Local Runner', () => {
    expect(source).toMatch(/import \{ TagFilter \}/);
    expect(source).toMatch(/<TagFilter all=\{allTags\} value=\{farmTags\} onChange=\{setFarmTags\}/);
  });

  it('ghi vào đúng biến mà testspec đọc, nối bằng dấu cộng', () => {
    expect(source).toMatch(/const FARM_TAG_VAR = 'TESTPILOT_TAG';/);
    expect(source).toMatch(/value: next\.join\('\+'\)/);
    expect(readFileSync(path.join(here, '../../../../..', 'farm/testspec.yml'), 'utf8')).toMatch(/--tag "\$TESTPILOT_TAG"/);
  });

  /** Một giá trị, hai ô sửa là cách chắc chắn để hai ô nói khác nhau. */
  it('ẩn dòng đó khỏi bảng biến môi trường chung', () => {
    expect(source).toMatch(/form\.env\.filter\(\(entry\) => entry\.key !== FARM_TAG_VAR\)/);
  });

  it('bỏ hết tag thì xoá luôn biến, không để lại chuỗi rỗng', () => {
    expect(source).toMatch(/next\.length > 0 \? \[\{ key: FARM_TAG_VAR/);
  });
});
