/**
 * Xem và chạm một chiếc máy ANDROID — phần phải sinh tiến trình, nên nó ở đây.
 *
 * Bản iOS nằm ở [iosControl.ts](./iosControl.ts) và làm cùng một việc bằng
 * đường hoàn toàn khác: WebDriverAgent thay vì `adb`, MJPEG thay vì H.264.
 * [control.ts](./control.ts) chọn giữa hai bên theo nền tảng.
 *
 * Vì sao `screenrecord` chứ không phải `screencap` theo nhịp: đã đo trên
 * emulator API 36. Một khung `screencap -p` mất **1,9-2,6 giây** và nặng
 * **1,39 MB**; năm giây `screenrecord --output-format=h264` ở 720x1600 nặng
 * **37 KB** và đúng tốc độ khung của máy. Tức là chụp ảnh liên tục cho ra 0,5
 * khung/giây với băng thông gấp hai mươi lần video — không phải chậm hơn một
 * chút, mà là một thứ khác hẳn.
 *
 * Vì sao không phải scrcpy: scrcpy cần đẩy `scrcpy-server.jar` lên máy rồi nói
 * giao thức socket riêng của nó. Nó cho độ trễ thấp hơn, và sẽ là bước sau nếu
 * độ trễ thành vấn đề. `screenrecord` là lệnh CÓ SẴN trong Android, đi qua đúng
 * `adb` mà runner vốn đã cần — không thêm nhị phân nào lên máy người dùng, và
 * đó là điều đáng giữ khi runner chạy trên máy cá nhân của người khác.
 *
 * Giới hạn đã biết, nói ra chứ không giấu: `screenrecord` tự dừng ở mốc
 * `--time-limit` (tối đa 180 giây) nên stream tự khởi động lại, và mỗi lần khởi
 * động lại có một khoảng hở khoảng một giây. Nó cũng không chụp được surface
 * bảo mật (màn nhập mật khẩu, DRM) — vùng ấy ra khung đen, đúng như khi quay
 * phim bằng tay.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { CONTROL_KEYS, isControlKey, type ControlKey } from '../protocol/control.js';

/** Mỗi lần khởi động lại `screenrecord` là một khoảng hở, nên lấy mốc cao nhất. */
const TIME_LIMIT_SECONDS = 180;

/** Chiều rộng đích. Cao hơn nữa thì băng thông tăng mà chữ trên máy không rõ thêm. */
const TARGET_WIDTH = 720;

export interface ScreenSize {
  width: number;
  height: number;
  /**
   * Toạ độ mà `input tap` dùng có phải toạ độ vật lý không.
   *
   * `wm size` in ra "Override size" khi màn hình đang bị đặt lại độ phân giải,
   * và `input tap` đi theo con số ĐÓ. Lấy nhầm số vật lý nghĩa là mọi cú chạm
   * lệch đi theo tỉ lệ — và lệch một cách đều đặn, nên nó trông như "app hỏng"
   * chứ không như "toạ độ sai".
   */
  overridden: boolean;
}

export interface ScreenStreamHandle {
  /** Kích thước khung video đang gửi — KHÁC kích thước màn hình khi có `--size`. */
  readonly frame: { width: number; height: number };
  stop(): void;
}

export interface ScreenStreamSink {
  /** Một mảnh H.264 Annex-B. Mảnh đầu của mỗi lần chạy mang SPS/PPS. */
  chunk(data: Buffer): void;
  /**
   * `screenrecord` vừa khởi động lại, nên bộ giải mã phía trình duyệt phải
   * dựng lại: mảnh tiếp theo bắt đầu một chuỗi mới, không nối tiếp chuỗi cũ.
   */
  restart(): void;
  /** Tiến trình chết vì lý do không phải mốc thời gian. */
  fail(message: string): void;
}

