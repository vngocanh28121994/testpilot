/**
 * The gate that decides what a source-derived locator library is allowed to put
 * into the registry.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Registry } from '../../core/registry.js';
import { applyLocatorLibrary, type LocatorLibrary } from '../locators-import.js';

const fresh = () => Registry.load(`/dev/null/nonexistent-import-${Math.random()}.json`);

const lib = (elements: LocatorLibrary['elements']): LocatorLibrary =>
  ({ screens: [], elements } as LocatorLibrary);

describe('locator library import', () => {
  it('accepts a semantic selector and marks it unproven', async () => {
    const registry = await fresh();
    const report = applyLocatorLibrary(registry, lib([{
      id: 'priceBoard.stockRow', label: 'Dòng cổ phiếu trong danh mục',
      screen: 'priceBoard', platform: 'web',
      locators: [{ strategy: 'css', value: '.content-row', weight: 0.9 }],
    }]), 'llm');

    assert.equal(report.accepted, 1);
    const web = registry.element('priceBoard.stockRow').candidates.web!;
    assert.equal(web[0]!.value, '.content-row');
    // Importing is a proposal. Only a run that resolves it makes it a fact.
    assert.equal(web[0]!.approved, false);
    assert.equal(web[0]!.origin, 'llm');
  });

  it('turns away a positional selector', async () => {
    const registry = await fresh();
    const report = applyLocatorLibrary(registry, lib([{
      id: 'priceBoard.row7', label: 'Dòng thứ bảy', screen: 'priceBoard', platform: 'web',
      // Inside a virtualised list this is renumbered by scrolling — the exact
      // shape that made rows unusable before they had a class selector.
      locators: [{ strategy: 'css', value: 'cdk-virtual-scroll-viewport > div:nth-of-type(7)' }],
    }]), 'llm');

    assert.equal(report.accepted, 0);
    assert.equal(report.rejected, 1);
    assert.match(report.weak[0]!, /positional/);
  });

  it('never overwrites a locator healing has already proven', async () => {
    const registry = await fresh();
    registry.upsertElement({
      id: 'priceBoard.addStockButton', label: 'Thêm mã', screen: 'priceBoard',
      candidates: { web: [{
        strategy: 'css', value: "tcbs-icon[name='Circle add']", weight: 0.95, origin: 'healed',
      }] },
    });
    applyLocatorLibrary(registry, lib([{
      id: 'priceBoard.addStockButton', label: 'Thêm mã', screen: 'priceBoard', platform: 'web',
      locators: [{ strategy: 'css', value: 'button.add-stock' }],
    }]), 'llm');

    const values = registry.element('priceBoard.addStockButton').candidates.web!.map((c) => c.value);
    assert.ok(values.includes("tcbs-icon[name='Circle add']"), 'locator đã chứng minh phải còn nguyên');
    assert.ok(values.includes('button.add-stock'), 'đề xuất mới vào làm phương án dự phòng');
  });

  it('keeps the business label, which a bare selector list cannot supply', async () => {
    const registry = await fresh();
    applyLocatorLibrary(registry, lib([{
      id: 'addStockModal.searchInput', label: 'Ô tìm kiếm mã cổ phiếu',
      screen: 'addStockModal', platform: 'web',
      locators: [{ strategy: 'placeholder', value: 'Mã cổ phiếu' }],
    }]), 'authored');
    const el = registry.element('addStockModal.searchInput');
    assert.equal(el.label, 'Ô tìm kiếm mã cổ phiếu');
    assert.equal(el.screen, 'addStockModal');
  });
});

describe('locators that identify nothing', () => {
  it('refuses a role with no accessible name', async () => {
    const registry = await fresh();
    // Scores 74 on the shared quality scale, yet matches every button on a
    // price board — and the resolver takes the first match.
    const report = applyLocatorLibrary(registry, lib([{
      id: 'priceBoard.filterButton', label: 'Lọc', screen: 'priceBoard', platform: 'web',
      locators: [{ strategy: 'role', value: 'button' }],
    }]), 'llm');
    assert.equal(report.accepted, 0);
    assert.match(report.weak[0]!, /không kèm tên/);
  });

  it('accepts the same role once it carries a name', async () => {
    const registry = await fresh();
    const report = applyLocatorLibrary(registry, lib([{
      id: 'priceBoard.filterButton', label: 'Lọc', screen: 'priceBoard', platform: 'web',
      locators: [{ strategy: 'role', value: 'button', name: 'Lọc' }],
    }]), 'llm');
    assert.equal(report.accepted, 1);
  });

  it('refuses a bare tag selector', async () => {
    const registry = await fresh();
    const report = applyLocatorLibrary(registry, lib([{
      id: 'x.y', label: 'Nút nào đó', screen: 'priceBoard', platform: 'web',
      locators: [{ strategy: 'css', value: 'button' }],
    }]), 'llm');
    assert.equal(report.accepted, 0);
    assert.match(report.weak[0]!, /tên thẻ/);
  });
});

describe('landing on the element the registry already has', () => {
  it('fills the existing element instead of creating a twin', async () => {
    const registry = await fresh();
    registry.upsertElement({
      id: 'priceBoard.addStockButton', label: 'Thêm mã', screen: 'priceBoard', candidates: {},
    });
    // The library names it its own way, as any independent generator would.
    applyLocatorLibrary(registry, lib([{
      id: 'priceBoard.addTicker', label: 'Thêm mã', screen: 'priceBoard', platform: 'web',
      locators: [{ strategy: 'css', value: '[data-walkthrough="mb-search-filter"] tcbs-icon[name="Circle add"]' }],
    }]), 'llm');

    assert.equal(registry.raw.elements['priceBoard.addTicker'], undefined, 'không được tạo id mới');
    const web = registry.element('priceBoard.addStockButton').candidates.web!;
    assert.equal(web.length, 1, 'locator phải vào đúng element đang có');
  });

  it('matches across tone-mark spellings', async () => {
    const registry = await fresh();
    registry.upsertElement({
      id: 'priceBoard.xoaKhoiDanhMuc', label: 'Xoá khỏi danh mục', screen: 'priceBoard', candidates: {},
    });
    applyLocatorLibrary(registry, lib([{
      // The app renders "Xóa"; the registry stored "Xoá". One control.
      id: 'priceBoard.removeFromList', label: 'Xóa khỏi danh mục', screen: 'priceBoard', platform: 'web',
      locators: [{ strategy: 'css', value: '.menu-item:text-is("Xóa khỏi danh mục")' }],
    }]), 'llm');

    assert.equal(registry.raw.elements['priceBoard.removeFromList'], undefined);
    assert.equal(registry.element('priceBoard.xoaKhoiDanhMuc').candidates.web!.length, 1);
  });

  it('still creates the element when the registry has no such label', async () => {
    const registry = await fresh();
    applyLocatorLibrary(registry, lib([{
      id: 'priceBoard.smartFilter', label: 'Bộ lọc thông minh', screen: 'priceBoard', platform: 'web',
      locators: [{ strategy: 'css', value: '[data-walkthrough="mb-search-filter"] tcbs-icon[name="Filter"]' }],
    }]), 'llm');
    assert.equal(registry.element('priceBoard.smartFilter').label, 'Bộ lọc thông minh');
  });
});

describe('labels that are unique today', () => {
  it('refuses a new element whose label already lives on another screen', async () => {
    const registry = await fresh();
    registry.upsertElement({
      id: 'login.phaiSinh', label: 'Phái sinh', screen: 'login', candidates: {},
    });
    // Before: "Phái sinh" matched one element and resolved without consulting
    // the screen. After: two elements carry it, the screen filter engages, and
    // a step running on `home` matches neither. A derivatives feature that had
    // worked for weeks failed on its second line this way.
    const report = applyLocatorLibrary(registry, lib([{
      id: 'priceBoard.derivativeMarket', label: 'Phái sinh', screen: 'priceBoard', platform: 'web',
      locators: [{ strategy: 'css', value: '[data-walkthrough="mb-derivative-tab"]' }],
    }]), 'llm');

    assert.equal(report.accepted, 0);
    assert.equal(registry.raw.elements['priceBoard.derivativeMarket'], undefined);
    assert.match(report.weak[0]!, /đã tồn tại ở login\.phaiSinh/);
  });

  it('still fills the same label on the same screen', async () => {
    const registry = await fresh();
    registry.upsertElement({
      id: 'priceBoard.filterButton', label: 'Lọc', screen: 'priceBoard', candidates: {},
    });
    const report = applyLocatorLibrary(registry, lib([{
      id: 'priceBoard.smartFilter', label: 'Lọc', screen: 'priceBoard', platform: 'web',
      locators: [{ strategy: 'css', value: '[data-walkthrough="mb-search-filter"] tcbs-icon[name="Filter"]' }],
    }]), 'llm');
    assert.equal(report.accepted, 1);
    assert.equal(registry.element('priceBoard.filterButton').candidates.web!.length, 1);
  });
});
