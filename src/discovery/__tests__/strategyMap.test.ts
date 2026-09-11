/**
 * AI tìm đúng ô nhập rồi đề xuất bị hỏng ngay ở bước dán nhãn.
 *
 * Đo trên máy thật, lượt chạy local sau khi discovery đã được cấp đủ thời gian:
 *
 *   [discovery:ai] "priceBoard.oMaCoPhieu"     → xpath="TCB,VNM,FPT..." (tin cậy 90)
 *   [discovery:ai] "priceBoard.addStockButton" → xpath="TCB,VNM,FPT..." (tin cậy 85)
 *
 * `TCB,VNM,FPT...` là placeholder của ô, không phải XPath. SemanticElementDiscovery
 * trả `{strategy:'text'}` cho phần tử chỉ có chữ, nhưng bảng ánh xạ không có
 * khoá `text` — nhánh mặc định dán cho nó nhãn `xpath` và giữ nguyên giá trị.
 * Kết quả là một locator không bao giờ khớp, mang vẻ ngoài của một locator hợp
 * lệ, và cả kịch bản đỏ dù AI đã làm đúng việc của nó.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapDiscoveryStrategy } from '../DriverObservationAdapter.js';

describe('ánh xạ chiến lược từ discovery sang locator', () => {
  it('text và label đều là khớp theo chữ', () => {
    assert.equal(mapDiscoveryStrategy('text'), 'label');
    assert.equal(mapDiscoveryStrategy('label'), 'label');
    assert.equal(mapDiscoveryStrategy('accessibility'), 'label');
  });

  it('giữ nguyên những chiến lược vốn đã đúng tên', () => {
    for (const name of ['testId', 'placeholder', 'css', 'xpath', 'role', 'relative', 'predicate']) {
      assert.equal(mapDiscoveryStrategy(name), name === 'testId' ? 'testId' : name);
    }
    assert.equal(mapDiscoveryStrategy('resourceId'), 'testId');
  });

  /**
   * Chiến lược lạ KHÔNG được biến thành xpath: giá trị vẫn là chữ, nên nó tạo
   * ra một locator chắc chắn hụt mà nhìn vào tưởng hợp lệ.
   */
  it('chiến lược lạ không bị bịa thành xpath', () => {
    assert.notEqual(mapDiscoveryStrategy('khong-biet-la-gi'), 'xpath');
  });
});
