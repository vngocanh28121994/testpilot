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
 * Hôm nay có HAI đường, và `screenrecord` là đường lui:
 *
 * - **scrcpy** ([scrcpy/](./scrcpy/)) khi mở được. Hình đi qua một socket đã
 *   mở sẵn thay vì stdout của một tiến trình, và quan trọng hơn: mỗi cú chạm
 *   là một gói 32 byte trên socket ấy, thay vì một lần `adb shell input` phải
 *   dựng cả một cái shell trên máy.
 * - **`screenrecord`** khi không. scrcpy cần `adb reverse` và quyền chạy
 *   `app_process`; cả hai đều có môi trường chặn. Một lần hỏng ở đó phải thành
 *   "chậm hơn", không thành "không xem được màn hình" — nên đường cũ ở lại
 *   nguyên vẹn chứ không bị rút xuống thành mã chết.
 *
 * Giới hạn đã biết, nói ra chứ không giấu: `screenrecord` không chụp được
 * surface bảo mật (màn nhập mật khẩu, DRM) — vùng ấy ra khung đen, đúng như khi
 * quay phim bằng tay. Và tốc độ khung là tốc độ MÁY dựng hình, không phải tốc
 * độ ta xin: một emulator chạy không cửa sổ (`-no-window`) dựng hình ~10
 * khung/giây, nên stream cũng chỉ ra chừng ấy dù đặt `--size` hay `--bit-rate`
 * thế nào. Cùng chiếc AVD ấy bật kèm cửa sổ và `-gpu host` cho 23 khung/giây.
 * Đo bằng `dumpsys gfxinfo`: 101ms/khung khi không cửa sổ, 42ms khi có.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { CONTROL_KEYS, isControlKey, type ControlKey } from '../protocol/control.js';
import {
  ACTION_DOWN,
  ACTION_MOVE,
  ACTION_UP,
  KEY_DOWN,
  KEY_UP,
  keyMessage,
  textMessage,
  touchMessage,
} from './scrcpy/protocol.js';
import { startScrcpy, type ScrcpySession } from './scrcpy/session.js';
import { StreamPrimer } from './h264.js';

/**
 * Mốc thời gian của `screenrecord`. `0` là "không giới hạn" — có từ bản 1.4 của
 * lệnh này, và là thứ ta muốn: mỗi lần hết mốc rồi khởi động lại là một khoảng
 * hở khoảng một giây ngay giữa lúc người ta đang thao tác.
 *
 * Bản cũ hơn từ chối `0` và chấp nhận tối đa 180. Không có đường nào hỏi trước
 * xem máy này thuộc bên nào, nên ta thử `0`, và nếu nó chết trước khi ra được
 * byte nào thì hạ xuống 180 rồi nhớ lấy cho những lần sau của chiếc máy ấy.
 */
const NO_TIME_LIMIT = 0;
const MAX_TIME_LIMIT_SECONDS = 180;

/** Những máy đã từ chối `--time-limit=0`. Hỏi một lần, nhớ cả phiên. */
const needsTimeLimit = new Set<string>();

/** Chiều rộng đích. Cao hơn nữa thì băng thông tăng mà chữ trên máy không rõ thêm. */
const TARGET_WIDTH = 720;

/**
 * Chiều rộng đích cho MÁY GIẢ LẬP — nhỏ hơn hẳn, và đây là con số đắt nhất
 * trong file này nên nó có cả một bảng đo đi kèm.
 *
 * Máy giả lập không có bộ mã hoá phần cứng: H.264 chạy bằng CPU của máy tính,
 * và `qemu` ăn trọn một lõi trong lúc quay. Máy thật thì có mạch mã hoá riêng
 * và không quan tâm tới cỡ ảnh ở mức này.
 *
 * Đo trên AVD Medium_Phone_API_36.0 (màn 1080x2400, chạy có cửa sổ, `-gpu
 * host`), vuốt liên tục trong mười lăm giây:
 *
 * | cạnh dài | khung/giây |
 * |---|---|
 * | 1600 | 9,7 |
 * | 1280 | 11-13 |
 * | 1100 | 16,5 |
 * | **960** | **17,7** |
 * | 800 | 25,5 |
 * | 640 | 29,9 (chạm trần `MAX_FPS`) |
 *
 * Không có điểm gãy — nó tỉ lệ nghịch với số điểm ảnh. Nên đây là một lựa
 * chọn giữa hai thứ đều thật: 960 gần gấp đôi tốc độ so với 1600 mà chữ vẫn
 * đọc được; 800 mượt hơn nữa nhưng chữ nhỏ bắt đầu nhoè.
 *
 * Và nói rõ điều KHÔNG phải nguyên nhân, vì tôi đã đo nhầm nó một lần: máy ảo
 * dựng hình 27 khung/giây (`dumpsys gfxinfo`, p50 26ms, kẹt 18%). Phần dựng
 * hình không nghẽn — chỉ phần mã hoá nghẽn.
 */
