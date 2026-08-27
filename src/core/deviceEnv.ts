import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

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

  set(udid: string, env: string, app: string): void {
    this.data.devices[udid] = { env, app, at: new Date().toISOString() };
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
  return { reinstall: false, because: `máy đã là env "${env}"` };
}
