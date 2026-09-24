/**
 * Mọi thứ chạm tới máy đang chạy: Appium, adb, Xcode, WebDriverAgent, Terminal.
 *
 * Đây là bước tách THẬT SỰ của P1, không phải đổi chỗ như các nhóm route
 * trước. Lý do cả kế hoạch farm tồn tại nằm ở một câu: control plane chạy trên
 * domain, còn những hàm dưới đây `spawn` tiến trình trên chính cái máy chúng
 * chạy — nên chúng không được ở cùng chỗ với phần phục vụ HTTP cho người dùng
 * từ xa. Xem [FARM-ARCHITECTURE.md](../../FARM-ARCHITECTURE.md) mục 12.
 *
 * Ở chế độ `embedded` hôm nay, server gọi thẳng các hàm này trong cùng tiến
 * trình — đúng như trước. Ở chế độ `server`, chúng sống trong runner ở máy
 * khác và server nói chuyện qua giao thức ở `src/protocol/`. Phần gọi qua mạng
 * là P3/P4; phần tách nhà là bây giờ.
 *
 * Nội dung giữ nguyên từng dòng so với bản trong `src/ui/server.ts`, kể cả các
 * chú thích giải thích vì sao từng chỗ làm như thế — chúng đắt hơn code.
 */
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { closeSync, createWriteStream, existsSync, openSync, readdirSync } from 'node:fs';
import { readFile, rm, unlink } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { devicesOf, type TestPilotConfig } from '../config.js';
import { IOS_TUNNEL_COMMAND } from '../core/preflight.js';
import { attachedFromDevicectl } from '../core/iosDevices.js';

const execFileAsync = promisify(execFile);

/* Prereq helpers                                                      */
/* ------------------------------------------------------------------ */

// Strip ANSI escape sequences and replace home dir with ~ before logging.
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const HOME = os.homedir();
export const cleanLog = (s: string) =>
  s.replace(ANSI_RE, '').replace(new RegExp(HOME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '~');

function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: '127.0.0.1', port });
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => { sock.destroy(); resolve(false); });
  });
}

