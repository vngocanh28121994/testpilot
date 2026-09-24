/**
 * Tách luồng `multipart/x-mixed-replace` của WebDriverAgent thành từng ảnh JPEG.
 *
 * WDA phát MJPEG ở một cổng HTTP (mỗi phiên một cổng trống, xem iosControl.ts): mỗi khung là một ảnh JPEG trọn vẹn, ngăn nhau
 * bằng một ranh giới và một khối header có `Content-Length`. Socket thì trả về
 * từng mảnh theo kích thước bộ đệm, nên một mảnh có thể chứa nửa header, hay
 * ba khung rưỡi — cùng hình dạng vấn đề với Annex-B của Android, và cùng cách
 * giải: gom, cắt theo `Content-Length`, phát ra những khung trọn vẹn.
 *
 * Dựa vào `Content-Length` chứ không đi tìm `FF D9` (dấu kết JPEG): byte ấy
 * xuất hiện được ở giữa dữ liệu ảnh, nên cắt theo nó sẽ thỉnh thoảng phát ra
 * một khung cụt — và một khung cụt không làm trình duyệt báo lỗi, nó chỉ vẽ ra
 * một nửa ảnh.
 */
import { createHash } from 'node:crypto';

const HEADER_END = Buffer.from('\r\n\r\n');

export class MjpegSplitter {
  private buffer = Buffer.alloc(0);

  /** Thêm byte, nhận về những khung JPEG trọn vẹn. */
  push(bytes: Buffer): Buffer[] {
    // `concat` cả khi bộ đệm rỗng: gán thẳng `bytes` vào sẽ giữ lại đúng kiểu
    // bộ nhớ nền của mảnh đến, và kiểu ấy không phải lúc nào cũng khớp.
    this.buffer = Buffer.concat([this.buffer, bytes]);
    const frames: Buffer[] = [];

    for (;;) {
      const headerEnd = this.buffer.indexOf(HEADER_END);
      if (headerEnd < 0) break;
      const header = this.buffer.subarray(0, headerEnd).toString('latin1');
      const match = /content-length:\s*(\d+)/i.exec(header);
      if (!match) {
        // Khối header không nói độ dài: không đoán, bỏ qua khối này và đi tiếp.
        // Đoán ở đây nghĩa là phát ra một khung có thể cụt.
        this.buffer = this.buffer.subarray(headerEnd + HEADER_END.length);
        continue;
      }
      const length = Number(match[1]);
      const start = headerEnd + HEADER_END.length;
      if (this.buffer.length < start + length) break;

      frames.push(this.buffer.subarray(start, start + length));
      this.buffer = this.buffer.subarray(start + length);
    }
    return frames;
  }

  reset(): void {
    this.buffer = Buffer.alloc(0);
  }
}

/**
 * Bỏ khung trùng với khung trước đó.
 *
 * Đo trên simulator iPhone 17 Pro ngày 22/09/2026: màn hình đứng yên thì 47
 * khung liên tiếp GIỐNG HỆT NHAU TỪNG BYTE. MJPEG không có nén liên khung, nên
 * mỗi khung là một ảnh đầy đủ 63-135 KB — tức là gửi đi 900 KB/s để mô tả một
 * màn hình không đổi.
 *
 * Người dùng màn điều khiển nhìn một màn hình đứng yên gần như toàn bộ thời
 * gian: họ đang đọc xem nên chạm vào đâu. Nên phép bỏ trùng này không phải một
 * tối ưu nhỏ — nó là khác biệt giữa 900 KB/s và gần như không tốn gì.
 */
export class FrameDeduper {
  private last: string | undefined;

  /** `undefined` nghĩa là khung này y hệt khung trước. */
  keep(frame: Buffer): Buffer | undefined {
    const digest = createHash('sha1').update(frame).digest('base64');
    if (digest === this.last) return undefined;
    this.last = digest;
    return frame;
  }

  reset(): void {
    this.last = undefined;
  }
}
