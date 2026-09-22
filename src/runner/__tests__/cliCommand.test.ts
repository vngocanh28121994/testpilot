/**
 * Lệnh chạy CLI đổi theo chỗ mã đang nằm.
 *
 * Bài này canh một thứ chỉ hỏng trên máy NGƯỜI KHÁC. Trong lúc phát triển,
 * thư mục làm việc tình cờ luôn là gốc repo, nên
 * `path.resolve('node_modules/.bin/tsx')` chạy suốt. Trên một chiếc máy cài
 * runner từ npm thì không có `src/`, không có `tsx`, và thư mục làm việc là
 * bất kỳ đâu — lượt chạy đầu tiên hỏng bằng ENOENT, thứ không nói được gì về
 * nguyên nhân.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { cliCommand } from '../execute.js';

describe('phân giải CLI', () => {
  it('chạy từ mã nguồn thì dùng tsx với file .ts cạnh mình', () => {
    // Bài test này CHÍNH NÓ chạy từ mã nguồn, nên đây là ca đang diễn ra.
    const { bin, entry } = cliCommand('run');
    assert.ok(entry.endsWith(path.join('cli', 'run.ts')), `entry lạ: ${entry}`);
    assert.ok(bin.endsWith(path.join('.bin', 'tsx')), `bin lạ: ${bin}`);
    assert.ok(existsSync(entry), 'file CLI phải có thật cạnh mã nguồn');
  });

  it('đường dẫn tính theo vị trí file, KHÔNG theo thư mục làm việc', () => {
    const before = process.cwd();
    try {
      process.chdir(path.parse(before).root);
      const { entry } = cliCommand('run-parallel');
      assert.ok(existsSync(entry), 'đổi thư mục làm việc không được làm mất file CLI');
    } finally {
      process.chdir(before);
    }
  });
});