const EMULATOR_TARGET_WIDTH = 432;

/** Máy giả lập: adb đặt tên chúng là `emulator-<cổng>`, không trừ trường hợp nào. */
function isEmulator(udid: string): boolean {
  return udid.startsWith('emulator-');
}

const BIT_RATE = 2_000_000;

/**
 * Trần tốc độ khung xin scrcpy.
 *
 * Cao hơn số này thì bộ mã hoá của máy làm việc nhiều hơn mà mắt không thấy
 * khác — một chiếc máy 120Hz sẽ cố mã hoá 120 khung/giây nếu không ai chặn.
 * `screenrecord` không có cờ nào tương đương, nên đây là thứ chỉ đường scrcpy
 * mới có.
 */
const MAX_FPS = 30;

/** Mã phím Android, cho đường scrcpy — nó nhận số, không nhận tên. */
const KEYCODES: Record<ControlKey, number> = {
  back: 4,
  home: 3,
  enter: 66,
  delete: 67,
  tab: 61,
  recents: 187,
};

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
  /**
   * Phần đầu luồng cho người xem VÀO SAU — gửi trước mọi mảnh trực tiếp.
   *
   * Trả về đây thay vì tự đẩy vào sink, vì THỨ TỰ chịu lực: người xem phải
   * nhận `meta` (biết codec, biết kích thước) rồi mới dựng bộ giải mã. Bản đầu
   * đẩy thẳng vào sink ngay trong `startScreenStream`, nên phần giữ tới TRƯỚC
   * `meta` và bị vứt — luồng chạy tiếp bằng khung P và ảnh đứng im, không lỗi.
   *
   * Vắng mặt với người xem đầu tiên: luồng của họ vốn đã bắt đầu từ đầu.
   */
  readonly primer?: Buffer;
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
export function frameSizeFor(
  screen: { width: number; height: number },
  target = TARGET_WIDTH,
): { width: number; height: number } {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  if (screen.width <= target) {
    return { width: even(screen.width), height: even(screen.height) };
  }
  return {
    width: even(target),
    height: even((target * screen.height) / screen.width),
  };
}

/**
 * Một tiến trình cho một chiếc máy.
 *
 * Hai `screenrecord` cùng lúc trên một máy là hai bộ mã hoá tranh nhau, và kết
 * quả là cả hai giật. Nên nhiều người xem — cùng một người mở hai tab là đủ —
 * dùng chung một tiến trình, và tiến trình tắt khi người xem cuối cùng rời đi.
 */
interface StreamState {
  child?: ChildProcess;
  /** Giữ SPS/PPS và khung khoá gần nhất, cho người xem vào sau. */
  primer: StreamPrimer;
  sinks: Set<ScreenStreamSink>;
  frame: { width: number; height: number };
  stopped: boolean;
  sawBytes: boolean;
  /**
   * Phiên scrcpy, khi mở được.
   *
   * Vắng mặt nghĩa là đang đi đường `screenrecord`. Các lệnh chạm đọc trường
   * này để biết gửi qua socket hay gọi `adb shell input` — và đó là lý do nó
   * nằm ở state của LUỒNG HÌNH chứ không ở một bản đồ riêng: hai thứ ấy sống
   * chết cùng nhau, và tách ra là mời một trạng thái lệch.
   */
  scrcpy?: ScrcpySession;
  /** Kích thước màn hình mà giao diện đo toạ độ theo. */
  screen: ScreenSize;
}

const streams = new Map<string, StreamState>();

/**
 * Máy này đang có phiên scrcpy không.
 *
 * Nếu có thì chạm đi qua socket đã mở sẵn — không sinh tiến trình, không chờ
 * `adb shell` dựng một cái shell trên máy. Đó là phần lớn độ trễ của một cú
 * chạm ở đường cũ.
 */
function sessionFor(udid: string): StreamState | undefined {
  const state = streams.get(udid);
  return state?.scrcpy ? state : undefined;
}

