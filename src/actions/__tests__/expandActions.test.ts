/**
 * Một action đã duyệt phải nở ra như nhau, bấm nút nào cũng vậy.
 *
 * Trước đây việc nở chỉ nằm trong đường "Chuẩn hoá". Gõ đúng câu macro rồi bấm
 * thẳng "Lưu" thì câu đó không nở, bản nháp biên dịch hỏng, và vòng tự sửa của
 * AI viết lại nó thành một câu khác — action đã duyệt coi như không tồn tại,
 * tuỳ theo người dùng bấm nút nào trước. Cùng một bản nháp, hai kết quả.
 */
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { ActionRegistry } from '../ActionRegistry.js';
import { expandApprovedActions } from '../expandActions.js';

async function registryWith(actions: unknown[]): Promise<ActionRegistry> {
  const dir = await mkdtemp(path.join(tmpdir(), 'tp-actions-'));
  const file = path.join(dir, 'actions.json');
  await writeFile(file, JSON.stringify({ version: 1, actions }), 'utf8');
  return ActionRegistry.load(file);
}

const transfer = {
  id: 'a1',
  label: 'Chuyển tiền nội bộ',
  kind: 'macro',
  status: 'approved',
  phraseTemplate: 'tôi chuyển {{amount}} sang Ký Quỹ',
  parameters: [{ name: 'amount', example: '500000' }],
  expansion: ['I enter "{{amount}}" into "Ô số tiền"', 'I tap "Nút xác nhận"'],
  postcondition: '"Thông báo" shows "thành công"',
  sourceExample: 'tôi chuyển 500000 sang Ký Quỹ',
  createdAt: '2026-09-11T00:00:00.000Z',
};

describe('nở action đã duyệt', () => {
  it('thay một dòng bằng các bước thuộc tập mẫu chuẩn', async () => {
    const actions = await registryWith([transfer]);
    const out = expandApprovedActions(
      'Feature: x\n  Scenario: y\n    When tôi chuyển 500000 sang Ký Quỹ\n',
      actions,
    );
    assert.match(out.content, /When I enter "500000" into "Ô số tiền"/);
    assert.match(out.content, /And I tap "Nút xác nhận"/);
    // Postcondition đi kèm: nó là thứ chứng minh macro đã làm xong việc.
    assert.match(out.content, /And "Thông báo" shows "thành công"/);
    assert.equal(out.applied.length, 1);
    assert.equal(out.changes[0]?.reason, 'Áp dụng action đã duyệt: Chuyển tiền nội bộ');
  });

  /** Chưa duyệt thì không được nở — duyệt mới là cái cổng. */
  it('bỏ qua action còn ở trạng thái đề xuất', async () => {
    const actions = await registryWith([{ ...transfer, status: 'proposed' }]);
    const source = 'Feature: x\n  Scenario: y\n    When tôi chuyển 500000 sang Ký Quỹ\n';
    // Giữ nguyên từng ký tự, kể cả dòng trống cuối file.
    assert.equal(expandApprovedActions(source, actions).content, source);
  });

  it('giữ nguyên thụt lề và câu không khớp action nào', async () => {
    const actions = await registryWith([transfer]);
    const out = expandApprovedActions('Feature: x\n    When I tap "Nút A"\n', actions);
    assert.match(out.content, /^ {4}When I tap "Nút A"$/m);
    assert.equal(out.applied.length, 0);
  });
});
