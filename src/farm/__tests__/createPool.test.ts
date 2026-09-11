/**
 * AWS từ chối tạo pool: "A static device pool can not have max devices
 * parameter".
 *
 * Pool liệt kê ARN là pool TĨNH. Số máy đã nằm sẵn trong danh sách ARN, nên
 * `maxDevices` vừa thừa vừa làm hỏng — nó chỉ dành cho pool ĐỘNG, loại mô tả
 * bằng luật (hãng, OS…) và để AWS tự chọn máy.
 *
 * Test đọc mã nguồn: gọi thật thì phải có credential AWS và sẽ tạo tài nguyên
 * tính tiền, còn thứ đáng canh ở đây là hình dạng của tham số gửi đi.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const source = readFileSync('src/farm/devicefarm.ts', 'utf8');
const block = source.slice(
  source.indexOf('new CreateDevicePoolCommand'),
  source.indexOf('const arn = created.devicePool?.arn'),
);

describe('tạo device pool từ danh sách thiết bị', () => {
  it('không gửi maxDevices cho pool tĩnh', () => {
    // Hỏi tham số, không hỏi chữ: chính đoạn chú thích giải thích vì sao bỏ nó
    // cũng chứa từ "maxDevices", và một phép kiểm bắt cả chú thích thì hoặc là
    // đỏ oan, hoặc buộc người sau phải xoá lời giải thích để test xanh.
    assert.doesNotMatch(block.replace(/\/\/[^\n]*/g, ''), /maxDevices\s*:/);
  });

  it('vẫn liệt kê ARN của đúng những máy đã chọn', () => {
    assert.match(block, /attribute: 'ARN', operator: 'IN', value: JSON\.stringify\(deviceArns\)/);
  });
});
