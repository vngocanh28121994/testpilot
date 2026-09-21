/**
 * Nối lại một lượt đang chạy mà không nhận lại từ đầu.
 *
 * Trước P1.5, mỗi lần nối lại là trả về TRỌN đệm — tám nghìn dòng cho một lượt
 * Android dài. Một tab rớt mạng ba giây phải vẽ lại tất cả, và nếu nó rớt vài
 * lần thì phần lớn công việc của trang là vẽ lại thứ nó đang có.
 *
 * `seq` sửa chuyện đó, và nó không phải là một con số tiện tay: nó chính là
 * `JobEvent.seq` trong `src/protocol/messages.ts`, và ở P2 là khoá của bảng
 * `job_event`. Đánh số ở đây từ bây giờ nghĩa là đường nối lại không phải viết
 * lại khi log rời khỏi RAM.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { beginActiveRun, endActiveRun, activeRuns, findActiveRun } from '../activeRuns.js';

function freshRun(lines: number) {
  const run = beginActiveRun('web · @smoke', 'run');
  for (let i = 1; i <= lines; i++) run.push(`dòng ${i}`);
  return run;
}

beforeEach(() => {
  for (const view of activeRuns()) endActiveRun({ id: view.id });
});

describe('nối lại lượt chạy theo seq', () => {
  it('không nói mình ở đâu thì nhận trọn lịch sử', () => {
    const run = freshRun(3);
    const { history, lastSeq } = run.subscribe(() => {});
    assert.deepEqual(history, ['dòng 1', 'dòng 2', 'dòng 3']);
    assert.equal(lastSeq, 3);
  });

  it('nói mình có tới dòng 2 thì chỉ nhận dòng 3', () => {
    const run = freshRun(3);
    const { history, lastSeq } = run.subscribe(() => {}, 2);
    assert.deepEqual(history, ['dòng 3']);
    assert.equal(lastSeq, 3);
  });

  it('đã có đủ thì không nhận gì thêm, nhưng vẫn nghe tiếp', () => {
    const run = freshRun(3);
    const got: string[] = [];
    const { history } = run.subscribe((line) => got.push(line), 3);
    assert.deepEqual(history, []);
    run.push('dòng 4');
    assert.deepEqual(got, ['dòng 4']);
  });

  it('seq tiếp tục tăng qua nhiều lần nối lại', () => {
    const run = freshRun(2);
    const first = run.subscribe(() => {}, 0);
    first.off();
    run.push('dòng 3');
    const second = run.subscribe(() => {}, first.lastSeq);
    assert.deepEqual(second.history, ['dòng 3']);
    assert.equal(second.lastSeq, 3);
  });

  /**
   * Phần người gọi thiếu đã bị cắt khỏi đệm. Gửi tiếp từ chỗ còn sót sẽ để lại
   * một lỗ hổng giữa cái họ có và cái họ nhận — và không ai nhìn thấy lỗ hổng
   * ấy. Trả trọn phần còn lại kèm `dropped` là câu trả lời trung thực.
   */
  it('phần thiếu đã bị cắt thì trả trọn phần còn lại kèm dropped', () => {
    const run = beginActiveRun('android · dài', 'run');
    for (let i = 1; i <= 8_100; i++) run.push(`dòng ${i}`);

    const { history, dropped } = run.subscribe(() => {}, 5);
    assert.equal(dropped, 100, 'phải nói ra đã cắt bao nhiêu');
    assert.equal(history.length, 8_000);
    assert.equal(history[0], 'dòng 101', 'bắt đầu từ dòng cũ nhất còn giữ');
  });

  it('/api/run/active nói ra chỗ đang đứng', () => {
    freshRun(4);
    const view = activeRuns()[0]!;
    assert.equal(view.lastSeq, 4);
    assert.equal(view.lines, 4);
  });

  /** Lượt chạy kết thúc thì biến khỏi danh sách — nối lại phải nhận 404. */
  it('lượt chạy đã xong thì không còn tìm thấy', () => {
    const run = freshRun(1);
    endActiveRun(run);
    assert.equal(findActiveRun(run.id), undefined);
  });
});
