/**
 * Phép ghép Annex-B, đo bằng byte dựng tay.
 *
 * Đây là chỗ dễ sai nhất của cả màn điều khiển, và sai một cách im lặng: đưa
 * nửa khung vào `VideoDecoder` thì nó không ném, nó chỉ vẽ ra hình vỡ. Nên
 * những trường hợp đáng đo là những trường hợp KHÓ: mảnh cắt giữa mã bắt đầu,
 * mã ba byte lẫn bốn byte, và một mảnh chứa nhiều khung.
 */
import { describe, it, expect } from 'vitest';
import { AnnexBAssembler, codecFromAnnexB, decodeBase64 } from '@/lib/h264';

/** NAL có mã bắt đầu bốn byte. `type` là 5 bit thấp của byte đầu. */
function nal(type: number, payload: number[] = [0xaa, 0xbb]): number[] {
  return [0, 0, 0, 1, type & 0x1f, ...payload];
}

const SPS = nal(7, [0x42, 0xc0, 0x2a, 0x8d]);
const PPS = nal(8, [0xce, 0x01]);
const IDR = nal(5, [0x88, 0x84]);
const FRAME = nal(1, [0x9a, 0x02]);

function bytes(...parts: number[][]): Uint8Array {
  return new Uint8Array(parts.flat());
}

describe('AnnexBAssembler', () => {
  it('gom SPS/PPS vào cùng đơn vị với khung khoá', () => {
    const assembler = new AnnexBAssembler();
    // Đơn vị đầu chỉ phát ra khi thấy khung TIẾP THEO — nên gửi kèm một khung.
    const units = assembler.push(bytes(SPS, PPS, IDR, FRAME));

    expect(units).toHaveLength(1);
    expect(units[0]!.key).toBe(true);
    expect([...units[0]!.data]).toEqual([...SPS, ...PPS, ...IDR]);
  });

  it('khung thường không phải khung khoá', () => {
    const assembler = new AnnexBAssembler();
    assembler.push(bytes(SPS, PPS, IDR));
    const units = assembler.push(bytes(FRAME, FRAME));

    expect(units).toHaveLength(2);
    expect(units[0]!.key).toBe(true);
    expect(units[1]!.key).toBe(false);
  });

  /**
   * Mảnh cắt GIỮA một mã bắt đầu.
   *
   * SSE mang về từng mảnh theo kích thước bộ đệm của ống `adb`, nên `00 00`
   * cuối mảnh này và `00 01` đầu mảnh sau là chuyện thường. Xử lý từng mảnh
   * độc lập sẽ bỏ sót đúng ranh giới ấy.
   */
  it('chịu được mảnh cắt giữa mã bắt đầu', () => {
    const whole = bytes(SPS, PPS, IDR, FRAME, FRAME);
    const assembler = new AnnexBAssembler();
    const units = [];
    // Cắt từng byte một: trường hợp khắc nghiệt nhất, và nó phải cho ra đúng
    // kết quả như khi đưa cả khối.
    for (const byte of whole) units.push(...assembler.push(new Uint8Array([byte])));

    const atOnce = new AnnexBAssembler().push(whole);
    expect(units.map((u) => [...u.data])).toEqual(atOnce.map((u) => [...u.data]));
    expect(units).toHaveLength(2);
  });

  it('đọc được cả mã bắt đầu ba byte', () => {
    const shortStart = [0, 0, 1, 1, 0x11];
    const assembler = new AnnexBAssembler();
    const units = assembler.push(bytes(SPS, PPS, IDR, shortStart, FRAME));

    expect(units).toHaveLength(2);
    expect(units[0]!.key).toBe(true);
  });

  it('không có mã bắt đầu thì không phát gì, và không mất byte', () => {
    const assembler = new AnnexBAssembler();
    expect(assembler.push(new Uint8Array([1, 2, 3]))).toEqual([]);
    const units = assembler.push(bytes(SPS, PPS, IDR, FRAME));
    expect(units).toHaveLength(1);
  });

  it('reset bỏ hết phần đang gom', () => {
    const assembler = new AnnexBAssembler();
    assembler.push(bytes(SPS, PPS, IDR));
    assembler.reset();
    // Sau reset, một khung lẻ không kéo theo phần dở dang của luồng cũ.
    const units = assembler.push(bytes(FRAME, FRAME));
    expect(units).toHaveLength(1);
    expect([...units[0]!.data]).toEqual([...FRAME]);
  });
});