function adb(args: string[], udid: string): ChildProcess {
  // `udid` rỗng nghĩa là lệnh không nhắm tới máy nào — `adb devices` là lệnh
  // duy nhất như thế, và thêm `-s ''` vào đó làm adb báo lỗi thiếu thiết bị.
  const target = udid ? ['-s', udid] : [];
  return spawn('adb', [...target, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Một lệnh adb ngắn, có hạn giờ.
 *
 * Câu lỗi phải nói được AI đã giết tiến trình. Bản đầu in `mã ${code}`, và khi
 * chính hạn giờ ở đây bắn SIGTERM thì `code` là `null` — người dùng nhận đúng
 * dòng "adb kết thúc với mã null", một câu không chỉ ra được gì. Nó đã xảy ra
 * thật giữa lúc ai đó đang chạm vào màn hình điện thoại.
 *
 * `code === null` LUÔN nghĩa là bị tín hiệu giết, và có đúng hai khả năng:
 * hạn giờ của ta, hoặc một tín hiệu từ bên ngoài. Hai câu trả lời khác nhau,
 * nên phân biệt chúng.
 */
function run(args: string[], udid: string, timeoutMs = 8_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const child = adb(args, udid);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    child.stdout?.on('data', (buf: Buffer) => { stdout += buf.toString(); });
    child.stderr?.on('data', (buf: Buffer) => { stderr += buf.toString(); });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return resolve(stdout);
      reject(new Error(
        stderr.trim() || stdout.trim() || describeExit(args, code, signal, timedOut, timeoutMs),
      ));
    });
  });
}

/** Câu nói ra chuyện gì đã xảy ra với tiến trình adb, cho người sẽ đi sửa nó. */
export function describeExit(
  args: string[],
  code: number | null,
  signal: NodeJS.Signals | null,
  timedOut: boolean,
  timeoutMs: number,
): string {
  const what = `adb ${args.join(' ')}`;
  if (timedOut) {
    return `${what} không trả lời trong ${Math.round(timeoutMs / 1000)} giây. `
      + 'Máy có thể đang bận, hoặc adb đã mất kết nối tới nó — thử `adb devices`.';
  }
  if (signal) return `${what} bị dừng bởi tín hiệu ${signal}.`;
  return `${what} kết thúc với mã ${code}.`;
}

/** `wm size` → số mà `input tap` thật sự dùng. Xem `ScreenSize.overridden`. */
export function parseScreenSize(output: string): ScreenSize | undefined {
  const override = /Override size:\s*(\d+)x(\d+)/.exec(output);
  const physical = /Physical size:\s*(\d+)x(\d+)/.exec(output);
  const picked = override ?? physical;
  if (!picked) return undefined;
  return {
    width: Number(picked[1]),
    height: Number(picked[2]),
    overridden: override !== null,
  };
}

export async function screenSize(udid: string): Promise<ScreenSize> {
  const size = parseScreenSize(await run(['shell', 'wm', 'size'], udid));
  if (!size) throw new Error(`Không đọc được kích thước màn hình của "${udid}".`);
  return size;
}

/**
 * Khung video nhỏ hơn màn hình, giữ đúng tỉ lệ, và chiều nào cũng CHẴN.
 *
 * Bộ mã hoá H.264 trên Android từ chối kích thước lẻ, và nó từ chối bằng cách
 * chết ngay lúc khởi động với một câu khó hiểu.
 */
export function frameSizeFor(screen: { width: number; height: number }): {
  width: number; height: number;
} {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  if (screen.width <= TARGET_WIDTH) {
    return { width: even(screen.width), height: even(screen.height) };
  }
  return {
    width: even(TARGET_WIDTH),
    height: even((TARGET_WIDTH * screen.height) / screen.width),
  };
}

/**
 * Một tiến trình cho một chiếc máy.
 *
 * Hai `screenrecord` cùng lúc trên một máy là hai bộ mã hoá tranh nhau, và kết
 * quả là cả hai giật. Nên nhiều người xem — cùng một người mở hai tab là đủ —
 * dùng chung một tiến trình, và tiến trình tắt khi người xem cuối cùng rời đi.
 */
