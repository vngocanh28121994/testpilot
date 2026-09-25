/**
 * Luồng hình iPhone QUA CÁP USB — thay cho MJPEG của WebDriverAgent.
 *
 * Đo trên iPhone 12 Pro Max (iOS 26), cùng một lúc vuốt màn hình:
 *
 *   MJPEG của WDA     ~18 khung/giây, ảnh 385×834 (30%), ~1,7 MB/s
 *   quay qua USB      ~40 khung/giây, ảnh gốc 1284×2778, khung đầu sau 0,8 giây
 *
 * Và quan trọng không kém: mỗi khung MJPEG là một lần XCTest chụp màn hình
 * NGAY TRÊN điện thoại, tranh CPU với chính cú chạm người dùng đang gửi. Quay
 * qua USB là việc của macOS, WDA chỉ còn lo phần chạm.
 *
 * Việc quay nằm trong một app Swift nhỏ ([native/ios-screen](../../native/ios-screen/main.swift)),
 * vì macOS coi nguồn ấy là camera và chỉ hỏi quyền cho app có mô tả lý do.
 * File này dựng app ấy khi cần, mở nó, và đọc luồng nó gửi về qua TCP cục bộ.
 *
 * Một app cho một chiếc máy, và nó phát được HAI dạng: H.264 cho người xem
 * giải mã được (trang HTTPS hoặc localhost — WebCodecs chỉ có ở đó), JPEG cho
 * người xem qua HTTP thường. Dạng nào không ai xem thì app không mã hoá.
 */
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

const SOURCE_DIR = 'native/ios-screen';
const APP_PATH = '.testpilot/bin/TestPilotScreen.app';
const BUILD_SCRIPT = 'scripts/build-ios-screen.sh';

/* ── Gói tin ──────────────────────────────────────────────────────────── */

export type ScreenPacket =
  | { kind: 'info'; info: ScreenInfo }
  | { kind: 'h264'; data: Buffer }
  | { kind: 'jpeg'; data: Buffer }
  | { kind: 'error'; message: string };

export interface ScreenInfo {
  device: string;
  source: { width: number; height: number };
  h264: { width: number; height: number };
  jpeg: { width: number; height: number };
}

const KINDS: Record<string, ScreenPacket['kind']> = { i: 'info', h: 'h264', j: 'jpeg', e: 'error' };

/**
 * Tách luồng byte thành gói: [1 byte loại][4 byte độ dài big-endian][dữ liệu].
 *
 * TCP không giữ biên gói — một lần đọc có thể là nửa gói, hay ba gói rưỡi —
 * nên phần dư được giữ lại tới lần đọc sau. Loại lạ thì bỏ qua gói ấy thay vì
 * ném: một app bản mới gửi thêm loại gói không được làm đứt luồng hình.
 */
export class PacketReader {
  private pending: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): ScreenPacket[] {
    this.pending = this.pending.length > 0 ? Buffer.concat([this.pending, chunk]) : chunk;
    const out: ScreenPacket[] = [];
    let offset = 0;
    while (this.pending.length - offset >= 5) {
      const length = this.pending.readUInt32BE(offset + 1);
      if (this.pending.length - offset - 5 < length) break;
      const type = String.fromCharCode(this.pending[offset]!);
      const payload = this.pending.subarray(offset + 5, offset + 5 + length);
      offset += 5 + length;
      const kind = KINDS[type];
      if (kind === 'info') {
        try {
          out.push({ kind, info: JSON.parse(payload.toString('utf8')) as ScreenInfo });
        } catch {
          // Gói thông tin hỏng: bỏ qua, gói sau sẽ mang lại đúng thông tin ấy.
        }
      } else if (kind === 'error') {
        out.push({ kind, message: payload.toString('utf8') });
      } else if (kind) {
        // Chép ra: `payload` trỏ vào bộ đệm sẽ bị thay ở lần đọc sau.
        out.push({ kind, data: Buffer.from(payload) });
      }
    }
    this.pending = offset === this.pending.length ? Buffer.alloc(0) : this.pending.subarray(offset);
    return out;
  }
}

