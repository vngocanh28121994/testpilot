import type { ObservedElement } from '../UiObservation.js';

/**
 * Suy ra locator từ một phần tử đã quan sát.
 *
 * Ở một chỗ duy nhất vì đã có ba bản sao: tầng ngữ nghĩa, tầng vision, và
 * adapter của MCP. Sửa một bản thì hai bản kia vẫn sai — đúng kiểu lỗi mà một
 * lượt chạy thật phải trả giá: model chọn ĐÚNG ô nhập ba lượt liền, và cả ba
 * lượt locator vẫn khai sai loại.
 */
/**
 * Phần tử này có phải một ô nhập không.
 *
 * Xét cả vai trò web (`input`, `textarea`) lẫn native (`EditText`,
 * `XCUIElementTypeTextField`): cùng một bộ discovery chạy trên cả hai, và một
 * ô nhập ở đâu thì cũng là ô nhập.
 */
function isField(el: ObservedElement): boolean {
  const role = (el.role ?? '').toLowerCase();
  return /input|textarea|textbox|searchfield|edittext|textfield|securetextfield/.test(role);
}

/**
 * Chuỗi gợi ý của một ô nhập đang rỗng, dù nó đi ra ở trường nào.
 *
 * DOM để nó ở `placeholder`. Cây native của Android để ở `text`, đôi khi ở
 * content-desc. Ô đã có người gõ vào thì `value` khác rỗng — lúc đó chuỗi nhìn
 * thấy là dữ liệu, không phải gợi ý, và khai nó thành placeholder là sai.
 */
function placeholderCuaField(el: ObservedElement): string | undefined {
  if (!isField(el) || el.value) return undefined;
  return el.placeholder || el.text || el.accessibilityLabel || undefined;
}

/**
 * Chốt locator cuối cùng: lấy đề xuất của model, nhưng sửa chỗ nó khai sai loại.
 *
 * `candidate.suggestedLocator ?? deriveLocator(el)` nghĩa là khi model tự đề
 * xuất, mọi hiểu biết trong deriveLocator bị bỏ qua. Đo trên máy thật ba lượt
 * liên tiếp: model chọn ĐÚNG ô nhập (tin cậy 85 → 95 → 90) rồi khai
 * `label="TCB,VNM,FPT…"` — chuỗi đó là hint của ô, mà `label` khớp chữ hiển thị
 * hoặc aria-label, nên locator không bao giờ khớp. Có lượt nó gán đúng chuỗi ấy
 * cho cả một cái nút.
 *
 * Đây không phải chuyện chọn sai phần tử, mà là khai sai LOẠI. Sửa được tại chỗ
 * vì chúng ta đang cầm chính phần tử đã quan sát: hint của một ô nhập rỗng thì
 * phải khai là placeholder, dù model gọi nó là gì.
 */
export function refineLocator(
  el: ObservedElement,
  suggested?: { strategy: string; value: string },
): { strategy: string; value: string } | undefined {
  if (!suggested) return deriveLocator(el);
  const hint = placeholderCuaField(el);
  const khaiTheoChu = suggested.strategy === 'label'
    || suggested.strategy === 'text'
    || suggested.strategy === 'accessibility';
  if (hint && khaiTheoChu && suggested.value.trim() === hint.trim()) {
    return { strategy: 'placeholder', value: hint };
  }
  return suggested;
}

export function deriveLocator(
  el: ObservedElement,
): { strategy: string; value: string } | undefined {
  if (el.testId) return { strategy: 'testId', value: el.testId };
  if (el.resourceId) return { strategy: 'resourceId', value: el.resourceId };
  // Ô nhập được xét TRƯỚC nhãn trợ năng.
  //
  // Trên cây native của Android, hint của một EditText rỗng đi ra ở `text`,
  // nhiều khi cả ở content-desc — nên nhánh `accessibilityLabel` bên dưới cướp
  // mất và lại sinh ra `label="TCB,VNM,FPT…"`, đúng thứ WebView không khớp
  // được. Đo trên máy thật hai lượt liên tiếp: tin cậy 85 rồi 95, locator vẫn
  // là `label`, bước vẫn hụt.
  //
  // `placeholder` chạy được trên cả hai đường — `[placeholder="…"]` trong
  // WebView, `descriptionContains(…)` trên native — nên nó là cách khai an toàn
  // cho một ô nhập đang rỗng.
  const cuaONhap = placeholderCuaField(el);
  if (cuaONhap) return { strategy: 'placeholder', value: cuaONhap };
  if (el.accessibilityLabel) return { strategy: 'label', value: el.accessibilityLabel };
  // Với MỘT Ô NHẬP, chuỗi nhìn thấy chính là placeholder — phải khai đúng như
  // vậy, đừng khai là chữ.
  //
  // Cây native của Android phơi hint của một EditText rỗng ra ở thuộc tính
  // `text`, nên chỗ này thấy `text = "TCB,VNM,FPT…"` và chọn khớp-theo-chữ.
  // Nhưng app là hybrid: bước resolve chạy trong WebView, nơi `label` khớp chữ
  // hiển thị hoặc aria-label — mà placeholder không phải hai thứ đó. Kết quả là
  // một locator đúng phần tử, đúng chuỗi, và không bao giờ khớp.
  //
  // Đo trên máy thật: AI tìm đúng ô mã cổ phiếu với tin cậy 85, rồi cả kịch bản
  // vẫn đỏ ở đúng bước đó.
  if (el.text) return { strategy: 'text', value: el.text };
  // A form field often has neither an id nor any words of its own — the caption
  // that names it lives in a sibling <legend>. Without these two the model could
  // identify the right input and still produce nothing usable, which is exactly
  // how the first wired run ended: "verification PASSED" and no locator.
  if (el.placeholder) return { strategy: 'placeholder', value: el.placeholder };
  if (el.css) return { strategy: 'css', value: el.css };
  if (el.xpath) return { strategy: 'xpath', value: el.xpath };
  return undefined;
}
