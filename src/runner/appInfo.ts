/**
 * Đọc phiên bản từ một file build (.apk / .ipa).
 *
 * Ở `src/runner/` vì nó chạy `aapt` và `unzip` — tiến trình con trên máy đang
 * giữ file. Bài test ranh giới bắt được chỗ này: nó đã lọt vào
 * `src/server/routes/builds.ts` khi tách nhóm 4, và ở đó thì control plane sẽ
 * phải có Android SDK cài sẵn để trả lời một câu hỏi về file.
 *
 * Biết bản nào đang nằm trên máy là thứ biến "hôm qua chạy được" thành một câu
 * hỏi có câu trả lời, nên nó được đọc cho MỌI build chứ không riêng build farm.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function findAapt(): string | null {
  const sdkRoot =
    process.env.ANDROID_HOME ??
    process.env.ANDROID_SDK_ROOT ??
    path.join(os.homedir(), 'Library', 'Android', 'sdk');
  const btRoot = path.join(sdkRoot, 'build-tools');
  if (!existsSync(btRoot)) return null;
  const versions = readdirSync(btRoot).sort().reverse();
  for (const v of versions) {
    const p = path.join(btRoot, v, 'aapt');
    if (existsSync(p)) return p;
  }
  return null;
}

export async function readAppVersion(file: string): Promise<{ versionName?: string; versionCode?: string; appLabel?: string }> {
  const isIpa = file.toLowerCase().endsWith('.ipa');
  if (isIpa) {
    return new Promise((resolve) => {
      let out = '';
      const child = spawn('bash', [
        '-c',
        `unzip -p "${file}" "Payload/*.app/Info.plist" | plutil -convert json -o - -`,
      ], { stdio: ['ignore', 'pipe', 'ignore'] });
      child.stdout?.on('data', (b: Buffer) => { out += b.toString(); });
      child.on('close', () => {
        try {
          const info = JSON.parse(out);
          resolve({
            versionName: info.CFBundleShortVersionString,
            versionCode: info.CFBundleVersion,
            appLabel: info.CFBundleDisplayName ?? info.CFBundleName,
          });
        } catch { resolve({}); }
      });
      child.on('error', () => resolve({}));
    });
  }

  const aapt = findAapt();
  if (!aapt) return {};
  return new Promise((resolve) => {
    let out = '';
    const child = spawn(aapt, ['dump', 'badging', file], { stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout?.on('data', (b: Buffer) => { out += b.toString(); });
    child.on('close', () => {
      const pkg = out.match(/^package:.*?versionCode='(\d+)'.*?versionName='([^']+)'/m);
      const label = out.match(/^application-label:'([^']+)'/m);
      resolve({
        versionCode: pkg?.[1],
        versionName: pkg?.[2],
        appLabel: label?.[1],
      });
    });
    child.on('error', () => resolve({}));
  });
}
