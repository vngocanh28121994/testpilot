import assert from 'node:assert/strict';
import test from 'node:test';
import type { ElementDef, ElementRegistry } from '../../core/types.js';
import type { GeneratedModel } from '../generate.js';
import { reconcileGeneratedModel } from '../reconcile.js';

const candidate = (value: string): ElementDef['candidates'] => ({
  web: [{ strategy: 'css', value, weight: 0.95, origin: 'authored' }],
});

test('reuses the mature screen and its proven add-stock element', () => {
  const registry: ElementRegistry = {
    version: 1,
    screens: {
      priceBoard: { id: 'priceBoard', title: 'Bảng giá cổ phiếu' },
      stockPriceBoard: { id: 'stockPriceBoard', title: 'Bảng giá cổ phiếu' },
    },
    elements: {
      'priceBoard.addStockButton': {
        id: 'priceBoard.addStockButton',
        label: 'Thêm mã',
        screen: 'priceBoard',
        candidates: candidate("tcbs-icon[name='Circle add']"),
        health: { resolutions: 31, heals: 0, winners: {} },
      },
      'stockPriceBoard.addStockButton': {
        id: 'stockPriceBoard.addStockButton',
        label: 'Nút mở chức năng Thêm mã cổ phiếu',
        screen: 'stockPriceBoard',
        candidates: {},
      },
    },
  };
  const generated: GeneratedModel = {
    screens: [{ id: 'stockPriceBoard', title: 'Bảng giá cổ phiếu' }],
    elements: [{
      id: 'stockPriceBoard.addStockButton',
      label: 'Nút mở chức năng Thêm mã cổ phiếu',
      screen: 'stockPriceBoard',
      candidates: {},
    }],
  };

  const result = reconcileGeneratedModel(generated, registry);

  assert.equal(result.screenAliases.stockPriceBoard, 'priceBoard');
  assert.equal(
    result.elementAliases['stockPriceBoard.addStockButton'],
    'priceBoard.addStockButton',
  );
  assert.equal(result.elements[0]?.candidates.web?.[0]?.value, "tcbs-icon[name='Circle add']");
});

test('reuses proven modal controls by semantic label and screen context', () => {
  const registry: ElementRegistry = {
    version: 1,
    screens: {
      priceBoard: { id: 'priceBoard', title: 'Bảng giá cổ phiếu' },
      home: { id: 'home', title: 'Trang chủ' },
    },
    elements: {
      'priceBoard.stockSearchFirstResult': {
        id: 'priceBoard.stockSearchFirstResult',
        label: 'Kết quả tìm kiếm đầu tiên',
        screen: 'priceBoard',
        candidates: candidate('.stock-result'),
      },
      'home.searchFirstResult': {
        id: 'home.searchFirstResult',
        label: 'Kết quả tìm kiếm đầu tiên',
        screen: 'home',
        candidates: candidate('.feature-result'),
      },
    },
  };
  const generated: GeneratedModel = {
    screens: [{ id: 'addStockModal', title: 'Thêm mã cổ phiếu' }],
    elements: [{
      id: 'addStockModal.searchResultItem',
      label: 'Một kết quả tìm kiếm (mã cổ phiếu)',
      screen: 'addStockModal',
      candidates: {},
    }],
  };

  const result = reconcileGeneratedModel(generated, registry);

  assert.equal(
    result.elementAliases['addStockModal.searchResultItem'],
    'priceBoard.stockSearchFirstResult',
  );
});

test('collapses duplicate generated ids for the same logical element on one screen', () => {
  const registry: ElementRegistry = {
    version: 1,
    screens: { priceBoard: { id: 'priceBoard', title: 'Bảng giá cổ phiếu' } },
    elements: {
      'priceBoard.removeFromList': {
        id: 'priceBoard.removeFromList',
        label: 'Tùy chọn Xoá khỏi danh mục',
        screen: 'priceBoard',
        candidates: {},
      },
    },
  };
  const generated: GeneratedModel = {
    screens: [{ id: 'priceBoard', title: 'Bảng giá cổ phiếu' }],
    elements: [
      {
        id: 'priceBoard.removeFromList',
        label: 'Tùy chọn Xoá khỏi danh mục',
        screen: 'priceBoard',
        candidates: {},
      },
      {
        id: 'priceBoard.removeFromListOption',
        label: 'Tùy chọn Xoá khỏi danh mục',
        screen: 'priceBoard',
        candidates: {},
      },
    ],
  };

  const result = reconcileGeneratedModel(generated, registry);

  assert.equal(result.elements.length, 1);
  assert.equal(result.elements[0]?.id, 'priceBoard.removeFromList');
  assert.equal(result.elementAliases['priceBoard.removeFromListOption'], 'priceBoard.removeFromList');
});

