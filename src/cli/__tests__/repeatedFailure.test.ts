/**
 * Cả bộ chết vì cùng một thứ thì đừng trả đủ giá cho từng kịch bản.
 *
 * Đo trên một lượt thật: chín kịch bản đều hỏng ở bước mở chức năng từ tìm kiếm
 * vì app báo "Không tìm thấy kết quả". Lượt chạy mất 48 phút để nói đúng cái
 * điều mà năm phút đầu đã nói xong — phần lớn là chờ hết giờ cho một phần tử
 * không bao giờ xuất hiện, rồi thử lại, rồi healing thử tiếp, nhân cho chín.
 *
 * Ngưỡng là ba chứ không phải hai: hai lần giống nhau vẫn có thể là trùng hợp
 * (một màn hình dùng chung như đăng nhập chập chờn), ba lần liên tiếp thì không
 * còn là chuyện của riêng kịch bản nào nữa.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const source = readFileSync('src/cli/run.ts', 'utf8');

describe('dừng sớm khi lặp lại cùng một lỗi', () => {
  it('ngưỡng là ba kịch bản liên tiếp', () => {
    assert.match(source, /const REPEATED_FAILURE_LIMIT = 3;/);
    assert.match(source, /repeatedFailures >= REPEATED_FAILURE_LIMIT/);
  });

  /**
   * Dấu vân phải gồm CẢ bước lẫn lý do. Chỉ lấy bước thì hai lỗi khác hẳn nhau
   * ở cùng một dòng bị gộp làm một; chỉ lấy lý do thì một câu lỗi chung chung
   * ("element not found") gộp mất những chỗ hỏng thật sự khác nhau.
   */
  it('dấu vân gồm cả bước lẫn dòng đầu của lý do', () => {
    assert.match(source, /failedStep\.step\.text/);
    assert.match(source, /failedStep\.error\?\.message\.split\('\\n'\)\[0\]/);
  });

  it('đếm lại từ đầu khi gặp một lỗi khác', () => {
    assert.match(source, /repeatedFailures = signature \? 1 : 0;/);
  });

  /** Dừng mà không nói rõ dừng vì cái gì thì chỉ đổi một nỗi bực này lấy một nỗi khác. */
  it('nói ra bước nào, lý do gì, và phải làm gì', () => {
    assert.match(source, /\[run:abort\][\s\S]{0,400}Bước: /);
    assert.match(source, /Sửa chỗ đó rồi chạy lại/);
  });
});
