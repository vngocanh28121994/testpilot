/**
 * Nút chỉ có icon ghi điểm được nhờ TỔ TIÊN của nó.
 *
 * `mat-icon` cố ý mang `interactive: undefined` — DOM không trả lời được là nó
 * có bắt sự kiện hay không. Nên nhánh chấm điểm icon chỉ chạy khi tìm được một
 * tổ tiên tương tác được, và `hasInteractiveAncestor` thoát ngay ở dòng đầu nếu
 * thiếu `parentId`.
 *
 * Nguồn quan sát DOM không hề mang quan hệ cha con, nên cả nhánh ấy chết âm
 * thầm — không lỗi, không cảnh báo. Đo trên máy thật 2026-09-16: quét 152 bản
 * DOM dump của app này thấy 1092/2150 nút (50%) là nút chỉ có icon KHÔNG có
 * aria-label, dồn vào 5 cái tên: close 671, filter_list 133, arrow_back 132,
 * more_vert 110, visibility 46. Toàn bộ số đó không ghi nổi điểm nào theo tên.
 *
 * `iconMeaningMatches` đã ánh xạ đúng close→"đóng" từ trước; thứ thiếu chưa bao
 * giờ là từ vựng, mà là sợi dây nối icon lên cái nút bọc nó.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { observedToUiObservation } from '../DriverObservationAdapter.js';
import { ConfidenceScorer, iconMeaningMatches } from '../ConfidenceScorer.js';
import { DeterministicMatcher } from '../ElementMatcher.js';
import type { Observed } from '../../crawl/observe.js';
import type { ElementIntent } from '../ElementIntent.js';

const rect = { x: 0, y: 0, width: 24, height: 24 };

/** Nút đóng của popup Thêm thẻ, dựng đúng như DOM dump đã đo. */
function popupWithCloseIcon(parentIndex: number | undefined): Observed[] {
  return [
    // 0: <button mat-icon-button> — tương tác được, nhưng chữ là của cả cây con
    {
      role: 'button', text: 'close', interactive: true, index: 0,
      container: true, bounds: rect,
    },
    // 1: <mat-icon aria-hidden="true">close</mat-icon> — chữ đúng, nhưng
    //    interactive không xác định được
    {
      role: 'mat-icon', text: 'close', interactive: undefined, index: 1,
      container: false, bounds: rect,
      ...(parentIndex !== undefined ? { parentIndex } : {}),
    },
  ] as Observed[];
}

const intent: ElementIntent = {
  id: 'addCardSheet.closeButton',
  label: 'Nút đóng popup Thêm thẻ',
  action: 'tap',
};

function scoreIcon(parentIndex: number | undefined) {
  const observation = observedToUiObservation(popupWithCloseIcon(parentIndex), 'android');
  const icon = observation.elements[1]!;
  return new ConfidenceScorer().score(intent, icon, {
    allCandidates: observation.elements,
  });
}

/** Lý do là thứ đáng chốt, không phải con số: điểm còn phụ thuộc nhiều tín hiệu khác. */
const ICON_SIGNAL = /icon "close" matches business action/;

describe('nút chỉ có icon', () => {
  /** Từ vựng vốn đã đúng — chốt lại để nếu nó hỏng thì biết ngay là hỏng ở đâu. */
  it('từ vựng icon đã ánh xạ close → "đóng"', () => {
    assert.equal(iconMeaningMatches('close', 'Nút đóng popup Thêm thẻ'), true);
  });

  it('quan sát DOM mang được quan hệ cha con qua tới ObservedElement', () => {
    const observation = observedToUiObservation(popupWithCloseIcon(0), 'android');
    assert.equal(observation.elements[1]?.parentId, 'obs-0');
  });

  it('không có tổ tiên thì tín hiệu icon không tồn tại', () => {
    const scored = scoreIcon(undefined);
    assert.equal(scored.reasons.filter((r) => ICON_SIGNAL.test(r)).length, 0);
  });

  it('có tổ tiên tương tác được thì tín hiệu icon xuất hiện', () => {
    const scored = scoreIcon(0);
    assert.ok(scored.reasons.some((r) => ICON_SIGNAL.test(r)), JSON.stringify(scored.reasons));
  });

  /**
   * Chính là chênh lệch đã làm 1092 nút vô hình: từ một khoản TRỪ điểm (không
   * tín hiệu nào, và bị phạt vì không khớp gì) thành một khoản cộng.
   */
  it('sợi dây cha con là thứ tạo ra chênh lệch', () => {
    assert.ok(scoreIcon(0).score > scoreIcon(undefined).score);
  });
});
