/** Hai nền tảng điều khiển được. Web thì không có màn hình để chạm. */
export type ControlPlatform = 'android' | 'ios';

/**
 * Một chiếc máy, nói rõ nền tảng.
 *
 * Nền tảng đi kèm chứ không đoán từ hình dạng `udid`: udid của simulator là
 * một UUID, của máy iOS thật là 25 hoặc 40 ký tự, của Android là bất cứ thứ gì
 * nhà sản xuất muốn — và `emulator-5554` chỉ tình cờ nhận ra được. Đoán sai
 * nghĩa là gửi lệnh `adb` cho một chiếc iPhone, và câu lỗi sẽ nói về `adb`
 * chứ không nói về chuyện đoán.
 */
export interface ControlTarget {
  platform: ControlPlatform;
  udid: string;
  /**
   * Chữ ký WebDriverAgent cho iPhone THẬT — lấy từ config của người đang xem.
   * Simulator không cần; máy thật thiếu nó thì Appium build WDA hỏng với
   * "xcodebuild failed with code 65" và màn điều khiển đứng ở "đang mở".
   */
  iosSigning?: IosSigning;
  /**
   * App đang test trên máy này — `android.appPackage` hoặc `ios.bundleId` của
   * config. Cho nút "mở lại / đóng app". Người dùng không gửi được nó: mở một
   * app tuỳ ý theo tên trên máy dùng chung là việc không ai nhờ.
   */
  appId?: string;
}

/** Cùng các trường `ios.*` mà lượt chạy test dùng để ký WDA. */
export interface IosSigning {
  teamId?: string;
  signingId?: string;
  wdaBundleId?: string;
  usePreinstalledWDA?: boolean;
  usePrebuiltWDA?: boolean;
  derivedDataPath?: string;
}

/**
 * Những phím mà màn điều khiển được phép bấm, theo từng nền tảng.
 *
 * Danh sách nằm ở tầng giao thức, không ở runner, vì nó là HỢP ĐỒNG: control
 * plane kiểm nó để từ chối sớm, runner kiểm lại để không tin phía bên kia, và
 * hai bên phải nói về cùng một danh sách. Để mỗi bên tự giữ một bản là cách
 * chắc chắn nhất để một ngày nào đó chúng lệch nhau — và bên nới rộng hơn sẽ
 * là bên quyết định.
 *
 * Không có POWER, không có SLEEP: một cái nút trên web khoá màn hình chiếc máy
 * đang cắm ở phòng khác là thứ không ai gỡ được từ xa.
 *
 * iOS có ÍT phím hơn, và đó là sự thật của nền tảng chứ không phải thiếu sót:
 * iPhone không có nút Quay lại, và WebDriverAgent chỉ bấm được những nút cứng
 * mà máy thật có. Trả lời "iOS không có phím ấy" rõ ràng hơn nhiều so với gửi
 * đi một lệnh rồi báo lỗi từ tầng dưới.
 */
export const CONTROL_KEYS_BY_PLATFORM: Record<ControlPlatform, readonly string[]> = {
  android: [
    'back', 'home', 'recents', 'notifications', 'quick_settings',
    'volume_up', 'volume_down', 'enter', 'delete', 'tab',
  ],
  // iPhone không có nút Quay lại, và bàn phím của nó không có Tab. Đa nhiệm,
  // Thông báo và Trung tâm điều khiển là CỬ CHỈ trên iOS chứ không phải phím —
  // runner làm cử chỉ ấy thay người dùng (xem iosControl.ts).
  ios: [
    'home', 'recents', 'notifications', 'quick_settings',
    'volume_up', 'volume_down', 'enter', 'delete',
  ],
};

/** Hợp của cả hai nền tảng — dùng cho kiểu, không dùng để cho phép. */
export const CONTROL_KEYS = [
  'back', 'home', 'enter', 'delete', 'tab', 'recents',
  'notifications', 'quick_settings', 'volume_up', 'volume_down',
] as const;

export type ControlKey = (typeof CONTROL_KEYS)[number];

export function isControlKey(value: unknown, platform?: ControlPlatform): value is ControlKey {
  if (typeof value !== 'string') return false;
  const allowed = platform
    ? CONTROL_KEYS_BY_PLATFORM[platform]
    : (CONTROL_KEYS as readonly string[]);
  return allowed.includes(value);
}

export type ControlOrientation = 'portrait' | 'landscape';
export type ControlAppOp = 'restart' | 'close';

/** Danh sách ĐÓNG các động tác. Xem `RunnerControlApi`. */
export type ControlAction =
  | { kind: 'tap'; x: number; y: number }
  | { kind: 'swipe'; x: number; y: number; toX: number; toY: number; durationMs?: number }
  | { kind: 'text'; text: string }
  | { kind: 'key'; key: ControlKey }
  | { kind: 'rotate'; orientation: ControlOrientation }
  | { kind: 'open_url'; url: string }
  /** App đang test — mã app lấy từ config ở máy chủ, KHÔNG từ request. */
  | { kind: 'app'; op: ControlAppOp };

/**
 * Scheme không bao giờ được mở từ web.
 *
 * `javascript:` và `data:` chạy mã trong trình duyệt của máy; `file:` và
 * `content:` đọc tệp trên máy. Một nút "mở URL" trên web mà mở được mấy thứ ấy
 * là một cửa đọc dữ liệu của chiếc điện thoại dùng chung cho bất kỳ ai giữ nó.
 */
const BLOCKED_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'content:', 'blob:', 'about:']);