describe('codecFromAnnexB', () => {
  /**
   * Đặt cứng `avc1.42E01E` đúng cho phần lớn máy và sai cho những máy mã hoá ở
   * profile khác — và khi sai thì `configure()` ném, màn hình trống, không ai
   * biết vì sao.
   */
  it('đọc profile và level từ SPS', () => {
    expect(codecFromAnnexB(bytes(SPS, PPS, IDR))).toBe('avc1.42c02a');
  });

  it('SPS không nằm đầu luồng vẫn tìm được', () => {
    expect(codecFromAnnexB(bytes(nal(6, [0x01]), SPS))).toBe('avc1.42c02a');
  });

  it('không có SPS thì trả undefined, không đoán', () => {
    expect(codecFromAnnexB(bytes(FRAME))).toBeUndefined();
    expect(codecFromAnnexB(new Uint8Array([0, 0, 0, 1]))).toBeUndefined();
  });
});

describe('decodeBase64', () => {
  it('ra đúng byte của mã bắt đầu Annex-B', () => {
    // Chính chuỗi mà server gửi trong sự kiện `video` đầu tiên.
    expect([...decodeBase64('AAAAAWdCwCo=')]).toEqual([0, 0, 0, 1, 0x67, 0x42, 0xc0, 0x2a]);
  });
});

describe('AnnexBAssembler.flush', () => {
  /**
   * Lỗi thật, và nó chỉ lộ ra khi màn hình ĐỨNG YÊN.
   *
   * `push()` chỉ phát một khung khi thấy khung kế tiếp. Trên máy đang dùng thì
   * khung nối nhau nên độ trễ ấy là một khung; trên một màn hình không đổi thì
   * đo được mười giây chỉ một mảnh — và khung đầu tiên không bao giờ được vẽ.
   * Người mở màn điều khiển nhìn một ô trống mà không hiểu vì sao.
   */
  it('phát nốt khung đang gom khi luồng im lặng', () => {
    const assembler = new AnnexBAssembler();
    // Đúng thứ một mảnh đầu tiên mang: SPS + PPS + khung khoá, rồi im lặng.
    assert_empty(assembler.push(bytes(SPS, PPS, IDR)));

    const flushed = assembler.flush();
    expect(flushed).toHaveLength(1);
    expect(flushed[0]!.key).toBe(true);
    expect([...flushed[0]!.data]).toEqual([...SPS, ...PPS, ...IDR]);
  });

  it('phát rồi thì không phát lại', () => {
    const assembler = new AnnexBAssembler();
    assembler.push(bytes(SPS, PPS, IDR));
    expect(assembler.flush()).toHaveLength(1);
    expect(assembler.flush()).toHaveLength(0);
  });

  /** Chưa có NAL ảnh nào thì chưa có gì để vẽ — giữ lại chờ tiếp. */
  it('chỉ có SPS/PPS thì chưa phát', () => {
    const assembler = new AnnexBAssembler();
    assembler.push(bytes(SPS, PPS));
    expect(assembler.flush()).toHaveLength(0);

    // Khung khoá tới sau thì cả cụm đi cùng nhau.
    assembler.push(bytes(IDR));
    const flushed = assembler.flush();
    expect(flushed).toHaveLength(1);
    expect([...flushed[0]!.data]).toEqual([...SPS, ...PPS, ...IDR]);
  });

  it('bộ đệm rỗng thì không phát gì', () => {
    expect(new AnnexBAssembler().flush()).toHaveLength(0);
  });
});

function assert_empty(units: unknown[]): void {
  expect(units).toHaveLength(0);
}