/**
 * Toạ độ theo hệ MÀN HÌNH → toạ độ theo hệ KHUNG VIDEO.
 *
 * scrcpy từ chối mọi sự kiện có kích thước khai báo khác kích thước video đang
 * phát — `PositionMapper.map()` trả `null` và sự kiện bị bỏ IM LẶNG, không lỗi,
 * không log ở mức thường. Đó chính xác là điều đã xảy ra: gửi 1080x2400 trong
 * khi video là 720x1600, và mọi cú chạm rơi vào hư không trong khi HTTP vẫn
 * trả 200.
 *
 * Phép kiểm ấy có lý do: máy có thể vừa xoay kể từ lúc sự kiện được sinh ra,
 * và một cú chạm tính theo khung cũ sẽ rơi sai chỗ. Nó thà bỏ còn hơn đoán.
 *
 * Giao diện đo theo hệ màn hình (`toScreenPoint`) nên phép quy đổi nằm ở đây,
 * sát chỗ biết cả hai con số.
 */
function toFrame(state: StreamState, x: number, y: number): {
  x: number; y: number; width: number; height: number;
} {
  // Kích thước ĐỌC TỪ LUỒNG khi có, không phải kích thước ta tự tính: scrcpy
  // làm tròn theo luật riêng của nó, và một chênh lệch một pixel cũng làm mọi
  // cú chạm bị bỏ. Con số tự tính chỉ dùng trong khoảnh khắc trước khi SPS đầu
  // tiên về.
  const frame = state.primer.videoSize() ?? state.frame;
  return {
    x: (x * frame.width) / state.screen.width,
    y: (y * frame.height) / state.screen.height,
    width: frame.width,
    height: frame.height,
  };
}

/**
 * Thử mở phiên scrcpy và nối luồng của nó vào các sink.
 *
 * Trả về `false` thay vì ném: gọi được scrcpy hay không là chuyện của môi
 * trường, không phải lỗi của người dùng, và câu trả lời đúng khi không được là
 * đi đường cũ chứ không phải một màn hình lỗi.
 */
async function attachScrcpy(udid: string, state: StreamState): Promise<boolean> {
  let session: ScrcpySession;
  try {
    session = await startScrcpy(udid, {
      // `max_size` của scrcpy chặn CẠNH DÀI, không phải bề rộng. Đưa bề rộng
      // vào đây là thu một màn hình dọc xuống còn 324x720 — nhỏ hơn hẳn thứ
      // `screenrecord` vẫn gửi, và không ai đọc được chữ trên đó nữa.
      maxSize: Math.max(state.frame.width, state.frame.height),
      bitRate: BIT_RATE,
      maxFps: MAX_FPS,
    });
  } catch (err) {
    // NÓI RA vì sao. Bản đầu nuốt lỗi ở đây, và hậu quả đúng như đáng ra phải
    // đoán được: hệ thống chạy tiếp bằng đường chậm, không ai biết, và khi đi
    // tìm thì không có một dòng nào để đọc. Tụt về đường lui là chuyện bình
    // thường; tụt về mà im lặng thì không.
    console.error(`[control] scrcpy không mở được trên ${udid}, dùng screenrecord: `
      + (err as Error).message);
    return false;
  }

  state.scrcpy = session;
  session.video.on('data', (buf: Buffer) => {
    state.sawBytes = true;
    // Người đang xem nhận TRƯỚC; bộ giữ ăn theo một bản sao và không nằm trên
    // đường đi của dữ liệu.
    for (const each of state.sinks) each.chunk(buf);
    state.primer.push(buf);
  });
  // scrcpy không tự hết giờ như `screenrecord`, nên một lần đóng ở đây LUÔN là
  // chuyện bất thường: máy rút ra, hoặc server chết. Không chạy lại ngầm.
  session.video.on('close', () => {
    if (state.stopped) return;
    for (const each of state.sinks) each.fail('scrcpy đóng luồng hình');
    void session.stop();
    streams.delete(udid);
  });
  return true;
}