async function appiumHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:4723/status`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

let appiumProc: ReturnType<typeof spawn> | null = null;
let lastAppiumExit: { code: number | null; signal: NodeJS.Signals | null; at: string } | undefined;
const APPIUM_LOG_FILE = path.join(os.tmpdir(), 'testpilot-appium.log');

export async function prereqAppiumStatus(): Promise<{
  running: boolean;
  managed: boolean;
  pid?: number;
  lastExit?: typeof lastAppiumExit;
}> {
  const running = await appiumHealthy();
  return {
    running,
    managed: Boolean(running && appiumProc?.exitCode === null),
    ...(running && appiumProc?.pid ? { pid: appiumProc.pid } : {}),
    ...(lastAppiumExit ? { lastExit: lastAppiumExit } : {}),
  };
}

/**
 * Builds the ENOENT error message for when `appium` is not on PATH.
 * Checks common install locations to distinguish "not installed" from
 * "installed but PATH not set up".
 */
function appiumNotFoundMessage(): string {
  const candidates: string[] = [];

  const isWin = process.platform === 'win32';

  if (isWin) {
    const appdata = process.env.APPDATA ?? '';
    if (appdata) candidates.push(path.join(appdata, 'npm', 'appium.cmd'));
  } else {
    candidates.push(
      '/opt/homebrew/bin/appium',   // Homebrew Apple Silicon
      '/usr/local/bin/appium',       // Homebrew Intel / pkg
      '/usr/bin/appium',             // Linux system
    );
  }

  // Unix nvm: ~/.nvm/versions/node/<ver>/bin/appium
  const nvmBins: string[] = [];
  if (!isWin) {
    const nvmRoot = path.join(HOME, '.nvm', 'versions', 'node');
    if (existsSync(nvmRoot)) {
      try {
        for (const ver of readdirSync(nvmRoot)) {
          const p = path.join(nvmRoot, ver, 'bin', 'appium');
          if (existsSync(p)) nvmBins.push(p);
        }
      } catch { /* ignore */ }
    }
  }

  // nvm-windows: %APPDATA%\nvm\<ver>\appium.cmd
  const nvmWinBins: string[] = [];
  if (isWin) {
    const appdata = process.env.APPDATA ?? '';
    const nvmWinRoot = appdata ? path.join(appdata, 'nvm') : '';
    if (nvmWinRoot && existsSync(nvmWinRoot)) {
      try {
        for (const ver of readdirSync(nvmWinRoot)) {
          const p = path.join(nvmWinRoot, ver, 'appium.cmd');
          if (existsSync(p)) nvmWinBins.push(p);
        }
      } catch { /* ignore */ }
    }
  }

  const found = [
    ...candidates.filter((p) => existsSync(p)),
    ...nvmBins,
    ...nvmWinBins,
  ];

  const lines: string[] = [];

  if (found.length > 0) {
    lines.push('Appium được tìm thấy nhưng không có trong PATH của shell hiện tại:');
    for (const p of found) lines.push(`  ${p}`);
    lines.push('');
    lines.push('Thêm thư mục chứa Appium vào PATH.');
    const dir = path.dirname(found[0]!);
    if (isWin) {
      lines.push('Cách 1 — Command Prompt (cần mở lại terminal sau):');
      lines.push(`  setx PATH "%PATH%;${dir}"`);
      lines.push('');
      lines.push('Cách 2 — PowerShell (cần mở lại terminal sau):');
      lines.push(`  [System.Environment]::SetEnvironmentVariable('PATH', $env:PATH + ';${dir}', 'User')`);
      lines.push('');
      lines.push('Cách 3 — Vào System Properties → Environment Variables → User variables → PATH → Edit.');
      lines.push('');
      lines.push('Sau khi chỉnh PATH, khởi động lại máy để Windows nhận PATH mới,');
      lines.push('rồi mở lại Horus và bấm ▶ Thử lại.');
    } else {
      lines.push(`  export PATH="${dir}:$PATH"`);
      lines.push('');
      lines.push('Thêm dòng này vào ~/.zshrc hoặc ~/.bashrc để giữ sau khi khởi động lại.');
      lines.push('Sau đó khởi động lại máy, mở lại Horus và bấm ▶ Thử lại.');
    }
  } else {
    lines.push('Appium chưa được cài trên máy này.');
    lines.push('');
    lines.push('Yêu cầu: Node.js 18+ (đi kèm npm).');
    lines.push('Tải tại https://nodejs.org nếu chưa có.');
    lines.push('');
    lines.push('Sau khi có Node.js, chạy:');
    lines.push('');
    lines.push('  npm install -g appium');
    lines.push('');
    if (isWin) {
      lines.push('Nếu báo lỗi quyền trên Windows, chạy Command Prompt với quyền Administrator.');
    } else {
      lines.push('Nếu báo lỗi quyền trên macOS/Linux, dùng nvm thay vì cài Node trực tiếp.');
    }
    lines.push('Sau khi cài xong, bấm ▶ Thử lại.');
  }

  return lines.join('\n');
}

/**
 * Stops whatever Appium is listening on 4723, then starts a fresh one.
 *
 * Starting was the only thing offered here, and "already running" was treated
 * as success — which is right until the server itself is the problem. An Appium
 * that has wedged mid-download of a chromedriver still answers /status, still
 * holds its session, and still hangs every getContexts() call; the only way out
 * was a terminal. A stuck server is a normal thing to hit, so ending it is a
 * normal thing to offer.
 */
export async function restartAppium(log: (l: string) => void): Promise<void> {
  // Before the server: the runner outlives it either way, and an Appium that
  // comes back up while a stale WDA still holds the device is worse than one
  // that comes back to a clean phone.
  await stopWebDriverAgent(log);
  const pids = await listeningPids(4723);
  if (pids.length === 0) {
    log('Không có tiến trình nào giữ port 4723.');
  } else {
    // Kills by port rather than only the child this server spawned: the wedged
    // server is often one started from a terminal, and that is exactly the case
    // where someone reaches for this button.
    log(`Dừng Appium (pid ${pids.join(', ')})…`);
    for (const pid of pids) {
      try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
    }
    for (let i = 0; i < 20 && (await appiumHealthy()); i++) {
      await new Promise((r) => setTimeout(r, 500));
    }
    if (await appiumHealthy()) {
      log('Vẫn còn trả lời sau 10s — gửi SIGKILL.');
      for (const pid of pids) {
        try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    log('Đã dừng.');
  }
  appiumProc = null;
  await prereqAppium(log);
}

/**
 * PIDs *listening* on a TCP port. Empty when nothing holds it.
 *
 * `-sTCP:LISTEN` is the whole point, and leaving it out was a bug that killed
 * this server: plain `lsof -ti :4723` also lists every process holding an open
 * connection *to* that port, and this server holds one — `appiumHealthy()`
 * fetches /status through it. Restarting Appium therefore terminated the UI
 * that asked for the restart, which reads to the user as "Failed to fetch".
 */
function listeningPids(port: number): Promise<number[]> {
  return new Promise((resolve) => {
    const child = spawn('lsof', ['-ti', `:${port}`, '-sTCP:LISTEN'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (c: Buffer) => { out += c.toString(); });
    child.on('error', () => resolve([]));
    child.on('close', () => resolve(
      [...new Set(out.split('\n').map((l) => Number(l.trim())).filter((n) => Number.isInteger(n) && n > 0))]
        // Belt and braces after the above: never sign this server's own death
        // warrant, whatever lsof decides to report.
        .filter((pid) => pid !== process.pid && pid !== process.ppid),
    ));
  });
}

/** PIDs whose command line mentions `pattern`, via pgrep -f. */
function pgrepFull(pattern: string): Promise<Set<number>> {
  return new Promise((resolve) => {
    const child = spawn('pgrep', ['-f', pattern], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (c: Buffer) => { out += c.toString(); });
    // pgrep exits 1 with no output when nothing matches; that is not an error.
    child.on('error', () => resolve(new Set()));
    child.on('close', () => resolve(new Set(
      out.split('\n').map((l) => Number(l.trim())).filter((n) => Number.isInteger(n) && n > 0),
    )));
  });
}

/** PIDs whose executable's basename is `name`, via ps. */
function pidsRunning(name: string): Promise<Set<number>> {
  return new Promise((resolve) => {
    const child = spawn('ps', ['-Ao', 'pid=,comm='], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (c: Buffer) => { out += c.toString(); });
    child.on('error', () => resolve(new Set()));
    child.on('close', () => {
      const pids = new Set<number>();
      for (const line of out.split('\n')) {
        // pid, then the executable path — which may itself contain spaces, so
        // everything after the first field is the path.
        const m = /^\s*(\d+)\s+(.*)$/.exec(line);
        if (m && path.basename(m[2]!.trim()) === name) pids.add(Number(m[1]));
      }
      resolve(pids);
    });
  });
}

/**
 * PIDs of the WebDriverAgent test runner — the `xcodebuild … -scheme
 * WebDriverAgentRunner` the iOS driver starts to drive the device.
 *
 * Matched by command line rather than tracked as a child, because it is not
 * one of ours: appium-xcuitest-driver spawns it detached, so by the time
 * anything here wants it gone its parent is init.
 *
 * The command line alone is not enough to justify a SIGKILL, though. `pgrep -f`
 * reads whole command lines, so a shell, an editor or a test script that merely
 * *names* the runner matches too — a stop button that kills the terminal
 * someone typed `pkill -f WebDriverAgentRunner` into is not a stop button. So
 * the name has to appear on a process that really is xcodebuild.
 */
async function webDriverAgentPids(): Promise<number[]> {
  const [named, xcodebuilds] = await Promise.all([
    pgrepFull('WebDriverAgentRunner'),
    pidsRunning('xcodebuild'),
  ]);
  return [...named]
    .filter((pid) => xcodebuilds.has(pid))
    // Belt and braces: never sign this server's own death warrant.
    .filter((pid) => pid !== process.pid && pid !== process.ppid);
}

/**
 * Ends the WebDriverAgent runner. Resolves true when there was one to end.
 *
 * SIGTERM lets xcodebuild tear the test down cleanly, which is what actually
 * clears the banner on the phone; SIGKILL is the fallback for a runner already
 * wedged enough to ignore it.
 */
export async function stopWebDriverAgent(log: (l: string) => void = () => {}): Promise<boolean> {
  const pids = await webDriverAgentPids();
  if (pids.length === 0) return false;
  log(`Dừng WebDriverAgent (pid ${pids.join(', ')})…`);
  for (const pid of pids) {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
  }
  for (let i = 0; i < 20 && (await webDriverAgentPids()).length > 0; i++) {
    await new Promise((r) => setTimeout(r, 500));
  }
  const left = await webDriverAgentPids();
  if (left.length > 0) {
    log('Vẫn còn sau 10s — gửi SIGKILL.');
    for (const pid of left) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  log('Đã dừng WebDriverAgent — banner "Automation running" trên máy iOS sẽ tắt.');
  return true;
}

export async function prereqAppium(log: (l: string) => void): Promise<void> {
  // If our own process is still alive AND responding, no need to start another.
  if (appiumProc && appiumProc.exitCode === null && await appiumHealthy()) {
    log('✓ Appium server đang chạy rồi (pid ' + appiumProc.pid + ')');
    return;
  }
  appiumProc = null;
  // If something else is already listening on 4723 and responding to WebDriver, don't fight it.
  if (await appiumHealthy()) {
    log('✓ Đã có Appium đang lắng nghe trên port 4723 — sẵn sàng.');
    return;
  }
  return new Promise((resolve, reject) => {
    // Redirect output to a real file descriptor rather than a pipe. This keeps
    // Appium independent from UI-server hot reloads while preserving the only
    // evidence capable of explaining a later process exit.
    const sdkDefault = `${process.env.HOME ?? process.env.USERPROFILE ?? ''}/Library/Android/sdk`;
    const logFd = openSync(APPIUM_LOG_FILE, 'a');
    let child: ReturnType<typeof spawn>;
    try {
      // `*:` is the destination driver, and Appium 3 requires it: a bare
      // `adb_shell` is rejected at startup with "The full feature name must
      // include both the destination automation name or the '*' wildcard".
      // The server then exits before it ever listens, so the UI's only symptom
      // was a start button that did nothing.
      child = spawn('appium', ['--allow-insecure=*:adb_shell,*:chromedriver_autodownload'], {
        stdio: ['ignore', logFd, logFd],
        detached: true,
        env: {
          ...process.env,
          ANDROID_HOME: process.env.ANDROID_HOME ?? sdkDefault,
          ANDROID_SDK_ROOT: process.env.ANDROID_SDK_ROOT ?? sdkDefault,
        },
        // On Windows, spawn needs shell:true to resolve 'appium.cmd' in PATH.
        ...(process.platform === 'win32' ? { shell: true } : {}),
      });
    } finally {
      closeSync(logFd);
    }
    appiumProc = child;
    lastAppiumExit = undefined;
    // Unref immediately so Node doesn't wait on the child.
    child.unref();
    child.on('error', (err: NodeJS.ErrnoException) => {
      appiumProc = null;
      if (err.code === 'ENOENT') {
        reject(new Error(appiumNotFoundMessage()));
      } else {
        reject(err);
      }
    });
    child.on('close', (code, signal) => {
      appiumProc = null;
      lastAppiumExit = { code, signal, at: new Date().toISOString() };
    });

    // Poll /status until Appium is ready (max 30 s).
    log('Đang khởi động Appium…');
    const deadline = Date.now() + 30_000;
    const poll = () => {
      if (Date.now() > deadline) {
        reject(new Error('Appium không phản hồi sau 30 giây.'));
        return;
      }
      fetch('http://127.0.0.1:4723/status', { signal: AbortSignal.timeout(1000) })
        .then((r) => {
          if (r.ok) { log('✓ Appium sẵn sàng trên port 4723.'); resolve(); }
          else setTimeout(poll, 600);
        })
        .catch(() => setTimeout(poll, 600));
    };
    setTimeout(poll, 1000);
  });
}

export interface PrereqAndroidDevice {
  id: string;
  state: string;
  manufacturer?: string;
  model?: string;
  androidVersion?: string;
  kind: 'physical' | 'emulator';
}

function captureStdout(bin: string, args: string[], timeoutMs = 8_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout?.on('data', (buffer: Buffer) => { stdout += buffer.toString(); });
    child.stderr?.on('data', (buffer: Buffer) => { stderr += buffer.toString(); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(cleanLog(stderr || stdout).trim() || `${bin} kết thúc với mã ${code}`));
    });
  });
}

export async function prereqAdb(): Promise<{ devices: PrereqAndroidDevice[] }> {
  const output = await captureStdout('adb', ['devices', '-l']);
  const base = output.split('\n').slice(1)
    .map((line) => line.trim()).filter(Boolean)
    .map((line) => {
      const [id = '', state = ''] = line.split(/\s+/);
      return { id, state };
    });

  const devices = await Promise.all(base.map(async ({ id, state }): Promise<PrereqAndroidDevice> => {
    const fallbackKind = id.startsWith('emulator-') ? 'emulator' : 'physical';
    if (state !== 'device') return { id, state, kind: fallbackKind };
    try {
      const propsOutput = await captureStdout('adb', ['-s', id, 'shell', 'getprop'], 5_000);
      const props = new Map<string, string>();
      for (const match of propsOutput.matchAll(/^\[([^\]]+)\]: \[(.*)\]$/gm)) {
        props.set(match[1]!, match[2] ?? '');
      }
      const manufacturer = props.get('ro.product.manufacturer')?.trim();
      const model = props.get('ro.product.model')?.trim();
      // Tên người ta thật sự đọc được. `ro.product.model` là mã máy —
      // "SM-S918B" không nói lên đó là máy nào trên bàn. Samsung, Xiaomi và
      // Oppo đều ghi tên thương mại vào một trong các prop dưới đây; máy nào
      // không có thì thôi, quay về mã máy.
      const marketName = [
        'ro.product.marketname',
        'ro.config.marketing_name',
        'ro.product.vendor.marketname',
        'ro.product.odm.marketname',
        'ro.oppo.market.name',
        'ro.vivo.market.name',
      ].map((key) => props.get(key)?.trim()).find(Boolean);

      const androidVersion = props.get('ro.build.version.release')?.trim();
      const emulator = fallbackKind === 'emulator' || props.get('ro.kernel.qemu') === '1';
      return {
        id,
        state,
        ...(manufacturer ? { manufacturer } : {}),
        ...(model ? { model } : {}),
        ...(marketName ? { marketName } : {}),
        ...(androidVersion ? { androidVersion } : {}),
        kind: emulator ? 'emulator' : 'physical',
      };
    } catch {
      return { id, state, kind: fallbackKind };
    }
  }));
  return { devices };
}

/**
 * The udids of iOS devices actually plugged in, out of xctrace's full listing.
 *
 * `xctrace list devices` prints three sections and this machine's own name:
 *
 *   == Devices ==
 *   MacBook Air của Tuoi (B652B524-…)      <- the host, not a phone
 *   == Devices Offline ==
 *   iPhone của Anh (26.5) (00008101-…)     <- known, but NOT connected
 *   == Simulators ==
 *   iPhone 17 Simulator (26.5) (20E1F4AE-…)
 *
 * Reading every line as "attached" reported an unplugged iPhone as connected
 * and counted twelve simulators as unknown handsets. Only the first section
 * means plugged in, and within it only entries carrying an OS version are
 * devices — the host has a udid but no version.
 */
function attachedIosUdids(lines: string[]): string[] {
  const udids: string[] = [];
  let inDevices = false;
  for (const line of lines) {
    const header = /^==\s*(.+?)\s*==$/.exec(line);
    if (header) {
      inDevices = header[1] === 'Devices';
      continue;
    }
    if (!inDevices || /simulator/i.test(line)) continue;
    const m = /\([\d.]+\)\s*\(([0-9A-Fa-f-]{8,})\)\s*$/.exec(line);
    if (m?.[1]) udids.push(m[1]);
  }
  return udids;
}

/**
 * Tên máy đọc được, theo udid.
 *
 * `devicectl --json-output` là chỗ duy nhất có CẢ udid lẫn marketingName. Bảng
 * chữ mà devicectl in ra thì cột Identifier là UUID của CoreDevice, không phải
 * udid — ghép với config bằng nó là ghép trượt.
 *
 * Trả về cho MỌI máy nó thấy, kể cả máy đang tắt: danh sách chọn máy vẫn cần
 * đọc được tên của một máy chưa cắm.
 */
/**
 * Bảo Terminal chạy lệnh dựng tunnel.
 *
 * Lệnh là hằng số trong mã nguồn, không ghép từ bất cứ thứ gì người dùng nhập
 * — nên không có đường nào chèn thêm lệnh khác vào đoạn AppleScript này.
 */
export async function openTunnelTerminal(): Promise<{ ok: boolean; error?: string; command: string }> {
  if (process.platform !== 'darwin') {
    return {
      ok: false,
      command: IOS_TUNNEL_COMMAND,
      error: `Chỉ mở được Terminal trên macOS; máy này là ${process.platform}.`,
    };
  }
  const script = [
    'tell application "Terminal"',
    '  activate',
    `  do script ${JSON.stringify(IOS_TUNNEL_COMMAND)}`,
    'end tell',
  ].join('\n');
  try {
    await execFileAsync('osascript', ['-e', script], { timeout: 15_000 });
    return { ok: true, command: IOS_TUNNEL_COMMAND };
  } catch (err) {
    // Máy có thể chặn AppleScript (Automation permission). Nút chép lệnh vẫn còn
    // đó, nên câu trả lời phải nói ra để người dùng biết quay sang dùng nó.
    return {
      ok: false,
      command: IOS_TUNNEL_COMMAND,
      error: `Không mở được Terminal: ${(err as Error).message}. Bạn chép lệnh rồi chạy tay giúp nhé.`,
    };
  }
}

/** Tên dịch vụ tunnel mà `scripts/install-ios-tunnel-service.sh` cài. */
export const TUNNEL_SERVICE_LABEL = 'com.testpilot.ios-tunnel';

/**
 * Máy này có tunnel chạy như DỊCH VỤ không — tức là không cần ai gõ mật khẩu.
 *
 * Máy chủ của một device farm phải có: mọi người làm việc từ xa, và "mở
 * Terminal rồi nhập mật khẩu" trên máy chủ là bắt ai đó đi tới tận máy ấy.
 */
export function tunnelServiceInstalled(): boolean {
  return process.platform === 'darwin'
    && existsSync(`/Library/LaunchDaemons/${TUNNEL_SERVICE_LABEL}.plist`);
}

/**
 * Làm cho tunnel chạy — theo cách hợp với máy này.
 *
 * - Có dịch vụ: khởi động lại nó bằng `sudo -n` cho ĐÚNG lệnh mà quy tắc
 *   sudoers của script cài cho phép. `-n`: không bao giờ hỏi mật khẩu — thiếu
 *   quy tắc thì hỏng ngay với câu nói việc cần làm, không treo chờ ai gõ.
 * - Không có: mở Terminal với lệnh điền sẵn, cho người đang ngồi ở máy này.
 */
export async function fixTunnel(): Promise<{
  ok: boolean; mode: 'service' | 'terminal'; error?: string;
}> {
  if (!tunnelServiceInstalled()) {
    const opened = await openTunnelTerminal();
    return { ok: opened.ok, mode: 'terminal', ...(opened.error ? { error: opened.error } : {}) };
  }
  try {
    await execFileAsync('sudo',
      ['-n', '/bin/launchctl', 'kickstart', '-k', `system/${TUNNEL_SERVICE_LABEL}`],
      { timeout: 15_000 });
    return { ok: true, mode: 'service' };
  } catch (err) {
    const message = (err as Error).message;
    return {
      ok: false,
      mode: 'service',
      error: /password is required|a terminal is required/i.test(message)
        ? 'Dịch vụ tunnel đã cài nhưng thiếu quyền khởi động lại không cần mật khẩu. '
          + 'Admin chạy lại một lần trên máy này: sudo bash scripts/install-ios-tunnel-service.sh'
        : `Không khởi động lại được dịch vụ tunnel: ${message}`,
    };
  }
}

/**
 * Mở sẵn ứng dụng Cài đặt trên chính chiếc iPhone đang cắm.
 *
 * Việc tin cậy chứng chỉ nhà phát triển chỉ bấm được trên máy, không có đường
 * nào làm hộ từ đây. Thứ làm hộ được là quãng đường tới đó: người dùng cầm máy
 * lên thì Cài đặt đã mở sẵn, thay vì mở khoá rồi tự đi tìm.
 *
 * devicectl không có lệnh mở URL, nên không nhảy thẳng vào đúng mục quản lý
 * thiết bị được — đường đi cụ thể nằm ở phần mô tả của dòng kiểm tra.
 */
export async function openIosSettings(cfg: TestPilotConfig): Promise<{ ok: boolean; error?: string }> {
  const udid = devicesOf(cfg, 'ios').find((d) => d.udid)?.udid;
  if (!udid) return { ok: false, error: 'Chưa chọn máy iOS nào trong cấu hình.' };
  try {
    await execFileAsync(
      'xcrun',
      ['devicectl', 'device', 'process', 'launch', '--device', udid, '--terminate-existing', 'com.apple.Preferences'],
      { timeout: 60_000 },
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Không mở được Cài đặt trên máy: ${(err as Error).message}` };
  }
}

