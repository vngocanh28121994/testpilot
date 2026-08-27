import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Registry } from '../../core/registry.js';
import {
  normalizeNaturalSteps,
  registerMissingElementIntents,
} from '../normalizer.js';
import { parseFeature } from '../binding.js';
import {
  contextualRowActionCandidates,
  parseRelativeRowLocator,
} from '../../core/contextual.js';

describe('natural-language scenario normalization', () => {
  it('accepts a concise unquoted Vietnamese visible result', () => {
    const normalized = normalizeNaturalSteps([
      'Scenario: Danh sách',
      '  Then Danh sách sản phẩm hiển thị',
      '  And Banner cảnh báo không xuất hiện',
    ].join('\n'));

    assert.equal(normalized.unresolved.length, 0);
    assert.match(normalized.content, /Then "Danh sách sản phẩm" is visible/);
    assert.match(normalized.content, /And "Banner cảnh báo" is not visible/);
  });

  it('keeps reusable login and business-search flows as first-class intents', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-business-flow-registry.json');
    const draft = [
      'Scenario: Hiệu quả đầu tư',
      '  Given người dùng đã đăng nhập bằng tài khoản "tcbs"',
      '  When người dùng mở chức năng "Hiệu quả đầu tư"',
    ].join('\n');

    const normalized = normalizeNaturalSteps(draft);
    assert.match(normalized.content, /I am logged in as "tcbs"/);
    assert.match(normalized.content, /I open feature "Hiệu quả đầu tư" from search/);
    assert.deepEqual(registerMissingElementIntents(normalized.content, registry), []);

    const parsed = parseFeature(
      'business-flow.feature',
      `Feature: Business flow\n\n${normalized.content}\n`,
      registry,
    );
    assert.deepEqual(parsed.scenarios[0]?.steps.map((step) => step.intent), [
      { kind: 'ensureLoggedIn', account: 'tcbs' },
      { kind: 'openFeatureFromSearch', query: 'Hiệu quả đầu tư' },
    ]);
  });

  it('turns concise business wording into selector-less semantic targets', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-semantic-target-registry.json');
    const draft = [
      'Scenario: Tài sản trái phiếu',
      '  Given I open the app',
      '  And I open "tcinvest://assets/bonds"',
      '  When người dùng truy cập phần Tài sản trái phiếu',
      '  And người dùng nhập ADS vào ô mã cổ phiếu',
      '  Then tôi kiểm tra Danh sách trái phiếu hiển thị',
    ].join('\n');

    const normalized = normalizeNaturalSteps(draft);
    assert.equal(normalized.unresolved.length, 0);
    assert.match(normalized.content, /Given I open the app/);
    assert.match(normalized.content, /And I open "tcinvest:\/\/assets\/bonds"/);
    assert.match(normalized.content, /When I tap "Tài sản trái phiếu"/);
    assert.match(normalized.content, /And I enter "ADS" into "mã cổ phiếu"/);
    assert.match(normalized.content, /Then "Danh sách trái phiếu" is visible/);

    const pending = registerMissingElementIntents(normalized.content, registry);
    assert.deepEqual(
      pending.map((element) => element.label),
      ['Tài sản trái phiếu', 'mã cổ phiếu', 'Danh sách trái phiếu'],
    );

    const parsed = parseFeature(
      'semantic-target.feature',
      `Feature: Semantic target\n\n${normalized.content}\n`,
      registry,
    );
    assert.deepEqual(parsed.scenarios[0]?.steps.map((step) => step.intent.kind), [
      'launch',
      'launch',
      'tap',
      'input',
      'assertVisible',
    ]);
  });

  it('expands a homepage business search and numeric investment assertion', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-investment-registry.json');
    const draft = [
      '@hieu-qua-dau-tu',
      'Scenario: Kiểm tra hiệu quả đầu tư phái sinh',
      '  And người dùng thực hiện tìm kiếm "Hiệu quả đầu tư" ở Homepage',
      '  And người dùng ấn "Hiệu quả đầu tư" ở kết quả tìm kiếm',
      '  And I click "Phái sinh"',
      '  And người dùng kiểm tra Thống kê chung giao dịch PS',
      '  And I click "ngày Từ "01/01/2026""',
      '  Then "số lượng giao dịch" shows "khác 0"',
    ].join('\n');

    const normalized = normalizeNaturalSteps(draft);
    assert.equal(normalized.unresolved.length, 0);
    assert.match(normalized.content, /I tap "Nút tìm kiếm"/);
    assert.match(normalized.content, /I enter "Hiệu quả đầu tư" into "Ô tìm kiếm"/);
    assert.match(normalized.content, /I wait for "Kết quả tìm kiếm đầu tiên"/);
    assert.match(normalized.content, /I tap "Hiệu quả đầu tư"/);
    assert.match(normalized.content, /I inspect section "Thống kê chung giao dịch PS"/);
    assert.match(normalized.content, /I select date "01\/01\/2026" from "Ngày Từ"/);
    assert.match(normalized.content, /"số lượng giao dịch" number is not "0"/);

    registerMissingElementIntents(normalized.content, registry);
    const parsed = parseFeature(
      'investment.feature',
      `Feature: Investment\n\n${normalized.content}\n`,
      registry,
    );
    assert.deepEqual(parsed.scenarios[0]?.steps.map((step) => step.intent.kind), [
      'tap', 'input', 'waitFor', 'tap', 'tap', 'focusRegion', 'selectDate', 'assertNumber',
    ]);
    assert.equal(
      registry.element('auto.ngayTu').candidates.web?.[0]?.value,
      `(//*[normalize-space(text())='Từ']/following-sibling::*[1]//input[@data-mat-calendar or @type='date'])[1]`,
    );
    assert.equal(
      registry.element('auto.soLuongGiaoDich').candidates.web?.[0]?.value,
      `(//*[not(*) and normalize-space(.)='Giao dịch']/preceding-sibling::*[1][normalize-space(.)!=''])[1]`,
    );
  });

  it('preserves an inspected section as runtime scope instead of flattening it to visibility', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-region-scope-registry.json');
    const draft = [
      'Scenario: Tooltip quỹ',
      '  And người dùng kiểm tra Các quỹ có thể bạn quan tâm',
      '  And I click "Giá 1M"',
      '  Then "Diễn biến giá trong vòng 1 tháng" is visible',
    ].join('\n');

    const normalized = normalizeNaturalSteps(draft);
    assert.equal(normalized.unresolved.length, 0);
    assert.match(
      normalized.content,
      /I inspect section "Các quỹ có thể bạn quan tâm"/,
    );

    registerMissingElementIntents(normalized.content, registry);
    const parsed = parseFeature(
      'region-scope.feature',
      `Feature: Region scope\n\n${normalized.content}\n`,
      registry,
    );
    assert.deepEqual(parsed.scenarios[0]?.steps.map((step) => step.intent.kind), [
      'focusRegion', 'tap', 'assertVisible',
    ]);
  });

  it('lets Playwright discover unknown elements without asking users for selectors', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-natural-registry.json');
    registry.upsertElement({
      id: 'priceBoard.coSoTab',
      label: 'Cơ sở',
      screen: 'priceBoard',
      candidates: { web: [{ strategy: 'css', value: '.co-so', weight: 0.9, origin: 'authored' }] },
    });
    registry.upsertElement({
      id: 'priceBoard.addStockButton',
      label: 'THÊM MÃ',
      screen: 'priceBoard',
      candidates: { web: [{ strategy: 'css', value: 'button.add', weight: 0.9, origin: 'authored' }] },
    });
    const draft = [
      'Scenario: Thêm mã',
      '  Then "Cơ sở" is visible',
      '  And I click button "THÊM MÃ"',
      '  And I enter "ADS" into "Ô mã cổ phiếu"',
      '  Then "ADS" is visible',
    ].join('\n');

    const normalized = normalizeNaturalSteps(draft);
    assert.match(normalized.content, /I click "THÊM MÃ"/);

    const first = registerMissingElementIntents(normalized.content, registry);
    assert.deepEqual(first.map((element) => [element.id, element.screen]), [
      ['priceBoard.oMaCoPhieu', 'priceBoard'],
    ]);
    assert.equal(registry.element('priceBoard.dynamicText').template?.kind, 'text');

    // Repeated normalization must still tell the UI that Playwright has not
    // discovered a selector yet.
    const second = registerMissingElementIntents(normalized.content, registry);
    assert.deepEqual(second.map((element) => element.id), [
      'priceBoard.oMaCoPhieu',
    ]);

    const parsed = parseFeature(
      'dynamic-text.feature',
      `Feature: Dynamic text\n\n${normalized.content}\n`,
      registry,
    );
    assert.deepEqual(parsed.scenarios[0]?.steps.at(-1)?.intent, {
      kind: 'assertVisible',
      element: 'priceBoard.dynamicText',
      locatorParams: { text: 'ADS' },
    });
  });

  it('normalizes a row-relative icon action and an unvisible assertion', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-contextual-registry.json');
    registry.upsertElement({
      id: 'priceBoard.ads',
      label: 'ADS',
      screen: 'priceBoard',
      candidates: { web: [{ strategy: 'label', value: 'ADS', weight: 0.7, origin: 'authored' }] },
    });
    const draft = [
      'Scenario: Xoá mã',
      '  Then "ADS" is visible',
      '  And I click icon ... tại dòng "ADS"',
      '  And I click "Xoá khỏi danh mục"',
      '  Then "ADS" is unvisible',
    ].join('\n');

    const normalized = normalizeNaturalSteps(draft);
    assert.equal(normalized.unresolved.length, 0);
    assert.match(normalized.content, /I click "Icon \.\.\. tại dòng ADS"/);
    assert.match(normalized.content, /"ADS" is not visible/);

    registerMissingElementIntents(normalized.content, registry);
    const contextual = registry.element('priceBoard.rowActionMenu');
    assert.equal(contextual.template?.kind, 'rowAction');
    assert.equal(contextual.candidates.web?.[0]?.strategy, 'relative');
    const relative = contextualRowActionCandidates('Icon ... tại dòng ADS');
    assert.equal(relative.length, 4);
    assert.ok(relative.every((candidate) => candidate.strategy === 'relative'));
    assert.ok(relative.every((candidate) => candidate.value.length < 100));
    assert.ok(relative.every((candidate) => !candidate.value.includes('ancestor::')));
    assert.deepEqual(parseRelativeRowLocator(relative[0]!.value), {
      rowText: 'ADS',
      action: '...',
      mode: 'metadata',
    });

    const parsed = parseFeature(
      'contextual.feature',
      `Feature: Contextual\n\n${normalized.content}\n`,
      registry,
    );
    assert.deepEqual(
      parsed.scenarios[0]?.steps.map((item) => item.intent.kind),
      ['assertVisible', 'tap', 'tap', 'assertNotVisible'],
    );
    assert.deepEqual(parsed.scenarios[0]?.steps[1]?.intent, {
      kind: 'tap',
      element: 'priceBoard.rowActionMenu',
      locatorParams: { action: '...', rowText: 'ADS' },
      rowAction: { action: '...', rowText: 'ADS' },
    });
  });

  it('normalizes hover, drag-drop and scroll into typed reusable capabilities', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-capability-registry.json');
    registry.upsertElement({
      id: 'board.stockInput', label: 'Ô mã', screen: 'board', candidates: {},
    });
    registry.upsertElement({
      id: 'board.dropZone', label: 'Danh mục yêu thích', screen: 'board', candidates: {},
    });
    registry.upsertElement({
      id: 'board.chart', label: 'Biểu đồ', screen: 'board', candidates: {},
    });
    const draft = [
      'Scenario: Pointer actions',
      '  When I move mouse over "Biểu đồ"',
      '  And I enter "ADS" into "Ô mã"',
      '  And I drag and drop "ADS" to "Danh mục yêu thích"',
      '  And I scroll "Danh mục yêu thích" into view',
      '  And I scroll down',
    ].join('\n');

    const normalized = normalizeNaturalSteps(draft);
    assert.equal(normalized.unresolved.length, 0);
    assert.match(normalized.content, /I hover "Biểu đồ"/);
    assert.match(normalized.content, /I drag "ADS" to "Danh mục yêu thích"/);
    assert.match(normalized.content, /I scroll to "Danh mục yêu thích"/);
    registerMissingElementIntents(normalized.content, registry);

    const parsed = parseFeature(
      'capabilities.feature',
      `Feature: Capabilities\n\n${normalized.content}\n`,
      registry,
    );
    assert.deepEqual(parsed.scenarios[0]?.steps.map((step) => step.intent), [
      { kind: 'hover', element: 'board.chart' },
      { kind: 'input', element: 'board.stockInput', text: 'ADS' },
      {
        kind: 'dragDrop',
        source: 'board.dynamicText',
        target: 'board.dropZone',
        sourceLocatorParams: { text: 'ADS' },
      },
      { kind: 'scrollTo', element: 'board.dropZone' },
      { kind: 'scroll', direction: 'down' },
    ]);
  });

  it('binds duplicate selector-less ids with one label on one screen to a canonical element', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-duplicate-label-registry.json');
    registry.upsertElement({
      id: 'priceBoard.removeFromListOption',
      label: 'Tùy chọn Xoá khỏi danh mục',
      screen: 'priceBoard',
      candidates: {},
    });
    registry.upsertElement({
      id: 'priceBoard.removeFromList',
      label: 'Tùy chọn Xoá khỏi danh mục',
      screen: 'priceBoard',
      candidates: {
        web: [{ strategy: 'label', value: 'Xoá khỏi danh mục', weight: 0.9, origin: 'authored' }],
      },
    });

    const parsed = parseFeature(
      'duplicate-label.feature',
      [
        'Feature: Thêm mã',
        '  Scenario: Xoá mã',
        '    When I click "Tùy chọn Xoá khỏi danh mục"',
      ].join('\n'),
      registry,
    );

    assert.deepEqual(parsed.scenarios[0]?.steps[0]?.intent, {
      kind: 'tap',
      element: 'priceBoard.removeFromList',
    });
  });

  it('uses the opened business feature as screen context for new and duplicate labels', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-feature-context-registry.json');
    registry.raw.screens.home = { id: 'home', title: 'Trang chủ' };
    registry.raw.screens.priceBoard = { id: 'priceBoard', title: 'Bảng giá cổ phiếu' };
    registry.upsertElement({ id: 'home.options', label: 'Tùy chọn', screen: 'home', candidates: {} });
    registry.upsertElement({ id: 'priceBoard.options', label: 'Tùy chọn', screen: 'priceBoard', candidates: {} });

    const content = [
      'Feature: Bảng giá',
      '  Scenario: Context nghiệp vụ',
      '    When I open feature "Bảng giá cổ phiếu" from search',
      '    And I click "Tùy chọn"',
      '    Then "Danh sách mã theo dõi" is visible',
    ].join('\n');
    const pending = registerMissingElementIntents(content, registry);
    assert.equal(pending.find((element) => element.label === 'Danh sách mã theo dõi')?.screen, 'priceBoard');

    const parsed = parseFeature('feature-context.feature', content, registry);
    assert.deepEqual(parsed.scenarios[0]?.steps.map((step) => step.intent), [
      { kind: 'openFeatureFromSearch', query: 'Bảng giá cổ phiếu' },
      { kind: 'tap', element: 'priceBoard.options' },
      { kind: 'assertVisible', element: 'priceBoard.danhSachMaTheoDoi' },
    ]);
  });

  it('binds executable business assertions for count, dedup, priority and focus', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-collection-registry.json');
    registry.upsertElement({
      id: 'search.results', label: 'Kết quả tìm kiếm', screen: 'search', candidates: {},
    });
    registry.upsertElement({
      id: 'search.adsRow', label: 'Dòng ADS', screen: 'search', candidates: {},
    });
    const content = [
      'Feature: Search rules',
      '  Scenario: Business assertions',
      '    Then "Kết quả tìm kiếm" số lượng tối đa "5"',
      '    And "Kết quả tìm kiếm" không có kết quả trùng',
      '    And kết quả đầu tiên của "Kết quả tìm kiếm" chứa "ADS"',
      '    And "Dòng ADS" được focus',
    ].join('\n');
    const parsed = parseFeature('collection.feature', content, registry);
    assert.deepEqual(parsed.scenarios[0]?.steps.map((step) => step.intent), [
      {
        kind: 'assertCollection', element: 'search.results',
        check: { kind: 'count', operator: 'atMost', value: 5 },
      },
      { kind: 'assertCollection', element: 'search.results', check: { kind: 'uniqueText' } },
      {
        kind: 'assertCollection', element: 'search.results',
        check: { kind: 'firstText', text: 'ADS' },
      },
      { kind: 'assertCollection', element: 'search.adsRow', check: { kind: 'focused' } },
    ]);
  });
});

