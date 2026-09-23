/**
 * Dựng một phiên scrcpy: đẩy file lên máy, mở đường về, chờ nó gọi ra.
 *
 * Trình tự bắt buộc, và không đảo được: ta phải ĐANG NGHE trước khi server
 * khởi động, vì với `tunnel_forward=false` chính server là bên gọi ra. Bật
 * server trước rồi mới mở cổng nghe là một cuộc đua mà phần thua hiện ra dưới
 * dạng "thỉnh thoảng không lên hình".
 *
 * Tại sao `adb reverse` chứ không `adb forward`: forward thì ta gọi vào máy,
 * và phải đoán khi nào server đã kịp lắng nghe — scrcpy gửi một byte giả để
 * dò, nhưng `raw_stream=true` tắt mất byte ấy. Reverse thì không có gì phải
 * đoán.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { once } from 'node:events';
import { createServer, type Server, type Socket } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { REMOTE_JAR, SCRCPY_VERSION, serverArgs, socketName } from './protocol.js';

/** Chờ server gọi ra bao lâu thì thôi. */
const HANDSHAKE_TIMEOUT_MS = 10_000;

/**
 * Đường tới file jar đã nhúng.
 *
 * Tính từ vị trí file này chứ không từ thư mục làm việc: runner được khởi động
 * từ bất cứ đâu, và `process.cwd()` của nó là thư mục người dùng đang đứng.
 */
export function vendoredJar(): string {
  // `dist/runner/scrcpy/` → gốc repo là bốn bậc lên.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '../../../vendor/scrcpy', `scrcpy-server-v${SCRCPY_VERSION}`);
}

export interface ScrcpySession {
  /** Luồng H.264 Annex-B thô, giống hệt thứ `screenrecord` vẫn gửi. */
  readonly video: Socket;
  /** Gửi một lệnh điều khiển đã mã hoá. */
  send(message: Buffer): void;
  /** Đóng phiên và trả lại mọi thứ đã mượn trên máy. */
  stop(): Promise<void>;
}

export interface ScrcpyOptions {
  maxSize: number;
  bitRate: number;
  maxFps: number;
  /** Để test thay bằng một bản giả; mặc định là `adb` thật. */
  spawnAdb?: (args: string[]) => ChildProcess;
}

function adbFor(udid: string, spawnAdb?: ScrcpyOptions['spawnAdb']) {
  return (args: string[]): ChildProcess => (spawnAdb
    ? spawnAdb(['-s', udid, ...args])
    : spawn('adb', ['-s', udid, ...args], { stdio: ['ignore', 'pipe', 'pipe'] }));
}

/** Chạy một lệnh adb ngắn và đòi nó thành công. */
async function adbOk(run: (args: string[]) => ChildProcess, args: string[]): Promise<void> {
  const child = run(args);
  let stderr = '';
  child.stderr?.on('data', (buf: Buffer) => { stderr += buf.toString(); });
  const [code] = (await once(child, 'close')) as [number | null];
  if (code !== 0) {
    throw new Error(`adb ${args[0]} hỏng: ${stderr.trim() || `mã ${code}`}`);
  }
}

export async function startScrcpy(
  udid: string,
  options: ScrcpyOptions,
): Promise<ScrcpySession> {
  const adb = adbFor(udid, options.spawnAdb);
  // 31 bit: scrcpy đọc `scid` bằng `Integer.parseInt`, nên bit dấu là số âm.
  const scid = Math.floor(Math.random() * 0x7fffffff);
  const name = socketName(scid);

  const sockets: Socket[] = [];
  const listener: Server = createServer((socket) => {
    socket.setNoDelay(true);
    sockets.push(socket);
  });
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = (listener.address() as net.AddressInfo).port;

  let server: ChildProcess | undefined;
  const cleanup = async (): Promise<void> => {
    server?.kill('SIGTERM');
    for (const socket of sockets) socket.destroy();
    listener.close();
    // Gỡ đường về dù có hỏng hay không: một `reverse` bỏ quên nằm lại trên máy
    // cho tới lần rút dây tiếp theo, và phiên sau mang `scid` khác nên không ai
    // đụng tới nó — nó chỉ lặng lẽ tích lại.
    await adbOk(adb, ['reverse', '--remove', `localabstract:${name}`]).catch(() => {});
  };

  try {
    await adbOk(adb, ['reverse', `localabstract:${name}`, `tcp:${port}`]);
    // Đẩy MỖI PHIÊN, không cache: đã đo, đẩy 717 KB hết 62 ms còn đi hỏi xem
    // máy đã có đúng bản chưa hết 77-117 ms, vì `adb push` truyền file thẳng
    // còn `adb shell` phải dựng một tiến trình trên máy.
    await adbOk(adb, ['push', vendoredJar(), REMOTE_JAR]);

    server = adb([
      'shell',
      `CLASSPATH=${REMOTE_JAR}`,
      'app_process', '/', 'com.genymobile.scrcpy.Server',
      ...serverArgs({ scid, ...options }),
    ]);
    let stderr = '';
    server.stderr?.on('data', (buf: Buffer) => { stderr += buf.toString(); });

    const [video, control] = await waitForSockets(listener, sockets, server, () => stderr);
    return {
      video,
      send(message: Buffer) { control.write(message); },
      stop: cleanup,
    };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

/**
 * Chờ đúng hai kết nối: video trước, điều khiển sau.
 *
 * Thứ tự do server quyết định (`DesktopConnection.open`), không do ta — nên
 * đây là một chỗ chép lại một sự thật ở phía bên kia, và nó chỉ đúng chừng nào
 * phiên bản còn khớp. Đó là lý do số hiệu phiên bản là một hằng số chung với
 * tên file jar.
 */
function waitForSockets(
  listener: Server,
  sockets: Socket[],
  server: ChildProcess,
  stderr: () => string,
): Promise<[Socket, Socket]> {
  return new Promise((resolve, reject) => {
    const done = (err?: Error): void => {
      clearTimeout(timer);
      listener.off('connection', onConnection);
      server.off('close', onClose);
      if (err) reject(err); else resolve([sockets[0]!, sockets[1]!]);
    };
    const onConnection = (): void => { if (sockets.length >= 2) done(); };
    // Hai socket có thể đã tới TRƯỚC khi hàm này kịp gắn bộ lắng nghe — chúng
    // được nhận bởi callback của `createServer`, thứ gắn từ đầu. Chỉ chờ sự
    // kiện là bỏ lỡ chúng và ngồi tới hết giờ, một kiểu hỏng chỉ lộ ra trên
    // máy nhanh hoặc lúc máy đang rảnh.
    if (sockets.length >= 2) { resolve([sockets[0]!, sockets[1]!]); return; }
    // Server chết trước khi gọi ra thì câu lỗi của NÓ là câu đáng đọc — đặc
    // biệt câu "does not match" khi số hiệu lệch, thứ nói thẳng phải sửa gì.
    const onClose = (): void => done(new Error(
      stderr().trim() || 'scrcpy-server thoát trước khi kết nối được',
    ));
    const timer = setTimeout(() => done(new Error(
      `scrcpy-server không gọi ra sau ${HANDSHAKE_TIMEOUT_MS / 1000}s`
      + `${stderr().trim() ? `: ${stderr().trim()}` : ''}`,
    )), HANDSHAKE_TIMEOUT_MS);
    listener.on('connection', onConnection);
    server.on('close', onClose);
  });
}
