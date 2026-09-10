/**
 * Mở rộng tầng AI, sau khi đo thấy nó là tầng đáng tin nhất trên iOS.
 *
 * Ngày 2026-09-10, mọi lần được gọi nó đều trả về đúng locator với tin cậy 95 —
 * kể cả khi tầng tất định chấm 0 ứng viên vì nhãn tiếng Việt không khớp chuỗi
 * nào trong DOM tiếng Anh. Ba giới hạn cũ khiến nó ít khi kịp giúp:
 *
 *   1. ngưỡng 60 — quá cao khi ba cổng an toàn phía sau vẫn nguyên
 *   2. chỉ chạy SAU khi tầng tất định thất bại, mà phần sau ảnh chụp còn hỏi
 *      lại thiết bị nên mất thêm hàng giây
 *   3. mỗi element chỉ được hỏi một lần cho cả lượt chạy
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const resolver = readFileSync('src/runtime/resolver.ts', 'utf8');
const discovery = readFileSync('src/discovery/ElementDiscovery.ts', 'utf8');
const config = readFileSync('src/config.ts', 'utf8');

describe('tầng AI được mở rộng', () => {
  it('ngưỡng tin cậy hạ xuống 45', () => {
    assert.match(config, /minConfidence: z\.number\(\)\.min\(0\)\.max\(100\)\.default\(45\)/);
  });

  it('khởi động ngay khi có ảnh chụp, không chờ tầng tất định thất bại', () => {
    assert.match(discovery, /onObservation\?: \(observation: UiObservation\) => void;/);
    assert.match(discovery, /opts\.onObservation\?\.\(observation\)/);
    assert.match(resolver, /onObservation: \(obs\) => \{[\s\S]{0,120}proposeViaAi\(intent, obs, elementId\)/);
  });

  /**
   * Vẫn phải chặn hỏi lặp trên CÙNG màn hình: hỏi lại khi không có gì đổi chỉ
   * tốn tiền cho đúng câu trả lời cũ.
   */
  it('hỏi lại được khi màn hình đã đổi, nhưng không hỏi lặp trên cùng màn hình', () => {
    assert.match(resolver, /const key = `\$\{elementId\}::\$\{observation\.elements\.length\}::\$\{shape\}`/);
    assert.match(resolver, /if \(this\.aiProposed\.has\(key\)\) return null;/);
  });

  /**
   * Ba cổng an toàn phải còn nguyên: hạ ngưỡng mà bỏ cổng thì thành đoán bừa.
   */
  it('vẫn giữ xác minh trước khi dùng ứng viên do AI đề xuất', () => {
    assert.match(resolver, /verifySemantically/);
    assert.match(resolver, /persistVerifiedLocator: false/);
  });
});
