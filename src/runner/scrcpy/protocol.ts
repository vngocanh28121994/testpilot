/**
 * Định dạng dây của scrcpy 4.1 — chỉ phần ta dùng, và không có tác dụng phụ.
 *
 * Tách riêng khỏi phần mở socket vì đây là chỗ sai KHÔNG BÁO LỖI: gửi thừa một
 * byte vào lệnh chạm thì server vẫn đọc trôi, chỉ là nó đọc lệch sang trường
 * sau, và triệu chứng là ngón tay rơi xuống một chỗ khác trên màn hình. Hàm
 * thuần thì kiểm được từng byte một bằng test.
 *
 * Nguồn của mọi con số dưới đây là `ControlMessageReader.java` tại tag v4.1
 * (xem [vendor/scrcpy/README.md](../../../vendor/scrcpy/README.md)). Định dạng
 * này KHÔNG ổn định giữa các bản scrcpy.
 */

/**
 * Phải khớp đúng tên file trong `vendor/scrcpy/`.
 *
 * Server so chuỗi này với số hiệu của chính nó và chết ngay nếu lệch, nên đây
 * là một hằng số hỏng to và rõ chứ không hỏng ngầm.
 */
export const SCRCPY_VERSION = '4.1';

/** Nơi file nằm trên máy. Cùng đường dẫn scrcpy thật dùng. */
export const REMOTE_JAR = '/data/local/tmp/scrcpy-server.jar';

/** Mã lệnh, từ `ControlMessage.java`. Ta chỉ dùng bốn cái. */
const TYPE_INJECT_KEYCODE = 0;
const TYPE_INJECT_TEXT = 1;
const TYPE_INJECT_TOUCH_EVENT = 2;
const TYPE_INJECT_SCROLL_EVENT = 3;

/** `MotionEvent.ACTION_*` của Android. */
export const ACTION_DOWN = 0;
export const ACTION_UP = 1;
export const ACTION_MOVE = 2;

/** `KeyEvent.ACTION_*`. */
export const KEY_DOWN = 0;
export const KEY_UP = 1;

/**
 * Mã ngón tay. Số nào cũng được miễn là ổn định trong một cử chỉ — nhưng
 * KHÔNG được trùng `-1`, số scrcpy dành cho con trỏ chuột ảo.
 */
export const POINTER_FINGER = 0n;

/** Lực nhấn 1.0 ở dạng số cố định 16 bit không dấu mà server chờ. */
const PRESSURE_FULL = 0xffff;

/**
 * Tên socket mà server sẽ gọi ra.
 *
 * `scid` là một số ngẫu nhiên 31 bit, để hai phiên trên cùng một chiếc máy
 * không giẫm lên nhau — chuyện có thật khi hai người cùng mở một máy của phòng
 * máy. scrcpy in nó ở dạng tám chữ số hex viết thường.
 */
export function socketName(scid: number): string {
  return `scrcpy_${scid.toString(16).padStart(8, '0')}`;
}

/**
 * Tham số dòng lệnh cho server.
 *
 * `raw_stream=true` là điều làm cả việc này đáng làm: nó tắt mọi phần đầu
 * (tên máy, mã codec, nhãn thời gian từng khung) và để lại đúng một luồng
 * H.264 Annex-B — thứ mà bộ giải mã phía trình duyệt đang nhận từ
 * `screenrecord`. Không có nó, ta phải viết thêm một lớp bóc khung, và lớp ấy
 * chẳng đem lại gì.
 */
export function serverArgs(options: {
  scid: number;
  maxSize: number;
  bitRate: number;
  maxFps: number;
}): string[] {
  return [
    SCRCPY_VERSION,
    // HỆ 16, không phải hệ 10: server đọc nó bằng `Integer.parseInt(value, 0x10)`.
    // Gửi số thập phân thì nó chết ngay từ khâu đọc tham số với một
    // `NumberFormatException` không nhắc gì tới cơ số.
    `scid=${options.scid.toString(16)}`,
    'log_level=error',
    'audio=false',
    'video=true',
    'control=true',
    'raw_stream=true',
    `max_size=${options.maxSize}`,
    `video_bit_rate=${options.bitRate}`,
    `max_fps=${options.maxFps}`,
    // Không tự tắt màn hình, không tự bật nguồn: người dùng đang NHÌN chiếc
    // máy ấy trên bàn, và một cái máy tự sáng lên vì ai đó mở tab là chuyện
    // khó hiểu. `cleanup=true` để server trả lại mọi thứ nó đổi khi thoát.
    'power_on=false',
    'cleanup=true',
  ];
}

