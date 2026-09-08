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
  it('chỉ mời gắn nhãn ở kịch bản đỏ chưa có nhãn', () => {
    assert.match(
      html,
      /r\.verdict === 'failed'[\s\S]{0,220}data-scenario/,
      'lời mời phải gắn theo verdict failed và mang scenario id',
    );
  });

  /**
   * Bản đầu dùng cùng một chữ "Known issue" cho cả nhãn đã gắn lẫn lời mời gắn,
   * nên mọi dòng fail trông như đang mang nhãn dù chưa ai đánh dấu gì — bảy dòng
   * "Known issue" trong một report mà thực tế mới có một.
   */
  it('phân biệt nhãn ĐÃ gắn với lời MỜI gắn', () => {
    assert.match(html, /knownIssueNote !== undefined/, 'không đọc nhãn đã gắn');
    assert.match(html, /⚠ Known issue<\/span>/, 'nhãn đã gắn phải là một span, không phải nút');
    assert.match(html, /\+ Đánh dấu<\/button>/, 'lời mời phải nói rõ là hành động');
  });

  /**
   * Cột riêng, không bám sau tên kịch bản: tên dài ngắn khác nhau nên nhãn mỗi
   * dòng một vị trí, mắt không quét được thành cột.
   */
  it('nhãn nằm ở cột riêng để thẳng hàng', () => {
    assert.match(html, /<th>Known issue<\/th>/);
    assert.match(html, /<td class="ki-col">\$\{mark\}<\/td>/);
  });

  it('nhãn đã gắn mang theo lý do', () => {
    assert.match(html, /title="\$\{esc\(knownIssueNote\)\}"/);
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
