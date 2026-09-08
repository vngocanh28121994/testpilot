/**
 * Một candidate đã resolve nhưng giờ khớp không phần tử nào.
 *
 * `transfer.thongBao` có ba candidate. Nặng ký nhất, `.subtitle-dialog-common`,
 * trỏ vào dialog xác nhận — dialog đóng ngay sau khi bấm XÁC NHẬN. Resolver
 * dừng ở candidate đầu tiên nó tìm thấy, rồi lúc đọc thì candidate ấy khớp 0
 * phần tử. Probe trên lượt chạy thật:
 *
 *   [probe:assert] element=transfer.thongBao
 *     candidate=css:".subtitle-dialog-common" count=0 texts=[]
 *     expected="Chuyển tiền thành công"
 *
 * Snapshot rỗng đi thẳng xuống phần so sánh và thành `got ""`, tức là báo sai
 * hẳn loại lỗi: người đọc đi tìm một lỗi nội dung, trong khi câu thành công vẫn
 * nằm trên màn hình ở candidate xếp sau. Hai kịch bản P0 smoke đỏ vì chuyện đó,
 * dù hai giao dịch đều thành công thật.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const source = readFileSync('src/runtime/executor.ts', 'utf8');

/**
 * Nhánh assert dương: từ chỗ resolve tới phép so sánh đầu tiên.
 *
 * Neo theo `let { r, heal, confirm }` chứ không theo `const seen` — khuôn
 * `snapshot.texts.map` còn xuất hiện ở readTexts(), và neo nhầm vào đó thì test
 * xanh trong khi chỗ cần soi không hề được đọc.
 */
function positiveAssertBlock(): string {
  const from = source.indexOf('let { r, heal, confirm } = await withElement');
  assert.ok(from > 0, 'nhánh assertText dương đã đổi hình dạng');
  const at = source.indexOf('const seen = snapshot.texts.map', from);
  assert.ok(at > from, 'không tìm thấy phép so sánh sau chỗ resolve');
  return source.slice(from, at);
}

describe('assertText khi phần tử đã rời màn hình', () => {
  it('không coi snapshot rỗng là nội dung sai', () => {
    const block = positiveAssertBlock();
    assert.match(block, /snapshot\.count === 0/, 'không còn phân biệt "rỗng" với "sai nội dung"');
  });

  /**
   * Điểm chính: candidate chết phải bị loại rồi thử candidate tiếp theo. Không
   * có bước này thì `.msg-row-wraper .label-content` — thứ đang giữ đúng câu
   * cần tìm — vĩnh viễn không được hỏi tới.
   */
  it('loại candidate đã chết rồi thử candidate còn lại', () => {
    const block = positiveAssertBlock();
    assert.match(block, /rejectResolution\(intent\.element/, 'không loại candidate đã chết');
    assert.match(block, /excludeCandidateKeys: rejected/, 'thử lại mà không loại trừ gì thì lặp vô hạn');
  });

  it('có trần số lần thử, không lặp vô hạn', () => {
    assert.match(positiveAssertBlock(), /rejected\.length < \d+/);
  });

  /**
   * Hết candidate thì phải nói đúng chuyện đã xảy ra. Câu cũ (`got ""`) là thứ
   * đã dẫn cả người lẫn máy đi sai hướng ngay từ đầu.
   */
  it('hết candidate thì báo đúng loại lỗi, không báo lệch nội dung', () => {
    const block = positiveAssertBlock();
    assert.match(block, /không còn trên màn hình lúc kiểm tra/);
    assert.doesNotMatch(
      block.slice(block.indexOf('snapshot.count === 0')),
      /got \$\{shown\}/,
      'vẫn rơi xuống câu lỗi nội dung',
    );
  });
});
