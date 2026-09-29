/**
 * Cài WebDriverAgent lên MỘT chiếc iPhone — trọn gói, từ một nút trên web.
 *
 * Trước đây việc này là `scripts/prepare-wda.sh` cộng với hai lần đổi cờ bằng
 * tay, và một chiếc iPhone mới cắm vào gãy đúng ở bước giữa: profile của
 * WebDriverAgent chỉ liệt kê những máy đã đăng ký với team, nên script dừng ở
 * "Máy chưa nằm trong provisioning profile" và bảo người dùng tạm tắt
 * `usePreinstalledWDA`, chạy một lượt, rồi bật lại. Không ai làm được chuỗi
 * đó mà không có người chỉ.
 *
 * Nay cả chuỗi nằm ở đây:
 *
 *   1. máy chưa có trong profile → build WebDriverAgent MỘT lần với
 *      `-allowProvisioningDeviceRegistration`: Xcode đăng ký máy với team và
 *      cấp profile mới gồm cả máy cũ lẫn máy mới. Đo trên máy thật
 *      (iPhone 16 Pro Max, iOS 27): khoảng hai phút.
 *   2. `usePreinstalledWDA` → tải bản dựng sẵn, ký lại bằng chứng chỉ trong
 *      Keychain, cài lên máy (chi tiết vì sao ở `prepare-wda.sh`).
 *      `usePrebuiltWDA` → bản build ở `derivedDataPath` phải được dựng lại để
 *      mang profile mới; bước 1 build thẳng vào đó.
 *   3. thử mở → chưa tin cậy thì nói đúng chỗ bấm trên điện thoại.
 *
 * Sống trong runner chứ không gọi script: runner đóng gói không kèm `scripts/`,
 * và việc này phải chạy trên máy đang cắm iPhone — thường không phải máy chủ.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { TestPilotConfig } from '../config.js';

type Log = (line: string) => void;

export interface ShResult { ok: boolean; stdout: string; stderr: string }

/** Chạy một lệnh, không bao giờ ném. `onLine` nhận từng dòng khi lệnh còn chạy. */
export type Sh = (
  file: string,
  args: string[],
  opts?: { timeoutMs?: number; input?: string; onLine?: (line: string) => void },
) => Promise<ShResult>;

export const sh: Sh = (file, args, opts = {}) => new Promise((resolve) => {
  const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let partial = '';
  const feed = (chunk: string) => {
    if (!opts.onLine) return;
    partial += chunk;
    const lines = partial.split('\n');
    partial = lines.pop() ?? '';
    for (const line of lines) opts.onLine(line);
  };
  const timer = opts.timeoutMs ? setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs) : undefined;
  child.stdout.on('data', (buf: Buffer) => { const s = buf.toString(); stdout += s; feed(s); });
  child.stderr.on('data', (buf: Buffer) => { const s = buf.toString(); stderr += s; feed(s); });
  child.on('error', (err) => {
    if (timer) clearTimeout(timer);
    resolve({ ok: false, stdout, stderr: `${stderr}${err.message}` });
  });
  child.on('close', (code) => {
    if (timer) clearTimeout(timer);
    if (partial && opts.onLine) opts.onLine(partial);
    resolve({ ok: code === 0, stdout, stderr });
  });
  child.stdin.end(opts.input ?? '');
});

const PROFILES_DIR = path.join(
  os.homedir(), 'Library', 'Developer', 'Xcode', 'UserData', 'Provisioning Profiles',
);

/** Nơi Appium cài driver xcuitest — và dự án WebDriverAgent đi kèm nó. */
export function wdaProjectPath(): string {
  const home = process.env.APPIUM_HOME ?? path.join(os.homedir(), '.appium');
  return path.join(
    home, 'node_modules', 'appium-xcuitest-driver', 'node_modules', 'appium-webdriveragent',
    'WebDriverAgent.xcodeproj',
  );
}

export interface ProfileInfo {
  file: string;
  expires: string;
  devices: string[];
  appId: string;
}

