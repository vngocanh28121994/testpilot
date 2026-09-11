import { stat } from 'node:fs/promises';
import path from 'node:path';

import type { TestPilotConfig } from '../config.js';

/**
 * The app build each environment will install, and nothing else.
 *
 * Builds used to be uploaded from three screens into three config slots, so a
 * new release meant repeating the same upload until they agreed. One screen
 * owns it now, and the question it answers is deliberately narrow: for SIT, for
 * UAT, for prod — which package goes on the phone?
 *
 * Inheritance is not offered, because it is never what anyone wants. Every
 * environment of this app shares one bundle id, so a phone cannot tell SIT's
 * app from prod's — installing the default environment's package for SIT means
 * logging a SIT account into the prod app, and the runner refuses it. An
 * environment either has its build or it does not, and "does not" is the honest
 * thing to show.
 */

export interface EnvBuild {
  path: string;
  sizeMb: number;
}

export interface EnvBuilds {
  /** Empty when the config names no environments at all. */
  env: string;
  /** Its build is the base config's, so uploading here writes that. */
  isDefault: boolean;
  android: EnvBuild | null;
  ios: EnvBuild | null;
  /** Configured but not on disk. Worth saying: Appium fails on this minutes in. */
  missing: Array<{ platform: 'android' | 'ios'; path: string }>;
  /**
   * Môi trường này ưu tiên bản đã cài sẵn trên máy, thay vì bản tải lên.
   *
   * Có thật hai thứ cùng tồn tại: một file build nằm đây, và một lời khai rằng
   * máy đang cài đúng bản cần chạy. Khi mâu thuẫn thì lời khai thắng — nó là
   * thứ người dùng vừa chọn, còn file chỉ là thứ có sẵn.
   */
  preferInstalled: { android: boolean; ios: boolean };
}

export interface BuildInventory {
  environments: EnvBuilds[];
  /** Where uploads land, so the paths in the table are not a mystery. */
  root: string;
}

async function describe(rel: string | undefined): Promise<EnvBuild | 'missing' | null> {
  if (!rel) return null;
  try {
    const info = await stat(path.resolve(rel));
    return { path: rel, sizeMb: Math.round(info.size / 1024 / 1024) };
  } catch {
    return 'missing';
  }
}

export async function buildInventory(
  cfg: TestPilotConfig,
  /** Where uploads land. A parameter so tests need not write into the real one. */
  root = 'build',
): Promise<BuildInventory> {
  const names = Object.keys(cfg.environments);
  // A config with no environments still installs something; it just has one
  // unnamed slot rather than three named ones.
  const rows = names.length > 0 ? names : [''];
  const environments: EnvBuilds[] = [];

  for (const env of rows) {
    const isDefault = env === '' || env === cfg.defaultEnv;
    const override = cfg.environments[env];
    const row: EnvBuilds = {
      env,
      isDefault,
      android: null,
      ios: null,
      missing: [],
      preferInstalled: {
        android: Boolean(override?.android?.useInstalledApp),
        ios: Boolean(override?.ios?.useInstalledApp),
      },
    };

    for (const platform of ['android', 'ios'] as const) {
      // The default environment's build *is* the base config's: one package,
      // no override to make. Every other environment must have named its own —
      // a path it merely inherited is not a build it has.
      const configured = isDefault
        ? (platform === 'android' ? cfg.android.app : cfg.ios.app)
        : (platform === 'android' ? override?.android?.app : override?.ios?.app);
      const found = await describe(configured);
      if (found === 'missing') row.missing.push({ platform, path: configured! });
      else row[platform] = found;
    }
    environments.push(row);
  }

  return { environments, root: `${root}/` };
}
