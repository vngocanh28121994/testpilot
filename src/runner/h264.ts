/**
 * Giữ lại phần đủ để một người xem VÀO SAU dựng được hình.
 *
 * Vì sao cần: một luồng H.264 đang chảy giữa chừng chỉ còn khung P — chúng mô
 * tả thay đổi so với khung trước, nên một bộ giải mã vừa mở không dựng được gì
 * từ chúng. Nó không báo lỗi; nó chỉ không vẽ. Người dùng thấy một ô trắng và
 * không có cách nào biết mình phải chờ hay phải bấm lại.
 *
 * Chuyện này từng tự khỏi mà không ai định thế: `screenrecord` hết mốc 180
 * giây rồi khởi động lại, và lần ấy phát lại SPS/PPS + khung khoá. Bỏ mốc đi
 * và chuyển sang scrcpy là bỏ luôn cái vá tình cờ đó.
 *
 * Hai cách khác đã thử và bỏ, ghi lại để không ai đi lại:
 *
 * - `RESET_VIDEO` của scrcpy. Đúng lệnh, nhưng đo trên emulator API 36: khung
 *   khoá về sau 4-5 giây, và một trong ba lượt không về trong tám giây.
 * - Dừng phiên rồi mở phiên mới. Xác định hơn, nhưng chập chờn: server cũ
 *   chưa chết hẳn trên máy thì server mới chết bằng một dòng "Aborted". Và nó
 *   làm MỌI người đang xem mất hình vài giây chỉ vì có một người mới vào.
 *
 * Cách ở đây không đụng gì tới phiên đang chạy: người mới nhận ngay phần đã
 * giữ, người đang xem không hề biết có ai vừa vào.
 */

/**
 * Trần cho phần giữ lại, mỗi chiếc máy.
 *
 * Phần giữ lớn dần cho tới khung khoá kế tiếp. Đo trên emulator: luồng nặng
 * 40-100 KB/s và khung khoá về mỗi ~12 giây, nên cỡ thường thấy là hơn một
 * megabyte. Trần này là lưới đỡ cho trường hợp một bộ mã hoá không chịu phát
 * khung khoá nào nữa — thà bỏ phần giữ còn hơn để nó ăn hết bộ nhớ của một
 * máy chủ đang cắm mười chiếc điện thoại.
 */
const MAX_HELD_BYTES = 4 * 1024 * 1024;

const NAL_SPS = 7;
const NAL_PPS = 8;
const NAL_IDR = 5;

/**
 * Đọc luồng đi qua, giữ lại SPS/PPS và mọi thứ từ khung khoá gần nhất.
 *
 * KHÔNG nằm trên đường đi của dữ liệu: người xem hiện tại nhận mảnh của họ
 * ngay, còn cái này ăn theo một bản sao. Một lỗi ở đây làm hỏng người vào sau,
 * không làm chậm người đang xem.
 */
export class StreamPrimer {
  /** Phần đuôi chưa đủ một NAL — biên gói không trùng biên NAL. */
  private carry: Buffer = Buffer.alloc(0);
  private config: Buffer[] = [];
  private gop: Buffer[] = [];
  private gopBytes = 0;

  push(chunk: Buffer): void {
    const data: Buffer = this.carry.length > 0
      ? Buffer.concat([this.carry, chunk])
      : chunk;
    const starts = startCodes(data);
    if (starts.length === 0) {
      this.carry = data;
      return;
    }
    // NAL cuối cùng chưa biết kết thúc ở đâu — phải chờ mã bắt đầu kế tiếp.
    for (let i = 0; i + 1 < starts.length; i += 1) {
      this.take(data.subarray(starts[i]!.at, starts[i + 1]!.at));
    }
    this.carry = data.subarray(starts[starts.length - 1]!.at);
  }

  private take(nal: Buffer): void {
    const type = typeOf(nal);
    if (type === NAL_SPS) {
      // SPS mở một bộ tham số MỚI: bỏ bộ cũ thay vì cộng dồn, nếu không một
      // phiên dài sẽ tích lại hàng trăm bản của cùng một thứ.
      this.config = [nal];
      return;
    }
    if (type === NAL_PPS) {
      this.config.push(nal);
      return;
    }
    if (type === NAL_IDR) {
      this.gop = [nal];
      this.gopBytes = nal.length;
      return;
    }
    if (this.gop.length === 0) return;
    this.gop.push(nal);
    this.gopBytes += nal.length;
    if (this.gopBytes > MAX_HELD_BYTES) {
      // Bỏ và chờ khung khoá kế tiếp. Người vào sau trong quãng này phải chờ
      // khung khoá ấy — vẫn hữu hạn, khác hẳn một ô trắng vĩnh viễn.
      this.gop = [];
      this.gopBytes = 0;
    }
  }

  /**
   * Phần cần gửi cho người vừa vào, hoặc `undefined` khi chưa đủ.
   *
   * Chưa đủ nghĩa là chưa thấy khung khoá nào kể từ lúc mở luồng — người mới
   * chờ khung khoá kế tiếp, và họ có thật vì scrcpy được xin
   * `i-frame-interval`.
   */
  primer(): Buffer | undefined {
    if (this.config.length === 0 || this.gop.length === 0) return undefined;
    return Buffer.concat([...this.config, ...this.gop]);
  }
}

/**
 * Vị trí các mã bắt đầu NAL.
 *
 * Nhận cả mã ba byte (`00 00 01`) lẫn bốn byte (`00 00 00 01`): bộ mã hoá
 * Android dùng bốn byte cho NAL đầu rồi ba byte cho phần còn lại, và cắt nhầm
 * một byte `00` vào đầu NAL trước làm hỏng đúng cái nó đang cố giữ.
 */
function startCodes(data: Buffer): Array<{ at: number }> {
  const out: Array<{ at: number }> = [];
  for (let i = 0; i + 3 < data.length; i += 1) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
      out.push({ at: i > 0 && data[i - 1] === 0 ? i - 1 : i });
      i += 2;
    }
  }
  return out;
}

/** Loại NAL, đọc sau mã bắt đầu dù mã ấy dài ba hay bốn byte. */
function typeOf(nal: Buffer): number {
  const offset = nal[2] === 1 ? 3 : 4;
  return (nal[offset] ?? 0) & 0x1f;
}