/**
 * Câu lỗi của app → câu người dùng hiểu, kèm việc cần làm.
 *
 * App chỉ gửi mã ngắn ("camera-denied"); lời nói nằm ở đây, cạnh những câu
 * tiếng Việt khác của runner, không nằm trong mã Swift.
 */
export function explainScreenError(code: string): string {
  if (code === 'camera-denied') {
    return 'Máy chủ chưa cho phép "TestPilot Screen Capture" xem màn hình iPhone. Trên máy chủ, mở '
      + 'Cài đặt hệ thống › Quyền riêng tư & Bảo mật › Camera và bật "TestPilot Screen Capture" '
      + '(macOS coi màn hình iPhone cắm USB là một camera). Tạm thời màn hình dùng đường cũ, chậm hơn.';
  }
  if (code.startsWith('device-not-found')) {
    const names = code.split(':').slice(1).join(':').trim();
    return 'macOS chưa thấy màn hình của chiếc iPhone này qua cáp USB'
      + (names ? ` (đang thấy: ${names})` : '')
      + '. Kiểm tra máy cắm bằng cáp, không phải qua Wi-Fi, và đang mở khoá.';
  }
  if (code.startsWith('capture-failed')) {
    return `Không quay được màn hình iPhone qua USB: ${code.slice('capture-failed:'.length)}`;
  }
  return code;
}

/* ── Dựng app ─────────────────────────────────────────────────────────── */

async function sourceHash(root: string): Promise<string> {
  // Cùng cách với script dựng: băm từng file, rồi băm danh sách băm.
  const lines: string[] = [];
  for (const name of ['main.swift', 'Info.plist']) {
    const file = path.join(root, SOURCE_DIR, name);
    const digest = createHash('sha256').update(await readFile(file)).digest('hex');
    lines.push(`${digest}  ${path.join(SOURCE_DIR, name)}`);
  }
  return createHash('sha256').update(`${lines.join('\n')}\n`).digest('hex');
}

let building: Promise<string> | undefined;

/**
 * Đường dẫn tới app đã dựng — dựng (lại) khi chưa có hoặc mã nguồn đã đổi.
 *
 * Một lần dựng cho cả tiến trình: hai người cùng giữ hai chiếc iPhone lúc máy
 * chủ vừa bật không được chạy `swiftc` hai lần cùng lúc vào cùng một thư mục.
 */
export function ensureScreenApp(root = process.cwd()): Promise<string> {
  building ??= (async () => {
    if (process.platform !== 'darwin') throw new Error('Quay màn hình iPhone qua USB chỉ có trên macOS.');
    const app = path.join(root, APP_PATH);
    const stamp = path.join(app, 'Contents', 'source.sha256');
    const want = await sourceHash(root);
    const have = existsSync(stamp) ? (await readFile(stamp, 'utf8')).trim() : '';
    if (have !== want) {
      await new Promise<void>((resolve, reject) => {
        execFile('bash', [path.join(root, BUILD_SCRIPT), app], { cwd: root, timeout: 300_000 },
          (err, _stdout, stderr) => (err ? reject(new Error(stderr.trim() || err.message)) : resolve()));
      });
    }
    return app;
  })();
  // Dựng hỏng thì lần sau thử lại, không nhớ mãi lỗi cũ.
  building.catch(() => { building = undefined; });
  return building;
}

/* ── Chạy app ─────────────────────────────────────────────────────────── */

export interface UsbScreen {
  /** Khổ khung hiện tại. Đổi khi máy xoay — nghe `onInfo`. */
  info: ScreenInfo;
  /** Bật/tắt từng dạng ảnh. Không ai xem dạng nào thì tắt để app khỏi mã hoá. */
  want(kind: 'h264' | 'jpeg', on: boolean): void;
  /** Xin một khung khoá H.264 ngay — cho người vừa bị bỏ bớt dữ liệu. */
  keyframe(): void;
  stop(): void;
}

