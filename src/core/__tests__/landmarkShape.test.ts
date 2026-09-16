/**
 * Locator nào được quyền trả lời câu "đang ở màn hình nào".
 *
 * Đo trên máy thật ngày 2026-09-16, màn Home của TCInvest: một hộp thoại thông
 * báo bất kỳ làm `transfer.thongBao` ("Thông báo", màn Chuyển tiền) khớp, vì cả
 * hai locator khoẻ nhất của nó đều không nhắc tới nội dung nào —
 * `.subtitle-dialog-common` và `role:dialog`. Runner in ra
 *
 *   [flow] tính năng "Chuyển tiền" đã mở sẵn — nhận diện bằng "Thông báo".
 *
 * rồi bỏ qua bước mở Search và thao tác trên màn hình sai.
 *
 * Luật chuỗi con (matchesByContainment) có sẵn từ sự cố "Bảng giá" hôm trước
 * KHÔNG bắt được hai locator này: chúng khớp chính xác, chỉ là khớp chính xác
 * một hình dạng mà mọi màn hình đều có.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchesByContainment, matchesByShape } from '../locatorQuality.js';
import type { LocatorCandidate } from '../types.js';

const c = (over: Partial<LocatorCandidate> & Pick<LocatorCandidate, 'strategy' | 'value'>):
  LocatorCandidate => ({ weight: 0.9, origin: 'crawler', ...over });

describe('landmark: locator chỉ mô tả hình dạng', () => {
  /** Đúng ba locator của transfer.thongBao, chép từ registry. */
  it('loại đúng hai locator đã gây ra sự cố', () => {
    const subtitle = c({ strategy: 'css', value: '.subtitle-dialog-common' });
    const dialog = c({ strategy: 'role', value: 'dialog' });
    // Luật cũ để lọt cả hai — đó là lý do luật mới phải tồn tại.
    assert.equal(matchesByContainment(subtitle), false);
    assert.equal(matchesByContainment(dialog), false);
    assert.equal(matchesByShape(subtitle), true);
    assert.equal(matchesByShape(dialog), true);
    // Locator thứ ba cũng chỉ là hai class dùng chung.
    assert.equal(matchesByShape(c({ strategy: 'css', value: '.msg-row-wraper .label-content' })), true);
  });

  /**
   * Năm element khoẻ nhất của chính màn Chuyển tiền. Nếu luật mới loại cả
   * chúng thì màn hình này không còn landmark nào, và luật đã đi quá tay.
   */
  it('giữ nguyên các landmark định danh bằng text', () => {
    const good: LocatorCandidate[] = [
      c({ strategy: 'label', value: 'Chọn TK nhận tiền' }),
      c({ strategy: 'label', value: 'Số tiền' }),
      c({ strategy: 'label', value: 'Được chuyển' }),
      c({ strategy: 'role', value: 'combobox', name: 'Chuyển từ' }),
      c({ strategy: 'role', value: 'button', name: 'CHUYỂN' }),
    ];
    for (const candidate of good) {
      assert.equal(matchesByShape(candidate), false, `${candidate.strategy}:${candidate.value}`);
    }
  });

  it('id, testid và thuộc tính định danh vẫn là bằng chứng', () => {
    const identifying: LocatorCandidate[] = [
      c({ strategy: 'testId', value: 'transfer-screen' }),
      c({ strategy: 'css', value: '#transfer-form' }),
      c({ strategy: 'css', value: '[data-testid="transfer-form"]' }),
      c({ strategy: 'css', value: '[aria-label="Chuyển tiền"]' }),
      c({ strategy: 'css', value: '.dialog:has-text("Chuyển tiền")' }),
      c({ strategy: 'xpath', value: "//*[@resource-id='com.fss:id/transfer_root']" }),
      c({ strategy: 'xpath', value: "//*[text()='Chuyển tiền']" }),
      c({ strategy: 'predicate', value: 'label == "Chuyển tiền"' }),
    ];
    for (const candidate of identifying) {
      assert.equal(matchesByShape(candidate), false, `${candidate.strategy}:${candidate.value}`);
    }
  });

  it('class, tag và chỉ số trần thì không', () => {
    const shapeOnly: LocatorCandidate[] = [
      c({ strategy: 'css', value: 'div.card > span' }),
      c({ strategy: 'css', value: '.modal-body .row:nth-child(2)' }),
      c({ strategy: 'xpath', value: '//android.widget.FrameLayout[2]/android.widget.TextView' }),
      c({ strategy: 'predicate', value: 'new UiSelector().className("android.widget.TextView").index(3)' }),
    ];
    for (const candidate of shapeOnly) {
      assert.equal(matchesByShape(candidate), true, `${candidate.strategy}:${candidate.value}`);
    }
  });
});
