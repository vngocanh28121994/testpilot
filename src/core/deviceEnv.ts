import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import os from 'node:os';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/**
 * Which environment's build is currently installed on each handset.
 *
 * This file exists because the app under test cannot be asked. Its SIT, UAT and
 * prod builds are published under one bundle id and one version string, so
 * nothing on the device — not the bundle id, not the version, not the display
 * name — distinguishes them. Appium, reasonably, skips installing an app whose
 * bundle id and version already match what is on the phone. The consequence is
 * a run that quietly opens the *wrong* environment's app, types the right
 * environment's credentials into it, and fails at login for a reason that looks
 * nothing like its cause.
 *
 * So the fact is recorded on the way past instead: whoever installs writes down
 * what they installed, keyed by udid, and the next run reads it back.
 */

export const DEVICE_ENV_FILE = 'registry/device-env.json';

interface Entry {
  env: string;
  /** The package that was installed, so a rebuilt ipa at the same path is visible. */
  app: string;
  /**
   * Vân tay nội dung của chính file đã cài.
   *
   * Đường dẫn không đủ. Bản build mới gần như luôn được tải đè lên đúng chỗ cũ
   * (`build/App.ipa`), nên so đường dẫn thì thấy y hệt và không lượt chạy nào
   * cài lại — điện thoại lặng lẽ chạy bản cũ. Trước đây chuyện này tự khỏi vì
   * XCUITest cài lại mỗi phiên; từ khi bật `noReset` thì không còn ai dọn hộ.
   *
   * Không có với các bản ghi cũ, nên chỗ so sánh phải chịu được `undefined`.
   */
  appHash?: string;
  at: string;
}

interface FileShape {
  version: 1;
  devices: Record<string, Entry>;
}

export class DeviceEnvLog {
  private constructor(
    private readonly file: string,
    private data: FileShape,
  ) {}

  static async load(file = DEVICE_ENV_FILE): Promise<DeviceEnvLog> {
    const abs = path.resolve(file);
    if (!existsSync(abs)) return new DeviceEnvLog(abs, { version: 1, devices: {} });
    try {
      const parsed = JSON.parse(await readFile(abs, 'utf8')) as Partial<FileShape>;
      return new DeviceEnvLog(abs, { version: 1, devices: parsed.devices ?? {} });
    } catch {
      // A corrupt log must not block a run: an unknown environment is handled
      // everywhere already, and that is exactly what this degrades to.
      return new DeviceEnvLog(abs, { version: 1, devices: {} });
    }
  }

  /** The environment last installed on `udid`, or undefined when never recorded. */
  get(udid: string): Entry | undefined {
    return this.data.devices[udid];
  }

  /** Every recorded handset, for a UI that wants to warn before a run starts. */
  all(): Record<string, Entry> {
    return { ...this.data.devices };
  }

  set(udid: string, env: string, app: string, appHash?: string): void {
    this.data.devices[udid] = {
      env,
      app,
      ...(appHash ? { appHash } : {}),
      at: new Date().toISOString(),
    };
  }

  async save(): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(this.data, null, 2) + '\n', 'utf8');
  }
}

/**
 * Whether the driver must be told to reinstall the app.
 *
 * Only ever on positive knowledge: a recorded environment that differs, or a
 * recorded package that differs. An unrecorded device is left alone.
 *
 * The first version reinstalled on "unknown" too, reasoning that an unverified
 * device is exactly where a wrong-environment run hides. That reasoning ignored
 * the cost. Reinstalling wipes app data, and the first run on an
 * already-working handset — the normal case, since every device is unknown once
 * — came up in a first-launch state and failed a scenario that had passed
 * minutes earlier. A guard that breaks the runs it was not talking about is not
 * worth the case it catches; `unknown` warns and `--reinstall` is one flag away.
 */
