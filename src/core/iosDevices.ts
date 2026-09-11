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
export function attachedFromDevicectl(parsed: {
  result?: { devices?: Array<{
    hardwareProperties?: { udid?: string };
    connectionProperties?: { tunnelState?: string; pairingState?: string };
  }> };
}): string[] {
  return (parsed.result?.devices ?? [])
    .filter((d) => d.connectionProperties?.pairingState === 'paired')
    .filter((d) => d.connectionProperties?.tunnelState !== 'unavailable')
    .map((d) => d.hardwareProperties?.udid)
    .filter((u): u is string => Boolean(u));
}
