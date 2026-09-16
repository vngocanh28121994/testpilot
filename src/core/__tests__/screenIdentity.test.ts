/**
 * Định danh màn hình phải do locator CHÍNH XÁC trả lời.
 *
 * Một locator khớp theo chuỗi con trả lời tốt câu "bấm cái nào" — và đã chứng
 * minh hàng trăm lần, nên không có lý do gì cấm nó ở đó. Nó chỉ sai đúng một
 * chỗ: khi được hỏi "đang ở màn hình nào". Lúc ấy bất kỳ câu văn nào chứa cụm
 * từ cũng thành bằng chứng, kể cả câu nằm trong menu của một màn hình khác.
 *
 * Đo trên máy thật ngày 2026-09-15: `:text('Cơ sở')` khớp dòng mô tả "Công cụ
 * phòng ngừa rủi ro giảm giá cho CK Cơ sở bằng HĐ phái sinh" trong menu tính
 * năng của Home — hai phần tử, cả hai đang hiển thị. Runner kết luận Bảng giá
 * đã mở sẵn, bỏ qua điều hướng, và bốn kịch bản liên tiếp cùng hỏng ở bước bấm
 * "Thêm mã" trên một màn hình không hề có nút ấy.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchesByContainment } from '../locatorQuality.js';
import type { LocatorCandidate } from '../types.js';

const css = (value: string): LocatorCandidate =>
  ({ strategy: 'css', value, weight: 0.9, origin: 'authored' });

describe('bằng chứng "đang ở màn hình nào"', () => {
  it('locator khớp chuỗi con không có phạm vi thì không định danh được màn hình', () => {
    assert.equal(matchesByContainment(css(":text('Cơ sở')")), true);
    // Tên thẻ đứng một mình không phải phạm vi: trang nào cũng có button.
    assert.equal(matchesByContainment(css("button:has-text('THÊM MÃ')")), true);
    assert.equal(matchesByContainment(css(':text-matches("Cơ sở.*")')), true);
  });

  it('một phạm vi thật thu hẹp việc chứa về một vùng màn hình', () => {
    assert.equal(
      matchesByContainment(css('[data-walkthrough="mb-header-segment"] :has-text("Cơ sở")')),
      false,
    );
    assert.equal(matchesByContainment(css('#wt-filter-tcprice-el-mb :text("Cơ sở")')), false);
  });

  it('so khớp chính xác vẫn dùng được, kể cả khi không có phạm vi', () => {
    assert.equal(matchesByContainment(css(':text-is("Cơ sở")')), false);
    assert.equal(matchesByContainment(css("tcbs-icon[name='Circle add']")), false);
  });

  /**
   * Native dịch những strategy này thành CONTAINS, nên chúng lỏng ở đúng cái
   * nghĩa đang bàn — dù trên web cùng strategy ấy có thể là khớp chính xác.
   * Một landmark bị loại nhầm chỉ khiến runner đi đường điều hướng bình thường;
   * một landmark được nhận nhầm khiến cả kịch bản chạy trên màn hình sai.
   */
  it('theo cách native biên dịch: placeholder, role có tên, predicate textContains đều lỏng', () => {
    assert.equal(matchesByContainment(
      { strategy: 'placeholder', value: 'Tìm kiếm', weight: 0.8, origin: 'authored' },
    ), true);
    assert.equal(matchesByContainment(
      { strategy: 'role', value: 'button', name: 'Cơ sở', weight: 0.8, origin: 'authored' },
    ), true);
    assert.equal(matchesByContainment({
      strategy: 'predicate',
      value: 'new UiSelector().textContains("Cơ sở")',
      weight: 0.7,
      origin: 'authored',
    }), true);
    assert.equal(matchesByContainment({
      strategy: 'predicate',
      value: 'new UiSelector().text("Cơ sở")',
      weight: 0.9,
      origin: 'authored',
    }), false);
  });

  /**
   * `label` có HAI arm chứa-chuỗi, không phải một: arm cây con
   * (labelSplitAcrossChildrenXPath, từ hai chữ) và arm nới lỏng
   * (labelContainsXPath, từ ba chữ). Ranh giới phải lấy từ chính hai hàm ấy.
   *
   * Bản đầu của luật chỉ chép ngưỡng ba chữ, nên `label="Cơ sở"` lọt qua và
   * lượt chạy thật sau khi vá vẫn hỏng y hệt lượt trước: arm cây con khớp đúng
   * dòng mô tả cũ trên màn hình Home.
   */
  it('label lỏng ngay từ hai chữ — ngưỡng của arm cây con', () => {
    assert.equal(matchesByContainment(
      { strategy: 'label', value: 'Đóng', weight: 0.75, origin: 'authored' },
    ), false);
    assert.equal(matchesByContainment(
      { strategy: 'label', value: 'Cơ sở', weight: 0.75, origin: 'authored' },
    ), true);
    assert.equal(matchesByContainment(
      { strategy: 'label', value: 'Đã lưu lệnh vào Sổ lệnh', weight: 0.75, origin: 'authored' },
    ), true);
  });
});