export async function iosDeviceNames(): Promise<Record<string, string>> {
  const file = path.join(os.tmpdir(), `tp-devicectl-${Date.now()}.json`);
  try {
    await execFileAsync('xcrun', ['devicectl', 'list', 'devices', '--json-output', file], { timeout: 20_000 });
    const parsed = JSON.parse(await readFile(file, 'utf8')) as {
      result?: { devices?: Array<{ hardwareProperties?: { udid?: string; marketingName?: string } }> };
    };
    const out: Record<string, string> = {};
    for (const device of parsed.result?.devices ?? []) {
      const udid = device.hardwareProperties?.udid;
      const name = device.hardwareProperties?.marketingName;
      if (udid && name) out[udid] = name;
    }
    return out;
  } catch {
    // Máy không có Xcode, hoặc devicectl bản cũ không nhận --json-output. Thiếu
    // tên chỉ làm danh sách khó đọc hơn, không được phép làm hỏng cả câu trả lời.
    return {};
  } finally {
    await rm(file, { force: true }).catch(() => {});
  }
}

/**
 * udid của những máy iOS thật đang dùng được, theo devicectl.
 *
 * Nguồn thứ hai bên cạnh `xctrace`, vì `xctrace` xếp máy nối qua tunnel
 * CoreDevice vào "Devices Offline" dù chúng dùng được — đo trên máy thật:
 * cùng lúc đó `devicectl device info lockState` lấy được tunnel và đọc được
 * trạng thái khoá.
 */
