/**
 * Quyết định về cặp trùng vai phải ở lại; danh sách nghi vấn thì không.
 *
 * Chỉ quyết định được lưu, còn nghi vấn tính lại từ registry mỗi lần hỏi. Nhờ
 * vậy một cặp hết nghi sẽ tự biến mất mà không ai phải đi dọn, và quan trọng
 * hơn: một cặp đã bị bấm "không phải trùng" không bao giờ quay lại. Không có
 * điều đó thì danh sách không về được 0 — trên registry thật có ít nhất một
 * cặp gần như chắc chắn là cố ý (cùng một trường trên màn nhập và màn xác nhận
 * chuyển tiền) — và một danh sách không bao giờ sạch sẽ kéo cả phần đúng
 * trong nó xuống cùng.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DuplicateReviewStore, pairKey } from '../duplicateReview.js';
import type { DuplicateElementPair } from '../duplicateElements.js';

const pair = (strong: string, weak: string): DuplicateElementPair => ({
  strong,
  weak,
  sharedLocator: 'label:x',
  strongKey: 'label:X',
  share: [1, 1],
});

let dir: string;
before(async () => { dir = await mkdtemp(path.join(tmpdir(), 'dup-')); });
after(async () => { await rm(dir, { recursive: true, force: true }); });

describe('sổ duyệt cặp trùng vai', () => {
  it('chưa có file thì chưa ai quyết định gì, không phải lỗi', async () => {
    const store = await DuplicateReviewStore.load(path.join(dir, 'chua-co.json'));
    assert.deepEqual(store.pending([pair('a', 'b')]).map((p) => p.weak), ['b']);
  });

  it('quyết định rồi thì cặp ấy không hiện lại', async () => {
    const file = path.join(dir, 'review.json');
    const store = await DuplicateReviewStore.load(file);
    store.decide('a', 'b', 'distinct');
    await store.save();

    const reloaded = await DuplicateReviewStore.load(file);
    assert.deepEqual(reloaded.pending([pair('a', 'b'), pair('c', 'd')]).map((p) => p.weak), ['d']);
    assert.equal(reloaded.decisionFor('a', 'b')?.decision, 'distinct');
  });

  /**
   * Hướng mạnh/yếu do bằng chứng quyết định và đổi được giữa hai lượt chạy —
   * một lượt thêm vài lần thắng cho bên kia là đủ. Nếu khoá theo thứ tự thì
   * một quyết định đã ghi sẽ tự hồi sinh vào ngày hướng đổi chiều.
   */
  it('đổi chỗ hai bên vẫn là một cặp', async () => {
    assert.equal(pairKey('a', 'b'), pairKey('b', 'a'));
    const store = await DuplicateReviewStore.load(path.join(dir, 'doi-cho.json'));
    store.decide('b', 'a', 'merged');
    assert.equal(store.decisionFor('a', 'b')?.decision, 'merged');
    assert.deepEqual(store.pending([pair('a', 'b')]), []);
  });
});
