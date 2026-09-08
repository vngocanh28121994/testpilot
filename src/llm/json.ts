/**
 * Lấy đối tượng JSON đầu tiên ra khỏi câu trả lời của model.
 *
 * Ba chỗ trong genspec từng tự làm việc này theo cùng một cách sai: lấy từ dấu
 * `{` ĐẦU TIÊN tới `}` CUỐI CÙNG. Cách đó hỏng ngay khi model trả về hai đối
 * tượng liền nhau, hoặc một đối tượng rồi vài dòng giải thích có chứa dấu ngoặc
 * — nó ôm trọn cả cụm, và JSON.parse báo
 *
 *   Unexpected non-whitespace character after JSON at position 2173
 *
 * một thông báo không hề nói rằng vấn đề là "có hai JSON" chứ không phải "JSON
 * hỏng". Đã làm chết một lượt workflow thật ở bước phân tích yêu cầu.
 *
 * Ở đây quét theo dấu ngoặc cân bằng và dừng đúng chỗ đối tượng đầu tiên khép
 * lại. Chuỗi bên trong được tôn trọng: một dấu `}` nằm trong chuỗi, hoặc một
 * dấu nháy đã escape, không được tính là kết thúc.
 */
export function firstJsonObject(raw: string): string {
  const text = stripFences(raw);
  const start = text.indexOf('{');
  if (start < 0) throw new Error('Model không trả về JSON object nào.');

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  // Ngoặc không khép: cắt tới cuối để JSON.parse nói ra chỗ hỏng thật, thay vì
  // ở đây đoán hộ.
  throw new Error('JSON của model thiếu dấu đóng ngoặc.');
}

/** Bỏ rào ```json ... ``` mà nhiều model vẫn thêm dù đã yêu cầu JSON thuần. */
function stripFences(value: string): string {
  return value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
}
