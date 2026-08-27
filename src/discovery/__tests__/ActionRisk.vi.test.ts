/**
 * Risk classification on a Vietnamese app.
 *
 * The generic keyword list is English, so on TCInvest it matched nothing: the
 * gate meant to stop discovery from clicking a destructive control was open on
 * "Đặt lệnh" and "Chuyển tiền" — the only controls on the screen that move real
 * money. Running the suite against production makes that the difference between
 * a test and an order.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyActionRisk } from '../ActionRisk.js';

describe('ActionRisk — tiếng Việt', () => {
  it('treats money-moving controls as HIGH', () => {
    for (const text of ['ĐẶT LỆNH', 'Chuyển tiền', 'Nộp tiền', 'Rút tiền', 'Xác nhận', 'LƯU MUA', 'LƯU BÁN']) {
      assert.equal(classifyActionRisk('tap', text), 'HIGH', text);
    }
  });

  it('matches with and without diacritics', () => {
    assert.equal(classifyActionRisk('tap', 'dat lenh'), 'HIGH');
    assert.equal(classifyActionRisk('tap', 'chuyen tien'), 'HIGH');
  });

  it('does not fire on letters that merely contain a keyword', () => {
    // "ban" lives inside "banner"; a promo banner is not a sell button.
    assert.equal(classifyActionRisk('tap', 'banner khuyến mãi'), 'MEDIUM');
    assert.equal(classifyActionRisk('tap', 'Lệnh thường'), 'MEDIUM');
    assert.equal(classifyActionRisk('assert-visible', 'Bảng giá'), 'LOW');
  });

  it('still classifies a multi-word keyword as a phrase', () => {
    // "chuyển" alone is harmless — "Chuyển sang tab" is navigation.
    assert.equal(classifyActionRisk('tap', 'Chuyển sang tab Cổ phiếu'), 'MEDIUM');
  });
});