export function needsReinstall(
  recorded: Entry | undefined,
  env: string,
  app: string | undefined,
  isDefaultEnv = true,
  appHash?: string,
): { reinstall: boolean; because: string; unknown?: boolean } {
  if (!app) return { reinstall: false, because: 'không có package nào để cài' };
  if (!recorded) {
    // Unknown cuts both ways, and which way depends on what is being asked for.
    // Asking for a non-default environment is asking to be on *that* build, so
    // installing it is the request, not a surprise. Asking for the default on a
    // handset that has been running it all along is not a reason to wipe it.
    return isDefaultEnv
      ? {
          reinstall: false,
          unknown: true,
          because: 'chưa ghi nhận máy này cài bản nào; chạy trên app sẵn có (--reinstall để cài lại cho chắc)',
        }
      : {
          reinstall: true,
          unknown: true,
          because: `chưa biết máy đang cài env nào, mà "${env}" có build riêng`,
        };
  }
  if (recorded.env !== env) {
    return { reinstall: true, because: `máy đang là env "${recorded.env}"` };
  }
  if (recorded.app !== app) {
    return { reinstall: true, because: `package đổi (${recorded.app} → ${app})` };
  }
  // Cùng đường dẫn, khác nội dung: đúng cái xảy ra khi ai đó tải bản build mới
  // lên đè chỗ cũ. Chỉ kết luận khi CẢ HAI đều có vân tay — bản ghi cũ không có
  // trường này, và coi "thiếu" là "khác" sẽ bắt mọi máy cài lại đúng một lần
  // ngay sau khi nâng cấp tool, tức là gây ra chính cái nó định tránh.
  if (recorded.appHash && appHash && recorded.appHash !== appHash) {
    return { reinstall: true, because: 'nội dung bản build đổi (cùng đường dẫn)' };
  }
  return { reinstall: false, because: `máy đã là env "${env}"` };
}

/**
 * Vân tay nội dung của một file build.
 *
 * SHA-256 chảy theo luồng: một ipa 109 MB mất chừng nửa giây, một lần cho mỗi
 * lượt chạy, và đó là cái giá rẻ hơn nhiều so với một buổi test chạy nhầm bản
 * cũ mà không ai biết. Trả về `undefined` khi không đọc được — thiếu vân tay
 * chỉ làm mất khả năng phát hiện, không được phép làm hỏng lượt chạy.
 */
export async function appFingerprint(file: string | undefined): Promise<string | undefined> {
  if (!file) return undefined;
  const abs = path.resolve(file);
  if (!existsSync(abs)) return undefined;
  try {
    const hash = createHash('sha256');
    await pipeline(createReadStream(abs), hash);
    return hash.digest('hex');
  } catch {
    return undefined;
  }
}

/**
 * Phiên bản app đang thật sự nằm trên máy, hỏi thẳng thiết bị.
 *
 * Dùng khi một môi trường khai `useInstalledApp`: tool không biết bản đang cài
 * thuộc môi trường nào, nhưng ít nhất nói ra được nó là bản nào — để người chạy
 * đối chiếu với thứ mình nghĩ là đang cài, thay vì chạy trong im lặng rồi hỏng
 * ở màn đăng nhập.
 *
 * Hỏi không được thì trả về undefined: đây là dòng thông tin, không phải cổng
 * chặn, và không đáng để làm hỏng một lượt chạy.
 */
export async function installedAppVersion(
  platform: 'ios' | 'android',
  udid: string,
  id: string | undefined,
): Promise<string | undefined> {
  if (!id) return undefined;
  try {
    if (platform === 'ios') {
      const file = path.join(os.tmpdir(), `tp-apps-${process.pid}-${Date.now()}.json`);
      await exec('xcrun', [
        'devicectl', 'device', 'info', 'apps', '--device', udid, '--quiet', '--json-output', file,
      ], { timeout: 90_000 });
      const parsed = JSON.parse(await readFile(file, 'utf8')) as {
        result?: { apps?: { bundleIdentifier?: string; version?: string }[] };
      };
      const app = parsed.result?.apps?.find((a) => a.bundleIdentifier === id);
      return app?.version;
    }
    const { stdout } = await exec('adb', ['-s', udid, 'shell', 'dumpsys', 'package', id], {
      timeout: 30_000, encoding: 'utf8',
    });
    return /versionName=(\S+)/.exec(stdout)?.[1];
  } catch {
    return undefined;
  }
}
