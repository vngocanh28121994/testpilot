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
    connectionProperties?: { tunnelState?: string; pairingState?: string };
    deviceProperties?: { osVersionNumber?: string };
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
}> {
  return (parsed.result?.devices ?? [])
    .filter((d) => d.connectionProperties?.pairingState === 'paired')
    .filter((d) => d.connectionProperties?.tunnelState !== 'unavailable')
    .filter((d) => Boolean(d.hardwareProperties?.udid))
    .map((d) => ({
      udid: d.hardwareProperties!.udid!,
      ...(d.hardwareProperties?.marketingName ? { name: d.hardwareProperties.marketingName } : {}),
      ...(d.deviceProperties?.osVersionNumber ? { osVersion: d.deviceProperties.osVersionNumber } : {}),
    }));
}
