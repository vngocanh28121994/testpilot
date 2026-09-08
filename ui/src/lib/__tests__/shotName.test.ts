import { describe, expect, it } from 'vitest';
import { shotLabel } from '../shotName';

/**
 * Giao diện thay toàn bộ tên ảnh lỗi bằng đúng hai chữ "khi fail" cho MỌI ảnh —
 * nên một lượt chạy có bảy kịch bản fail cho ra bảy tấm mang cùng một nhãn,
 * không tấm nào tự nhận là của kịch bản nào. Chính phần cần nhất lại bị vứt đi.
 */
describe('shotLabel', () => {
  it('lấy lại tên kịch bản và dòng lỗi từ tên file', () => {
    expect(shotLabel('chuyen-tien-noi-bo-nhap-so-tien-vuot-qua-a1-l7-fail', true)).toEqual({
      scenario: 'chuyen tien noi bo nhap so tien vuot qua',
      detail: 'lúc fail · dòng 7',
    });
  });

  /** Gần như mọi ảnh đều là lần thử đầu; "lần 1" ở mọi dòng chỉ tổ phải bỏ qua. */
  it('chỉ nói lần thử khi nó lớn hơn một', () => {
    expect(shotLabel('abc-a1-l3-fail', true).detail).toBe('lúc fail · dòng 3');
    expect(shotLabel('abc-a2-l3-fail', true).detail).toBe('lúc fail · dòng 3 · lần thử 2');
  });

  it('ảnh do kịch bản tự đặt tên thì giữ nguyên tên đó', () => {
    expect(shotLabel('man-hinh-xac-nhan', false)).toEqual({
      scenario: '',
      detail: 'man-hinh-xac-nhan',
    });
  });

  it('ảnh lỗi không theo dạng chuẩn thì vẫn nói là lúc fail', () => {
    expect(shotLabel('tap-declined-1788842133277', true).detail).toBe(
      'lúc fail · tap-declined-1788842133277',
    );
  });

  it('hai kịch bản khác nhau cho hai nhãn khác nhau', () => {
    const a = shotLabel('kich-ban-mot-a1-l5-fail', true);
    const b = shotLabel('kich-ban-hai-a1-l5-fail', true);
    expect(a.scenario).not.toBe(b.scenario);
  });
});