/**
 * Lệnh chạm, 32 byte.
 *
 * Bố cục theo `parseInjectTouchEvent`: type(1) action(1) pointerId(8) x(4)
 * y(4) w(2) h(2) pressure(2) actionButton(4) buttons(4).
 *
 * `w`/`h` là kích thước màn hình mà toạ độ NÀY được đo theo. Server tự quy đổi
 * sang kích thước thật, nên ta gửi thẳng toạ độ theo khung video đang xem và
 * không phải nhân chia ở đâu cả — chỗ nhân chia bằng tay là chỗ đã sinh ra lỗi
 * "chạm lệch đều" trong bản `input tap`.
 */
export function touchMessage(input: {
  action: number;
  x: number;
  y: number;
  width: number;
  height: number;
  pointerId?: bigint;
}): Buffer {
  const buf = Buffer.alloc(32);
  buf.writeUInt8(TYPE_INJECT_TOUCH_EVENT, 0);
  buf.writeUInt8(input.action, 1);
  buf.writeBigUInt64BE(input.pointerId ?? POINTER_FINGER, 2);
  buf.writeInt32BE(Math.round(input.x), 10);
  buf.writeInt32BE(Math.round(input.y), 14);
  buf.writeUInt16BE(input.width, 18);
  buf.writeUInt16BE(input.height, 20);
  // Nhấc tay ra thì lực bằng không; mọi lúc khác là nhấn hết cỡ. Server dùng
  // số này làm `pressure` của `MotionEvent`, và một cú UP còn lực nhấn là thứ
  // vài ứng dụng đọc ra thành "vẫn đang chạm".
  buf.writeUInt16BE(input.action === ACTION_UP ? 0 : PRESSURE_FULL, 22);
  buf.writeInt32BE(0, 24);
  buf.writeInt32BE(0, 28);
  return buf;
}

/** Lệnh phím, 14 byte: type(1) action(1) keycode(4) repeat(4) metaState(4). */
export function keyMessage(action: number, keycode: number): Buffer {
  const buf = Buffer.alloc(14);
  buf.writeUInt8(TYPE_INJECT_KEYCODE, 0);
  buf.writeUInt8(action, 1);
  buf.writeInt32BE(keycode, 2);
  buf.writeInt32BE(0, 6);
  buf.writeInt32BE(0, 10);
  return buf;
}

/**
 * Lệnh gõ chữ: type(1) + độ dài 4 byte + UTF-8.
 *
 * Độ dài tính bằng BYTE của UTF-8, không phải số ký tự. Với tiếng Việt hai thứ
 * này luôn khác nhau, nên nhầm chỗ này là hỏng ngay ở lần gõ đầu tiên chứ
 * không phải một trường hợp biên hiếm gặp.
 */
export function textMessage(text: string): Buffer {
  const body = Buffer.from(text, 'utf8');
  const head = Buffer.alloc(5);
  head.writeUInt8(TYPE_INJECT_TEXT, 0);
  head.writeUInt32BE(body.length, 1);
  return Buffer.concat([head, body]);
}

/**
 * Lệnh cuộn, 21 byte: type(1) x(4) y(4) w(2) h(2) hScroll(2) vScroll(2)
 * buttons(4).
 *
 * Hai trường cuộn là số cố định 16 bit CÓ DẤU trên thang [-1, 1], rồi server
 * nhân với 16. Nên muốn cuộn `n` nấc thì gửi `n/16` — và `n` ngoài khoảng
 * [-16, 16] thì không biểu diễn được.
 */
export function scrollMessage(input: {
  x: number;
  y: number;
  width: number;
  height: number;
  vScroll: number;
}): Buffer {
  const buf = Buffer.alloc(21);
  buf.writeUInt8(TYPE_INJECT_SCROLL_EVENT, 0);
  buf.writeInt32BE(Math.round(input.x), 1);
  buf.writeInt32BE(Math.round(input.y), 5);
  buf.writeUInt16BE(input.width, 9);
  buf.writeUInt16BE(input.height, 11);
  buf.writeInt16BE(0, 13);
  buf.writeInt16BE(clampFixedPoint(input.vScroll / 16), 15);
  buf.writeInt32BE(0, 17);
  return buf;
}

/** Số thực trên [-1, 1] thành số cố định 16 bit có dấu. */
function clampFixedPoint(value: number): number {
  const clamped = Math.max(-1, Math.min(1, value));
  return Math.round(clamped * 0x7fff);
}
