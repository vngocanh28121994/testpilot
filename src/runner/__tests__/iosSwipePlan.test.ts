/**
 * Cú vuốt trên web → cú vuốt iPhone diễn lại, sau khi người dùng nhả chuột.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FLICK_MS, swipePlan } from '../iosControl.js';

describe('swipePlan', () => {
  it('vuốt nhanh giữ nguyên thời lượng — đó là cú hất, đà là thứ người dùng muốn', () => {
    assert.deepEqual(swipePlan(80), { moveMs: 80, holdMs: 0 });
    assert.deepEqual(swipePlan(FLICK_MS), { moveMs: FLICK_MS, holdMs: 0 });
  });

  it('kéo chậm không bắt người dùng chờ lại đúng thời gian kéo, và dừng trước khi nhả', () => {
    // Log thật: kéo 1000 ms → Appium trả sau 1741 ms, tất cả SAU lúc nhả chuột.
    const plan = swipePlan(1_000);
    assert.equal(plan.moveMs, FLICK_MS);
    assert.ok(plan.holdMs > 0, 'giữ một chút để tốc độ lúc nhả bằng 0 — nội dung không trôi tiếp');
    assert.ok(plan.moveMs + plan.holdMs < 400);
  });

  it('thời lượng hỏng vẫn ra một cú vuốt hợp lệ', () => {
    assert.deepEqual(swipePlan(0), { moveMs: 1, holdMs: 0 });
  });
});