/** Đọc một `.mobileprovision` (CMS có chữ ký) thành các trường cần dùng. */
export async function readProfile(file: string, run: Sh = sh): Promise<ProfileInfo | undefined> {
  const decoded = await run('security', ['cms', '-D', '-i', file]);
  if (!decoded.ok) return undefined;
  // Từng trường một: `plutil -convert json` hỏng với cả file, vì profile có
  // trường kiểu ngày (CreationDate…) mà JSON không biểu diễn được.
  const field = (key: string, format: 'raw' | 'json') =>
    run('plutil', ['-extract', key, format, '-o', '-', '-'], { input: decoded.stdout });
  const [expires, devices, appId] = await Promise.all([
    field('ExpirationDate', 'raw'),
    field('ProvisionedDevices', 'json'),
    field('Entitlements.application-identifier', 'raw'),
  ]);
  if (!expires.ok || !appId.ok) return undefined;
  let list: string[] = [];
  try {
    list = devices.ok ? JSON.parse(devices.stdout) as string[] : [];
  } catch {
    list = [];
  }
  return { file, expires: expires.stdout.trim(), devices: list, appId: appId.stdout.trim() };
}

/**
 * Profile CÒN HẠN LÂU NHẤT cho đúng bundle của WebDriverAgent.
 *
 * Bản đã hết hạn bị bỏ: ký bằng nó thì iOS từ chối cài ("This provisioning
 * profile has expired", xcodebuild code 70).
 */
export function bestProfile(profiles: ProfileInfo[], appId: string, now = new Date()): ProfileInfo | undefined {
  return profiles
    .filter((profile) => profile.appId === appId)
    .filter((profile) => Date.parse(profile.expires) > now.getTime())
    .sort((a, b) => Date.parse(b.expires) - Date.parse(a.expires))[0];
}

async function findProfile(appId: string, run: Sh, dir: string): Promise<ProfileInfo | undefined> {
  const files = await readdir(dir).catch(() => [] as string[]);
  const read = await Promise.all(
    files.filter((file) => file.endsWith('.mobileprovision'))
      .map((file) => readProfile(path.join(dir, file), run)),
  );
  return bestProfile(read.filter((item): item is ProfileInfo => Boolean(item)), appId);
}

/**
 * Chứng chỉ Apple Development của ĐÚNG team, dạng SHA-1 cho `codesign`.
 *
 * Team ID nằm ở `OU` của subject, KHÔNG phải phần trong ngoặc của CN — phần đó
 * là id của chứng chỉ.
 */
async function signingCert(team: string, run: Sh): Promise<string> {
  const all = await run('security', ['find-certificate', '-a', '-p', '-c', 'Apple Development']);
  const pems = all.stdout.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
  for (const pem of pems) {
    const subject = await run('openssl', ['x509', '-noout', '-subject'], { input: pem });
    if (!new RegExp(`OU\\s*=\\s*${team}\\b`).test(subject.stdout)) continue;
    const print = await run('openssl', ['x509', '-noout', '-fingerprint', '-sha1'], { input: pem });
    const sha = /=([0-9A-F:]+)/i.exec(print.stdout)?.[1]?.replace(/:/g, '');
    if (sha) return sha;
  }
  throw new Error(
    `Trong Keychain của máy này không có chứng chỉ "Apple Development" nào của team ${team}. `
    + 'Mở Xcode › Settings › Accounts, đăng nhập Apple ID của team đó, bấm Manage Certificates › + › '
    + 'Apple Development, rồi thử lại.',
  );
}

/**
 * Build WebDriverAgent một lần để Xcode đăng ký máy với team và cấp profile.
 *
 * Đúng bộ tham số Appium dùng (appium-webdriveragent `xcodebuild.js`), để bản
 * build này cũng dùng lại được cho `usePrebuiltWDA`.
 */
