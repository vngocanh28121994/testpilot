/**
 * Gói runner cài bằng npm trên máy khác chết ngay dòng đầu: file trong `bin`
 * thiếu shebang, nên shell chạy nó như script shell ("/**: is a directory").
 *
 * Dựng cả gói trong test thì chậm, nên kiểm hai điều đủ để chặn lỗi quay lại:
 * bộ gom gói tự thêm shebang cho mọi lệnh trong `bin`, và `bin` chỉ khai ở
 * đúng một chỗ (không có danh sách thứ hai bị quên).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const source = readFileSync('packaging/collect-runner.mjs', 'utf8');

describe('gói runner: lệnh trong bin chạy thẳng được', () => {
  it('thêm shebang và quyền chạy cho mọi file trong BIN', () => {
    assert.match(source, /for \(const rel of Object\.values\(BIN\)\)/);
    assert.match(source, /#!\/usr\/bin\/env node/);
    assert.match(source, /chmodSync\(file, 0o755\)/);
  });

  it('package.json dùng đúng danh sách BIN ấy', () => {
    assert.match(source, /bin: BIN,/);
  });
});
