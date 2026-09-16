/**
 * Registry sinh ra hai bản ghi cho cùng một control, và đó là chuyện tự nhiên:
 * mỗi feature mới đặt lại tên control cũ theo cách kịch bản mới gọi nó. Bản
 * mới bắt đầu từ locator yếu, chưa từng chứng minh được gì, trong khi bản cũ
 * ngay cạnh đã có locator tốt và hàng chục lần thắng — nên lượt chạy hỏng ở
 * bản mới trong khi cách chữa nằm sẵn trong registry dưới tên khác.
 *
 * Bằng chứng duy nhất được chấp nhận ở đây là lịch sử thắng. Suy từ tên gọi
 * thôi thì không đủ, và hai ngưỡng dưới đây tồn tại vì mỗi ngưỡng giết một
 * kiểu kết luận sai khác nhau — cả hai đều đo được trên registry thật.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findDuplicateElements } from '../duplicateElements.js';
import type { ElementDef } from '../types.js';

const el = (
  id: string,
  label: string,
  winners: Record<string, number>,
): [string, ElementDef] => [id, {
  id,
  label,
  candidates: {},
  screen: 'x',
  health: { resolutions: Object.values(winners).reduce((a, b) => a + b, 0), heals: 0, winners },
} as ElementDef];

const registry = (...entries: Array<[string, ElementDef]>): Record<string, ElementDef> =>
  Object.fromEntries(entries);

describe('tìm element trùng vai bằng bằng chứng', () => {
  /**
   * Cặp thật trên registry: cùng thắng bằng `label:Xoá khỏi danh mục`, 100%
   * lịch sử của cả hai bên. Vị trí dấu thanh khác nhau ("Xoá"/"Xóa") không
   * được phép làm hai bản ghi trông như hai control.
   */
  it('cùng thắng bằng một locator riêng biệt thì là một control', () => {
    const pairs = findDuplicateElements(registry(
      el('priceBoard.xoaKhoiDanhMuc', 'Xoá khỏi danh mục', { 'label:Xoá khỏi danh mục': 41 }),
      el('stockOptionsMenu.removeFromCategory', 'Tùy chọn Xóa khỏi danh mục', { 'label:Xóa khỏi danh mục': 3 }),
    ));
    assert.equal(pairs.length, 1);
    // Bên nhiều lịch sử hơn là bản gốc; bản trùng luôn là bản sinh sau.
    assert.equal(pairs[0]!.strong, 'priceBoard.xoaKhoiDanhMuc');
    assert.equal(pairs[0]!.weak, 'stockOptionsMenu.removeFromCategory');
    // Khoá nguyên văn giữ đúng dấu của bên gốc, vì `sharedLocator` đã bỏ dấu
    // để so sánh được nên không dựng ngược lại thành locator.
    assert.equal(pairs[0]!.strongKey, 'label:Xoá khỏi danh mục');
  });

  /**
   * `label:add` là chữ trên một icon, không phải danh tính. Trên registry thật
   * nó là 100% lịch sử của CẢ "Nút thêm mới báo cáo" lẫn "Nút nổi thêm thẻ" —
   * hai nút khác hẳn nhau — nên ngưỡng "đường chính" không cứu được ở đây. Tên
   * nghiệp vụ mới là thứ tách chúng ra.
   */
  it('tên nghiệp vụ không trùng nghĩa thì không kết luận, dù locator giống nhau', () => {
    const pairs = findDuplicateElements(registry(
      el('myReports.addReportButton', 'Nút thêm mới báo cáo', { 'label:add': 29 }),
      el('reportTemplateEditor.addCardButton', 'Nút nổi thêm thẻ', { 'label:add': 15 }),
    ));
    assert.deepEqual(pairs, []);
  });

  /**
   * Chiều ngược lại: tên trùng nghĩa nhưng locator chung chỉ là một lần trúng
   * lạc. `placeholder:tìm kiếm` thắng 1/1073 lượt của "Nút tìm kiếm" và 2/1101
   * của "Kết quả tìm kiếm đầu tiên" — hai control khác hẳn nhau.
   */
  it('locator chỉ trúng lạc vài lần thì không phải bằng chứng', () => {
    const pairs = findDuplicateElements(registry(
      el('home.searchBox', 'Nút tìm kiếm', { 'label:Tìm kiếm': 1072, 'placeholder:Tìm kiếm': 1 }),
      el('home.searchFirstResult', 'Kết quả tìm kiếm đầu tiên', { 'css:.result': 1099, 'placeholder:Tìm kiếm': 2 }),
    ));
    assert.deepEqual(pairs, []);
  });

  /**
   * Locator thắng cho càng nhiều element thì càng không nói được element nào.
   * `role:button` trên registry thật thắng cho 6 element khác nhau.
   */
  it('locator thắng cho từ ba element trở lên là chung chung, không định danh', () => {
    const pairs = findDuplicateElements(registry(
      el('a.submit', 'Nút gửi biểu mẫu', { 'role:button': 50 }),
      el('b.submit', 'Nút gửi biểu mẫu', { 'role:button': 40 }),
      el('c.submit', 'Nút gửi biểu mẫu', { 'role:button': 30 }),
    ));
    assert.deepEqual(pairs, []);
  });

  /** Locator có tham số chạy theo từng dòng, không nói gì về danh tính. */
  it('bỏ qua locator có tham số', () => {
    const pairs = findDuplicateElements(registry(
      el('home.dynamicText', 'Chữ động', { 'label:{{text}}': 515 }),
      el('priceBoard.dynamicText', 'Chữ động', { 'label:{{text}}': 7 }),
    ));
    assert.deepEqual(pairs, []);
  });
});