describe('negative text assertion', () => {
  it('binds "does not show" and registers the element it names', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-negative-registry.json');
    const draft = [
      'Scenario: Xóa mã cổ phiếu khỏi danh mục',
      '  Given "Dòng cổ phiếu trong danh mục" shows "VIC"',
      '  When I click "Xoá khỏi danh mục"',
      '  Then "Dòng cổ phiếu trong danh mục" does not show "VIC"',
    ].join('\n');

    const normalized = normalizeNaturalSteps(draft);
    assert.equal(normalized.unresolved.length, 0, JSON.stringify(normalized.unresolved));

    registerMissingElementIntents(normalized.content, registry);
    const parsed = parseFeature('remove.feature', `Feature: X\n\n${normalized.content}`, registry);
    const steps = parsed.scenarios[0]!.steps;
    const last = steps[steps.length - 1]!.intent;

    assert.equal(last.kind, 'assertText');
    assert.equal((last as { mode?: string }).mode, 'notContains');
    // Sharing the element with the positive assertion two lines up is the
    // point: a second registry entry would put the same label on two screens
    // and stop the whole feature from binding.
    assert.equal(
      (last as { element: string }).element,
      (steps[0]!.intent as { element: string }).element,
    );
  });

  it('accepts the Vietnamese form', () => {
    const normalized = normalizeNaturalSteps(
      'Scenario: S\n  Then "Danh sách gợi ý" không chứa "VIC"',
    );
    assert.equal(normalized.unresolved.length, 0, JSON.stringify(normalized.unresolved));
  });
});

