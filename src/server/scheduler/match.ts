/**
 * Ghép job với thiết bị: một job sẽ chạy trên CHIẾC MÁY NÀO, gọi bằng TÊN NÀO.
 *
 * Câu hỏi thứ hai mới là chỗ khó, và nó là một lỗi đã tồn tại thật. Cùng một
 * chiếc điện thoại có ba cái tên trong hệ thống này:
 *
 *  - `id` trong config — `sm-s918b`, do đội tự đặt, dùng trong `--device` và
 *    trong tên thư mục lượt chạy;
 *  - `udid` — `R5CW525G35Y`, thứ `adb` trả về và thứ driver thật sự nói chuyện;
 *  - `deviceName` — `SM_S918B`, capability của Appium.
 *
 * Màn Điều khiển giữ chỗ theo **udid** (nó lấy danh sách từ `adb devices`),
 * còn job trước P3.3 giữ chỗ theo **id** của config. Hai cái tên khác nhau cho
 * cùng một chiếc máy nghĩa là hai bên khoá hai thứ khác nhau — và lá chắn dựng
 * ở P3.2 chỉ hoạt động với những config tình cờ đặt `id` trùng `udid`. Không
 * có lỗi nào hiện ra; job vẫn chạy, chỉ là chạy đè lên tay người đang bấm.
 *
 * Nên ở đây chọn MỘT danh tính: **udid**, vì nó là thứ duy nhất cả ba bên —
 * adb, driver, và màn Điều khiển — đều gọi giống nhau.
 */
import { devicesOf, type TestPilotConfig } from '../../config.js';
import type { Platform } from '../../core/types.js';

/** Một chiếc máy đang cắm thật, như runner nhìn thấy. */
export interface AttachedDevice {
  platform: 'android' | 'ios';
  udid: string;
}

export type Resolution =
  /** Chạy được: giữ chỗ đúng những udid này (rỗng nghĩa là không cần máy nào). */
  | { ok: true; udids: string[] }
  /** Chưa chạy được nhưng sẽ chạy được — máy chưa cắm. Job CHỜ. */
  | { ok: false; wait: true; reason: string }
  /** Không bao giờ chạy được với spec này. Job HỎNG, và người dùng phải sửa. */
  | { ok: false; wait: false; reason: string };

/**
 * `platform:id` → udid.
 *
 * `id` tra trong config trước, vì đó là thứ người dùng chọn trên màn hình. Không
 * thấy thì thử coi chính nó là udid: máy cắm vào mà chưa khai trong config vẫn
 * điều khiển được qua màn Điều khiển, nên job nhắm vào nó cũng phải hiểu được.
 */
function udidOf(
  cfg: TestPilotConfig,
  platform: Platform,
  id: string,
  attached: AttachedDevice[],
): string | undefined {
  const configured = devicesOf(cfg, platform).find((device) => device.id === id);
  if (configured?.udid) return configured.udid;
  if (attached.some((device) => device.udid === id)) return id;
  // Config khai máy nhưng không có udid: bản một-máy tự sinh, nơi runner chạy
  // trên bất cứ thứ gì adb tìm thấy. Danh tính thật nằm ở phần dưới.
  return undefined;
}

/**
 * Job này cần giữ chỗ những chiếc máy nào.
 *
 * Bốn đường ra, và ba trong số đó là "chưa chạy" — vì phần lớn cái sai ở đây
 * không phải lỗi mà là "chưa đủ điều kiện", và phân biệt hai thứ ấy quyết định
 * job nằm chờ hay đỏ lên.
 */
export function resolveDevices(
  spec: { deviceTokens: string[]; run?: { platform?: string } },
  cfg: TestPilotConfig,
  attached: AttachedDevice[],
): Resolution {
  const platform = (spec.run?.platform ?? '') as Platform;

  if (spec.deviceTokens.length > 0) {
    const udids: string[] = [];
    for (const token of spec.deviceTokens) {
      const [tokenPlatform, ...rest] = token.split(':');
      const id = rest.join(':');
      if (!id || (tokenPlatform !== 'android' && tokenPlatform !== 'ios')) {
        return { ok: false, wait: false, reason: `Mã thiết bị "${token}" không đọc được.` };
      }
      // Không có trong config thì coi chính nó là udid: danh sách chọn máy trên
      // màn hình lấy từ máy ĐANG CẮM, nên một mã lạ gần như luôn là chiếc máy
      // vừa bị rút ra — chứ không phải lỗi gõ.
      const udid = udidOf(cfg, tokenPlatform, id, attached) ?? id;
      if (!attached.some((device) => device.udid === udid)) {
        // CHỜ, không hỏng: cắm máy vào là chạy. Đây là hành vi mà một phòng
        // máy cần — job đặt trước, máy về sau.
        //
        // Câu nói ra cả khả năng kia, vì hai trường hợp nhìn từ đây giống hệt
        // nhau: một mã gõ sai cũng sẽ chờ mãi, và người đọc cần biết để đi
        // kiểm cái tên.
        return {
          ok: false, wait: true,
          reason: `Máy "${id}"${udid === id ? '' : ` (${udid})`} chưa cắm `
            + '(hoặc mã máy này không có trong config).',
        };
      }
      udids.push(udid);
    }
    return { ok: true, udids };
  }

  // Không nêu máy nào.
  if (platform === 'web') return { ok: true, udids: [] };
  if (platform !== 'android' && platform !== 'ios') {
    return { ok: false, wait: false, reason: `Nền tảng "${platform}" không có.` };
  }

  const configured = devicesOf(cfg, platform);
  if (configured.length > 1) {
    // Cùng câu mà CLI nói, và cố ý giống: người dùng sẽ tìm nó trong cả hai chỗ.
    return {
      ok: false, wait: false,
      reason: `${platform} có ${configured.length} máy trong config nên phải chọn một: `
        + configured.map((device) => device.id).join(', '),
    };
  }

  const only = configured[0];
  const udid = only?.udid
    // Config một-máy không khai udid: lấy chiếc duy nhất đang cắm của nền tảng
    // ấy. Nhiều hơn một thì không đoán — đoán sai là chạy nhầm điện thoại, và
    // sai ấy chỉ lộ ra sau khi báo cáo đã được đọc và tin.
    ?? (attached.filter((device) => device.platform === platform).length === 1
      ? attached.find((device) => device.platform === platform)?.udid
      : undefined);

  if (!udid) {
    const count = attached.filter((device) => device.platform === platform).length;
    return count === 0
      ? { ok: false, wait: true, reason: `Chưa có máy ${platform} nào cắm vào.` }
      : {
          ok: false, wait: false,
          reason: `Có ${count} máy ${platform} đang cắm nhưng config không nói dùng chiếc nào. `
            + 'Khai `devices` trong config, hoặc chọn máy trên màn hình.',
        };
  }
  return { ok: true, udids: [udid] };
}

/**
 * Nền tảng runner này chạy được, ĐO từ máy đang cắm.
 *
 * `web` luôn có: nó không cần thiết bị nào. Android và iOS chỉ được khai khi
 * thật sự có máy — khai điều mình mong thay vì điều mình đo được nghĩa là job
 * iOS rơi vào một chiếc MacBook không có iPhone nào, rồi fail sau ba phút chờ
 * WebDriverAgent.
 */
export function runnerPlatforms(attached: AttachedDevice[]): string[] {
  const platforms = new Set<string>(['web']);
  for (const device of attached) platforms.add(device.platform);
  return [...platforms];
}