async function usableIosUdids(): Promise<string[]> {
  const file = path.join(os.tmpdir(), `tp-devicectl-u-${Date.now()}.json`);
  try {
    await execFileAsync('xcrun', ['devicectl', 'list', 'devices', '--json-output', file], { timeout: 20_000 });
    const parsed = JSON.parse(await readFile(file, 'utf8')) as {
      result?: { devices?: Array<{
        hardwareProperties?: { udid?: string };
        connectionProperties?: { tunnelState?: string; pairingState?: string };
      }> };
    };
    return attachedFromDevicectl(parsed);
  } catch {
    return [];
  } finally {
    await rm(file, { force: true }).catch(() => {});
  }
}

export async function prereqIosDevices(): Promise<{ devices: string[]; attached: string[]; names: Record<string, string> }> {
  const names = await iosDeviceNames();
  const usableUdids = await usableIosUdids();
  return new Promise((resolve, reject) => {
    let out = '';
    const child = spawn('xcrun', ['xctrace', 'list', 'devices'], { stdio: ['ignore', 'pipe', 'ignore'] });
    // xctrace has been seen to never exit on some Xcode installs. Without a cap
    // the request simply never answers and the button spins forever, which
    // looks like "no devices" rather than like a broken tool.
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({
        names,
        attached: [],
        devices: [
          'xcrun xctrace không phản hồi sau 15s.',
          'Thường do bản Xcode đang cài; thử: sudo xcode-select -s /Applications/Xcode.app',
          'rồi mở Xcode một lần để nó hoàn tất cài đặt thành phần.',
        ],
      });
    }, 15_000);
    timer.unref?.();
    child.stdout?.on('data', (b: Buffer) => { out += b.toString(); });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', () => {
      clearTimeout(timer);
      const devices = out.split('\n').map((l) => l.trim()).filter(Boolean);
      // Gộp hai nguồn: `xctrace` bỏ sót máy nối qua tunnel CoreDevice (nó xếp
      // chúng vào "Devices Offline"), còn `devicectl` thì thấy. Chỉ tin một
      // nguồn là bỏ rơi đúng những máy đời mới.
      const attached = [...new Set([...attachedIosUdids(devices), ...usableUdids])];
      resolve({ devices, attached, names });
    });
  });
}