describe('ambiguous label on one screen', () => {
  const build = async (elements: Record<string, unknown>) => {
    const registry = await Registry.load(`/dev/null/nonexistent-ambig-${Math.random()}.json`);
    for (const el of Object.values(elements)) registry.upsertElement(el as never);
    return registry;
  };
  const css = (value: string) => ({
    web: [{ strategy: 'css', value, weight: 0.9, origin: 'authored' }],
  });
  const draft = 'Feature: F\n\nScenario: S\n  When I click "Kết quả đầu tiên"\n';

  it('warns when two elements with locators share a label and screen', async () => {
    const registry = await build({
      a: { id: 'p.tickerFirst', label: 'Kết quả đầu tiên', screen: 'p', candidates: css('.ticker mat-option') },
      b: { id: 'p.categoryFirst', label: 'Kết quả đầu tiên', screen: 'p', candidates: css('.category li') },
    });
    const spec = parseFeature('a.feature', draft, registry);

    // The step still binds — failing here would break suites that already run.
    assert.equal(spec.scenarios[0]!.steps.length, 1);
    assert.equal(spec.warnings?.length, 1, JSON.stringify(spec.warnings));
    assert.match(spec.warnings![0]!, /p\.tickerFirst/);
    assert.match(spec.warnings![0]!, /p\.categoryFirst/);
    assert.match(spec.warnings![0]!, /phỏng đoán/);
  });

  it('stays quiet when only one of the twins has locators', async () => {
    // The ordinary case: generation minted a selector-less duplicate. Choosing
    // the one with locators is not a guess, and warning here would train people
    // to ignore the warning that matters.
    const registry = await build({
      a: { id: 'p.first', label: 'Kết quả đầu tiên', screen: 'p', candidates: css('.ticker mat-option') },
      b: { id: 'p.first2', label: 'Kết quả đầu tiên', screen: 'p', candidates: {} },
    });
    const spec = parseFeature('b.feature', draft, registry);
    assert.equal(spec.warnings, undefined);
  });

  it('stays quiet when the label is unique', async () => {
    const registry = await build({
      a: { id: 'p.first', label: 'Kết quả đầu tiên', screen: 'p', candidates: css('.ticker mat-option') },
    });
    assert.equal(parseFeature('c.feature', draft, registry).warnings, undefined);
  });
});