export async function startScreenStream(
  udid: string,
  sink: ScreenStreamSink,
): Promise<ScreenStreamHandle> {
  const existing = streams.get(udid);
  if (existing) {
    existing.sinks.add(sink);
    // Người vào SAU chỉ nhận được khung P từ đây trở đi, và bộ giải mã không
    // dựng được gì từ chúng: trắng màn, không báo lỗi, không tự hết.
    return {
      frame: existing.frame,
      primer: existing.primer.primer(),
      stop: () => detach(udid, sink),
    };
  }

  const screen = await screenSize(udid);
  const frame = frameSizeFor(
    screen,
    isEmulator(udid) ? EMULATOR_TARGET_WIDTH : TARGET_WIDTH,
  );
  const state: StreamState = {
    sinks: new Set([sink]), frame, stopped: false, sawBytes: false, screen,
    primer: new StreamPrimer(),
  };
  streams.set(udid, state);

  // scrcpy trước, `screenrecord` làm đường lui. scrcpy cần `adb reverse` và
  // quyền chạy `app_process` — hai thứ có môi trường chặn — nên một lần hỏng ở
  // đây phải thành "chậm hơn", không thành "không xem được màn hình".
  if (await attachScrcpy(udid, state)) {
    return { frame: state.frame, stop: () => detach(udid, sink) };
  }

  const launch = (first: boolean): void => {
    if (state.stopped) return;
    const limit = needsTimeLimit.has(udid) ? MAX_TIME_LIMIT_SECONDS : NO_TIME_LIMIT;
    state.sawBytes = false;
    const child = adb([
      'exec-out', 'screenrecord',
      '--output-format=h264',
      `--size=${frame.width}x${frame.height}`,
      '--bit-rate=2000000',
      `--time-limit=${limit}`,
      '-',
    ], udid);
    state.child = child;
    if (!first) for (const each of state.sinks) each.restart();

    child.stdout?.on('data', (buf: Buffer) => {
      state.sawBytes = true;
      for (const each of state.sinks) each.chunk(buf);
      state.primer.push(buf);
    });
    let stderr = '';
    child.stderr?.on('data', (buf: Buffer) => { stderr += buf.toString(); });
    child.on('error', (err) => {
      for (const each of state.sinks) each.fail(err.message);
      streams.delete(udid);
    });
    child.on('close', (code) => {
      if (state.stopped) return;
      // Chết mà chưa ra được byte nào, trong khi ta vừa xin "không giới hạn":
      // đây là bản `screenrecord` cũ không hiểu `0`. Hạ xuống 180 và chạy lại.
      // Điều kiện "chưa ra byte nào" là thứ phân biệt nó với một chiếc máy bị
      // rút ra giữa chừng — máy rút ra thì đã kịp phát hình rồi.
      if (code !== 0 && !state.sawBytes && !needsTimeLimit.has(udid)) {
        needsTimeLimit.add(udid);
        launch(false);
        return;
      }
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
  // `void`: người xem cuối cùng vừa rời đi và không ai chờ câu trả lời, nhưng
  // `stop()` còn phải gỡ `adb reverse` trên máy — bỏ qua nó là để lại rác.
  void state.scrcpy?.stop();
  streams.delete(udid);
}

/** Dừng mọi luồng — dùng khi tiến trình runner tắt. */
export function stopAllScreenStreams(): void {
  for (const [udid, state] of streams) {
    state.stopped = true;
    state.child?.kill('SIGTERM');
    void state.scrcpy?.stop();
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
  // Kiểm TRƯỚC khi rẽ đường, dù scrcpy không cần: người gọi không được thấy
  // luật khác nhau tuỳ đường nào tình cờ đang mở. Một toạ độ âm hay lớn vô lý
  // là một lỗi ở phía gọi, và nó phải bị từ chối như nhau ở cả hai bên.
  const ax = coord('x', x);
  const ay = coord('y', y);
  const live = sessionFor(udid);
  if (live) {
    const at = toFrame(live, x, y);
    live.scrcpy!.send(touchMessage({ ...at, action: ACTION_DOWN }));
    live.scrcpy!.send(touchMessage({ ...at, action: ACTION_UP }));
    return;
  }
  await run(['shell', 'input', 'tap', ax, ay], udid);
}

/** Một cú quét mượt cần nhiều điểm giữa; ~60 điểm/giây là đủ để không thấy giật. */
const SWIPE_STEP_MS = 16;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

export async function swipe(
  udid: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
  durationMs = 200,
): Promise<void> {
  // Như `tap`: cùng một luật cho cả hai đường.
  const x1 = coord('x1', from.x);
  const y1 = coord('y1', from.y);
  const x2 = coord('x2', to.x);
  const y2 = coord('y2', to.y);
  const live = sessionFor(udid);
  if (live) {
    // `input swipe` gửi cả cử chỉ như MỘT lệnh và máy tự nội suy; scrcpy thì
    // nhận từng điểm, nên ta phải tự rải. Điều đổi lại là cuộn theo ngón tay
    // thật sự — ứng dụng nhận được các điểm giữa và tính được vận tốc, thứ
    // quyết định nó có trôi tiếp sau khi nhấc tay hay không.
    const steps = Math.max(1, Math.round(durationMs / SWIPE_STEP_MS));
    live.scrcpy!.send(touchMessage({ ...toFrame(live, from.x, from.y), action: ACTION_DOWN }));
    for (let step = 1; step <= steps; step += 1) {
      await sleep(SWIPE_STEP_MS);
      const ratio = step / steps;
      live.scrcpy!.send(touchMessage({
        ...toFrame(
          live,
          from.x + (to.x - from.x) * ratio,
          from.y + (to.y - from.y) * ratio,
        ),
        action: ACTION_MOVE,
      }));
    }
    live.scrcpy!.send(touchMessage({ ...toFrame(live, to.x, to.y), action: ACTION_UP }));
    return;
  }
  await run([
    'shell', 'input', 'swipe', x1, y1, x2, y2,
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
  const live = sessionFor(udid);
  if (live) {
    // Đường scrcpy KHÔNG cần `encodeText`: chuỗi đi ở dạng UTF-8 có độ dài
    // kèm theo, nên dấu cách không phải trốn thành `%s`. Nhưng vẫn từ chối ký
    // tự điều khiển, vì lý do từ chối chúng không phải là chuyện mã hoá.
    if (CONTROL_CHARS.test(text)) {
      throw new Error('Chuỗi có ký tự điều khiển; dùng phím Enter/Delete thay vì gõ chúng.');
    }
    live.scrcpy!.send(textMessage(text));
    return;
  }
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
  const live = sessionFor(udid);
  if (live) {
    live.scrcpy!.send(keyMessage(KEY_DOWN, KEYCODES[key]));
    live.scrcpy!.send(keyMessage(KEY_UP, KEYCODES[key]));
    return;
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
    const props = parseProps(await run(['shell', 'getprop'], udid, 5_000).catch(() => ''));
    return { udid, label: deviceLabel(udid, props) };
  }));
}

/**
 * `getprop` → bảng tra.
 *
 * Phân tích MỘT LẦN thay vì dựng một `RegExp` cho mỗi khoá. Bản đầu làm cách
 * thứ hai và nó hỏng theo kiểu tệ nhất: chuỗi mẫu bị thừa dấu escape
 * (`\\\\[` thay vì `\\[`), nên regex không khớp được dòng nào — và vì mọi
 * phép đọc đều có `?? udid` đứng sau, nó KHÔNG báo lỗi. Nó chỉ lặng lẽ trả về
 * số sê-ri cho mọi chiếc máy, suốt nhiều tuần, cho tới khi có người cắm một
 * chiếc điện thoại thật vào và hỏi "máy này là máy gì".
 *
 * Một hàm thuần thì test được bằng đúng thứ `adb` in ra.
 */
export function parseProps(output: string): Map<string, string> {
  const props = new Map<string, string>();
  for (const line of output.split('\n')) {
    const at = line.indexOf(']: [');
    if (at < 1 || !line.startsWith('[') || !line.trimEnd().endsWith(']')) continue;
    const key = line.slice(1, at);
    const value = line.slice(at + 4, line.trimEnd().length - 1).trim();
    if (key && value) props.set(key, value);
  }
  return props;
}

/**
 * Tên đọc được của một chiếc máy Android.
 *
 * Thứ tự ưu tiên là thứ tự "người ta gọi nó là gì" giảm dần. Samsung không
 * khai tên thương mại trong `getprop` — một chiếc Galaxy S23 Ultra chỉ nói
 * `SM-S918B` — nên ghép thêm hãng vào: "Samsung SM-S918B" nhận ra được, còn
 * "SM-S918B" một mình thì phải đi tra.
 *
 * Rơi về `udid` là đường CUỐI. Nó đúng về mặt kỹ thuật và vô dụng với người
 * đang chọn máy, nên mọi nhánh trên tồn tại để không phải dùng tới nó.
 */
export function deviceLabel(udid: string, props: Map<string, string>): string {
  const get = (key: string): string | undefined => props.get(key)?.trim() || undefined;
  const emulator = udid.startsWith('emulator-');
  const model = get('ro.product.model');
  const maker = get('ro.product.manufacturer');
  const name = get('ro.product.marketname')
    ?? get('ro.config.marketing_name')
    // Máy giả lập KHÔNG ghép hãng: "Google sdk_gphone64_arm64" dài hơn mà
    // không nói thêm gì — hậu tố "· emulator" ở dưới đã trả lời câu hỏi mà
    // tên hãng định trả lời.
    ?? (model && maker && !emulator && !model.toLowerCase().startsWith(maker.toLowerCase())
      ? `${capitalise(maker)} ${model}`
      : model)
    ?? udid;
  const version = get('ro.build.version.release');
  return [
    name,
    version && `Android ${version}`,
    emulator ? 'emulator' : undefined,
  ].filter(Boolean).join(' · ');
}

/** `samsung` → `Samsung`. Hãng khai bằng chữ thường; người đọc thì không viết thế. */
function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