/**
 * Whether this machine can build for iOS at all, and how far.
 *
 * Three separate failures look identical from the Appium error alone: no Xcode,
 * Command Line Tools only, or an Xcode too old for the phone's iOS version.
 * The last one is the quiet trap — everything installs, WebDriverAgent simply
 * refuses to deploy onto a device newer than the SDK.
 */
export async function prereqXcode(): Promise<{
  ok: boolean; version?: string; path?: string; sdk?: string; reason?: string;
}> {
  const run = async (cmd: string): Promise<string | undefined> => {
    try {
      const { stdout } = await execFileAsync('/bin/sh', ['-c', cmd], { timeout: 20_000 });
      return stdout.trim();
    } catch {
      return undefined;
    }
  };

  const selected = await run('xcode-select -p');
  if (!selected) return { ok: false, reason: 'Chưa cài Xcode, hoặc xcode-select chưa trỏ tới đâu cả.' };
  if (!selected.includes('.app')) {
    return {
      ok: false,
      path: selected,
      reason: 'Đang trỏ tới Command Line Tools, không phải Xcode đầy đủ. '
        + 'Cài Xcode rồi chạy: sudo xcode-select -s /Applications/Xcode.app',
    };
  }

  const version = (await run('xcodebuild -version'))?.split('\n')[0];
  if (!version) {
    return { ok: false, path: selected, reason: 'xcodebuild không chạy được — mở Xcode một lần để nó hoàn tất cài đặt.' };
  }
  const sdk = (await run("xcodebuild -showsdks | grep -o 'iphoneos[0-9.]*' | tail -1"));
  return { ok: true, version, path: selected, ...(sdk ? { sdk } : {}) };
}

