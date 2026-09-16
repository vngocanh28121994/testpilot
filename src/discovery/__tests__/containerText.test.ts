/**
 * Một node bọc node khác thì chữ của nó là chữ của cả cây con.
 *
 * Hai lớp bảo vệ dựa vào điều đó — ConfidenceScorer trừ điểm container,
 * ElementMatcher chỉ dựng locator theo chữ cho một lá — và cả hai cùng hỏi qua
 * `childIds`. Bản quét DOM không phát id cho con, nên nó không có cách nào trả
 * lời: mọi phần tử nó đưa ra đều trông như lá, kể cả một div bọc cả màn hình.
 *
 * Trước đây điều đó vô hại vì bản quét chỉ thu input/button/span/label. Từ khi
 * nó thu thêm div có `cursor: pointer` — đúng, đó là nút thật trong Angular —
 * thì container vào thẳng tầng chấm điểm. Đo ngày 2026-09-15: tầng AI nhận về
 * ứng viên có chữ "closeĐầu tư nối tiếpĐặc quyền ưu đãiĐược…" và phải tự từ
 * chối, còn ElementMatcher thì dựng locator theo chữ cho những node như thế.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isContainerElement } from '../UiObservation.js';
import { observedToUiObservation } from '../DriverObservationAdapter.js';
import { rawDomElementToObservedElement } from '../../drivers/WebViewCdpDriver.js';
import type { RawEl } from '../../drivers/domObserve.js';
import type { Observed } from '../../crawl/observe.js';

const rawEl = (over: Partial<RawEl> = {}): RawEl => ({
  tag: 'div',
  interactive: false,
  container: false,
  disabled: false,
  visible: true,
  rect: { x: 0, y: 0, width: 100, height: 20 },
  ...over,
});

describe('container đi được qua mọi đường quan sát', () => {
  it('bản quét DOM nói ra được, và CDP mang đi tiếp', () => {
    const wrapper = rawDomElementToObservedElement(
      rawEl({ domText: 'closeĐầu tư nối tiếpĐặc quyền ưu đãi', container: true }),
      1,
    );
    assert.equal(isContainerElement(wrapper), true);

    const leaf = rawDomElementToObservedElement(rawEl({ domText: 'close' }), 2);
    assert.equal(isContainerElement(leaf), false);
  });

  /**
   * `observedToUiObservation` từng nói "đây là container" bằng `childIds: []`.
   * Mảng rỗng có độ dài 0, nên chính lớp bảo vệ nó định bật lại đọc ra "không
   * phải container" — cách diễn đạt tự vô hiệu hoá mình.
   */
  it('cây quan sát phẳng không nói container bằng mảng rỗng', () => {
    const observed: Observed[] = [
      { role: 'div', text: 'A B C', interactive: false, index: 0, container: true },
      { role: 'span', text: 'A', interactive: false, index: 1, container: false },
    ];
    const [wrapper, leaf] = observedToUiObservation(observed, 'android').elements;
    assert.equal(isContainerElement(wrapper!), true);
    assert.equal(isContainerElement(leaf!), false);
  });

  it('hỏi được cả hai cách diễn đạt', () => {
    assert.equal(isContainerElement({ childIds: ['a'] }), true);
    assert.equal(isContainerElement({ childIds: [] }), false);
    assert.equal(isContainerElement({}), false);
  });
});