describe('text assertion over a repeated element', () => {
  it('parses "shows" as contains, which the executor applies to every match', () => {
    // The wording is unchanged; what changed is that a label naming a list is
    // satisfied by any row. Guarded here so the step keeps compiling to the
    // mode the executor now reads across matches.
    const normalized = normalizeNaturalSteps(
      'Scenario: S\n  Then "Dòng cổ phiếu trong danh mục" shows "VIC"',
    );
    assert.equal(normalized.unresolved.length, 0, JSON.stringify(normalized.unresolved));
  });
});

describe('filtered count', () => {
  it('counts members carrying a value, not the whole collection', async () => {
    const registry = await Registry.load(`/dev/null/nonexistent-count-${Math.random()}.json`);
    const draft = [
      'Scenario: Thêm mã đã có không nhân đôi',
      '  Then "Dòng cổ phiếu trong danh mục" shows "VIC" exactly "1" times',
    ].join('\n');
    const normalized = normalizeNaturalSteps(draft);
    assert.equal(normalized.unresolved.length, 0, JSON.stringify(normalized.unresolved));

    registerMissingElementIntents(normalized.content, registry);
    const spec = parseFeature('c.feature', `Feature: F\n\n${normalized.content}`, registry);
    const intent = spec.scenarios[0]!.steps[0]!.intent as {
      kind: string; check: { kind: string; text: string; value: number };
    };
    assert.equal(intent.kind, 'assertCollection');
    // The distinction the old wording could not make: "VIC once" vs "one row".
    assert.equal(intent.check.kind, 'countMatching');
    assert.equal(intent.check.text, 'VIC');
    assert.equal(intent.check.value, 1);
  });

  it('accepts the Vietnamese form', () => {
    const n = normalizeNaturalSteps(
      'Scenario: S\n  Then "Danh sách gợi ý" hiển thị "MEL" đúng "1" lần',
    );
    assert.equal(n.unresolved.length, 0, JSON.stringify(n.unresolved));
  });
});

