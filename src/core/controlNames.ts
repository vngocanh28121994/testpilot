/**
 * Tên nghiệp vụ của một control, rút về những chữ thực sự nói control ấy là gì.
 *
 * Dùng chung cho hai câu hỏi khác nhau nhưng cùng dựa trên một phép rút: "có
 * element nào trên màn hình này cùng nghĩa không" (resolver) và "hai element
 * này có phải một control không" (duplicateElements). Trước đây chỉ resolver có
 * phép rút ấy, nằm private trong file của nó — nên câu hỏi thứ hai hoặc phải
 * chép lại, hoặc phải nghĩ ra một phép rút thứ hai rồi trôi khỏi phép thứ nhất.
 */

/** Words that describe how to operate a control, not which control it is. */
const CONTROL_ACTION_WORDS = new Set([
  'mo', 'open', 'bam', 'click', 'tap', 'chon', 'select', 'nut', 'button',
  'icon', 'dropdown', 'menu', 'tai', 'dong', 'o', 'truong', 'field',
]);

export function semanticControlTokens(value: string): string[] {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('vi-VN')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 1 && !CONTROL_ACTION_WORDS.has(token));
}

/**
 * Hai tên nghiệp vụ nói về cùng một control.
 *
 * Bao hàm một chiều là đủ, và cố ý không đòi bằng nhau: cùng một control
 * thường được hai bản nháp đặt tên với một chữ bổ nghĩa thừa ra —
 * "Xoá khỏi danh mục" và "Tùy chọn Xóa khỏi danh mục" — trong khi vị trí dấu
 * thanh ("Xoá"/"Xóa") thì phép rút ở trên đã xoá bỏ từ trước.
 */
export function controlNamesAgree(a: string, b: string): boolean {
  const ta = new Set(semanticControlTokens(a));
  const tb = new Set(semanticControlTokens(b));
  if (ta.size === 0 || tb.size === 0) return false;
  return [...ta].every((t) => tb.has(t)) || [...tb].every((t) => ta.has(t));
}
