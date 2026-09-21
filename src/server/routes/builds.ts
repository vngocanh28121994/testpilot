/**
 * Nguồn app cho một môi trường: dùng bản đã cài trên máy, hay bản build đã tải lên.
 *
 * FARM-ROUTE-MAP.md xếp route này vào nhóm RUNNER vì tên nó nghe như đi đọc
 * thiết bị. Đọc kỹ thì không: nó chỉ ghi một cờ vào config. Sửa lại bản đồ
 * thay vì đẩy một route thuần cấu hình sang runner — phân loại sai theo hướng
 * đó sẽ kéo cả `saveConfig` sang máy người dùng.
 */
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { loadConfig, saveConfig } from '../../config.js';

import { localRunner } from '../../runner/index.js';
import { json, readJson } from '../http.js';
import type { RouteTable } from './types.js';
import { buildInventory } from '../../core/builds.js';

/**
 * The name an uploaded build is stored under.
 *
 * Only ever a bare filename with the right extension: the value arrives from a
 * browser and is about to become a path this server writes to, so anything
 * carrying a directory — "../../etc/x.apk" included — is reduced to its last
 * segment before it can point outside `build/`.
 */
function safeBuildName(raw: string, platform: 'android' | 'ios'): string | undefined {
  const base = path.basename(raw.replace(/\\/g, '/')).trim();
  const wanted = platform === 'android' ? '.apk' : '.ipa';
  if (!base.toLowerCase().endsWith(wanted)) return undefined;
  const cleaned = base.replace(/[^\w.\- ]+/g, '_');
  return cleaned === wanted ? undefined : cleaned;
}

/**
 * Why a file was not accepted, per format.
 *
 * "Chỉ nhận .apk" is true and useless: the person holding an .aab did not
 * choose it by accident — it is what the build pipeline produced, and what they
 * need is the one command that turns it into something installable. Each of
 * these is a mistake worth its own sentence.
 */
function rejectedBuildReason(raw: string, platform: 'android' | 'ios'): string {
  const ext = path.extname(path.basename(raw.replace(/\\/g, '/'))).toLowerCase();
  const why: Record<string, string> = {
    '.aab':
      'AAB là Android App Bundle, không cài trực tiếp được. '
      + 'Dựng universal APK: bundletool build-apks --mode=universal.',
    '.apks': 'File .apks của bundletool là bộ split APK — cần một .apk đơn.',
    '.zip': 'Zip không phải app build. Nếu đây là XAPK đổi tên, giải nén lấy .apk bên trong.',
    '.app': '.app là thư mục build cho simulator; cần .ipa đã đóng gói và ký.',
  };
  return why[ext]
    ?? (platform === 'android'
      ? 'Android chỉ nhận .apk, tên không có ký tự lạ.'
      : 'iOS chỉ nhận .ipa, tên không có ký tự lạ.');
}

/**
 * Turns a write failure into something the reader can act on.
 *
 * The raw errno text is accurate and useless: "ENOSPC: no space left on device,
 * write" names a condition, not the thing to do about it, and a build is large
 * enough that a full disk is the failure to expect rather than a surprise.
 */
function uploadError(err: unknown): string {
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === 'ENOSPC') return 'ổ đĩa đã đầy, không còn chỗ để lưu build. Dọn bớt dung lượng rồi thử lại.';
  if (code === 'EACCES' || code === 'EPERM') return 'không có quyền ghi vào thư mục build/.';
  if (code === 'EROFS') return 'thư mục build/ đang ở chế độ chỉ đọc.';
  return (err as Error).message;
}

/**
 * One directory name for an environment, or undefined when there is none.
 *
 * Same reasoning as safeBuildName: the value comes from a browser and becomes
 * part of a path this server writes to, so a separator has no business in it.
 */
function safeEnvSegment(raw: string): string | undefined {
  const cleaned = raw.trim().replace(/[^\w.\-]+/g, '_').replace(/^\.+/, '');
  return cleaned.length > 0 ? cleaned : undefined;
}

