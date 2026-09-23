/**
 * Câu lỗi của một lệnh adb phải nói được AI đã giết tiến trình.
 *
 * Bản đầu in `mã ${code}`, và `code` là `null` mỗi khi tiến trình bị một tín
 * hiệu giết — kể cả tín hiệu do CHÍNH hạn giờ của ta bắn ra. Người dùng nhận
 * đúng dòng "adb kết thúc với mã null" giữa lúc đang chạm vào màn hình điện
 * thoại: một câu không chỉ ra được gì, và không gợi ý được việc gì để thử.
 *
 * Đây là bài test cho một hàm thuần tách ra từ đúng chỗ đó.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describeExit } from '../androidControl.js';

const ARGS = ['shell', 'input', 'tap', '100', '200'];

describe('câu lỗi của lệnh adb', () => {
  it('hạn giờ của ta thì nói là hạn giờ, kèm việc để thử', () => {
    const message = describeExit(ARGS, null, 'SIGTERM', true, 8_000);
    assert.match(message, /không trả lời trong 8 giây/);
    assert.match(message, /adb devices/, 'phải gợi ý một việc kiểm được');
    assert.doesNotMatch(message, /null/, 'đừng bao giờ in chữ null cho người dùng');
  });

  it('tín hiệu từ bên ngoài thì gọi đúng tên tín hiệu', () => {
    // Khác hẳn ca trên: ai đó hoặc cái gì đó ngoài tiến trình này đã giết nó,
    // và "thử `adb devices`" là lời khuyên sai cho trường hợp ấy.
    const message = describeExit(ARGS, null, 'SIGKILL', false, 8_000);
    assert.match(message, /SIGKILL/);
    assert.doesNotMatch(message, /không trả lời/);
  });

  it('thoát với mã thật thì in mã ấy', () => {
    assert.match(describeExit(ARGS, 1, null, false, 8_000), /kết thúc với mã 1/);
  });

  it('luôn nhắc lại lệnh đã chạy', () => {
    // Màn điều khiển gửi nhiều loại lệnh; biết cú chạm hay cú vuốt hỏng là
    // khác biệt giữa "thử lại" và "đi tìm nguyên nhân".
    for (const [code, signal, timedOut] of [
      [null, 'SIGTERM', true], [null, 'SIGKILL', false], [1, null, false],
    ] as const) {
      assert.match(
        describeExit(ARGS, code, signal, timedOut, 8_000),
        /adb shell input tap 100 200/,
      );
    }
  });
});
