/**
 * Khi nào một lỗi giải mã là CHUYỆN THƯỜNG, khi nào là thật sự hỏng.
 *
 * `VideoDecoder` gặp một mảnh không giải mã được thì báo "Decoder failure" và
 * TỰ ĐÓNG. Trước file này, màn Điều khiển coi đó là lỗi chết: người dùng phải
 * bấm Giữ máy lại, dù chỉ một mảnh hỏng — mạng Wi-Fi khựng giữa một khung
 * khoá lớn là đủ. Cả hai bộ mã hoá (iOS, scrcpy) phát khung khoá mỗi hai
 * giây, nên dựng lại bộ giải mã ở khung khoá kế tiếp là hình về sau tối đa
 * chừng ấy, không ai phải bấm gì.
 *
 * Nhưng một trình duyệt THẬT SỰ không giải mã được (profile lạ, GPU lỗi) thì
 * dựng lại mãi cũng hỏng mãi. Nên: hỏng liên tiếp nhiều lần mà giữa chừng
 * không vẽ được khung nào thì mới báo.
 */
export const MAX_FAILURES = 3;
export const FAILURE_WINDOW_MS = 15_000;

export class DecodeRecovery {
  private failures: number[] = [];

  /** Một lỗi vừa xảy ra. `true`: dựng lại ở khung khoá kế tiếp. `false`: thôi, báo người dùng. */
  failed(now = Date.now()): boolean {
    this.failures = [...this.failures.filter((at) => now - at < FAILURE_WINDOW_MS), now];
    return this.failures.length < MAX_FAILURES;
  }

  /** Vừa vẽ được một khung — mọi lỗi trước đó là chuyện đã qua. */
  drew(): void {
    if (this.failures.length > 0) this.failures = [];
  }

  reset(): void {
    this.failures = [];
  }
}

/** Câu báo khi đã dựng lại nhiều lần mà vẫn hỏng. */
export function decodeGiveUpMessage(detail: string, secure: boolean): string {
  return 'Trình duyệt giải mã hình từ máy hỏng liên tục (đã tự dựng lại '
    + `${MAX_FAILURES} lần). Thử: bấm Nhả máy rồi Giữ máy lại; `
    + (secure ? '' : 'mở trang qua HTTPS hoặc localhost; ')
    + 'dùng Chrome/Edge bản mới; nếu vẫn lỗi, tắt “Use graphics acceleration when available” '
    + `trong cài đặt trình duyệt rồi mở lại. Chi tiết kỹ thuật: ${detail}`;
}
