/**
 * Hai máy con cùng xem một iPhone: một máy xem bình thường, máy kia "màn hình
 * không phản hồi gì" — kết nối của nó có hàng chờ gửi đầy, và máy chủ cứ đẩy
 * thêm. Nhịp gửi phải là của RIÊNG từng người xem.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { streamPacer } from '../streamPacer.js';

function fakeConn(limit = 100) {
  const sent: string[] = [];
  let backlog = 0;
  let drain: (() => void) | undefined;
  return {
    sent,
    setBacklog: (n: number) => { backlog = n; },
    drain: () => { backlog = 0; const fn = drain; drain = undefined; fn?.(); },
    deps: {
      write: (chunk: Buffer) => { sent.push(chunk.toString()); },
      restart: () => { sent.push('<restart>'); },
      backlog: () => backlog,
      onDrain: (fn: () => void) => { drain = fn; },
      limitBytes: limit,
    },
  };
}

describe('streamPacer', () => {
  it('kết nối nhanh: gửi mọi khung, không bỏ gì', () => {
    const c = fakeConn();
    const pacer = streamPacer({ mode: 'mjpeg', ...c.deps });
    for (const f of ['a', 'b', 'c']) pacer.push(Buffer.from(f));
    assert.deepEqual(c.sent, ['a', 'b', 'c']);
    assert.equal(pacer.dropped(), 0);
  });

  it('MJPEG, nhận không kịp: bỏ khung cũ, bắt kịp thì gửi ảnh MỚI NHẤT', () => {
    const c = fakeConn();
    const pacer = streamPacer({ mode: 'mjpeg', ...c.deps });
    pacer.push(Buffer.from('1'));
    c.setBacklog(1_000); // kết nối bắt đầu nghẽn
    for (const f of ['2', '3', '4']) pacer.push(Buffer.from(f));
    assert.deepEqual(c.sent, ['1'], 'không dồn thêm vào kết nối đang nghẽn');
    c.drain();
    assert.deepEqual(c.sent, ['1', '4'], 'gửi ảnh mới nhất, không phải ảnh cũ');
    pacer.push(Buffer.from('5'));
    assert.deepEqual(c.sent, ['1', '4', '5']);
    assert.equal(pacer.dropped(), 3);
  });

  it('H.264, nhận không kịp: bắt kịp thì báo restart rồi gửi phần đầu luồng hiện tại', () => {
    const c = fakeConn();
    const pacer = streamPacer({ mode: 'h264', ...c.deps, resync: () => Buffer.from('<SPS+IDR>') });
    pacer.push(Buffer.from('p1'));
    c.setBacklog(1_000);
    pacer.push(Buffer.from('p2'));
    pacer.push(Buffer.from('p3'));
    c.drain();
    assert.deepEqual(c.sent, ['p1', '<restart>', '<SPS+IDR>'],
      'không gửi mảnh lẻ sau khi đã bỏ — bộ giải mã sẽ hỏng hình');
    pacer.push(Buffer.from('p4'));
    assert.deepEqual(c.sent.at(-1), 'p4');
  });
});
