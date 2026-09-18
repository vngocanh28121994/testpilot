/**
 * Registry phải luôn ĐỌC LẠI ĐƯỢC sau khi ghi.
 *
 * `assertAliasesUnique` chỉ tồn tại ở đường đọc: `Registry.load()` ném khi một
 * alias trùng label của element khác. Không ai chặn ở đường ghi, nên một lượt
 * sinh kịch bản ghi ra được đúng cái registry mà chính nó sau đó không đọc nổi.
 *
 * Đo trên máy thật 2026-09-16: workflow sinh mới `addStockModal.addStockButton`
 * với label "Nút thêm mã cổ phiếu" — đúng cái tên đang là alias của
 * `priceBoard.addStockButton` (386 lần resolve). Vì `/api/state` nạp registry,
 * mọi endpoint trả 500 và cả UI trắng: không feature, không kịch bản, không
 * report. Màn Kịch bản còn hiện "0 kịch bản khớp bộ lọc", nên nhìn như lỗi lọc.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { Registry } from '../registry.js';
import type { ElementDef } from '../types.js';

const el = (over: Partial<ElementDef> & Pick<ElementDef, 'id' | 'label'>): ElementDef => ({
  candidates: { web: [{ strategy: 'label', value: over.label, weight: 0.8, origin: 'authored' }] },
  ...over,
}) as ElementDef;

function fileWith(elements: Record<string, ElementDef>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'tp-reg-'));
  const file = path.join(dir, 'elements.json');
  writeFileSync(file, JSON.stringify({ version: 1, elements }), 'utf8');
  return file;
}

async function loadWith(elements: Record<string, ElementDef>): Promise<Registry> {
  return Registry.load(fileWith(elements));
}

describe('registry giữ bất biến tên ngay lúc ghi', () => {
  /**
   * Đúng ca đã làm sập UI — và bằng chứng quyết định ai giữ tên, không phải
   * thứ bậc label/alias.
   *
   * Alias "Nút thêm mã cổ phiếu" thuộc về element đã resolve 398 lần; kẻ đòi
   * tên vừa được sinh ra, 0 lần. Nhường tên cho kẻ đòi nghĩa là ba bước Gherkin
   * đang chạy tốt bị đẩy sang một element chưa từng tìm thấy — đã đo trên máy
   * thật: bước bấm "Thêm mã" chết hẳn.
   */
  it('bên đã chứng minh được thì giữ tên, kẻ đòi phải đổi', async () => {
    const reg = await loadWith({
      'priceBoard.addStockButton': el({
        id: 'priceBoard.addStockButton',
        label: 'Thêm mã',
        aliases: ['Nút thêm mã cổ phiếu'],
        health: { resolutions: 398, heals: 0, winners: {} },
      }),
    });
    reg.upsertElement(el({
      id: 'addStockModal.addStockButton',
      label: 'Nút thêm mã cổ phiếu',
      screen: 'addStockModal',
    }));
    assert.deepEqual(
      reg.element('priceBoard.addStockButton').aliases,
      ['Nút thêm mã cổ phiếu'],
      'alias đã chứng minh được thì không được gỡ',
    );
    assert.equal(
      reg.element('addStockModal.addStockButton').label,
      'Nút thêm mã cổ phiếu (addStockModal)',
    );
  });

  /** Chiều ngược lại: alias chưa chứng minh được gì thì nhường cho label. */
  it('alias chưa có lịch sử thì nhường tên cho element đòi', async () => {
    const reg = await loadWith({
      'a.button': el({ id: 'a.button', label: 'Thêm mã', aliases: ['Nút thêm mã cổ phiếu'] }),
    });
    reg.upsertElement(el({ id: 'b.button', label: 'Nút thêm mã cổ phiếu', screen: 'b' }));
    assert.equal(reg.element('a.button').aliases, undefined);
    assert.equal(reg.element('b.button').label, 'Nút thêm mã cổ phiếu');
  });

  /**
   * Và điều thật sự cần: thứ ghi ra phải nạp lại được. Đây là bất biến, các
   * assertion trên chỉ là cách nó được giữ.
   */
  it('registry sau khi ghi luôn nạp lại được', async () => {
    const file = fileWith({
      'a.button': el({ id: 'a.button', label: 'Thêm mã', aliases: ['Nút thêm mã cổ phiếu'] }),
    });
    const reg = await Registry.load(file);
    reg.upsertElement(el({ id: 'b.button', label: 'Nút thêm mã cổ phiếu' }));
    await reg.save();
    await assert.doesNotReject(() => Registry.load(file));
  });

  it('alias mới trùng tên người khác đang giữ thì bị bỏ, không ghi vào', async () => {
    const reg = await loadWith({
      'a.field': el({ id: 'a.field', label: 'Số tiền' }),
    });
    reg.upsertElement(el({ id: 'b.field', label: 'Giá trị', aliases: ['Số tiền'] }));
    assert.equal(reg.element('b.field').aliases, undefined);
    assert.equal(reg.element('a.field').label, 'Số tiền');
  });

  /** Alias không xung đột vẫn phải đi qua bình thường. */
  it('không đụng tới alias hợp lệ', async () => {
    const reg = await loadWith({ 'a.list': el({ id: 'a.list', label: 'Danh sách gợi ý mã cổ phiếu' }) });
    reg.upsertElement(el({
      id: 'a.list',
      label: 'Danh sách gợi ý mã cổ phiếu',
      aliases: ['Danh sách gợi ý'],
    }));
    assert.deepEqual(reg.element('a.list').aliases, ['Danh sách gợi ý']);
  });

  /**
   * Luật "regeneration không được xoá tên do người dạy" vẫn nguyên: nó cấm xoá
   * vì bản mới KHÔNG BIẾT tới cái tên, khác hẳn việc một element chính danh đòi
   * lại tên ấy làm label.
   */
  it('bản ghi mới không mang alias thì alias cũ vẫn còn', async () => {
    const reg = await loadWith({
      'a.list': el({ id: 'a.list', label: 'Danh sách', aliases: ['Gợi ý'] }),
    });
    reg.upsertElement(el({ id: 'a.list', label: 'Danh sách' }));
    assert.deepEqual(reg.element('a.list').aliases, ['Gợi ý']);
  });
});