/** URL hay deep link mở được — hoặc câu nói vì sao không. */
export function checkUrl(raw: unknown): { ok: true; url: string } | { ok: false; error: string } {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, error: 'Thiếu URL.' };
  const url = raw.trim();
  if (url.length > 2_000) return { ok: false, error: 'URL quá dài (tối đa 2000 ký tự).' };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      ok: false,
      error: `"${url}" không phải URL. Ghi đủ cả phần đầu, ví dụ https://… hoặc tcinvest://…`,
    };
  }
  if (BLOCKED_SCHEMES.has(parsed.protocol)) {
    return { ok: false, error: `Không mở URL dạng ${parsed.protocol} từ web.` };
  }
  // Ký tự điều khiển (xuống dòng…) không có chỗ trong một URL thật, và là cách
  // quen thuộc để chèn thêm lệnh vào một dòng lệnh shell.
  if (/[\u0000-\u001f\u007f]/.test(url)) {
    return { ok: false, error: 'URL chứa ký tự điều khiển.' };
  }
  return { ok: true, url };
}

/**
 * Kiểm một động tác trước khi nó tới `adb`.
 *
 * Hàm thuần, và đó là chủ ý: đây là chỗ duy nhất quyết định "toạ độ này có hợp
 * lệ không", nên nó phải đo được mà không cần một chiếc điện thoại. Route thì
 * mỏng — nó chỉ hỏi hàm này rồi gọi runner.
 *
 * Toạ độ nhận theo hệ của MÀN HÌNH, không theo khung video: chỉ client biết nó
 * đang vẽ khung to nhỏ thế nào, nên việc quy đổi thuộc về client. Server kiểm
 * lại biên, vì một toạ độ ngoài màn hình là dấu hiệu client tính sai — không
 * phải ý muốn của người dùng.
 */
export function checkAction(
  raw: unknown,
  screen: { width: number; height: number },
  platform?: ControlPlatform,
): { ok: true; action: ControlAction } | { ok: false; error: string } {
  const action = (raw ?? {}) as Record<string, unknown>;
  const num = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined;

  const point = (x: unknown, y: unknown): { x: number; y: number } | string => {
    const px = num(x);
    const py = num(y);
    if (px === undefined || py === undefined) return 'Thiếu toạ độ.';
    if (px < 0 || py < 0 || px > screen.width || py > screen.height) {
      return `Toạ độ (${px}, ${py}) nằm ngoài màn hình ${screen.width}x${screen.height}.`;
    }
    return { x: Math.round(px), y: Math.round(py) };
  };

  switch (action.kind) {
    case 'tap': {
      const at = point(action.x, action.y);
      if (typeof at === 'string') return { ok: false, error: at };
      return { ok: true, action: { kind: 'tap', ...at } };
    }
    case 'swipe': {
      const from = point(action.x, action.y);
      if (typeof from === 'string') return { ok: false, error: from };
      const to = point(action.toX, action.toY);
      if (typeof to === 'string') return { ok: false, error: to };
      const durationMs = num(action.durationMs);
      return {
        ok: true,
        action: {
          kind: 'swipe',
          x: from.x, y: from.y, toX: to.x, toY: to.y,
          // Quét 0 giây là một cú chạm, quét một phút là giữ tay — cả hai đều
          // không phải điều người ta muốn khi kéo chuột trên màn hình.
          durationMs: durationMs === undefined ? undefined : Math.min(10_000, Math.max(1, Math.round(durationMs))),
        },
      };
    }
    case 'text': {
      if (typeof action.text !== 'string') return { ok: false, error: 'Thiếu text.' };
      if (action.text.length === 0) return { ok: false, error: 'Chuỗi rỗng.' };
      // Một nghìn ký tự là đủ cho mọi ô nhập thật, và là giới hạn để một
      // request không biến thành một phút gõ trên máy của người khác.
      if (action.text.length > 1_000) {
        return { ok: false, error: 'Chuỗi quá dài (tối đa 1000 ký tự).' };
      }
      return { ok: true, action: { kind: 'text', text: action.text } };
    }
    case 'key': {
      if (!isControlKey(action.key, platform)) {
        // Nói rõ phím nào CÓ, vì với iOS câu trả lời không phải "sai" mà là
        // "nền tảng này không có nút ấy".
        const allowed = platform
          ? CONTROL_KEYS_BY_PLATFORM[platform].join(', ')
          : CONTROL_KEYS.join(', ');
        return {
          ok: false,
          error: `Phím "${String(action.key)}" không dùng được`
            + `${platform ? ` trên ${platform}` : ''}. Chỉ có: ${allowed}.`,
        };
      }
      return { ok: true, action: { kind: 'key', key: action.key } };
    }
    case 'rotate': {
      if (action.orientation !== 'portrait' && action.orientation !== 'landscape') {
        return { ok: false, error: 'Hướng xoay phải là portrait hoặc landscape.' };
      }
      return { ok: true, action: { kind: 'rotate', orientation: action.orientation } };
    }
    case 'open_url': {
      const checked = checkUrl(action.url);
      if (!checked.ok) return checked;
      return { ok: true, action: { kind: 'open_url', url: checked.url } };
    }
    case 'app': {
      if (action.op !== 'restart' && action.op !== 'close') {
        return { ok: false, error: 'Thao tác app phải là restart hoặc close.' };
      }
      return { ok: true, action: { kind: 'app', op: action.op } };
    }
    default:
      return { ok: false, error: `Động tác "${String(action.kind)}" không có.` };
  }
}
