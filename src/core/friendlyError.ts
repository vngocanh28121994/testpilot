/**
 * Biến lỗi kỹ thuật thành câu người dùng hiểu được — MỘT chỗ cho cả server lẫn
 * giao diện.
 *
 * Lỗi đi lên màn hình qua vài cửa (bộ bắt lỗi chung của server, luồng SSE, bộ
 * gọi API của giao diện) và trước file này cả ba đều đẩy nguyên văn lên:
 *
 *   Không mở được luồng MJPEG ở cổng 55463: connect ECONNREFUSED 127.0.0.1:55463
 *
 * Người dùng phải hỏi "đây là hiện tượng gì". Mỗi câu ở đây trả lời hai điều:
 * chuyện gì đã xảy ra, và làm gì tiếp theo. Nguyên văn vẫn giữ ở cuối, sau
 * "Chi tiết kỹ thuật", cho người đi đào lỗi.
 *
 * Làm việc trên CHUỖI chứ không trên kiểu lỗi: lỗi tới từ tiến trình con, từ
 * mạng, từ history đã lưu — chỉ còn lại câu chữ.
 *
 * Không dịch thì trả nguyên: câu do chính TestPilot viết bằng tiếng Việt đã nói
 * đúng việc, và bọc thêm một lớp là làm nó dài ra vô ích.
 */

/** Dấu hiệu một câu đã được dịch — để không dịch hai lần qua hai cửa. */
const DETAIL_MARK = 'Chi tiết kỹ thuật:';

/** Nguyên văn dài thì cắt: đủ để tra, không lấp màn hình. */
const RAW_LIMIT = 300;

/** Cổng quen thuộc trên máy này, để nói tên thứ đang tắt thay vì một con số. */
const KNOWN_PORTS: Record<number, string> = {
  4723: 'Appium',
  4300: 'máy chủ TestPilot',
  5037: 'adb',
};

interface Rule {
  test: RegExp;
  say: (match: RegExpExecArray) => string;
}

