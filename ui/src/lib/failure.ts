/**
 * Biến câu lỗi thô thành một thông báo người đọc hiểu được.
 *
 * Phần lớn lỗi làm workflow dừng KHÔNG phải lỗi của người đang ngồi trước màn
 * hình, và cũng không có gì để họ sửa: nhà cung cấp AI quá tải, mạng rớt, hết
 * hạn mức. Nhưng trước đây tất cả đều rơi vào cùng một băng đỏ "Workflow dừng
 * giữa chừng", kèm nguyên văn cục JSON của Google:
 *
 *   Gemini Vision 503: { "error": { "code": 503, "message": "This model is
 *   currently experiencing high demand..." } }
 *
 * Đọc xong vẫn không biết nên chờ, nên sửa cấu hình, hay nên đi báo lỗi. Ba
 * tình huống đó cần ba hành động khác hẳn nhau, nên chúng phải trông khác nhau.
 *
 * Bộ phân loại làm việc trên CHUỖI, không phải trên kiểu lỗi, vì nguồn của nó
 * là `run.error` đã lưu trong history — kể cả những lượt chạy từ trước khi có
 * tệp này vẫn hiển thị đẹp.
 */

export type FailureKind =
  | 'provider_busy'
  | 'provider_auth'
  | 'provider_quota'
  | 'timeout'
  | 'network'
  | 'test_failed'
  | 'unknown';

export interface Failure {
  kind: FailureKind;
  /** Đọc được từ xa, không có mã số, không có JSON. */
  title: string;
  /** Chuyện gì đã xảy ra, và quan trọng hơn: có phải lỗi của người dùng không. */
  detail: string;
  /** Việc nên làm tiếp. Bỏ trống khi thành thật là không biết. */
  hint?: string;
  /** Bấm chạy lại có khả năng qua được không. Quyết định việc có hiện nút. */
  retryable: boolean;
  /** Nguyên văn, giấu sau một chỗ bấm — vẫn cần cho người đi đào lỗi. */
  raw: string;
}

/**
 * Tên dịch vụ nằm ngay trước mã HTTP, do chính chỗ ném đặt vào: "Gemini Vision
 * 503", "DeepSeek 429", "Confluence trả 401".
 *
 * Rút ra thay vì dò một danh sách cố định, vì không phải mọi thứ hỏng đều là
 * nhà cung cấp AI — 401 của Confluence là token Confluence, và bảo người dùng
 * đi kiểm tra khoá AI thì họ tìm sai chỗ.
 */
function sourceOf(raw: string): string | undefined {
  const match = /^(\p{Lu}[\p{L}\p{N} .]{0,24}?)\s+(?:trả\s+)?(?:HTTP\s+)?\d{3}\b/u.exec(raw.trim());
  const name = match?.[1]?.trim();
  if (!name) return undefined;
  return /^gemini/i.test(name) ? 'Gemini' : name;
}

/**
 * Nhà cung cấp thường đã viết sẵn một câu tiếng Anh tử tế bên trong JSON. Lấy
 * đúng câu đó còn hơn tự chế một câu mô tả chung chung.
 */
