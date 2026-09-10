/**
 * Discovery không được đua với đồng hồ rồi vứt kết quả.
 *
 * Bản cũ: `Promise.race([tryDiscovery(...), sleep(2s)])`. Trên iOS, riêng một
 * lần lấy cây giao diện đã mất khoảng 900ms — đo trên máy thật ngày 2026-09-10,
 * có lần 11–12 giây — cộng parse, chấm điểm và có thể một lượt gọi model. Nên
 * discovery gần như luôn thua cuộc đua.
 *
 * Thua thì mất hai thứ, và thứ hai mới đắt: mất ứng viên vừa tìm được, và mất
 * luôn câu giải thích "vì sao không tìm được" — vì lời cảnh báo đó nằm bên
 * TRONG lời hứa vừa bị bỏ. Một discovery thất bại trông y hệt một discovery
 * chưa từng chạy, và đó đúng là thứ đã làm tôi truy nhầm hướng cả buổi.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const source = readFileSync('src/runtime/resolver.ts', 'utf8');

describe('discovery chạy nền', () => {
  it('không còn đặt discovery vào Promise.race với sleep', () => {
    assert.doesNotMatch(source, /Promise\.race\(\[\s*this\.tryDiscovery/);
  });

  it('kết quả về muộn vẫn được dùng ở tick sau', () => {
    assert.match(source, /\.then\(\(c\) => \{ discovered = c; \}\)/);
    assert.match(source, /if \(discovered && !excluded\.has\(candidateKey\(discovered\)\)\) \{/);
  });

  it('nói ra khi hết giờ mà discovery chưa xong', () => {
    assert.match(source, /discoveryAttempted && !discoverySettled/);
    assert.match(source, /chưa trả lời xong sau \$\{Date\.now\(\) - discoveryStartedAt\}ms/);
  });
});