/** Screens the model renamed between runs, and screens that merely read alike. */
const el = (id: string, label: string, screen: string, css?: string): ElementDef => ({
  id, label, screen, candidates: css ? candidate(css) : {},
});

test('merges a renamed screen onto the one holding the same elements', () => {
  const registry: ElementRegistry = {
    version: 1,
    screens: { addStockModal: { id: 'addStockModal', title: 'Thêm mã cổ phiếu' } },
    elements: {
      'addStockModal.searchInput': el('addStockModal.searchInput', 'Ô tìm kiếm mã cổ phiếu', 'addStockModal', 'input.search'),
      'addStockModal.suggestionList': el('addStockModal.suggestionList', 'Danh sách gợi ý', 'addStockModal', 'mat-option'),
      'addStockModal.clearButton': el('addStockModal.clearButton', 'Xóa từ khóa', 'addStockModal', '.clear'),
    },
  };
  const generated: GeneratedModel = {
    // Same modal, new heading — the exact-title rule saw a second screen and
    // duplicated its elements, which then broke binding for the whole feature.
    screens: [{ id: 'addStockSearch', title: 'Thêm mã cổ phiếu - Tìm kiếm' }],
    elements: [
      el('addStockSearch.searchInput', 'Ô tìm kiếm mã cổ phiếu', 'addStockSearch'),
      el('addStockSearch.suggestionList', 'Danh sách gợi ý', 'addStockSearch'),
    ],
  };
  const out = reconcileGeneratedModel(generated, registry);

  assert.equal(out.screenAliases.addStockSearch, 'addStockModal');
  assert.equal(out.screens.length, 1, 'không được sinh thêm màn hình trùng');
  const labels = out.elements.map((e) => `${e.screen}:${e.label}`);
  assert.ok(!labels.some((l) => l.startsWith('addStockSearch:')), labels.join(', '));
});

test('keeps apart screens whose titles read alike but hold different elements', () => {
  const registry: ElementRegistry = {
    version: 1,
    screens: { priceBoard: { id: 'priceBoard', title: 'Bảng giá cổ phiếu' } },
    elements: {
      'priceBoard.addStockButton': el('priceBoard.addStockButton', 'Thêm mã', 'priceBoard', '.add'),
      'priceBoard.filterButton': el('priceBoard.filterButton', 'Lọc', 'priceBoard', '.filter'),
      'priceBoard.stockRow': el('priceBoard.stockRow', 'Dòng cổ phiếu trong danh mục', 'priceBoard', '.row'),
    },
  };
  const generated: GeneratedModel = {
    // Title similarity would call this the same screen; its contents say no.
    screens: [{ id: 'derivativesBoard', title: 'Bảng giá cổ phiếu phái sinh' }],
    elements: [
      el('derivativesBoard.contractRow', 'Dòng hợp đồng tương lai', 'derivativesBoard'),
      el('derivativesBoard.expiryPicker', 'Chọn tháng đáo hạn', 'derivativesBoard'),
    ],
  };
  const out = reconcileGeneratedModel(generated, registry);
  assert.equal(out.screenAliases.derivativesBoard, 'derivativesBoard', 'màn hình khác nhau phải giữ riêng');
});

test('does not merge on a single shared label', () => {
  const registry: ElementRegistry = {
    version: 1,
    screens: { home: { id: 'home', title: 'Trang chủ' } },
    elements: {
      'home.searchInput': el('home.searchInput', 'Ô tìm kiếm', 'home', '.search'),
      'home.banner': el('home.banner', 'Banner khuyến mãi', 'home', '.banner'),
    },
  };
  const generated: GeneratedModel = {
    screens: [{ id: 'reportPage', title: 'Báo cáo' }],
    elements: [
      el('reportPage.searchInput', 'Ô tìm kiếm', 'reportPage'),
      el('reportPage.exportButton', 'Xuất Excel', 'reportPage'),
    ],
  };
  const out = reconcileGeneratedModel(generated, registry);
  assert.equal(out.screenAliases.reportPage, 'reportPage', 'một nhãn chung là quá ít bằng chứng');
});
