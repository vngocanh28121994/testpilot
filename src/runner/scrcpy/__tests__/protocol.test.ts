/**
 * Từng byte của lệnh điều khiển scrcpy.
 *
 * Vì sao đáng test đến mức này: server đọc các trường theo THỨ TỰ và theo ĐỘ
 * DÀI cố định, không có nhãn nào. Thừa hay thiếu một byte thì nó không báo lỗi
 * — nó đọc tiếp và hiểu sai mọi trường phía sau. Triệu chứng là ngón tay rơi
 * xuống một chỗ khác trên màn hình, thứ trông như "app hỏng" chứ không như
 * "sai giao thức".
 *
 * Các con số đối chiếu với `ControlMessageReader.java` ở tag v4.1.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_DOWN,
  ACTION_UP,
  KEY_DOWN,
  SCRCPY_VERSION,
  keyMessage,
  scrollMessage,
  serverArgs,
  socketName,
  textMessage,
  touchMessage,
} from '../protocol.js';

describe('lệnh chạm', () => {
  const touch = touchMessage({
    action: ACTION_DOWN, x: 100, y: 200, width: 720, height: 1600,
  });

  it('dài đúng 32 byte', () => {
    assert.equal(touch.length, 32);
  });

  it('đặt từng trường đúng chỗ', () => {
    assert.equal(touch.readUInt8(0), 2, 'mã lệnh INJECT_TOUCH_EVENT');
    assert.equal(touch.readUInt8(1), ACTION_DOWN);
    assert.equal(touch.readBigUInt64BE(2), 0n, 'mã ngón tay');
    assert.equal(touch.readInt32BE(10), 100);
    assert.equal(touch.readInt32BE(14), 200);
    assert.equal(touch.readUInt16BE(18), 720, 'bề rộng mà toạ độ đo theo');
    assert.equal(touch.readUInt16BE(20), 1600);
    assert.equal(touch.readUInt16BE(22), 0xffff, 'nhấn hết cỡ');
  });

  it('nhấc tay ra thì lực nhấn bằng không', () => {
    // Một cú UP còn mang lực nhấn là thứ vài ứng dụng đọc ra thành "vẫn đang
    // chạm", và khi ấy nút bấm không bao giờ nhả.
    const up = touchMessage({ action: ACTION_UP, x: 1, y: 1, width: 720, height: 1600 });
    assert.equal(up.readUInt16BE(22), 0);
  });

  it('làm tròn toạ độ lẻ thay vì cắt cụt', () => {
    // Toạ độ tới từ một phép chia trên trình duyệt nên gần như luôn lẻ.
    const half = touchMessage({ action: ACTION_DOWN, x: 10.6, y: 20.4, width: 720, height: 1600 });
    assert.equal(half.readInt32BE(10), 11);
    assert.equal(half.readInt32BE(14), 20);
  });
});

describe('lệnh phím', () => {
  it('dài 14 byte và mang mã phím', () => {
    const key = keyMessage(KEY_DOWN, 4);
    assert.equal(key.length, 14);
    assert.equal(key.readUInt8(0), 0);
    assert.equal(key.readUInt8(1), KEY_DOWN);
    assert.equal(key.readInt32BE(2), 4);
  });
});

describe('lệnh gõ chữ', () => {
  it('độ dài tính bằng BYTE của UTF-8, không phải số ký tự', () => {
    // Với tiếng Việt hai con số này luôn khác nhau, nên nhầm là hỏng ngay ở
    // lần gõ đầu tiên chứ không phải một trường hợp biên hiếm gặp.
    const message = textMessage('Chào');
    assert.equal(message.readUInt32BE(1), 5, '"Chào" là 4 ký tự nhưng 5 byte');
    assert.equal(message.length, 5 + 5);
    assert.equal(message.subarray(5).toString('utf8'), 'Chào');
  });

  it('chuỗi rỗng vẫn là một lệnh hợp lệ', () => {
    assert.deepEqual([...textMessage('')], [1, 0, 0, 0, 0]);
  });
});

describe('lệnh cuộn', () => {
  it('quy đổi số nấc sang thang [-1, 1] mà server chờ', () => {
    // Server đọc số cố định trên [-1, 1] rồi NHÂN 16. Gửi thẳng số nấc vào đó
    // là cuộn nhanh gấp mười sáu lần.
    const down = scrollMessage({ x: 0, y: 0, width: 720, height: 1600, vScroll: -16 });
    assert.equal(down.length, 21);
    assert.equal(down.readInt16BE(15), -0x7fff);
  });

  it('số nấc vượt khoảng biểu diễn được thì kẹp lại, không tràn', () => {
    const huge = scrollMessage({ x: 0, y: 0, width: 720, height: 1600, vScroll: 999 });
    assert.equal(huge.readInt16BE(15), 0x7fff);
  });
});

describe('chào hỏi', () => {
  it('tham số đầu tiên là số hiệu phiên bản', () => {
    // Server so nó với số của chính nó và chết ngay nếu lệch — đó là thứ giữ
    // cho một file jar cũ nằm lại trên máy không âm thầm nói sai giao thức.
    assert.equal(serverArgs({ scid: 1, maxSize: 720, bitRate: 2e6, maxFps: 30 })[0], SCRCPY_VERSION);
  });

  it('xin luồng thô: không phần đầu, không nhãn thời gian', () => {
    // Đây là điều khiến việc này lắp vừa chỗ cũ: luồng ra giống hệt thứ
    // `screenrecord` vẫn gửi, nên bộ giải mã phía trình duyệt không phải đổi.
    const args = serverArgs({ scid: 1, maxSize: 720, bitRate: 2e6, maxFps: 30 });
    assert.ok(args.includes('raw_stream=true'));
    assert.ok(args.includes('audio=false'));
    assert.ok(args.includes('control=true'));
  });

  it('scid gửi ở hệ 16, và khớp tên socket', () => {
    // Server đọc `scid` bằng `Integer.parseInt(value, 0x10)`. Gửi hệ 10 thì nó
    // chết ngay từ khâu đọc tham số — đã xảy ra thật ở lần chạy đầu tiên, và
    // câu lỗi của Java không nhắc gì tới cơ số.
    const scid = 0x2a3b4c5d;
    const args = serverArgs({ scid, maxSize: 720, bitRate: 2e6, maxFps: 30 });
    assert.ok(args.includes('scid=2a3b4c5d'));
    assert.equal(socketName(scid), 'scrcpy_2a3b4c5d');
  });

  it('tên socket là tám chữ số hex viết thường', () => {
    assert.equal(socketName(0x2a), 'scrcpy_0000002a');
    assert.equal(socketName(0x7fffffff), 'scrcpy_7fffffff');
  });
});
