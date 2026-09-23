/**
 * Chọn những chiếc máy mà một lượt chạy song song sẽ dùng.
 *
 * Tách khỏi [run-parallel.ts](./run-parallel.ts) vì file ấy CHẠY khi được
 * import — nó có `main()` ở thân module — nên phần quyết định "token này trỏ
 * tới máy nào" không test được khi nằm trong đó. Mà đó đúng là phần đáng test:
 * nó là chỗ một cái tên gõ sai biến thành "chạy ít máy hơn người ta yêu cầu".
 */
import { devicesOf, type DeviceSpec, type TestPilotConfig } from '../config.js';
import type { Platform } from '../core/types.js';

export interface Args {
  platforms: Platform[];
  config?: string;
  tag?: string;
  includeQuarantined: boolean;
  /** Which environment every device runs against; see config.environments. */
  env?: string;
  /** Bản đã cài sẵn trên máy, hay bản đã tải lên. Chuyển thẳng cho từng lượt con. */
  appSource?: 'device' | 'upload';
  /** Reinstall the app on every device even when already on this environment. */
  reinstall: boolean;
  /** Subset of device ids, as `id` or `platform:id`; all of them when omitted. */
  only?: string[];
}

/** One device to drive, and the platform it belongs to. */
export interface Target {
  platform: Platform;
  device: DeviceSpec;
  /**
   * Whether the config names this device in a `devices` list.
   *
   * False means the platform declares only a `deviceName`, so `devicesOf`
   * synthesised this entry. Such a run is passed no `--device` at all: it takes
   * the ordinary single-device path, and its run directory keeps the ordinary
   * unsuffixed name. Nothing can collide with it, because the only other run
   * sharing that second is on the other platform and the platform is in the name.
   */
  named: boolean;
}

export function pickTargets(cfg: TestPilotConfig, args: Args): Target[] {
  const available: Target[] = args.platforms.flatMap((platform) => {
    const named = Boolean(
      (platform === 'android' ? cfg.android.devices : cfg.ios.devices)?.length,
    );
    return devicesOf(cfg, platform).map((device) => ({ platform, device, named }));
  });

  if (!args.only) {
    if (available.length < 2) {
      throw new Error(
        `Only ${available.length} device is configured across ${args.platforms.join(', ')}, ` +
        `so there is nothing to parallelise. Add entries to <platform>.devices, ` +
        `name a second platform, or use the single-device run.`,
      );
    }
    return available;
  }

  return args.only.map((token) => {
    // `platform:id` when the same id exists on both platforms; a bare id while
    // it is unambiguous, which it is in every single-platform run.
    const [maybePlatform, maybeId] = token.includes(':') ? token.split(':', 2) : [undefined, token];
    // Khớp theo `id` TRONG CONFIG hoặc theo `udid`. Giao diện gửi udid, vì từ
    // lúc điện thoại có thể cắm ở laptop người khác thì `id` trong config của
    // máy chủ không trỏ tới được chiếc máy người dùng đang nhìn. Đường chạy đơn
    // đã nhận cả hai từ lâu (`configIdFor`); chỗ này là bản sao còn sót lại của
    // cùng một phép tra, và nó chỉ nhận một nửa.
    const matches = available.filter((t) =>
      (t.device.id === maybeId || t.device.udid === maybeId)
      && (!maybePlatform || t.platform === maybePlatform));

    if (matches.length === 0) {
      throw new Error(
        `--devices names "${token}", which is not configured. ` +
        `Available: ${available.map((t) => `${t.platform}:${t.device.id}`
          + (t.device.udid ? ` (${t.device.udid})` : '')).join(', ')}.`,
      );
    }
    if (matches.length > 1) {
      throw new Error(
        `--devices names "${token}", which exists on ${matches.map((t) => t.platform).join(' and ')}. ` +
        `Qualify it as ${matches.map((t) => `${t.platform}:${t.device.id}`).join(' or ')}.`,
      );
    }
    return matches[0]!;
  });
}

/**
 * Refuses to start when two sessions of the same kind would ask for one port.
 *
 * They fail late and confusingly otherwise: the second session either cannot
 * bind or quietly attaches to the first device's server, and the run that comes
 * back looks real. Cheaper to say so before any device is touched.
 *
 * Checked per platform, and only where a platform runs more than one device.
 * Android sessions contend for `systemPort` and iOS ones for `wdaLocalPort` —
 * different fields, so one phone and one iPhone never collide, and demanding
 * ports of them would turn the most ordinary cross-platform run into a config
 * chore for a conflict that cannot happen.
 */
