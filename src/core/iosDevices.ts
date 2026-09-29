/**
 * Đọc trạng thái máy iOS từ `devicectl`.
 *
 * Tách khỏi server vì import server là khởi động luôn một HTTP server — test
 * không hỏi được một hàm thuần tuý mà không kéo theo cổng 4300.
 */
/**
 * Máy iOS đang thật sự cắm, đọc từ JSON của `devicectl list devices`.
 *
 * `pairingState` KHÔNG trả lời câu hỏi đó. Ghép đôi là chuyện của quá khứ và nó
 * giữ nguyên kể cả khi máy đã nằm trong ngăn kéo — đo trên máy người dùng, ngay
 * sau khi rút cáp:
 *
 *   pairingState   paired          ← vẫn thế
 *   tunnelState    unavailable     ← đây mới là thứ đổi
 *
 * Lọc theo `pairingState` khiến màn chọn máy chấm xanh cho một chiếc iPhone đã
 * rút ra từ lâu, và người dùng tích vào đó rồi chờ một lượt chạy không bao giờ
 * chạy được.
 */
export interface DevicectlJson {
  result?: { devices?: Array<{
    hardwareProperties?: { udid?: string; marketingName?: string };
    connectionProperties?: { tunnelState?: string; pairingState?: string; transportType?: string };
    deviceProperties?: { osVersionNumber?: string; name?: string; developerModeStatus?: string };
  }> };
}

export function attachedFromDevicectl(parsed: DevicectlJson): string[] {
  return usableFromDevicectl(parsed).map((device) => device.udid);
}

/**
 * Cùng luật với `attachedFromDevicectl`, kèm tên và phiên bản iOS — cho sổ
 * máy, nơi một chiếc iPhone cần một cái nhãn đọc được.
 *
 * MỘT luật cho cả hai: preflight nói "máy thật: iPhone 12 Pro Max" trong khi
 * màn Điều khiển không thấy chiếc máy ấy đâu là đúng thứ đã xảy ra khi sổ máy
 * dò máy bằng một đường khác — nó chỉ biết tới simulator.
 */
export function usableFromDevicectl(parsed: DevicectlJson): Array<{
  udid: string; name?: string; osVersion?: string;
  /** Tên người dùng đặt cho máy ("iPhone của Anh") — khác `name`, là tên dòng máy. */
  deviceName?: string;
}> {
  return (parsed.result?.devices ?? [])
    .filter((d) => d.connectionProperties?.pairingState === 'paired')
    .filter((d) => d.connectionProperties?.tunnelState !== 'unavailable')
    .filter((d) => Boolean(d.hardwareProperties?.udid))
    .map((d) => ({
      udid: d.hardwareProperties!.udid!,
      ...(d.hardwareProperties?.marketingName ? { name: d.hardwareProperties.marketingName } : {}),
      ...(d.deviceProperties?.osVersionNumber ? { osVersion: d.deviceProperties.osVersionNumber } : {}),
      ...(d.deviceProperties?.name ? { deviceName: d.deviceProperties.name } : {}),
    }));
}

/**
 * Vì sao một chiếc iPhone ĐANG CẮM mà chưa dùng được — viết cho người cầm máy.
 *
 * Từng bị bỏ lặng lẽ, như Android trước đó: cắm iPhone mới vào, máy hỏi "Tin
 * cậy máy tính này?" mà chưa ai bấm, và màn Thiết bị không hiện gì — người
 * dùng không biết máy có được nhận hay không.
 */
export const IOS_UNAVAILABLE = {
  unpaired: 'iPhone chưa tin cậy máy tính này. Mở khoá iPhone, bấm "Tin cậy" ở hộp thoại rồi nhập '
    + 'mật mã. Không thấy hộp thoại thì rút cáp cắm lại khi máy đang mở khoá.',
  developerMode: 'iPhone chưa bật Chế độ nhà phát triển. Trên máy: Cài đặt › Quyền riêng tư & Bảo mật › '
    + 'Chế độ nhà phát triển › bật, máy khởi động lại, rồi bấm "Bật" để xác nhận.',
} as const;

/**
 * Mọi iPhone đang cắm, kể cả chiếc chưa dùng được — kèm lý do ở `unavailable`.
 *
 * Luật "đang cắm" giữ nguyên như `usableFromDevicectl`: `tunnelState` khác
 * `unavailable`. Chỉ khác ở chỗ máy chưa ghép đôi hoặc chưa bật Chế độ nhà
 * phát triển không bị bỏ đi, mà đi kèm câu nói việc cần làm.
 */
export function iphonesFromDevicectl(parsed: DevicectlJson): Array<{
  udid: string; name?: string; osVersion?: string; deviceName?: string; unavailable?: string;
}> {
  return (parsed.result?.devices ?? [])
    .filter((d) => d.connectionProperties?.tunnelState !== 'unavailable')
    .filter((d) => Boolean(d.hardwareProperties?.udid))
    .map((d) => {
      const unavailable = d.connectionProperties?.pairingState !== 'paired'
        ? IOS_UNAVAILABLE.unpaired
        : d.deviceProperties?.developerModeStatus === 'disabled'
          ? IOS_UNAVAILABLE.developerMode
          : undefined;
      return {
        udid: d.hardwareProperties!.udid!,
        ...(d.hardwareProperties?.marketingName ? { name: d.hardwareProperties.marketingName } : {}),
        ...(d.deviceProperties?.osVersionNumber ? { osVersion: d.deviceProperties.osVersionNumber } : {}),
        ...(d.deviceProperties?.name ? { deviceName: d.deviceProperties.name } : {}),
        ...(unavailable ? { unavailable } : {}),
      };
    });
}

/**
 * iPhone đang CẮM CÁP và đã ghép đôi — những máy tunnel phải giữ.
 *
 * `transportType: wired` là chỗ phân biệt với máy chỉ còn thấy qua mạng: tunnel
 * của Appium chỉ dựng cho máy USB, nên đòi nó giữ một máy Wi-Fi là đòi mãi.
 */
export function wiredIphones(parsed: DevicectlJson): string[] {
  return (parsed.result?.devices ?? [])
    .filter((d) => d.connectionProperties?.transportType === 'wired')
    .filter((d) => d.connectionProperties?.pairingState === 'paired')
    .filter((d) => d.connectionProperties?.tunnelState !== 'unavailable')
    .map((d) => d.hardwareProperties?.udid)
    .filter((udid): udid is string => Boolean(udid));
}