const streams = new Map<string, {
  child?: ChildProcess;
  sinks: Set<ScreenStreamSink>;
  frame: { width: number; height: number };
  stopped: boolean;
}>();

export async function startScreenStream(
  udid: string,
  sink: ScreenStreamSink,
): Promise<ScreenStreamHandle> {
  const existing = streams.get(udid);
  if (existing) {
    existing.sinks.add(sink);
    return { frame: existing.frame, stop: () => detach(udid, sink) };
  }

  const screen = await screenSize(udid);
  const frame = frameSizeFor(screen);
  const state = { sinks: new Set([sink]), frame, stopped: false } as {
    child?: ChildProcess;
    sinks: Set<ScreenStreamSink>;
    frame: { width: number; height: number };
    stopped: boolean;
  };
  streams.set(udid, state);

  const launch = (first: boolean): void => {
    if (state.stopped) return;
    const child = adb([
      'exec-out', 'screenrecord',
      '--output-format=h264',
      `--size=${frame.width}x${frame.height}`,
      '--bit-rate=2000000',
      `--time-limit=${TIME_LIMIT_SECONDS}`,
      '-',
    ], udid);
    state.child = child;
    if (!first) for (const each of state.sinks) each.restart();

    child.stdout?.on('data', (buf: Buffer) => {
      for (const each of state.sinks) each.chunk(buf);
    });
    let stderr = '';
    child.stderr?.on('data', (buf: Buffer) => { stderr += buf.toString(); });
    child.on('error', (err) => {
      for (const each of state.sinks) each.fail(err.message);
      streams.delete(udid);
    });
    child.on('close', (code) => {
      if (state.stopped) return;
      // Mã 0 là hết mốc thời gian — chuyện bình thường, chạy lại ngay. Mã khác
      // là máy rút ra hoặc bộ mã hoá từ chối, và im lặng chạy lại một thứ chắc
      // chắn hỏng sẽ thành một vòng lặp sinh tiến trình.
      if (code === 0) {
        launch(false);
        return;
      }
      for (const each of state.sinks) {
        each.fail(stderr.trim() || `screenrecord kết thúc với mã ${code}`);
      }
      streams.delete(udid);
    });
  };
  launch(true);

  return { frame, stop: () => detach(udid, sink) };
}

function detach(udid: string, sink: ScreenStreamSink): void {
  const state = streams.get(udid);
  if (!state) return;
  state.sinks.delete(sink);
  if (state.sinks.size > 0) return;
  state.stopped = true;
  state.child?.kill('SIGTERM');
  streams.delete(udid);
}

/** Dừng mọi luồng — dùng khi tiến trình runner tắt. */
export function stopAllScreenStreams(): void {
  for (const [udid, state] of streams) {
    state.stopped = true;
    state.child?.kill('SIGTERM');
    streams.delete(udid);
  }
}

/* ── Đầu vào ──────────────────────────────────────────────────────────── */

/**
 * Tên phím của hợp đồng → mã phím của Android.
 *
 * `Record<ControlKey, string>` chứ không phải `Record<string, string>`: thêm
 * một phím vào `CONTROL_KEYS` mà quên mã ở đây thì TYPECHECK đỏ, không phải
 * người dùng bấm rồi mới biết.
 */
const KEYS: Record<ControlKey, string> = {
  back: 'KEYCODE_BACK',
  home: 'KEYCODE_HOME',
  enter: 'KEYCODE_ENTER',
  delete: 'KEYCODE_DEL',
  tab: 'KEYCODE_TAB',
  recents: 'KEYCODE_APP_SWITCH',
};

export function controlKeys(): string[] {
  return [...CONTROL_KEYS];
}