async function registerDevice(
  cfg: TestPilotConfig, udid: string, derivedDataPath: string, log: Log, run: Sh,
): Promise<void> {
  const project = wdaProjectPath();
  if (!existsSync(project)) {
    throw new Error('Chưa cài driver xcuitest của Appium trên máy này (không thấy dự án WebDriverAgent). '
      + 'Cài ở màn Local Runner › Appium driver, rồi thử lại.');
  }
  log('[wda] Đăng ký máy với tài khoản Apple và xin profile mới — build WebDriverAgent một lần, '
    + 'khoảng 2–3 phút. Giữ iPhone mở khoá.');
  const errors: string[] = [];
  const built = await run('xcodebuild', [
    'build-for-testing',
    '-allowProvisioningUpdates', '-allowProvisioningDeviceRegistration',
    '-project', project, '-scheme', 'WebDriverAgentRunner',
    '-derivedDataPath', derivedDataPath,
    '-destination', `id=${udid}`,
    `DEVELOPMENT_TEAM=${cfg.ios.teamId}`,
    `CODE_SIGN_IDENTITY=${cfg.ios.signingId ?? 'Apple Development'}`,
    `PRODUCT_BUNDLE_IDENTIFIER=${wdaBundle(cfg)}`,
    'GCC_TREAT_WARNINGS_AS_ERRORS=0', 'COMPILER_INDEX_STORE_ENABLE=NO',
  ], {
    timeoutMs: 15 * 60_000,
    // Log của xcodebuild dài hàng nghìn dòng; chỉ đưa lên những dòng người
    // đọc cần: lỗi, và mốc thành công.
    onLine: (line) => {
      if (/\berror\b|\*\* .* \*\*/i.test(line)) {
        log(`[xcodebuild] ${line.trim()}`);
        if (/\berror\b/i.test(line)) errors.push(line.trim());
      }
    },
  });
  if (!built.ok) throw new Error(explainBuildFailure(errors.join('\n') || built.stderr));
}

/** Lỗi xcodebuild hay gặp khi đăng ký máy → việc cần làm. */
export function explainBuildFailure(output: string): string {
  const raw = output.split('\n').slice(-5).join('\n').slice(0, 600);
  if (/No Accounts|No account for team|not logged in|sign in/i.test(output)) {
    return 'Xcode trên máy này chưa đăng nhập Apple ID của team. Mở Xcode › Settings › Accounts, '
      + `đăng nhập, rồi thử lại.\n\nChi tiết kỹ thuật: ${raw}`;
  }
  if (/maximum number of registered|device limit/i.test(output)) {
    return 'Tài khoản Apple đã đăng ký đủ số máy cho phép (100 máy mỗi loại mỗi năm). Xoá bớt máy '
      + `không dùng ở developer.apple.com › Devices, rồi thử lại.\n\nChi tiết kỹ thuật: ${raw}`;
  }
  if (/Developer Mode|developer mode disabled/i.test(output)) {
    return 'iPhone chưa bật Chế độ nhà phát triển: Cài đặt › Quyền riêng tư & Bảo mật › Chế độ nhà '
      + `phát triển.\n\nChi tiết kỹ thuật: ${raw}`;
  }
  if (/locked|passcode/i.test(output)) {
    return `iPhone đang khoá màn hình. Mở khoá rồi thử lại.\n\nChi tiết kỹ thuật: ${raw}`;
  }
  return 'Không build được WebDriverAgent để đăng ký máy. Kiểm tra iPhone đã mở khoá, đã tin cậy máy '
    + `tính và đã bật Chế độ nhà phát triển.\n\nChi tiết kỹ thuật: ${raw}`;
}

const wdaBundle = (cfg: TestPilotConfig) => cfg.ios.wdaBundleId ?? 'com.facebook.WebDriverAgentRunner';

/** Nơi build mặc định khi config không dùng bản build dựng sẵn. */
const REGISTER_DERIVED = path.join(os.tmpdir(), 'testpilot-wda-register');

/** App runner mà `xcodebuild build-for-testing` sinh ra trong một `derivedDataPath`. */
const builtRunner = (derived: string) =>
  path.join(derived, 'Build', 'Products', 'Debug-iphoneos', 'WebDriverAgentRunner-Runner.app');

