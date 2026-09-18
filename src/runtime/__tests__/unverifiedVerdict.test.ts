/**
 * "Chưa chứng minh được" không phải một khái niệm, mà là ba.
 *
 * Gộp cả ba vào một cờ rồi cho cả ba cùng rơi vào `passed` là cách suite Chuyển
 * tiền báo xanh trong khi không chuyển đồng nào (đo trên prod, 2026-09-16): cả
 * cú bấm CHUYỂN lẫn XÁC NHẬN đều `unverified`, ảnh chụp lúc "pass" cho thấy ô
 * nhận tiền còn trống và viền đỏ validation.
 *
 * Nhưng bắt cả ba cùng đỏ thì sai theo chiều kia, và sai thường xuyên hơn: một
 * bước hoãn để bước sau đo, hay một kịch bản không viết hậu điều kiện quan sát
 * được, đều không phải bằng chứng thao tác đã hỏng.
 *
 * Ranh giới nằm ở `unchanged`: điều kiện đã đúng TỪ TRƯỚC thao tác. Đúng lúc ấy
 * và chỉ lúc ấy, không gì phân biệt được "đã chạy đúng" với "không làm gì cả".
 * Nếu kết quả thật sự xuất hiện DO cú bấm thì `transitionCanBeProven` đúng và
 * bước đó không mang cờ này ngay từ đầu.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const executor = readFileSync('src/runtime/executor.ts', 'utf8');
const types = readFileSync('src/core/types.ts', 'utf8');

const verdict = (() => {
  const at = executor.indexOf('const unproven = stepResults.filter');
  assert.ok(at > 0, 'không thấy chỗ tính phán quyết kịch bản');
  return executor.slice(at, at + 700);
})();

describe('phán quyết kịch bản với bước chưa chứng minh được', () => {
  it('bốn loại khoảng trống được phân biệt trong kiểu dữ liệu', () => {
    assert.match(
      types,
      /unverifiedKind\?: 'deferred' \| 'no-postcondition' \| 'unchanged' \| 'covered'/,
    );
  });

  /** Cả ba loại đều phải được gán, nếu không thì loại thiếu thành "không rõ". */
  it('mỗi loại được gán đúng một chỗ', () => {
    for (const kind of ['deferred', 'no-postcondition', 'unchanged', 'covered']) {
      assert.ok(
        executor.includes(`'${kind}'`),
        `không thấy chỗ gán ${kind}`,
      );
    }
    assert.match(executor, /this\.lastUnverifiedKind = 'deferred';/);
    // `covered` đứng trước hai loại kia: một cú bấm bị lớp phủ chắn mà driver
    // không hit-test được thì chưa kết luận được, và xếp nó vào `unchanged` là
    // bắt đỏ một ca không có bằng chứng nào nói nó hỏng.
    assert.match(
      executor,
      /this\.lastUnverifiedKind = coveredUnmeasured\s*\?\s*'covered'\s*:\s*expectation \? 'unchanged' : 'no-postcondition';/,
    );
  });

  it('chỉ "unchanged" làm kịch bản đỏ', () => {
    // Hai vế, và cần cả hai. Thiếu `unverifiedKind` là gom cả ba loại vào đỏ —
    // đúng cái bẫy cũ. Thiếu `status` là đếm cả bước ĐÃ được bước sau chứng
    // minh: `confirmTapProvenBy*` nâng nó lên `passed`, và nếu phán quyết chỉ
    // nhìn `unverifiedKind` thì cờ cũ còn sót vẫn kéo kịch bản đỏ.
    assert.match(
      verdict,
      /s\.status === 'unverified' && s\.unverifiedKind === 'unchanged'/,
    );
  });

  /** Và hai hàm gỡ cờ phải xoá CẢ loại, không chỉ lý do. */
  it('bước được chứng minh sau đó thì cờ bị xoá hẳn', () => {
    const cleared = executor.match(/delete candidate\.unverifiedKind;/g) ?? [];
    assert.equal(cleared.length, 2, 'cả hai đường gỡ cờ đều phải xoá loại');
  });

  /**
   * Bước hỏng hẳn đã tự chụp ảnh ở handler của nó; kịch bản chỉ đỏ vì
   * `unchanged` thì không đi qua handler ấy. Ảnh cuối chính là thứ đã vạch ra
   * lỗi này — bỏ nó đi là bỏ mất bằng chứng đắt nhất.
   */
  it('kịch bản đỏ vì chưa chứng minh được vẫn giữ ảnh chụp', () => {
    assert.match(executor, /const proof = hardFailed\s*\n?\s*\? undefined/);
  });

  /** Và phải nói ra, kèm lý do, chứ không âm thầm đổi màu. */
  it('nói ra từng bước không chứng minh được', () => {
    assert.match(verdict, /\[verdict\][\s\S]{0,140}không chứng minh được/);
    assert.match(verdict, /step\.unverifiedReason/);
  });
});
