/**
 * Tên ảnh chụp, đọc được cho người.
 *
 * Executor đặt tên ảnh lỗi theo dạng
 *   <slug-kịch-bản>-a<lần thử>-l<dòng>-fail
 * ví dụ `chuyen-tien-noi-bo-nhap-so-tien-vuot-qua-a1-l7-fail`.
 *
 * Giao diện trước đây thay toàn bộ tên đó bằng đúng hai chữ "khi fail" cho MỌI
 * ảnh lỗi — nên một lượt chạy có bảy kịch bản fail cho ra bảy tấm ảnh mang cùng
 * một nhãn, không tấm nào tự nhận là của kịch bản nào. Chính phần cần nhất lại
 * là phần bị vứt đi.
 */
export interface ShotLabel {
  /** Slug kịch bản, đã trả về dạng có dấu cách. */
  scenario: string;
  /** Mô tả ngắn: "lúc fail · dòng 7", hoặc chính tên ảnh do kịch bản tự đặt. */
  detail: string;
}

const FAIL = /^(.*)-a(\d+)-l(\d+)-fail$/;

export function shotLabel(name: string, onFailure: boolean): ShotLabel {
  const match = FAIL.exec(name);
  if (match) {
    const [, slug, attempt, line] = match;
    return {
      scenario: humanise(slug!),
      // Lần thử chỉ nói khi lớn hơn một: gần như mọi ảnh đều là lần thử đầu, và
      // "lần 1" ở mọi dòng là thứ mắt phải bỏ qua mỗi lần đọc.
      detail: `lúc fail · dòng ${line}${Number(attempt) > 1 ? ` · lần thử ${attempt}` : ''}`,
    };
  }
  // Ảnh do chính kịch bản đặt tên thì tên ấy đã là câu người viết ra.
  return { scenario: '', detail: onFailure ? `lúc fail · ${name}` : name };
}

function humanise(slug: string): string {
  return slug.replace(/-/g, ' ').trim();
}