/**
 * Tải bản dựng sẵn, ký lại cho đúng bundle và team, cài lên máy.
 * Vì sao là bản dựng sẵn chứ không phải bản xcodebuild: xem `prepare-wda.sh`.
 */
async function installPrebuilt(
  cfg: TestPilotConfig, udid: string, profile: ProfileInfo, log: Log, run: Sh,
): Promise<void> {
  const cert = await signingCert(cfg.ios.teamId!, run);
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'testpilot-wda-'));
  // Thư mục con CHƯA tồn tại: download-wda từ chối ghi vào thư mục đã có.
  const out = path.join(tmp, 'wda');
  try {
    log('[wda] Tải bản WebDriverAgent dựng sẵn…');
    const got = await run('appium', [
      'driver', 'run', 'xcuitest', 'download-wda', '--', '--outdir', out, '--platform', 'iOS', '--kind', 'real',
    ], { timeoutMs: 5 * 60_000 });
    const app = path.join(out, 'WebDriverAgentRunner-Runner.app');
    if (!got.ok || !existsSync(app)) {
      throw new Error('Không tải được bản WebDriverAgent dựng sẵn (cần mạng tới github.com). '
        + `\n\nChi tiết kỹ thuật: ${(got.stderr || got.stdout).slice(-400)}`);
    }
    const bundle = wdaBundle(cfg);
    const xctest = path.join(app, 'PlugIns', 'WebDriverAgentRunner.xctest');
    await run('/usr/libexec/PlistBuddy', ['-c', `Set :CFBundleIdentifier ${bundle}.xctrunner`, path.join(app, 'Info.plist')]);
    await run('/usr/libexec/PlistBuddy', ['-c', `Set :CFBundleIdentifier ${bundle}`, path.join(xctest, 'Info.plist')]);

    await cp(profile.file, path.join(app, 'embedded.mobileprovision'));
    const decoded = await run('security', ['cms', '-D', '-i', profile.file]);
    const ent = await run('plutil', ['-extract', 'Entitlements', 'xml1', '-o', '-', '-'], { input: decoded.stdout });
    const entFile = path.join(tmp, 'entitlements.plist');
    await writeFile(entFile, ent.stdout);

    log('[wda] Ký bằng chứng chỉ trong Keychain…');
    // dSYM không được ký và không cần trên máy; để lại thì codesign kêu.
    await rm(`${xctest}.dSYM`, { recursive: true, force: true });
    const frameworks = path.join(xctest, 'Frameworks');
    for (const item of await readdir(frameworks).catch(() => [] as string[])) {
      await run('codesign', ['--force', '--timestamp=none', '--sign', cert, path.join(frameworks, item)]);
    }
    for (const target of [xctest, app]) {
      const signed = await run('codesign', ['--force', '--timestamp=none', '--sign', cert, '--entitlements', entFile, target]);
      if (!signed.ok) throw new Error(`Không ký được WebDriverAgent.\n\nChi tiết kỹ thuật: ${signed.stderr.slice(-400)}`);
    }

    log('[wda] Cài lên iPhone…');
    const installed = await run('xcrun', ['devicectl', 'device', 'install', 'app', '--device', udid, app], {
      timeoutMs: 5 * 60_000,
    });
    if (!installed.ok) {
      throw new Error('iPhone từ chối cài WebDriverAgent. Mở khoá máy rồi thử lại.'
        + `\n\nChi tiết kỹ thuật: ${(installed.stderr || installed.stdout).slice(-400)}`);
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/** Thử mở — cài xong không có nghĩa là mở được. Trả về câu nói việc tiếp theo. */
async function tryLaunch(cfg: TestPilotConfig, udid: string, run: Sh): Promise<string> {
  const launched = await run('xcrun', [
    'devicectl', 'device', 'process', 'launch', '--device', udid, `${wdaBundle(cfg)}.xctrunner`,
  ], { timeoutMs: 90_000 });
  const output = `${launched.stdout}${launched.stderr}`;
  if (launched.ok && /Launched application/i.test(output)) {
    return 'WebDriverAgent đã cài và mở được. Máy sẵn sàng chạy test.';
  }
  if (/Security|not.*trusted|invalid code signature|untrusted/i.test(output)) {
    return 'Đã cài xong. Còn MỘT việc trên iPhone: Cài đặt › Cài đặt chung › VPN & Quản lý thiết bị › '
      + 'chọn Apple ID nhà phát triển › Tin cậy. Rồi bấm Kiểm tra lại.';
  }
  return 'Đã cài xong, nhưng chưa mở thử được — mở khoá iPhone rồi bấm Kiểm tra lại.';
}

/**
 * Chuẩn bị WebDriverAgent cho một chiếc iPhone, theo đúng chế độ config đang
 * dùng. Ném lỗi đã viết sẵn cho người đọc; thành công thì dòng log cuối nói
 * việc tiếp theo (thường là bấm Tin cậy trên máy).
 */
export async function setupWda(
  cfg: TestPilotConfig, udid: string, log: Log, run: Sh = sh,
  /** Tách ra được để test không đọc profile thật trên máy. */
  profilesDir = PROFILES_DIR,
): Promise<void> {
  if (!cfg.ios.teamId) {
    throw new Error('Chưa khai team ký (ios.teamId) trong cấu hình — không có nó thì không ký được '
      + 'WebDriverAgent. Điền ở màn Cấu hình rồi thử lại.');
  }
  const appId = `${cfg.ios.teamId}.${wdaBundle(cfg)}.xctrunner`;
  const prebuilt = cfg.ios.usePrebuiltWDA && cfg.ios.derivedDataPath ? cfg.ios.derivedDataPath : undefined;

  // 1. Máy có trong profile chưa. Với `usePrebuiltWDA`, profile cần xét là
  //    bản NẰM TRONG bản build dựng sẵn — bản đó mới là thứ được cài lên máy.
  const embedded = prebuilt ? builtRunner(prebuilt) : undefined;
  const current = embedded
    ? existsSync(embedded) ? await readProfile(path.join(embedded, 'embedded.mobileprovision'), run) : undefined
    : await findProfile(appId, run, profilesDir);
  const expired = current && Date.parse(current.expires) <= Date.now();
  if (!current || expired || !current.devices.includes(udid)) {
    log(!current
      ? '[wda] Chưa có profile nào cho WebDriverAgent.'
      : expired
        ? `[wda] Profile đã hết hạn (${current.expires}).`
        : '[wda] Máy này chưa có trong profile của WebDriverAgent — máy mới, cần đăng ký một lần.');
    await mkdir(prebuilt ?? REGISTER_DERIVED, { recursive: true });
    await registerDevice(cfg, udid, prebuilt ?? REGISTER_DERIVED, log, run);
    if (prebuilt) {
      log('[wda] Đã dựng lại bản WebDriverAgent dùng chung. Các iPhone cũ có thể phải bấm Tin cậy '
        + 'lại một lần ở lượt chạy tới.');
    }
  } else {
    log('[wda] Máy đã có trong profile.');
  }

  // 2. Cài theo chế độ.
  if (cfg.ios.usePreinstalledWDA) {
    const profile = await findProfile(appId, run, profilesDir);
    if (!profile || !profile.devices.includes(udid)) {
      throw new Error('Xcode đã build xong nhưng profile mới vẫn chưa có máy này. Mở Xcode › Settings › '
        + 'Accounts › Download Manual Profiles, rồi thử lại.');
    }
    log(`[wda] Profile hạn tới ${profile.expires.slice(0, 10)}.`);
    await installPrebuilt(cfg, udid, profile, log, run);
    log(`[wda] ${await tryLaunch(cfg, udid, run)}`);
    return;
  }
  // Hai chế độ còn lại không cài gì lúc này: Appium cài WebDriverAgent ở đầu
  // lượt chạy (bản vừa build, hoặc bản nó tự build).
  log('[wda] Xong. Lượt chạy đầu tiên trên máy này sẽ cài WebDriverAgent, rồi iPhone hỏi Tin cậy '
    + 'một lần: Cài đặt › Cài đặt chung › VPN & Quản lý thiết bị › Tin cậy.');
}