describe('numbers with or without quotes', () => {
  // Both repair rounds of a real generation were spent on this: the model wrote
  // "exactly 5 times" where the rule demanded "exactly \"5\" times". The count
  // was never ambiguous — only the punctuation was.
  const forms = [
    'Then "Danh sách gợi ý" shows "MEL-HNX" exactly 5 times',
    'Then "Danh sách gợi ý" shows "MEL-HNX" exactly "5" times',
    'Then "Dòng cổ phiếu trong danh mục" count is at least 1',
    'Then "Dòng cổ phiếu trong danh mục" count is at least "1"',
    'Then "Danh sách gợi ý" hiển thị "MEL" đúng 2 lần',
  ];
  for (const step of forms) {
    it(`hiểu được: ${step.slice(5, 62)}`, () => {
      const n = normalizeNaturalSteps(`Scenario: S\n  ${step}`);
      assert.equal(n.unresolved.length, 0, JSON.stringify(n.unresolved));
    });
  }

  it('binds the unquoted form to the same intent as the quoted one', async () => {
    const build = async (step: string) => {
      const registry = await Registry.load(`/dev/null/nonexistent-num-${Math.random()}.json`);
      const n = normalizeNaturalSteps(`Scenario: S\n  ${step}`);
      registerMissingElementIntents(n.content, registry);
      return parseFeature('n.feature', `Feature: F\n\n${n.content}`, registry)
        .scenarios[0]!.steps[0]!.intent;
    };
    const bare = await build('Then "Danh sách gợi ý" count is at most 5');
    const quoted = await build('Then "Danh sách gợi ý" count is at most "5"');
    assert.deepEqual(bare, quoted);
  });
});
