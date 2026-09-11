import type { TestPilotConfig } from '../config.js';

/**
 * Which build and which device pool a Device Farm run should use for a given
 * platform.
 *
 * `cfg.farm` is a snapshot of whichever platform was used last: the Device Farm
 * tab rewrites the whole block on every run, and uploading an app sets
 * `farm.platform` from the file extension. A workflow that ticks the other
 * platform would therefore inherit the wrong build and the wrong pool — an .ipa
 * uploaded as ANDROID_APP, against a pool holding no Android devices.
 *
 * Both are re-derived from the platform actually asked for, and anything that
 * cannot be derived is reported rather than guessed. This runs before the
 * bundle and the upload, so a mismatch costs a sentence instead of a 200MB
 * round trip and a rejected run.
 */
export interface FarmTarget {
  appPath: string;
  devicePoolArn: string;
}

export function resolveFarmTarget(
  cfg: TestPilotConfig,
  platform: 'android' | 'ios',
): FarmTarget {
  // The platform's own build, which is the same file a local run installs.
  // `farm.appPath` is only a fallback, and only for the platform it belongs to.
  const appPath =
    (platform === 'android' ? cfg.android.app : cfg.ios.app)
    || (platform === cfg.farm.platform ? cfg.farm.appPath : '');

  const devicePoolArn =
    cfg.farm.devicePools?.[platform]
    || (platform === cfg.farm.platform ? cfg.farm.devicePoolArn : '');

  // Both reported at once. Raising the first and stopping means fixing it,
  // starting another run, and finding the second — twice the round trip for
  // one incomplete setup.
  const missing: string[] = [];
  if (!appPath) {
    missing.push(
      `bản build cho ${platform} — khai báo ${platform}.app trong config `
      + `(farm.appPath đang là bản ${cfg.farm.platform})`,
    );
  }
  if (!devicePoolArn) {
    missing.push(
      `device pool cho ${platform} — mở tab Device Farm, chọn ${platform} và một pool, `
      + 'chạy một lượt ở đó rồi pool sẽ được nhớ lại cho workflow',
    );
  }
  if (missing.length > 0) {
    throw new Error(`Chưa chạy được trên Device Farm, còn thiếu:\n  - ${missing.join('\n  - ')}`);
  }

  return { appPath, devicePoolArn };
}

/**
 * Pool có chạy được bản build của nền tảng này không.
 *
 * Trả về câu giải thích khi KHÔNG, `undefined` khi được — hoặc khi không đọc
 * nổi nền tảng của pool. Mất mạng hay thiếu quyền không nên biến thành một lời
 * từ chối chạy.
 *
 * Chuyện có thật, ba lần liên tiếp: config giữ `devicePools.android` trỏ tới
 * một pool tên "ios-iphone12" — chọn pool lúc để iOS rồi chuyển sang Android,
 * ô pool giữ nguyên ARN cũ và lượt chạy ghi đè nó vào đúng khoá android. Mỗi
 * lần chạy lại là dựng gói, nén, upload APK, upload test package, upload
 * testspec — rồi AWS mới trả lời "Android application requires an Android
 * device".
 */
export function poolPlatformMismatch(
  pools: Array<{ arn: string; name: string; platforms: string[] }>,
  poolArn: string,
  platform: 'android' | 'ios',
): string | undefined {
  const pool = pools.find((item) => item.arn === poolArn);
  if (!pool || pool.platforms.length === 0) return undefined;
  if (pool.platforms.includes(platform)) return undefined;
  return `Device pool "${pool.name}" chỉ có máy ${pool.platforms.join(', ')}, `
    + `không chạy được bản build ${platform}.\n`
    + 'Mở tab Device Farm, chọn một pool khác cho nền tảng này — hoặc tích thiết bị '
    + 'rồi đặt tên và bấm "Tạo pool từ thiết bị đã chọn".';
}