export interface UsbScreenEvents {
  onInfo(info: ScreenInfo): void;
  onH264(data: Buffer): void;
  onJpeg(data: Buffer): void;
  /** Luồng đóng không do ta đóng: máy rút ra, app chết. */
  onClose(reason: string): void;
}

/**
 * Mở app quay màn hình cho MỘT chiếc iPhone, chờ nó gửi khổ khung đầu tiên.
 *
 * App được mở qua `open` (LaunchServices), không `spawn` thẳng: có vậy macOS
 * mới coi nó là một app riêng khi hỏi quyền camera. Vì thế không có stdout để
 * đọc — app nối ngược về một cổng TCP cục bộ mà hàm này mở sẵn, và đóng cổng
 * ấy là app tự thoát.
 */
export async function startUsbScreen(
  deviceName: string,
  events: UsbScreenEvents,
  opts: { root?: string; timeoutMs?: number } = {},
): Promise<UsbScreen> {
  const app = await ensureScreenApp(opts.root);
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as net.AddressInfo).port;

  return new Promise<UsbScreen>((resolve, reject) => {
    let socket: net.Socket | undefined;
    let settled = false;
    let stopped = false;
    const reader = new PacketReader();

    const done = (err?: Error): void => {
      clearTimeout(timer);
      server.close();
      if (settled) return;
      settled = true;
      if (err) {
        socket?.destroy();
        reject(err);
      }
    };

    // Lần đầu trên một máy chủ, macOS hiện hộp thoại xin quyền và chờ người
    // bấm — nên chờ lâu hơn một lần mở thường.
    const timer = setTimeout(() => {
      done(new Error('TestPilot Screen Capture không gửi được hình trong thời gian chờ. '
        + 'Nếu máy chủ đang hiện hộp thoại xin quyền camera, bấm Cho phép rồi giữ máy lại.'));
    }, opts.timeoutMs ?? 30_000);

    server.on('connection', (conn) => {
      if (socket) { conn.destroy(); return; }
      socket = conn;
      conn.setNoDelay(true);
      conn.on('data', (chunk: Buffer) => {
        for (const packet of reader.push(chunk)) {
          if (packet.kind === 'error') {
            const message = explainScreenError(packet.message);
            if (!settled) done(new Error(message));
            else events.onClose(message);
            continue;
          }
          if (packet.kind === 'info') {
            handle.info = packet.info;
            if (!settled) {
              done();
              resolve(handle);
            } else {
              events.onInfo(packet.info);
            }
            continue;
          }
          if (!settled) continue;
          if (packet.kind === 'h264') events.onH264(packet.data);
          else events.onJpeg(packet.data);
        }
      });
      conn.on('close', () => {
        if (!settled) {
          done(new Error('TestPilot Screen Capture đóng kết nối trước khi gửi hình.'));
          return;
        }
        if (!stopped) events.onClose('Luồng hình iPhone qua USB đã đóng — thường là máy vừa bị rút cáp.');
      });
      conn.on('error', () => undefined);
    });

    const command = (line: string): void => { socket?.write(`${line}\n`); };
    const handle: UsbScreen = {
      info: {
        device: deviceName,
        source: { width: 0, height: 0 },
        h264: { width: 0, height: 0 },
        jpeg: { width: 0, height: 0 },
      },
      want: (kind, on) => command(`${kind} ${on ? 1 : 0}`),
      keyframe: () => command('key'),
      stop: () => {
        stopped = true;
        socket?.destroy();
        server.close();
      },
    };

    // `-n`: một bản riêng cho mỗi chiếc máy. `-g`: không cướp tiêu điểm của
    // người đang ngồi ở máy chủ.
    const opener = spawn('open', ['-g', '-n', '-a', app, '--args', '--port', String(port), '--name', deviceName],
      { stdio: 'ignore' });
    opener.on('error', (err) => done(new Error(`Không mở được TestPilot Screen Capture: ${err.message}`)));
    opener.on('close', (code) => {
      if (code !== 0) done(new Error(`Không mở được TestPilot Screen Capture (mã ${code}).`));
    });
  });
}
