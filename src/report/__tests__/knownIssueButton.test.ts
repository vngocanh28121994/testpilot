/**
 * Người ta biết một kịch bản là Known issue SAU KHI đọc report — biết trước lúc
 * sinh kịch bản thì đã không cần nhãn. Nên nút gắn nhãn phải nằm ngay trong
 * report, cạnh chính kịch bản đỏ; bắt họ nhớ tên rồi đi tìm màn hình khác để
 * ghi lại nghĩa là phần lớn sẽ không ai ghi.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const html = readFileSync('src/report/html.ts', 'utf8');

describe('report — nút Known issue', () => {
  it('chỉ mọc ở kịch bản đỏ, không mọc ở kịch bản xanh', () => {
    assert.match(
      html,
      /const mark = r\.verdict === 'failed'[\s\S]{0,200}data-scenario/,
      'nút phải gắn theo verdict failed và mang scenario id',
    );
  });

  it('khoá theo scenario id, vì report không mang tên file feature', () => {
    assert.match(html, /data-scenario="\$\{esc\(r\.scenario\.id\)\}"/);
    assert.match(html, /scenarioId: button\.dataset\.scenario/);
  });

  it('bắt buộc nhập lý do trước khi gửi', () => {
    assert.match(html, /if \(!note \|\| !note\.trim\(\)\) return;/);
  });

  /**
   * Report còn được mở thẳng từ đĩa, nơi không có server nào để gọi. Trường hợp
   * đó phải nói ra, không được im lặng như thể đã lưu.
   */
  it('nói rõ khi mở bằng file:// thay vì lặng lẽ hỏng', () => {
    assert.match(html, /location\.protocol === 'file:'/);
    assert.match(html, /Mở report qua TestPilot để gắn nhãn/);
  });

  it('lỗi hiện ngay trên nút, không quay về như chưa bấm', () => {
    assert.match(html, /button\.textContent = 'Lỗi: ' \+ err\.message/);
  });
});