export async function prereqInstallDriver(driver: string, log: (l: string) => void): Promise<void> {
  const safe = /^[a-z0-9-]+$/.test(driver) ? driver : '';
  if (!safe) throw new Error('Tên driver không hợp lệ');
  return new Promise((resolve, reject) => {
    let output = '';
    const child = spawn('appium', ['driver', 'install', safe], { stdio: ['ignore', 'pipe', 'pipe'] });
    const onData = (b: Buffer) => {
      // Buffer until the command exits. Appium reports an already-installed
      // driver as an Error on stderr with a non-zero exit code, even though the
      // machine is fully ready. Streaming that line cannot be retracted and
      // makes a successful prerequisite look like a failure in the UI.
      output += b.toString();
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', reject);
    child.on('close', (code) => {
      const cleaned = cleanLog(output).trim();
      // "already installed" is not an error — driver is ready to use.
      if (/already installed/i.test(cleaned)) {
        log(`✓ Driver ${safe} đã được cài và sẵn sàng sử dụng.`);
        return resolve();
      }
      if (code === 0) {
        log(`✓ Driver ${safe} đã được cài đặt thành công.`);
        return resolve();
      }
      if (cleaned) log(cleaned);
      reject(new Error(`Cài driver thất bại (mã ${code}) — xem log bên trên.`));
    });
  });
}