function providerMessage(raw: string): string | undefined {
  const start = raw.indexOf('{');
  if (start < 0) return undefined;
  try {
    const parsed = JSON.parse(raw.slice(start)) as { error?: { message?: unknown } };
    const message = parsed.error?.message;
    return typeof message === 'string' && message.trim() ? message.trim() : undefined;
  } catch {
    // JSON bị cắt cụt (chỗ ném giới hạn 300 ký tự) — vẫn còn regex phía dưới.
    const match = /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(raw);
    return match?.[1]?.replace(/\\"/g, '"');
  }
}

export function describeFailure(raw: string | null | undefined): Failure {
  const text = (raw ?? '').trim();
  if (!text) {
    return {
      kind: 'unknown',
      title: 'Workflow dừng giữa chừng',
      detail: 'Không có thông tin lỗi kèm theo.',
      hint: 'Xem log bên dưới để biết bước cuối cùng đã chạy.',
      retryable: true,
      raw: text,
    };
  }

  const source = sourceOf(text) ?? 'Dịch vụ bên ngoài';
  const upstream = providerMessage(text);

  // Kết quả kiểm thử, KHÔNG phải hỏng hóc. Xếp trước mọi thứ khác vì câu này do
  // chính TestPilot viết ra và không lẫn với lỗi hạ tầng được.
  // Hai biến thể: fail sau healing, và assertion fail (server.ts:2229). Cả hai
  // đều do TestPilot tự viết và đã nói rõ chuyện gì — chỉ thiếu đúng một câu:
  // rằng đây không phải hỏng hóc cần đi sửa hệ thống.
  if (/^Automation có/i.test(text)) {
    return {
      kind: 'test_failed',
      title: 'Có testcase không đạt',
      detail: `${text} Đây là kết quả kiểm thử, không phải lỗi hệ thống.`,
      hint: 'Mở report để xem kịch bản nào fail và ảnh chụp lúc fail.',
      retryable: false,
      raw: text,
    };
  }

  // Hết hạn mức phải xét TRƯỚC quá tải: cả hai đều có thể là HTTP 429, nhưng
  // một cái chờ là qua, còn cái kia chờ tới sang năm cũng không qua.
  if (/quota|exhausted|billing|insufficient balance|hết hạn mức/i.test(text)) {
    return {
      kind: 'provider_quota',
      title: `Tài khoản ${source} đã hết hạn mức`,
      detail:
        upstream ??
        `${source} từ chối vì tài khoản đã dùng hết hạn mức hoặc hết số dư.`,
      hint: 'Chạy lại cũng sẽ hỏng như vậy — cần nạp thêm hạn mức hoặc đổi sang model khác.',
      retryable: false,
      raw: text,
    };
  }

  if (/\b(401|403)\b|invalid api key|permission denied|unauthenticated|API key not valid/i.test(text)) {
    return {
      kind: 'provider_auth',
      title: `${source} từ chối xác thực`,
      detail: upstream ?? `${source} không chấp nhận khoá/token đang cấu hình.`,
      hint: `Kiểm tra lại khoá/token của ${source} ở phần Cấu hình. Chạy lại khi chưa sửa thì vẫn hỏng.`,
      retryable: false,
      raw: text,
    };
  }

  if (/\b(429|500|502|503|504)\b|overload|high demand|UNAVAILABLE|rate.?limit|server error|quá tải/i.test(text)) {
    return {
      kind: 'provider_busy',
      title: `${source} đang quá tải`,
      detail:
        `${source} tạm thời không nhận thêm yêu cầu. ` +
        'Đây là sự cố phía nhà cung cấp — không phải lỗi tài liệu, cấu hình hay thao tác của bạn.',
      hint: 'Đợi vài phút rồi chạy lại. Loại lỗi này thường tự hết.',
      retryable: true,
      raw: text,
    };
  }

  if (/timeout|timed out|AbortError|The operation was aborted|quá thời gian/i.test(text)) {
    return {
      kind: 'timeout',
      title: `${source} không trả lời kịp`,
      detail: 'Yêu cầu bị huỷ vì chờ quá lâu. Thường đi kèm lúc nhà cung cấp đang tải nặng.',
      hint: 'Đợi một lát rồi chạy lại.',
      retryable: true,
      raw: text,
    };
  }

  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|fetch failed|network error/i.test(text)) {
    return {
      kind: 'network',
      title: 'Không kết nối được ra ngoài',
      detail: 'Máy chạy TestPilot không mở được kết nối tới dịch vụ cần dùng.',
      hint: 'Kiểm tra mạng, VPN hoặc proxy rồi chạy lại.',
      retryable: true,
      raw: text,
    };
  }

  return {
    kind: 'unknown',
    title: 'Workflow dừng giữa chừng',
    // Không bịa ra lời trấn an cho thứ mình không nhận dạng được: đưa nguyên
    // câu lỗi, vì lúc này nó là thông tin tốt nhất đang có.
    detail: text.length > 200 ? `${text.slice(0, 200)}…` : text,
    hint: 'Xem log bên dưới để biết bước cuối cùng đã chạy.',
    retryable: true,
    raw: text,
  };
}
