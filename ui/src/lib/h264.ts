/**
 * Ghép byte H.264 Annex-B thành từng đơn vị truy cập cho `VideoDecoder`.
 *
 * Vì sao cần tầng này: SSE mang về từng mảnh theo kích thước bộ đệm của ống
 * `adb`, KHÔNG theo ranh giới khung hình. Một mảnh có thể chứa một khung rưỡi,
 * hay nửa khung, hay ba khung. `VideoDecoder.decode()` thì đòi mỗi lần gọi là
 * một đơn vị truy cập trọn vẹn — đưa nửa khung vào thì nó không báo lỗi rõ
 * ràng, nó chỉ dựng ra hình vỡ hoặc im lặng bỏ qua.
 *
 * Nên ở đây làm đúng một việc: gom byte, cắt ở mã bắt đầu, và phát ra một đơn
 * vị mỗi khi gặp NAL ảnh tiếp theo. Hàm thuần, không phụ thuộc trình duyệt,
 * nên đo được bằng test thường.
 */

/** Một đơn vị truy cập: đủ để giải mã ra một khung hình. */
export interface AccessUnit {
  data: Uint8Array;
  /** Khung khoá (IDR). Bộ giải mã cần một khung khoá để bắt đầu. */
  key: boolean;
}

/** Vị trí và độ dài của mã bắt đầu kế tiếp, từ `from`. */
function nextStartCode(buf: Uint8Array, from: number): { at: number; size: 3 | 4 } | undefined {
  for (let i = from; i + 2 < buf.length; i += 1) {
    if (buf[i] !== 0 || buf[i + 1] !== 0) continue;
    if (buf[i + 2] === 1) return { at: i, size: 3 };
    if (buf[i + 2] === 0 && i + 3 < buf.length && buf[i + 3] === 1) return { at: i, size: 4 };
  }
  return undefined;
}

/** 5 bit thấp của byte đầu NAL. 1 = khung thường, 5 = IDR, 7 = SPS, 8 = PPS. */
function nalType(buf: Uint8Array, headerAt: number): number {
  return (buf[headerAt] ?? 0) & 0x1f;
}

const VCL = new Set([1, 2, 3, 4, 5]);

export class AnnexBAssembler {
  private buffer = new Uint8Array(0);

  /**
   * Thêm byte, nhận về những đơn vị đã trọn vẹn.
   *
   * Đơn vị CUỐI luôn còn nằm lại trong bộ đệm: chỉ khi thấy mã bắt đầu tiếp
   * theo mới biết đơn vị trước đã hết. Đó là một khung độ trễ — 16ms ở 60
   * khung/giây — và là cái giá để không bao giờ đưa nửa khung vào bộ giải mã.
   */
  push(bytes: Uint8Array): AccessUnit[] {
    const merged = new Uint8Array(this.buffer.length + bytes.length);
    merged.set(this.buffer, 0);
    merged.set(bytes, this.buffer.length);

    const units: AccessUnit[] = [];
    let unitStart = nextStartCode(merged, 0);
    if (!unitStart) {
      this.buffer = merged;
      return units;
    }

    // `cut` là đầu của đơn vị đang gom; `sawPicture` nói đơn vị ấy đã có NAL
    // ảnh chưa. Gặp NAL ảnh thứ hai nghĩa là khung mới bắt đầu.
    let cut = unitStart.at;
    let sawPicture = false;
    let key = false;
    let cursor = unitStart.at;

    for (;;) {
      const here = nextStartCode(merged, cursor);
      if (!here) break;
      const headerAt = here.at + here.size;
      if (headerAt >= merged.length) break;
      const type = nalType(merged, headerAt);

      if (VCL.has(type)) {
        if (sawPicture) {
          units.push({ data: merged.slice(cut, here.at), key });
          cut = here.at;
          key = false;
        }
        sawPicture = true;
        if (type === 5) key = true;
      }
      cursor = headerAt + 1;
    }

    this.buffer = merged.slice(cut);
    return units;
  }

  /**
   * Phát nốt phần đang gom, dùng khi luồng IM LẶNG.
   *
   * `push()` chỉ phát một đơn vị khi thấy đơn vị KẾ TIẾP, vì chỉ lúc ấy mới
   * biết đơn vị trước đã hết. Trên một chiếc máy đang được dùng thì khung nối
   * nhau liên tục nên độ trễ ấy là một khung. Trên một màn hình ĐỨNG YÊN thì
   * không có khung kế tiếp — đo được: mười giây chỉ một mảnh — nên khung đầu
   * tiên không bao giờ được vẽ, và người dùng nhìn một ô trống mà không hiểu
   * vì sao.
   *
   * Nên khi không có byte mới trong một lúc, phần đang gom được coi là trọn
   * vẹn. Đó là một PHỎNG ĐOÁN, và nó đúng vì bộ mã hoá ghi từng khung một vào
   * ống; đoán sai thì bộ giải mã báo lỗi và khung sau vẽ lại.
   */
  flush(): AccessUnit[] {
    if (this.buffer.length === 0) return [];
    let hasPicture = false;
    let key = false;
    let cursor = 0;
    for (;;) {
      const here = nextStartCode(this.buffer, cursor);
      if (!here) break;
      const headerAt = here.at + here.size;
      if (headerAt >= this.buffer.length) break;
      const type = nalType(this.buffer, headerAt);
      if (VCL.has(type)) {
        hasPicture = true;
        if (type === 5) key = true;
      }
      cursor = headerAt + 1;
    }
    // Không có NAL ảnh nào thì chưa có gì để vẽ — giữ lại chờ tiếp.
    if (!hasPicture) return [];
    const unit = { data: this.buffer, key };
    this.buffer = new Uint8Array(0);
    return [unit];
  }

  /** Quên mọi thứ đang gom — dùng khi luồng khởi động lại. */
  reset(): void {
    this.buffer = new Uint8Array(0);
  }
}

/**
 * Chuỗi codec cho `VideoDecoder.configure()`, đọc từ chính SPS.
 *
 * Đặt cứng một chuỗi như `avc1.42E01E` sẽ đúng cho phần lớn máy và sai cho
 * những máy mã hoá ở profile khác — và khi sai thì `configure()` ném, màn hình
 * trống, không ai biết vì sao. Ba byte sau header NAL của SPS là
 * profile_idc / constraint_flags / level_idc, tức là chính xác thứ chuỗi ấy mã
 * hoá.
 */
export function codecFromAnnexB(bytes: Uint8Array): string | undefined {
  let cursor = 0;
  for (;;) {
    const here = nextStartCode(bytes, cursor);
    if (!here) return undefined;
    const headerAt = here.at + here.size;
    if (headerAt + 3 >= bytes.length) return undefined;
    if (nalType(bytes, headerAt) === 7) {
      const hex = [bytes[headerAt + 1], bytes[headerAt + 2], bytes[headerAt + 3]]
        .map((byte) => (byte ?? 0).toString(16).padStart(2, '0'))
        .join('');
      return `avc1.${hex}`;
    }
    cursor = headerAt + 1;
  }
}

/** base64 của một sự kiện SSE → byte. `atob` có sẵn ở cả trình duyệt và Node 22. */
export function decodeBase64(value: string): Uint8Array {
  const raw = atob(value);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}
