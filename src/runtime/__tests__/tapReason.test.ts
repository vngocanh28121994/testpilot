/**
 * Dòng log lúc bấm hỏng phải nói ra vì sao.
 *
 * Chuyện thật: một lượt chạy iOS hỏng ở bước mở chức năng từ tìm kiếm, và dòng
 * log chỉ ghi `[tap] "Kết quả tìm kiếm đầu tiên": bấm lỗi`. Để biết lý do đã
 * phải đi đọc 19 file cây XML kèm ảnh chụp mới thấy màn hình đang hiện "Không
 * tìm thấy kết quả" — tức là không có gì để bấm. Câu đó vốn nằm sẵn trong lỗi
 * của driver, chỉ là dòng log vứt nó đi.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const source = readFileSync('src/runtime/executor.ts', 'utf8');

describe('log lúc bấm hỏng', () => {
  it('kèm nguyên văn lý do của driver, không chỉ "bấm lỗi"', () => {
    assert.match(source, /\[tap\] "\$\{actionLabel\}": \$\{driverReason\(error\)\}/);
    assert.match(source, /function driverReason\(error: unknown\): string/);
  });

  /**
   * Cắt ngắn là chủ đích: WebdriverIO đính kèm cả trang gợi ý và link tài liệu
   * vào message, dán nguyên vào thì dòng log dài hơn màn hình và không ai đọc.
   */
  it('cắt ở dòng đầu và 160 ký tự', () => {
    const fn = source.slice(source.indexOf('function driverReason'));
    assert.match(fn, /split\('\\n'\)/);
    assert.match(fn, /slice\(0, 160\)/);
  });

  it('lượt thử lại của tìm kiếm cũng nói lý do', () => {
    // Câu lệnh trải trên nhiều dòng, nên mẫu phải bước qua được xuống dòng.
    assert.match(source, /chưa mở được trang đích[\s\S]{0,120}lastError\.message/);
  });
});