/** Toạ độ phải là số nguyên không âm: `input` nhận chuỗi, và không kiểm gì. */
function coord(name: string, value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 20_000) {
    throw new Error(`${name} phải là số nguyên trong [0, 20000], nhận "${value}".`);
  }
  return String(value);
}

export async function tap(udid: string, x: number, y: number): Promise<void> {
  await run(['shell', 'input', 'tap', coord('x', x), coord('y', y)], udid);
}

export async function swipe(
  udid: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
  durationMs = 200,
): Promise<void> {
  await run([
    'shell', 'input', 'swipe',
    coord('x1', from.x), coord('y1', from.y),
    coord('x2', to.x), coord('y2', to.y),
    coord('duration', Math.min(10_000, Math.max(1, Math.round(durationMs)))),
  ], udid);
}

/**
 * `input text` coi dấu cách là dấu phân cách đối số, nên dấu cách thành `%s`.
 *
 * Ký tự điều khiển thì bị TỪ CHỐI thay vì tự lọc: một chuỗi có ký tự xuống
 * dòng mà ta lặng lẽ bỏ đi sẽ gõ ra một thứ khác với thứ người ta gõ, và họ
 * không biết phần nào đã mất.
 */
export function encodeText(text: string): string {
  if (CONTROL_CHARS.test(text)) {
    throw new Error('Chuỗi có ký tự điều khiển; dùng phím Enter/Delete thay vì gõ chúng.');
  }
  return text.replace(/ /g, '%s');
}

const CONTROL_CHARS = new RegExp(
  // Dựng từ mã ký tự thay vì viết thẳng, để chính file này không chứa ký tự
  // điều khiển nào — `sourceIntegrity.test.ts` canh điều đó.
  `[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
);

export async function typeText(udid: string, text: string): Promise<void> {
  if (text.length === 0) return;
  await run(['shell', 'input', 'text', encodeText(text)], udid);
}

/**
 * Kiểm LẠI ở đây, dù control plane đã kiểm.
 *
 * Runner không tin phía bên kia: ở chế độ server, "phía bên kia" là một thông
 * điệp đi qua mạng, và một control plane bị chiếm không được phép gõ
 * `KEYCODE_POWER` lên chiếc máy đang cắm ở nhà một người.
 */
export async function pressKey(udid: string, key: string): Promise<void> {
  if (!isControlKey(key)) {
    throw new Error(`Phím "${key}" không có trong danh sách cho phép.`);
  }
  await run(['shell', 'input', 'keyevent', KEYS[key]], udid);
}

/**
 * Máy Android đang cắm, dạng rút gọn cho danh sách chọn máy.
 *
 * Khác `prereqAdb()` ở chỗ nó chỉ trả những máy ở trạng thái `device` và một
 * nhãn đọc được: màn điều khiển không cần biết máy nào đang `unauthorized`,
 * vì không giữ chỗ được thì cũng không chạm được.
 */
export async function attachedDevices(): Promise<Array<{ udid: string; label: string }>> {
  const output = await run(['devices', '-l'], '', 8_000).catch(() => '');
  const ids = output.split('\n').slice(1)
    .map((line) => line.trim()).filter(Boolean)
    .map((line) => line.split(/\s+/))
    .filter(([, state]) => state === 'device')
    .map(([id]) => id!)
    .filter(Boolean);

  return Promise.all(ids.map(async (udid) => {
    const props = await run(['shell', 'getprop'], udid, 5_000).catch(() => '');
    const read = (key: string): string | undefined =>
      new RegExp(`^\\\\[${key}\\\\]: \\\\[(.*)\\\\]$`, 'm').exec(props)?.[1]?.trim() || undefined;
    const name = read('ro.product.marketname') ?? read('ro.config.marketing_name')
      ?? read('ro.product.model') ?? udid;
    const version = read('ro.build.version.release');
    return {
      udid,
      label: [name, version && `Android ${version}`,
        udid.startsWith('emulator-') ? 'emulator' : undefined].filter(Boolean).join(' · '),
    };
  }));
}
