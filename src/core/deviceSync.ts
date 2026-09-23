/**
 * Thêm một chiếc máy đang cắm vào danh sách máy của config.
 *
 * Việc này vốn đã có ở `npm run devices:sync`, và ở đó nó giải quyết đúng ba
 * chuyện khó: đặt một `id` đọc được, chọn một cổng chưa ai dùng, và không bao
 * giờ đụng vào dòng đã có. Nhưng nó là một lệnh dòng lệnh, nên người cắm máy
 * vào rồi mở web lên không có đường nào tới nó — họ thấy màn hình nói "2 máy
 * sẵn sàng" rồi chỉ chạy được một máy, và cách sửa nằm trong một terminal.
 *
 * Nên phần quyết định được tách ra đây: hàm thuần, không đọc `adb`, không ghi
 * file. CLI và route web gọi chung — hai bản chép tay của cùng một luật đặt
 * tên sẽ lệch, và lúc ấy cùng một chiếc máy có hai `id` khác nhau tuỳ người
 * thêm nó bằng đường nào.
 *
 * **Chỉ THÊM.** Một dòng đã có được giữ nguyên từng chữ, vì `id` của nó chịu
 * lực: tên thư mục lượt chạy dựng từ nó và `HealingStore` gộp theo nó. Sửa
 * một `id` đang dùng là tách lịch sử của chiếc máy ấy làm hai mà không ai báo.
 */
import type { DeviceSpec, TestPilotConfig } from '../config.js';
import type { AttachedDevice } from './attachedDevices.js';

/** Cổng đầu của mỗi dải — mặc định của Appium, dịch đi để chừa chỗ cho nó. */
const FIRST_PORT: Record<'android' | 'ios', number> = { android: 8200, ios: 8100 };

/**
 * Máy đang cắm mà config chưa biết.
 *
 * Đây là thứ màn hình cần để hỏi "thêm máy này chứ?". Khớp theo `udid` và cả
 * `deviceName`: config cũ khai `deviceName` mà không khai `udid`, và bỏ nhánh
 * ấy là mời người dùng thêm lần thứ hai một chiếc máy họ đã khai rồi.
 */
export function unregisteredDevices(
  cfg: TestPilotConfig,
  platform: 'android' | 'ios',
  attached: ReadonlyArray<AttachedDevice>,
): AttachedDevice[] {
  const devices = (platform === 'android' ? cfg.android : cfg.ios).devices ?? [];
  const known = new Set(devices.flatMap((device) =>
    [device.udid, device.deviceName].filter((value): value is string => Boolean(value))));
  return attached.filter((found) => !known.has(found.udid));
}

export interface Registered {
  /** Những dòng vừa thêm. Rỗng nghĩa là config đã có đủ. */
  added: DeviceSpec[];
}

/**
 * Thêm những máy đang cắm mà config chưa có. SỬA `cfg` tại chỗ.
 *
 * Sửa tại chỗ chứ không trả về bản sao, vì cả hai người gọi đều ghi lại chính
 * `cfg` ấy ngay sau đó — và một bản sao nửa vời là đường để ai đó lưu nhầm bản
 * cũ. Người gọi quyết định có lưu hay không (`--dry-run` là một ví dụ).
 */
export function registerDevices(
  cfg: TestPilotConfig,
  platform: 'android' | 'ios',
  attached: ReadonlyArray<AttachedDevice>,
): Registered {
  const section = platform === 'android' ? cfg.android : cfg.ios;
  // Nền tảng chưa có danh sách nào thì nó đang chạy bằng `deviceName` trơ —
  // một cái tên không chỉ vào chiếc máy cụ thể nào. Ở đó không có danh tính
  // nào đáng giữ, nên danh sách bắt đầu từ những chiếc máy tìm thấy thật.
  section.devices ??= [];
  const devices = section.devices;

  const added: DeviceSpec[] = [];
  for (const found of unregisteredDevices(cfg, platform, attached)) {
    const device: DeviceSpec = {
      id: uniqueId(found, devices),
      deviceName: found.model ?? (platform === 'android' ? 'Android Device' : 'iPhone'),
      udid: found.udid,
    };
    assignPort(platform, device, devices);
    devices.push(device);
    added.push(device);
  }
  return { added };
}

/**
 * `id` đọc được, dựng từ model.
 *
 * Model chứ không phải serial, vì `id` đi vào tên thư mục lượt chạy và đó là
 * chỗ người ta đọc để nhận ra chiếc máy. `R5CW525G35Y` thì phải đi tra, còn
 * `sm-s918b` thì nhận ra ngay. Không có model thì lấy sáu ký tự cuối của
 * serial — vẫn ngắn hơn và vẫn phân biệt được.
 */
export function uniqueId(found: AttachedDevice, existing: ReadonlyArray<DeviceSpec>): string {
  const base = (found.model ?? found.udid.slice(-6))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'device';
  const taken = new Set(existing.map((d) => d.id));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Mỗi phiên một cổng riêng.
 *
 * Hai phiên Appium cùng cổng thì phiên thứ hai hoặc không bind được, hoặc
 * lặng lẽ nối vào máy của phiên thứ nhất — và lượt chạy trả về trông như thật.
 * Cổng của những dòng ĐÃ CÓ đều được tránh, kể cả dòng của một chiếc máy đang
 * nằm trong ngăn kéo: ngày mai nó được cắm vào.
 */
export function assignPort(
  platform: 'android' | 'ios',
  device: DeviceSpec,
  all: ReadonlyArray<DeviceSpec>,
): void {
  const field = platform === 'android' ? 'systemPort' : 'wdaLocalPort';
  if (device[field] !== undefined) return;
  const taken = new Set(all.map((d) => d[field]).filter((p): p is number => p !== undefined));
  let port = FIRST_PORT[platform];
  while (taken.has(port)) port += 1;
  device[field] = port;
}