const RULES: Rule[] = [
  // ── Thiết bị iOS ──────────────────────────────────────────────────────────
  {
    test: /xcodebuild failed with code 70/i,
    say: () => 'iPhone từ chối cài WebDriverAgent — thường là vì provisioning profile đã hết hạn '
      + '(Apple ID miễn phí chỉ cho 7 ngày). Chạy `bash scripts/prepare-wda.sh` để ký lại, '
      + 'rồi bấm Tin cậy trên máy.',
  },
  {
    test: /xcodebuild failed with code 65/i,
    say: () => 'WebDriverAgent đã cài nhưng iPhone không cho mở — thường là chứng chỉ nhà phát triển '
      + 'chưa được tin cậy. Trên điện thoại: Cài đặt › Cài đặt chung › VPN & Quản lý thiết bị › '
      + 'chọn chứng chỉ › Tin cậy, mở khoá máy rồi thử lại.',
  },
  {
    test: /could not be, unlocked|Description = Locked/i,
    say: () => 'iPhone đang khoá màn hình nên iOS không cho mở WebDriverAgent. Mở khoá máy (để màn '
      + 'hình sáng) rồi thử lại.',
  },
  {
    test: /Unknown device or simulator UDID/i,
    say: () => 'Appium không thấy chiếc iPhone này. Kiểm tra cáp, mở khoá máy; nếu máy vẫn cắm thì '
      + 'bật lại tunnel: `sudo appium driver run xcuitest tunnel-creation`.',
  },
  {
    test: /invalid session id|session is either terminated or not started/i,
    say: () => 'Phiên điều khiển thiết bị đã đóng — thường vì một lượt test khác vừa dùng máy. '
      + 'Thử lại thao tác (ví dụ bấm Giữ máy lại).',
  },
  // ── Thiết bị Android ──────────────────────────────────────────────────────
  {
    test: /device unauthorized|unauthorized.*adb|adb.*unauthorized/i,
    say: () => 'Máy Android chưa cho phép gỡ lỗi USB từ máy tính này. Mở khoá điện thoại và bấm '
      + '"Cho phép" ở hộp thoại gỡ lỗi USB.',
  },
  {
    test: /device offline/i,
    say: () => 'Máy Android đang offline với adb. Rút cáp ra cắm lại, hoặc khởi động lại máy.',
  },
  {
    test: /device '([^']+)' not found|no devices\/emulators found/i,
    say: (m) => `Không thấy máy Android${m[1] ? ` ${m[1]}` : ''}. Kiểm tra cáp và bấm Tìm lại.`,
  },
  // ── Kết nối ───────────────────────────────────────────────────────────────
  {
    test: /ECONNREFUSED\s+(?:(127\.0\.0\.1|localhost|::1|\[::1\])|([\w.-]+)):(\d+)/i,
    say: (m) => {
      const port = Number(m[3]);
      if (m[2]) {
        return `Không kết nối được tới ${m[2]}:${port} — dịch vụ ấy đang tắt hoặc bị chặn. `
          + 'Kiểm tra mạng/VPN hoặc địa chỉ trong cấu hình.';
      }
      const name = KNOWN_PORTS[port];
      if (name === 'Appium') return 'Appium chưa chạy. Bật Appium ở màn Local Runner rồi thử lại.';
      if (name) return `${name[0]!.toUpperCase()}${name.slice(1)} không chạy (cổng ${port}). Bật lại rồi thử lại.`;
      return `Một dịch vụ trên máy này đã ngừng (cổng ${port}) — thường là phiên điều khiển `
        + 'thiết bị hoặc WebDriverAgent vừa đóng. Thử lại thao tác (ví dụ bấm Giữ máy lại).';
    },
  },
  {
    test: /EADDRINUSE[^\d]*(\d+)?/i,
    say: (m) => `Cổng${m[1] ? ` ${m[1]}` : ''} đang bị một chương trình khác dùng. Tắt chương `
      + 'trình đó hoặc đổi cổng rồi thử lại.',
  },
  {
    test: /The port #?(\d+) is occupied/i,
    say: (m) => `Cổng ${m[1]} đang bị một chương trình khác dùng (thường là WebDriverAgent của `
      + 'simulator hoặc một phiên cũ). Thử lại sau ít giây; nếu vẫn lỗi, tắt simulator đang chạy.',
  },
  {
    test: /(?:ENOTFOUND|EAI_AGAIN)\s+([\w.-]+)/i,
    say: (m) => `Không tìm thấy địa chỉ ${m[1]}. Kiểm tra kết nối mạng/VPN hoặc URL trong cấu hình.`,
  },
  {
    test: /ECONNRESET|socket hang up|EPIPE/i,
    say: () => 'Kết nối bị ngắt giữa chừng. Thử lại; nếu lặp lại, kiểm tra mạng hoặc dịch vụ đang dùng.',
  },
  {
    // Chặt tay: "timeout" trần xuất hiện trong tên cấu hình (`webviewTimeoutMs`)
    // ngay giữa những câu tiếng Việt đã nói đúng việc.
    test: /\bETIMEDOUT\b|\bESOCKETTIMEDOUT\b|\btimed out\b|The operation was aborted|\bTimeoutError\b/i,
    say: () => 'Dịch vụ không trả lời trong thời gian chờ. Đợi một lát rồi thử lại.',
  },
  {
    test: /^(?:TypeError: )?(?:Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?|fetch failed)$/i,
    say: () => 'Không kết nối được tới máy chủ TestPilot — máy chủ có thể đang khởi động lại. '
      + 'Đợi vài giây rồi thử lại.',
  },
  // ── Hệ thống tệp và lệnh ──────────────────────────────────────────────────
  {
    test: /spawn (\S+) ENOENT/i,
    say: (m) => `Máy này chưa cài lệnh "${m[1]}" (hoặc lệnh không nằm trong PATH). Cài nó rồi thử lại.`,
  },
  {
    test: /ENOENT[^']*'([^']+)'/i,
    say: (m) => `Không tìm thấy tệp hoặc thư mục ${m[1]}.`,
  },
  {
    test: /EACCES[^']*'([^']+)'|EPERM[^']*'([^']+)'/i,
    say: (m) => `Không có quyền truy cập ${m[1] ?? m[2]}. Kiểm tra quyền của tệp/thư mục.`,
  },
  {
    test: /Unexpected token .* in JSON|is not valid JSON|Unexpected end of JSON input/i,
    say: () => 'Nhận về dữ liệu không đọc được (không phải JSON hợp lệ). Thử lại; nếu lặp lại, '
      + 'tệp cấu hình hoặc dịch vụ trả lời có thể đang hỏng.',
  },
  // ── Mã HTTP trần do chính server trả ──────────────────────────────────────
  { test: /^forbidden$/i, say: () => 'Bạn không có quyền làm việc này.' },
  { test: /^unauthori[sz]ed$/i, say: () => 'Phiên đăng nhập đã hết hạn. Đăng nhập lại rồi thử lại.' },
  { test: /^Not found: (.+)$/i, say: (m) => `Không tìm thấy: ${m[1]}.` },
];

/** Câu nói theo mã HTTP, khi server không gửi kèm câu nào (`res.statusText`). */
export function friendlyStatus(status: number): string {
  if (status === 401) return 'Phiên đăng nhập đã hết hạn. Đăng nhập lại rồi thử lại.';
  if (status === 403) return 'Bạn không có quyền làm việc này.';
  if (status === 404) return 'Không tìm thấy thứ đang yêu cầu — có thể nó vừa bị xoá hoặc đổi tên.';
  if (status === 409) return 'Thao tác bị từ chối vì trạng thái vừa thay đổi. Tải lại trang rồi thử lại.';
  if (status === 413) return 'Tệp gửi lên quá lớn.';
  if (status === 429) return 'Đang có quá nhiều yêu cầu. Đợi một lát rồi thử lại.';
  if (status >= 502 && status <= 504) {
    return 'Máy chủ TestPilot tạm thời không phản hồi — có thể đang khởi động lại. Đợi vài giây rồi thử lại.';
  }
  if (status >= 500) return 'Máy chủ TestPilot gặp lỗi khi xử lý yêu cầu. Thử lại; nếu lặp lại, báo cho người quản trị.';
  return `Yêu cầu không thành công (mã ${status}).`;
}

/**
 * Câu thân thiện cho một lỗi. Không nhận dạng được thì trả nguyên văn — không
 * bịa lời giải thích cho thứ mình không hiểu.
 */
export function friendlyError(raw: unknown): string {
  const text = (raw instanceof Error ? raw.message : typeof raw === 'string' ? raw : String(raw ?? '')).trim();
  if (!text) return 'Có lỗi xảy ra nhưng không kèm thông tin nào. Thử lại thao tác.';
  // Đã qua một cửa dịch rồi (server dịch, giao diện gặp lại) — giữ nguyên.
  if (text.includes(DETAIL_MARK)) return text;
  for (const rule of RULES) {
    const match = rule.test.exec(text);
    if (!match) continue;
    const said = rule.say(match);
    // Câu gốc chỉ là mã trần ("forbidden") thì câu dịch đã nói đủ.
    if (/^(forbidden|unauthori[sz]ed|Not found: .+)$/i.test(text)) return said;
    const detail = text.length > RAW_LIMIT ? `${text.slice(0, RAW_LIMIT)}…` : text;
    return `${said} ${DETAIL_MARK} ${detail}`;
  }
  return text;
}
