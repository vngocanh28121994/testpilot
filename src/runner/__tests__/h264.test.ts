/**
 * Phần giữ lại cho người xem vào sau.
 *
 * Bài này dựng luồng H.264 giả thay vì gọi máy thật, vì thứ cần đo là phép cắt
 * NAL — và phép cắt ấy phải đúng ở những chỗ một chiếc máy thật hiếm khi tạo
 * ra đúng lúc ta đang nhìn: mã bắt đầu ba byte lẫn bốn byte, và một NAL bị cắt
 * đôi giữa hai gói mạng.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StreamPrimer } from '../h264.js';

const SPS = 7; const PPS = 8; const IDR = 5; const SLICE = 1;

/** Một NAL với mã bắt đầu bốn byte. */
function nal(type: number, size = 4): Buffer {
  return Buffer.concat([
    Buffer.from([0, 0, 0, 1, type & 0x1f]),
    Buffer.alloc(size, type),
  ]);
}

/** Cùng thế nhưng mã bắt đầu ba byte — bộ mã hoá Android dùng cả hai. */
function nal3(type: number, size = 4): Buffer {
  return Buffer.concat([
    Buffer.from([0, 0, 1, type & 0x1f]),
    Buffer.alloc(size, type),
  ]);
}

describe('giữ phần đầu luồng', () => {
  it('chưa thấy khung khoá thì chưa có gì để đưa', () => {
    // Đưa nửa vời còn tệ hơn không đưa: bộ giải mã nhận tham số rồi ngồi chờ
    // một điểm bắt đầu không bao giờ tới.
    const primer = new StreamPrimer();
    primer.push(Buffer.concat([nal(SPS), nal(PPS), nal(SLICE), nal(SLICE)]));
    assert.equal(primer.primer(), undefined);
  });

  it('có SPS, PPS và khung khoá thì đưa cả ba, đúng thứ tự', () => {
    const primer = new StreamPrimer();
    primer.push(Buffer.concat([nal(SPS), nal(PPS), nal(IDR), nal(SLICE)]));
    // NAL cuối chưa đóng được (chưa có mã bắt đầu kế tiếp), nên chưa vào.
    primer.push(nal(SLICE));
    const out = primer.primer()!;
    assert.deepEqual(types(out), [SPS, PPS, IDR, SLICE]);
  });

  it('khung khoá MỚI vứt bỏ khung cũ, không cộng dồn', () => {
    // Không có luật này thì phần giữ lớn mãi theo độ dài phiên.
    const primer = new StreamPrimer();
    primer.push(Buffer.concat([nal(SPS), nal(PPS), nal(IDR, 64), nal(SLICE, 64)]));
    primer.push(Buffer.concat([nal(IDR, 8), nal(SLICE, 8), nal(SLICE, 8)]));
    const out = primer.primer()!;
    assert.deepEqual(types(out), [SPS, PPS, IDR, SLICE]);
    assert.ok(out.length < 64, `phần giữ phải nhỏ lại, đang là ${out.length} byte`);
  });

  it('NAL bị cắt đôi giữa hai gói vẫn ghép lại đúng', () => {
    // Biên gói mạng không trùng biên NAL, và đây là chỗ một phép cắt ngây thơ
    // hỏng: nửa đầu bị coi là một NAL trọn vẹn.
    const whole = Buffer.concat([nal(SPS), nal(PPS), nal(IDR, 32), nal(SLICE)]);
    const primer = new StreamPrimer();
    for (let cut = 1; cut < whole.length; cut += 7) {
      const each = new StreamPrimer();
      each.push(whole.subarray(0, cut));
      each.push(whole.subarray(cut));
      each.push(nal(SLICE));
      assert.deepEqual(types(each.primer()!), [SPS, PPS, IDR, SLICE], `cắt ở byte ${cut}`);
    }
    primer.push(whole);
  });

  it('đọc được cả mã bắt đầu ba byte', () => {
    // Bộ mã hoá Android dùng bốn byte cho NAL đầu rồi ba byte cho phần sau.
    const primer = new StreamPrimer();
    primer.push(Buffer.concat([nal(SPS), nal3(PPS), nal3(IDR), nal3(SLICE)]));
    primer.push(nal3(SLICE));
    assert.deepEqual(types(primer.primer()!), [SPS, PPS, IDR, SLICE]);
  });

  it('SPS mới thay bộ tham số cũ, không xếp chồng', () => {
    const primer = new StreamPrimer();
    primer.push(Buffer.concat([nal(SPS), nal(PPS), nal(SPS), nal(PPS), nal(IDR)]));
    primer.push(nal(SLICE));
    assert.deepEqual(types(primer.primer()!), [SPS, PPS, IDR]);
  });
});

/** Loại của từng NAL trong một chuỗi, để so sánh cho dễ đọc. */
function types(data: Buffer): number[] {
  const out: number[] = [];
  for (let i = 0; i + 3 < data.length; i += 1) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
      out.push(data[i + 3]! & 0x1f);
      i += 2;
    }
  }
  return out;
}
