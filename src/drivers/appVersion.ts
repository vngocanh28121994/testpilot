/**
 * Warns when the build on a device is not the build the config points at.
 *
 * `isolation: 'restart'` sets `noReset`, and `noReset` skips reinstalling an app
 * that is already there. That is what makes a run start in seconds instead of
 * pushing 200MB every time — but it also means the `app` path in the config is
 * a statement of intent, not a fact about the device.
 *
 * On one phone that is a private nuisance. Across several phones at once it is
 * a correctness problem: a device that kept an older build produces results the
 * report presents beside the others as if they were comparable, and its
 * verified locators are merged into the same registry. An element that simply
 * moved between builds then looks flaky.
 *
 * So this reads both versions and says so. It never blocks: reinstalling is a
 * decision about time and risk that belongs to whoever is running the suite,
 * and a missing build tool must not be the reason a suite cannot run.
 */
import { exec as execCb } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execAsync = promisify(execCb);

export interface VersionCheck {
  /**
   * - `match`      — device and config agree.
   * - `mismatch`   — they disagree; the device's build is what will run.
   * - `notInstalled` — the session is about to install the configured build.
   * - `unknown`    — one of the two versions could not be read.
   */
  status: 'match' | 'mismatch' | 'notInstalled' | 'unknown';
  apk?: string;
  installed?: string;
  message: string;
}

export async function checkAppVersion(opts: {
  apkPath: string;
  appPackage: string;
  deviceSerial?: string;
}): Promise<VersionCheck> {
  const [apk, device] = await Promise.all([
    apkVersionName(opts.apkPath),
    installedVersionName(opts.appPackage, opts.deviceSerial),
  ]);

  // Failing to ask the device is not the same as the device answering "absent".
  // Reporting an unreachable adb as "app chưa có trên máy" states something
  // false about the phone and hides the real fault — which, with two handsets
  // attached and no udid configured, is exactly the case worth surfacing.
  if (!device.ok) {
    return {
      status: 'unknown',
      ...(apk ? { apk } : {}),
      message:
        `Không hỏi được ${opts.appPackage} trên máy nên chưa đối chiếu được phiên bản: ${device.error}`,
    };
  }

  const installed = device.version;
  if (!installed) {
    return {
      status: 'notInstalled',
      ...(apk ? { apk } : {}),
      message:
        `${opts.appPackage} chưa có trên máy — Appium sẽ cài ${path.basename(opts.apkPath)}` +
        `${apk ? ` (${apk})` : ''}. Bước đầu tiên sẽ lâu hơn bình thường.`,
    };
  }
  if (!apk) {
    // Two very different causes, and the fix differs: one is a wrong path in
    // the config, the other a missing SDK tool. Saying "không đọc được" for
    // both sends the reader looking in the wrong place.
    const why = existsSync(opts.apkPath)
      ? 'không đọc được version (thiếu aapt/aapt2 trong Android SDK build-tools)'
      : 'file không tồn tại';
    return {
      status: 'unknown',
      installed,
      message:
        `${opts.apkPath}: ${why} — không đối chiếu được với bản ${installed} ` +
        `đang cài trên máy.`,
    };
  }
  if (apk === installed) {
    return { status: 'match', apk, installed, message: `app ${installed} khớp với ${path.basename(opts.apkPath)}.` };
  }
  return {
    status: 'mismatch',
    apk,
    installed,
    message:
      `LỆCH PHIÊN BẢN: máy đang cài ${opts.appPackage} ${installed}, ` +
      `còn config trỏ tới ${opts.apkPath} (${apk}).\n` +
      `  isolation="restart" đặt noReset nên Appium KHÔNG cài đè — bản ${installed} sẽ chạy, không phải ${apk}.\n` +
      `  Muốn chạy đúng bản trong config: adb ${opts.deviceSerial ? `-s ${opts.deviceSerial} ` : ''}install -r ${opts.apkPath}`,
  };
}

/**
 * Asks the device for the installed versionName.
 *
 * `ok: false` means adb could not answer at all; `ok: true` with no version
 * means it answered and the package is not there. Collapsing the two would let
 * an adb problem masquerade as a fact about the app.
 */
async function installedVersionName(
  appPackage: string,
  deviceSerial?: string,
): Promise<{ ok: true; version?: string } | { ok: false; error: string }> {
  const serial = deviceSerial ? `-s ${deviceSerial} ` : '';
  try {
    const { stdout } = await execAsync(
      `adb ${serial}shell dumpsys package ${appPackage}`,
      { maxBuffer: 8 * 1024 * 1024 },
    );
    // Absent packages still exit 0, with output that names no version at all.
    const version = /^\s*versionName=(.+)$/m.exec(stdout)?.[1]?.trim();
    return version ? { ok: true, version } : { ok: true };
  } catch (err) {
    const text = errorText(err);
    return {
      ok: false,
      error: /more than one device/i.test(text)
        ? 'đang cắm nhiều máy nhưng chưa khai báo udid cho thiết bị này ' +
          '(thêm android.devices[].udid trong testpilot.config.json), nên adb không biết hỏi máy nào.'
        : text,
    };
  }
}

function errorText(err: unknown): string {
  const raw = err instanceof Error ? (err as Error & { stderr?: string }).stderr || err.message : String(err);
  return raw.trim().split('\n').filter(Boolean).pop() ?? 'adb lỗi không rõ nguyên nhân';
}

/** versionName baked into the apk, read with whichever aapt the SDK has. */
async function apkVersionName(apkPath: string): Promise<string | undefined> {
  if (!existsSync(apkPath)) return undefined;
  for (const tool of await aaptCandidates()) {
    try {
      const { stdout } = await execAsync(`"${tool}" dump badging "${apkPath}"`, {
        maxBuffer: 8 * 1024 * 1024,
      });
      const found = /versionName='([^']*)'/.exec(stdout)?.[1];
      if (found) return found;
    } catch {
      // Wrong tool for this apk, or not executable — try the next one.
    }
  }
  return undefined;
}

/**
 * aapt/aapt2 are not on PATH in a default SDK install; they live under a
 * versioned build-tools directory. Newest first, since an old aapt cannot read
 * an apk built by a newer toolchain.
 */
async function aaptCandidates(): Promise<string[]> {
  const found = ['aapt2', 'aapt'];
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (!sdk) return found;

  const buildTools = path.join(sdk, 'build-tools');
  let versions: string[] = [];
  try {
    versions = (await readdir(buildTools)).sort().reverse();
  } catch {
    return found;
  }
  for (const version of versions) {
    for (const name of ['aapt2', 'aapt']) {
      const candidate = path.join(buildTools, version, name);
      if (existsSync(candidate)) found.unshift(candidate);
    }
  }
  return found;
}
