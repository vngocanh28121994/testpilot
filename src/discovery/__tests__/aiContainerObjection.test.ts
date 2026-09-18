/**
 * Luật "chia sẻ chữ nhưng trật ý" chỉ có nghĩa với phần tử LÁ.
 *
 * Nó sinh ra từ một ca thật: hỏi "Lệnh thường", model trả về control đọc là
 * "Thường" — giá trị của một field khác — và một chữ chung làm nó trông hợp lý.
 * Đúng với lá, nơi chữ trên phần tử chính là danh tính của nó.
 *
 * Container thì khác: chữ của nó là chữ của cả cây con nối lại, nên nó chia sẻ
 * chữ với gần như mọi nhãn nói về thứ nằm bên trong. Đo trên máy thật
 * 2026-09-16, android, popup "Thêm thẻ":
 *
 *     [discovery:ai] "addCardSheet.closeButton" chưa có ứng viên dùng được:
 *       reasoning: mat-dialog-container của popup Thêm thẻ, chứa nút đóng close
 *       candidate #1 từ chối: chữ trên phần tử ("Báo cáo mẫu chưa có tên Lưu
 *       Tạo mẫu báo …") trùng một phần nhưng trật ý của "Nút đóng popup Thêm thẻ"
 *
 * Model tìm trúng vùng và nói rõ trong reasoning. Chữ container gồm cả "Thêm
 * thẻ" lẫn "Đóng" → chung ba chữ dong/them/the → luật kết luận "nhầm lẫn" và
 * vứt đi ứng viên duy nhất có được. Sau đó tầng vision hết giờ, bước hỏng.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { aiAnswerObjection } from '../ai/SemanticElementDiscovery.js';
import type { ObservedElement } from '../UiObservation.js';
import type { ElementIntent } from '../ElementIntent.js';

const intent = (over: Partial<ElementIntent> = {}): ElementIntent => ({
  elementId: 'addCardSheet.closeButton',
  label: 'Nút đóng popup Thêm thẻ',
  action: 'tap',
  ...over,
}) as ElementIntent;

const el = (over: Partial<ObservedElement>): ObservedElement => ({
  id: 'mcp-el-18',
  visible: true,
  ...over,
}) as ObservedElement;

/** Chữ thật của mat-dialog-container trong ca đã đo, rút gọn. */
const CONTAINER_TEXT = 'Báo cáo mẫu chưa có tên Lưu Tạo mẫu báo cáo Thêm thẻ Đóng';

describe('AI trả lời bằng container', () => {
  it('không từ chối container chỉ vì nó chia sẻ chữ', () => {
    const objection = aiAnswerObjection(intent(), el({ text: CONTAINER_TEXT, container: true }));
    assert.equal(objection, undefined);
  });

  /** Cùng chữ ấy trên một LÁ thì vẫn là nhầm lẫn, và vẫn phải bị từ chối. */
  it('vẫn từ chối khi đó là phần tử lá', () => {
    const objection = aiAnswerObjection(intent(), el({ text: CONTAINER_TEXT, container: false }));
    assert.match(objection ?? '', /trùng một phần nhưng trật ý/);
  });

  /**
   * Thiếu thông tin thì im lặng, giữ nguyên hành vi cũ — đúng quy ước mà
   * ConfidenceScorer và ElementMatcher đang theo cho cùng thuộc tính này.
   */
  it('không biết có phải container hay không thì giữ luật như cũ', () => {
    const objection = aiAnswerObjection(intent(), el({ text: CONTAINER_TEXT }));
    assert.match(objection ?? '', /trùng một phần nhưng trật ý/);
  });

  /** Luật 1 không bị nới: bước gõ vẫn phải trúng thứ nhận được dữ liệu. */
  it('container vẫn không được nhận cho bước gõ nếu không giữ được giá trị', () => {
    const objection = aiAnswerObjection(
      intent({ action: 'input', label: 'Ô số tiền', text: '1000' }),
      el({ role: 'group', container: true, interactive: false }),
    );
    assert.match(objection ?? '', /không nhận được dữ liệu/);
  });

  /** Không chung chữ nào thì vốn đã được tha — model đã suy luận theo cấu trúc. */
  it('lá không chung chữ nào vẫn được đi tiếp', () => {
    const objection = aiAnswerObjection(intent(), el({ text: 'xyz', container: false }));
    assert.equal(objection, undefined);
  });
});

/**
 * Và thuộc tính ấy phải THỰC SỰ tới nơi.
 *
 * Luật trên chỉ bỏ qua khi `container === true`, còn thiếu thì im lặng — nên
 * một nguồn quan sát quên gán nó không gây lỗi nào, nó chỉ lặng lẽ vô hiệu hoá
 * cả ba lớp đang đọc thuộc tính này. Đúng chuyện đã xảy ra: sửa luật xong chạy
 * lại trên máy thật, nút đóng popup VẪN bị từ chối y hệt, vì đường appium-mcp
 * dựng `childIds` đầy đủ mà bỏ trống `container`.
 */
describe('quan sát qua appium-mcp', () => {
  const source = readFileSync('src/discovery/mcp/AppiumMcpElementDiscovery.ts', 'utf8');

  it('gán container từ chính cây vừa duyệt', () => {
    assert.match(source, /container: childIds\.length > 0,/);
  });

  /** Cùng một suy luận với hai nguồn web đã làm từ trước. */
  it('cùng quy ước với các nguồn quan sát khác', () => {
    for (const file of ['src/discovery/WebObservationAdapter.ts', 'src/drivers/domObserve.ts']) {
      assert.match(readFileSync(file, 'utf8'), /container: el\.children\.length > 0,/, file);
    }
  });
});
