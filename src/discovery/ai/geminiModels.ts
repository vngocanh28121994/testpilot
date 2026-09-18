/**
 * Chuỗi model Gemini: gọi model đầu, hỏng thì lần lượt sang model sau.
 *
 * Sinh ra từ một lượt chạy thật ngày 2026-09-16: `gemini-3.6-flash` trả 429
 * hết quota ngay ở element đầu tiên cần tới thị giác, và tầng vision tắt cho
 * cả lượt. Tầng ấy là tầng DUY NHẤT nhận ra được một nút chỉ có icon — không
 * chữ, không nhãn, không testid — nên mất nó là mất luôn khả năng tìm những
 * control ấy, và kịch bản hỏng ở một bước mà log chỉ nói "không có ứng viên".
 *
 * Quota là của từng model, nên một model cạn KHÔNG có nghĩa là hết đường.
 */

/**
 * Thứ tự mặc định, xếp theo ĐỘ TIN CẬY ĐO ĐƯỢC, không theo số hiệu phiên bản.
 *
 * Đo ngày 2026-09-18, mỗi model ba lượt gọi thật bằng cùng một key:
 *
 *   gemini-3.6-flash   200/3.9s   200/2.3s   200/2.6s
 *   gemini-3.5-flash   200/2.7s   200/2.8s   200/2.9s
 *   gemini-3.8-flash   200/6.0s   503/5.9s   503/13.4s
 *   gemini-3.7-flash   503/0.9s   TREO 40s   503/36.8s
 *
 * Chuỗi cũ xếp 3.6 → 3.7 → 3.8, tức là khi model chính hỏng thì rơi xuống đúng
 * model tệ nhất. Trên prod ngày 2026-09-18 điều đó nghĩa là: 3.6 lỗi một nhịp,
 * chuyển sang 3.7, và 3.7 treo cho tới khi hết ngân sách resolve 15 giây —
 * locator không bao giờ về, kịch bản đỏ với log chỉ nói "chưa trả lời xong".
 *
 * Một bản dự phòng chỉ đáng gọi là dự phòng khi nó ỔN ĐỊNH HƠN thứ nó đỡ. Số
 * hiệu phiên bản cao hơn không hứa điều đó, và bản mới thường là bản đang chịu
 * tải nặng nhất. `gemini-3.5-flash` là bản GA, chậm hơn không đáng kể và chưa
 * lần nào 503 trong phép đo.
 *
 * Con số này sẽ cũ đi. Đo lại bằng `scripts/bench-ai-discovery.ts` rồi sửa thứ
 * tự ở đây, hoặc ghi đè bằng `GEMINI_VISION_MODEL` mà không cần phát hành.
 */
export const DEFAULT_VISION_MODEL_CHAIN = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
] as const;

/**
 * `GEMINI_VISION_MODEL` nhận một model hoặc cả một chuỗi ngăn cách bằng dấu
 * phẩy.
 *
 * Nhận cả hai dạng vì id model là thứ đổi theo nhà cung cấp chứ không theo kho
 * mã này: một bản bị khai tử hay đổi tên thì phải sửa được bằng biến môi
 * trường, không phải bằng một lần phát hành.
 */
export function visionModelChain(
  raw = process.env.GEMINI_VISION_MODEL,
  fallback: readonly string[] = DEFAULT_VISION_MODEL_CHAIN,
): string[] {
  const configured = (raw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return configured.length > 0 ? configured : [...fallback];
}

/**
 * Lỗi này có nghĩa là "thử model khác đi" hay "câu trả lời là vậy"?
 *
 * Chỉ những lỗi thuộc về CHÍNH model mới đáng chuyển: hết quota, không có model
 * ấy, hoặc dịch vụ đang lỗi. Một câu trả lời hợp lệ mà không tìm ra ứng viên
 * nào là một CÂU TRẢ LỜI — chuyển tiếp lúc ấy chỉ nhân ba chi phí để nhận lại
 * đúng kết quả đó, ba lần.
 */
export function shouldTryNextModel(message: string): boolean {
  return /\b(?:429|404|500|502|503|504)\b|resource[_ -]?exhausted|quota|unavailable|overload|not[_ -]?found/i
    .test(message);
}

/**
 * Model nào đã cạn quota, nhớ trong suốt đời tiến trình.
 *
 * Không nhớ thì mỗi element sau đó lại gọi model đã chết một lần nữa trước khi
 * sang model sống — trên một lượt chạy có hàng chục element cần thị giác, đó là
 * hàng chục round-trip chỉ để nhận lại đúng lỗi 429 đã biết.
 *
 * Chỉ nhớ lỗi VĨNH VIỄN trong phạm vi lượt chạy: hết quota (429) và không có
 * model (404). Lỗi 5xx là tạm thời — dịch vụ lỗi một phút rồi lại chạy — nên
 * lần này bỏ qua model đó, lần sau vẫn thử lại.
 */
export class ExhaustedModels {
  private readonly dead = new Set<string>();

  remember(model: string, message: string): void {
    if (/\b(?:429|404)\b|resource[_ -]?exhausted|quota|not[_ -]?found/i.test(message)) {
      this.dead.add(model);
    }
  }

  usable(chain: readonly string[]): string[] {
    const alive = chain.filter((model) => !this.dead.has(model));
    // Cả chuỗi đã chết thì vẫn trả về chuỗi gốc: thà gọi một lần rồi hỏng có
    // thông báo, còn hơn im lặng trả về rỗng như thể không có gì để tìm.
    return alive.length > 0 ? alive : [...chain];
  }

  has(model: string): boolean {
    return this.dead.has(model);
  }
}

/**
 * Ngắn nhất còn đáng gọi một model.
 *
 * Đo trên prod ngày 2026-09-18: một lượt gọi vision thành công mất ~3–8 giây.
 * Khởi động một model khi chỉ còn hai giây là chắc chắn bỏ tiền mua một câu trả
 * lời về sau khi resolver đã bỏ cuộc — đúng cảnh lượt chạy ấy gặp: model đầu
 * hỏng, model dự phòng được gọi, và không ai còn chờ nó nữa.
 */
export const MIN_MODEL_BUDGET_MS = 2_500;

/**
 * Bao nhiêu mili giây được phép dành cho lượt gọi model tiếp theo.
 *
 * `undefined` nghĩa là người gọi không nói hạn chót — giữ nguyên hành vi cũ và
 * dùng trọn thời gian chờ mặc định. Số 0 hoặc âm nghĩa là hết giờ: đừng gọi.
 */
export function budgetForNextModel(
  defaultTimeoutMs: number,
  deadlineAt?: number,
  now = Date.now(),
): number {
  if (deadlineAt == null) return defaultTimeoutMs;
  return Math.min(defaultTimeoutMs, Math.max(0, deadlineAt - now));
}
