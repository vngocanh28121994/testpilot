/**
 * Gói tin từ app quay màn hình iPhone qua USB, và câu lỗi người dùng đọc.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PacketReader, explainScreenError } from '../iosScreen.js';

function packet(type: string, payload: Buffer | string): Buffer {
  const body = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
  const header = Buffer.alloc(5);
  header.write(type, 0, 'ascii');
  header.writeUInt32BE(body.length, 1);
  return Buffer.concat([header, body]);
}

const INFO = {
  device: 'iPhone của Anh',
  source: { width: 1284, height: 2778 },
  h264: { width: 720, height: 1560 },
  jpeg: { width: 540, height: 1170 },
};

describe('PacketReader', () => {
  it('đọc nhiều gói trong một lần nhận', () => {
    const reader = new PacketReader();
    const got = reader.push(Buffer.concat([
      packet('i', JSON.stringify(INFO)),
      packet('h', Buffer.from([0, 0, 0, 1, 0x67])),
      packet('j', Buffer.from([0xff, 0xd8, 0xff, 0xd9])),
    ]));
    assert.deepEqual(got.map((p) => p.kind), ['info', 'h264', 'jpeg']);
    assert.deepEqual((got[0] as { info: unknown }).info, INFO);
    assert.deepEqual([...(got[1] as { data: Buffer }).data], [0, 0, 0, 1, 0x67]);
  });

  it('một gói bị cắt ở giữa thì chờ phần còn lại — TCP không giữ biên gói', () => {
    const reader = new PacketReader();
    const whole = packet('h', Buffer.alloc(1000, 7));
    assert.deepEqual(reader.push(whole.subarray(0, 3)), []);
    assert.deepEqual(reader.push(whole.subarray(3, 600)), []);
    const got = reader.push(whole.subarray(600));
    assert.equal(got.length, 1);
    assert.equal((got[0] as { data: Buffer }).data.length, 1000);
  });

  it('dữ liệu gói không bị ghi đè bởi lần nhận sau', () => {
    const reader = new PacketReader();
    const first = reader.push(packet('h', Buffer.from([1, 2, 3])))[0] as { data: Buffer };
    reader.push(packet('h', Buffer.from([9, 9, 9])));
    assert.deepEqual([...first.data], [1, 2, 3]);
  });

  it('loại gói lạ và gói thông tin hỏng bị bỏ qua, không làm đứt luồng', () => {
    const reader = new PacketReader();
    const got = reader.push(Buffer.concat([
      packet('z', 'bản mới'),
      packet('i', '{hỏng'),
      packet('e', 'camera-denied'),
    ]));
    assert.deepEqual(got, [{ kind: 'error', message: 'camera-denied' }]);
  });
});

describe('explainScreenError', () => {
  it('chưa có quyền camera: nói chỗ bật, trên máy chủ', () => {
    const text = explainScreenError('camera-denied');
    assert.match(text, /Quyền riêng tư & Bảo mật › Camera/);
    assert.match(text, /TestPilot Screen Capture/);
  });

  it('không thấy máy: nêu những máy đang thấy, và việc cần kiểm', () => {
    const text = explainScreenError('device-not-found:iPhone của Bình, iPhone của Chi');
    assert.match(text, /iPhone của Bình, iPhone của Chi/);
    assert.match(text, /cáp/);
    assert.doesNotMatch(explainScreenError('device-not-found:'), /đang thấy/);
  });
});