export const buildsRoutes: RouteTable = {
  'GET /api/builds': async (_req, res, _url, ctx) => {
    return json(res, 200, await buildInventory(await loadConfig(ctx.configFile)));
  },

  // The cheat sheet shown beside the scenario editor. Generated from the
  // vocabulary and the action registry so it cannot describe a syntax the
  // runner does not accept.
  // Upload a build straight from the machine the browser is on. The config
  // still stores a path — everything downstream (Appium's `app`, the version
  // check, the farm bundler) reads one — but nobody has to know what the path
  // should be, which is the part that was unanswerable from the UI.
  'POST /api/app/upload': async (req, res, url, ctx) => {
    const platform = url.searchParams.get('platform') ?? '';
    if (platform !== 'android' && platform !== 'ios') {
      return json(res, 400, { error: 'platform phải là android hoặc ios.' });
    }
    const requested = url.searchParams.get('filename') ?? '';
    const name = safeBuildName(requested, platform);
    if (!name) return json(res, 400, { error: rejectedBuildReason(requested, platform) });

    // An environment's build is parked in its own subdirectory. Without that,
    // a SIT ipa exported under the same name as the prod one — which is the
    // normal case, since they are the same app — would overwrite the prod
    // build sitting at the path the base config points at.
    const envDir = safeEnvSegment(url.searchParams.get('env') ?? '');
    if (url.searchParams.has('env') && !envDir) {
      return json(res, 400, { error: 'Tên môi trường không hợp lệ.' });
    }
    const dir = envDir ? path.resolve('build', envDir) : path.resolve('build');
    await mkdir(dir, { recursive: true });
    // Written under a temporary name first: an upload that dies halfway
    // would otherwise leave a truncated apk sitting at the path the config
    // points at, and Appium's failure would say nothing about why.
    const temp = path.join(dir, `.upload-${Date.now()}-${name}`);
    try {
      await pipeline(req, createWriteStream(temp));
    } catch (err) {
      await rm(temp, { force: true });
      return json(res, 500, { error: `Tải lên thất bại: ${uploadError(err)}` });
    }
    const written = await stat(temp);
    if (written.size === 0) {
      await rm(temp, { force: true });
      return json(res, 400, { error: 'File rỗng.' });
    }
    await rename(temp, path.join(dir, name));

    const rel = envDir ? path.posix.join('build', envDir, name) : path.posix.join('build', name);
    // Read for every build, not just the farm's: knowing which version is on
    // the phone is what turns "it worked yesterday" into a question with an
    // answer, and Device Farm labels its runs with it.
    const version = await localRunner.builds.readAppVersion(path.join(dir, name));
    // Whether the config is written depends on who is asking. The
    // environments editor is an unsaved form, so an upload from there returns
    // a path and lets the form own it — writing would half-save edits nobody
    // asked to save. The build screen has no form, so it says `persist`, and
    // an upload there is finished when it finishes.
    const persist = !envDir || url.searchParams.get('persist') === '1';
    if (persist) {
      const cfg = await loadConfig(ctx.configFile);
      if (envDir) {
        // `accounts` is required on an environment, so a row created by an
        // upload starts with none rather than being invalid.
        const env = cfg.environments[envDir] ?? { accounts: {} };
        cfg.environments[envDir] = {
          ...env,
          [platform]: { ...(platform === 'android' ? env.android : env.ios), app: rel },
        };
      } else {
        cfg[platform].app = rel;
      }
      // Kept beside the farm's other run metadata, which is where the run
      // name and the AWS console label are read from.
      cfg.farm.appVersionName = version.versionName ?? '';
      cfg.farm.appVersionCode = version.versionCode ?? '';
      cfg.farm.appLabel = version.appLabel ?? '';
      await saveConfig(cfg, ctx.configFile);
    }
    return json(res, 200, {
      path: rel,
      sizeMb: Math.round(written.size / 1024 / 1024),
      size: written.size,
      ...version,
    });
  },

  'POST /api/builds/source': async (req, res, _url, ctx) => {
    const body = await readJson<{ env: string; platform: 'android' | 'ios'; useInstalled: boolean }>(req);
    if (body.platform !== 'android' && body.platform !== 'ios') {
      return json(res, 400, { error: 'Nền tảng không hợp lệ.' });
    }
    const cfg = await loadConfig(ctx.configFile);
    const env = cfg.environments[body.env];
    if (!env) return json(res, 404, { error: `Không có môi trường "${body.env}".` });
    cfg.environments[body.env] = {
      ...env,
      [body.platform]: {
        ...(body.platform === 'android' ? env.android : env.ios),
        useInstalledApp: body.useInstalled,
      },
    };
    await saveConfig(cfg, ctx.configFile);
    return json(res, 200, await buildInventory(cfg));
  },
};
