/**
 * Cắt luồng MJPEG, và bỏ khung trùng.
 *
 * Hai phép thuần, đo bằng byte dựng tay — không cần một chiếc iPhone nào. Đây
 * là chỗ sai im lặng: một khung cụt không làm trình duyệt báo lỗi, nó vẽ ra
 * nửa ảnh; và quên bỏ trùng thì đường truyền tốn 900 KB/s để mô tả một màn
 * hình không đổi.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FrameDeduper, MjpegSplitter } from '../mjpeg.js';

/** Một phần multipart đúng như WDA gửi. */
function part(jpeg: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`--BoundaryString\r\nContent-type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`),
    jpeg,
  ]);
}

const A = Buffer.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
const B = Buffer.from([0xff, 0xd8, 9, 9, 0xff, 0xd9]);

describe('MjpegSplitter', () => {
  it('cắt ra đúng từng khung', () => {
    const frames = new MjpegSplitter().push(Buffer.concat([part(A), part(B)]));
    assert.deepEqual(frames.map((f) => [...f]), [[...A], [...B]]);
  });

  it('khung chưa đủ byte thì chưa phát', () => {
    const splitter = new MjpegSplitter();
    const whole = part(A);
    assert.deepEqual(splitter.push(whole.subarray(0, whole.length - 2)), []);
    assert.deepEqual(splitter.push(whole.subarray(whole.length - 2)).map((f) => [...f]), [[...A]]);
  });

  /**
   * Từng byte một: trường hợp khắc nghiệt nhất, và nó phải cho ra đúng kết quả
   * như khi đưa cả khối. Socket cắt ở đâu là chuyện của hệ điều hành.
   */
  it('chịu được mảnh cắt ở bất kỳ đâu', () => {
    const whole = Buffer.concat([part(A), part(B)]);
    const splitter = new MjpegSplitter();
    const frames = [];
    for (const byte of whole) frames.push(...splitter.push(Buffer.from([byte])));
    assert.deepEqual(frames.map((f) => [...f]), [[...A], [...B]]);
  });

  /**
   * Cắt theo `Content-Length`, KHÔNG đi tìm `FF D9`.
   *
   * Byte kết JPEG xuất hiện được ở giữa dữ liệu ảnh — khung này có một cặp
   * `FF D9` ở giữa. Cắt theo nó sẽ phát ra một khung cụt, và một khung cụt chỉ
   * vẽ ra nửa ảnh chứ không báo lỗi.
   */
  it('không cắt nhầm ở dấu kết JPEG nằm giữa dữ liệu', () => {
    const tricky = Buffer.from([0xff, 0xd8, 0x11, 0xff, 0xd9, 0x22, 0x33, 0xff, 0xd9]);
    const frames = new MjpegSplitter().push(part(tricky));
    assert.deepEqual(frames.map((f) => f.length), [tricky.length]);
  });

  it('khối header không có Content-Length thì bỏ qua, không đoán', () => {
    const bad = Buffer.from('--BoundaryString\r\nContent-type: image/jpeg\r\n\r\n');
    const frames = new MjpegSplitter().push(Buffer.concat([bad, part(A)]));
    assert.deepEqual(frames.map((f) => [...f]), [[...A]]);
  });
});

describe('FrameDeduper', () => {
  /**
   * Đo trên simulator: màn hình đứng yên cho 47 khung giống hệt nhau. MJPEG
   * không nén liên khung, nên mỗi khung là một ảnh đầy đủ 63-135 KB.
   */
  it('khung y hệt khung trước thì bỏ', () => {
    const deduper = new FrameDeduper();
    assert.ok(deduper.keep(A));
    assert.equal(deduper.keep(Buffer.from(A)), undefined, 'cùng nội dung, khác object');
    assert.equal(deduper.keep(A), undefined);
  });

  it('khung đổi thì giữ, rồi lại bỏ trùng từ đó', () => {
    const deduper = new FrameDeduper();
    deduper.keep(A);
    assert.ok(deduper.keep(B));
    assert.equal(deduper.keep(B), undefined);
    assert.ok(deduper.keep(A), 'quay lại nội dung cũ vẫn là một thay đổi');
  });

  it('reset thì khung kế tiếp luôn được giữ', () => {
    const deduper = new FrameDeduper();
    deduper.keep(A);
    deduper.reset();
    assert.ok(deduper.keep(A), 'người xem mới phải nhận được một khung ngay');
  });
});
