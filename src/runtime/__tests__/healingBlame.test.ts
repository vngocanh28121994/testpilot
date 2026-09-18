/**
 * Bước sau hỏng không mặc nhiên là lỗi của bước trước.
 *
 * Healing chỉ nhìn thấy "màn hình mong đợi không có" và mặc định suy ra
 * "locator vừa bấm là thủ phạm". Suy luận ấy chỉ đúng khi hậu điều kiện CÓ THỂ
 * được nhìn thấy.
 *
 * Đo trên máy thật 2026-09-16, feature Thêm mới template báo cáo trên android:
 *
 *     [discovery] "addCardSheet.cardMonthlyProfit": tìm được sau khi chờ thêm
 *     [learn:new]  … đã chứng minh bằng kết quả action.
 *     [learn:rejected] "addCardSheet.cardMonthlyProfit" … kết quả action chứng minh locator sai
 *     [healing] "Thẻ Lợi nhuận theo tháng": locator xpath did not produce
 *               "I click "Nút đóng popup Thêm thẻ""
 *     [cdp] xpath="…'Tài sản'" khớp 4 phần tử       ← đi thử một thẻ KHÁC
 *
 * Cú bấm thẻ đúng, discovery vừa học được locator và tự chứng minh bằng kết quả
 * action. Thứ hỏng là bước SAU nó — `addCardSheet.closeButton`, 0 resolutions,
 * không locator trên nền tảng nào. Nhưng healing gỡ bỏ locator vừa học rồi đi
 * bấm thẻ "Tài sản". Cả hai lượt chạy lặp lại y hệt.
 *
 * Cùng bài học với nhánh `saidSince` ngay phía trên nó: khi có bằng chứng thủ
 * phạm nằm chỗ khác, đừng đổ cho element vừa bấm.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const executor = readFileSync('src/runtime/executor.ts', 'utf8');

const guard = (() => {
  const at = executor.indexOf('private expectationCanAccuse(');
  assert.ok(at > 0, 'không thấy expectationCanAccuse');
  return executor.slice(at, executor.indexOf('\n  }', at));
})();

describe('healing đổ lỗi cho ai', () => {
  it('chỉ xét đúng lỗi "không tìm thấy" của chính element hậu điều kiện', () => {
    // Lỗi khác — sai giá trị, app từ chối — vẫn nói được điều gì đó về cú bấm,
    // nên không được tha bừa.
    assert.match(guard, /err instanceof ElementNotFoundError/);
    assert.match(guard, /err\.elementId !== expectation\.elementId/);
  });

  /**
   * Hai lối thoát, và cần cả hai: có locator cho nền tảng này, HOẶC đã từng
   * resolve ở đâu đó. `cardMonthlyProfit` không có locator android nhưng đã
   * resolve 16 lần trên web — discovery có căn cứ để tìm, nên nó vẫn buộc tội
   * được như cũ.
   */
  it('element đã từng nhìn thấy thì vẫn buộc tội được', () => {
    assert.match(guard, /hasLocator \|\| everResolved/);
    assert.match(guard, /candidates\?\.\[this\.driver\.platform\]/);
    assert.match(guard, /health\?\.resolutions/);
  });

  it('không buộc tội được thì giữ nguyên locator và dừng, không thử ứng viên khác', () => {
    const at = executor.indexOf('if (this.expectationCanAccuse(');
    assert.ok(at > 0, 'guard phải được dùng ở nhánh hỏng của postcondition');
    const body = executor.slice(at, at + 800);
    assert.match(body, /this\.resolver\.rejectResolution\(elementId, r\);/);
    assert.match(body, /giữ nguyên locator/);
    // Dừng hẳn: thử ứng viên khác nghĩa là đi bấm một control khác trên tài
    // khoản thật, cho một kết luận ta vừa thừa nhận là không rút ra được.
    assert.match(body, /giữ nguyên locator[\s\S]{0,260}break;/);
  });
});
