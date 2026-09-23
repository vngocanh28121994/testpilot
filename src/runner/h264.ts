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
  private size: { width: number; height: number } | undefined;

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
      // Kích thước ảnh có thể ĐỔI giữa chừng — máy xoay là bộ mã hoá dựng lại
      // và phát SPS mới. Đọc lại mỗi lần thay vì chỉ đọc lần đầu.
      this.size = spsSize(nal) ?? this.size;
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
  /**
   * Kích thước ảnh thật, khi đã đọc được SPS.
   *
   * Mọi sự kiện chạm phải khai đúng con số này; scrcpy bỏ im lặng những sự
   * kiện khai sai. Xem [spsSize](#spsSize).
   */
  videoSize(): { width: number; height: number } | undefined {
    return this.size;
  }

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

/**
 * Kích thước ảnh, đọc từ SPS.
 *
 * Vì sao phải tự đọc: scrcpy 4.1 KHÔNG gửi kích thước video trên dây (phần
 * `device_meta` chỉ có tên máy, `stream_meta` chỉ có mã codec) — client thật
 * của nó cũng suy ra từ SPS. Mà ta buộc phải biết con số ấy: mọi sự kiện chạm
 * phải khai đúng kích thước video, và `PositionMapper.map()` bên kia trả `null`
 * cho bất kỳ kích thước nào khác — sự kiện bị bỏ IM LẶNG, không lỗi, không log.
 *
 * Đoán bằng cách tự tính từ `max_size` thì sai: scrcpy làm tròn theo luật của
 * riêng nó và luật ấy đổi theo phiên bản. Đọc từ luồng thì đúng theo định
 * nghĩa, dù scrcpy có đổi cách tính.
 */
export function spsSize(nal: Buffer): { width: number; height: number } | undefined {
  const offset = nal[2] === 1 ? 3 : 4;
  if (((nal[offset] ?? 0) & 0x1f) !== NAL_SPS) return undefined;
  const bits = new Bits(unescape(nal.subarray(offset + 1)));
  try {
    const profile = bits.u(8);
    bits.u(16); // cờ ràng buộc + level_idc
    bits.ue(); // seq_parameter_set_id

    let chromaFormat = 1; // 4:2:0 khi không khai
    if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profile)) {
      chromaFormat = bits.ue();
      if (chromaFormat === 3) bits.u(1);
      bits.ue(); // bit_depth_luma_minus8
      bits.ue(); // bit_depth_chroma_minus8
      bits.u(1); // qpprime_y_zero_transform_bypass_flag
      if (bits.u(1) === 1) skipScalingLists(bits, chromaFormat === 3 ? 12 : 8);
    }

    bits.ue(); // log2_max_frame_num_minus4
    const pocType = bits.ue();
    if (pocType === 0) {
      bits.ue();
    } else if (pocType === 1) {
      bits.u(1);
      bits.se();
      bits.se();
      const cycle = bits.ue();
      for (let i = 0; i < cycle; i += 1) bits.se();
    }
    bits.ue(); // max_num_ref_frames
    bits.u(1); // gaps_in_frame_num_value_allowed_flag

    const widthMbs = bits.ue() + 1;
    const heightMapUnits = bits.ue() + 1;
    const frameMbsOnly = bits.u(1);
    if (frameMbsOnly === 0) bits.u(1);
    bits.u(1); // direct_8x8_inference_flag

    let cropLeft = 0; let cropRight = 0; let cropTop = 0; let cropBottom = 0;
    if (bits.u(1) === 1) {
      cropLeft = bits.ue();
      cropRight = bits.ue();
      cropTop = bits.ue();
      cropBottom = bits.ue();
    }

    // Đơn vị cắt viền theo kiểu lấy mẫu màu; 4:2:0 là 2x2 điểm ảnh một đơn vị.
    const subWidth = chromaFormat === 3 ? 1 : 2;
    const subHeight = chromaFormat === 1 ? 2 : 1;
    const unitX = chromaFormat === 0 ? 1 : subWidth;
    const unitY = (chromaFormat === 0 ? 1 : subHeight) * (2 - frameMbsOnly);

    const width = widthMbs * 16 - unitX * (cropLeft + cropRight);
    const height = (2 - frameMbsOnly) * heightMapUnits * 16 - unitY * (cropTop + cropBottom);
    if (width <= 0 || height <= 0) return undefined;
    return { width, height };
  } catch {
    // SPS cắt dở hoặc không như mong đợi. Trả `undefined` để phía gọi giữ con
    // số tự tính — sai nhưng có, hơn là ném ra giữa lúc đang mở luồng.
    return undefined;
  }
}

function skipScalingLists(bits: Bits, count: number): void {
  for (let i = 0; i < count; i += 1) {
    if (bits.u(1) === 0) continue;
    let last = 8; let next = 8;
    const size = i < 6 ? 16 : 64;
    for (let j = 0; j < size; j += 1) {
      if (next !== 0) next = (last + bits.se() + 256) % 256;
      last = next === 0 ? last : next;
    }
  }
}

/**
 * Bỏ byte chống giả mã bắt đầu.
 *
 * Bộ mã hoá chèn `0x03` vào giữa `00 00 0x` để chuỗi ấy không bị nhầm là mã
 * bắt đầu một NAL. Đọc bit mà quên gỡ chúng thì mọi trường sau đó lệch.
 */
function unescape(rbsp: Buffer): Buffer {
  const out: number[] = [];
  for (let i = 0; i < rbsp.length; i += 1) {
    if (i >= 2 && rbsp[i] === 3 && rbsp[i - 1] === 0 && rbsp[i - 2] === 0) continue;
    out.push(rbsp[i]!);
  }
  return Buffer.from(out);
}

/** Đọc từng bit, với hai kiểu số Exp-Golomb mà H.264 dùng khắp nơi. */
class Bits {
  private at = 0;

  constructor(private readonly data: Buffer) {}

  u(count: number): number {
    let value = 0;
    for (let i = 0; i < count; i += 1) {
      const byte = this.data[this.at >> 3];
      if (byte === undefined) throw new Error('hết bit');
      value = (value << 1) | ((byte >> (7 - (this.at & 7))) & 1);
      this.at += 1;
    }
    return value;
  }

  /** Số nguyên không dấu Exp-Golomb. */
  ue(): number {
    let zeros = 0;
    while (this.u(1) === 0) {
      zeros += 1;
      if (zeros > 31) throw new Error('Exp-Golomb quá dài');
    }
    return zeros === 0 ? 0 : (1 << zeros) - 1 + this.u(zeros);
  }

  /** Số nguyên có dấu Exp-Golomb. */
  se(): number {
    const value = this.ue();
    return value % 2 === 0 ? -(value / 2) : (value + 1) / 2;
  }
}
