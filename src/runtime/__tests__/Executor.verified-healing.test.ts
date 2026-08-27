import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { LocatorCandidate, ScenarioSpec } from '../../core/types.js';
import { Registry } from '../../core/registry.js';
import type { UiDriver, UiHandle } from '../../drivers/driver.js';
import { Resolver } from '../resolver.js';
import { Executor } from '../executor.js';

function handle(candidate: LocatorCandidate, text = ''): UiHandle {
  return {
    candidate,
    isVisible: async () => true,
    text: async () => text,
  };
}

function scenario(steps: ScenarioSpec['steps']): ScenarioSpec {
  return {
    id: 'verified-healing',
    name: 'Verified contextual healing',
    tags: [],
    platforms: ['web'],
    steps,
  };
}

describe('Executor — verified action healing', () => {
  it('executes shared login and exact business-search flows across the same resolver', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-business-flow.json');
    const elements = [
      ['login.usernameField', 'username'],
      ['login.passwordField', 'password'],
      ['login.submitButton', 'submit'],
      ['home.totalAssets', 'total-assets'],
      ['home.searchBox', 'search-box'],
      ['home.searchInput', 'search-input'],
      ['home.searchFirstResult', 'first-result'],
      ['feature.summary', 'summary'],
    ] as const;
    for (const [id, value] of elements) {
      registry.upsertElement({
        id, label: value, screen: id.split('.')[0]!,
        candidates: { web: [{ strategy: 'testId', value, weight: 0.95, origin: 'authored' }] },
      });
    }
    registry.upsertElement({
      id: 'home.dynamicText', label: '{{text}}', screen: 'home', template: { kind: 'text' },
      candidates: { web: [{ strategy: 'label', value: '{{text}}', weight: 0.9, origin: 'authored' }] },
    });

    let loggedIn = false;
    let query = '';
    let opened = false;
    let saved = 0;
    let launches = 0;
    let currentUrl = 'about:blank';
    const values = new Map<string, string>();
    const driver: UiDriver = {
      platform: 'web', device: 'mock-web',
      start: async () => {}, stop: async () => {},
      launch: async () => { launches += 1; currentUrl = 'https://example.test/login'; },
      currentUrl: async () => currentUrl,
      restoreAuthenticatedSession: async () => false,
      saveAuthenticatedSession: async () => { saved += 1; },
      invalidateAuthenticatedSession: async () => {},
      find: async (candidate) => {
        const value = candidate.value;
        if (value === 'total-assets' && !loggedIn) return null;
        if (value === 'first-result' && !query) return null;
        if (value === 'Hiệu quả đầu tư' && query !== value) return null;
        if (value === 'summary' && !opened) return null;
        return {
          ...handle(candidate, value),
          value: async () => values.get(value) ?? '',
        };
      },
      tap: async (target) => {
        if (target.candidate.value === 'submit') loggedIn = true;
        if (target.candidate.value === 'Hiệu quả đầu tư') opened = true;
      },
      longPress: async () => {},
      input: async (target, text) => {
        values.set(target.candidate.value, text);
        if (target.candidate.value === 'search-input') query = text;
      },
      clear: async () => {}, selectOption: async () => {}, scrollIntoView: async () => {},
      swipe: async () => {}, scroll: async () => {}, back: async () => {},
      screenshot: async () => '', isIdle: async () => true,
    };
    const resolver = new Resolver(driver, registry, {
      timeoutMs: 100, pollMs: 5, requireVisible: true, verifyHealedMatch: false,
    });
    const executor = new Executor(driver, resolver, {
      retries: 0,
      screenshotOnFailure: false,
      postconditionTimeoutMs: 80,
      variables: {
        'account.tcbs.username': 'safe-user',
        'account.tcbs.password': 'not-logged',
      },
    });

    const result = await executor.runScenario(scenario([
      {
        keyword: 'Given', line: 1, text: 'I am logged in as "tcbs"',
        intent: { kind: 'ensureLoggedIn', account: 'tcbs' },
      },
      {
        keyword: 'When', line: 2, text: 'I open feature "Hiệu quả đầu tư" from search',
        intent: { kind: 'openFeatureFromSearch', query: 'Hiệu quả đầu tư' },
      },
      {
        keyword: 'Then', line: 3, text: 'summary visible',
        intent: { kind: 'assertVisible', element: 'feature.summary' },
      },
    ]));

    assert.equal(result.verdict, 'passed');
    assert.equal(loggedIn, true);
    assert.equal(opened, true);
    assert.equal(saved, 1);
    assert.equal(launches, 1);
  });

  it('accepts a real route change even when the next generated element has no locator yet', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-route-proof.json');
    for (const [id, value] of [
      ['home.searchBox', 'search-box'],
      ['home.searchInput', 'search-input'],
      ['home.searchFirstResult', 'first-result'],
    ] as const) {
      registry.upsertElement({
        id, label: value, screen: 'home',
        candidates: { web: [{ strategy: 'testId', value, weight: 0.95, origin: 'authored' }] },
      });
    }
    registry.upsertElement({
      id: 'home.dynamicText', label: '{{text}}', screen: 'home', template: { kind: 'text' },
      candidates: { web: [{ strategy: 'label', value: '{{text}}', weight: 0.9, origin: 'authored' }] },
    });
    registry.upsertElement({
      id: 'destination.newButton', label: 'Nút mới chưa discovery', screen: 'destination',
      candidates: {},
    });

    let url = 'https://example.test/home';
    let query = '';
    const driver: UiDriver = {
      platform: 'web', device: 'mock-web',
      start: async () => {}, stop: async () => {}, launch: async () => {},
      currentUrl: async () => url,
      find: async (candidate) => {
        if (candidate.value === 'first-result' && !query) return null;
        if (candidate.value === 'Bảng giá cổ phiếu' && query !== candidate.value) return null;
        if (candidate.value.includes('Nút mới chưa discovery')) return null;
        return handle(candidate, candidate.value);
      },
      tap: async (target) => {
        if (target.candidate.value === 'Bảng giá cổ phiếu') {
          url = 'https://example.test/tc-price?table=1';
        }
      },
      input: async (_target, text) => { query = text; },
      longPress: async () => {}, clear: async () => {}, selectOption: async () => {},
      scrollIntoView: async () => {}, swipe: async () => {}, scroll: async () => {}, back: async () => {},
      screenshot: async () => '', isIdle: async () => true,
    };
    const resolver = new Resolver(driver, registry, {
      timeoutMs: 40, pollMs: 5, requireVisible: true, verifyHealedMatch: false,
    });
    const executor = new Executor(driver, resolver, {
      retries: 0, screenshotOnFailure: false, postconditionTimeoutMs: 20,
    });

    const result = await executor.runScenario(scenario([
      {
        keyword: 'When', line: 1, text: 'I open feature "Bảng giá cổ phiếu" from search',
        intent: { kind: 'openFeatureFromSearch', query: 'Bảng giá cổ phiếu' },
      },
      {
        keyword: 'Then', line: 2, text: 'new button visible',
        intent: { kind: 'assertVisible', element: 'destination.newButton' },
      },
    ]));

    assert.equal(result.runs[0]?.steps[0]?.status, 'passed');
    assert.equal(result.runs[0]?.steps[1]?.status, 'failed');
    assert.equal(url, 'https://example.test/tc-price?table=1');
  });

  it('classifies a blank page that cannot launch as environment and does not retry', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-app-launch.json');
    let attempts = 0;
    const driver: UiDriver = {
      platform: 'web', device: 'mock-web',
      start: async () => {}, stop: async () => {},
      beginScenario: async () => { attempts += 1; },
      launch: async () => { throw new Error('navigation unavailable'); },
      currentUrl: async () => 'about:blank',
      find: async () => null,
      tap: async () => {}, longPress: async () => {}, input: async () => {}, clear: async () => {},
      selectOption: async () => {}, scrollIntoView: async () => {}, swipe: async () => {},
      scroll: async () => {}, back: async () => {}, screenshot: async () => '', isIdle: async () => true,
    };
    const resolver = new Resolver(driver, registry, {
      timeoutMs: 20, pollMs: 5, requireVisible: true, verifyHealedMatch: false,
    });
    const executor = new Executor(driver, resolver, { retries: 2, screenshotOnFailure: false });

    const result = await executor.runScenario(scenario([{
      keyword: 'Given', line: 1, text: 'I am logged in as "tcbs"',
      intent: { kind: 'ensureLoggedIn', account: 'tcbs' },
    }]));

    assert.equal(attempts, 1);
    assert.equal(result.runs.length, 1);
    assert.equal(result.runs[0]?.steps[0]?.failureKind, 'environment');
    assert.match(result.runs[0]?.steps[0]?.error?.message ?? '', /RUNTIME_APP_NOT_LAUNCHED/);
  });

  it('trusts cached auth only after the logged-in UI is visible', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-cached-flow.json');
    registry.upsertElement({
      id: 'home.totalAssets', label: 'Tổng tài sản', screen: 'home',
      candidates: { web: [{ strategy: 'testId', value: 'total', weight: 0.95, origin: 'authored' }] },
    });
    let restored = 0;
    let loggedIn = false;
    let typed = 0;
    const driver: UiDriver = {
      platform: 'web', device: 'mock-web',
      start: async () => {}, stop: async () => {}, launch: async () => {},
      restoreAuthenticatedSession: async () => { restored += 1; loggedIn = true; return true; },
      saveAuthenticatedSession: async () => {}, invalidateAuthenticatedSession: async () => {},
      find: async (candidate) => loggedIn ? handle(candidate) : null,
      tap: async () => {}, longPress: async () => {}, input: async () => { typed += 1; },
      clear: async () => {}, selectOption: async () => {}, scrollIntoView: async () => {},
      swipe: async () => {}, scroll: async () => {}, back: async () => {},
      screenshot: async () => '', isIdle: async () => true,
    };
    const resolver = new Resolver(driver, registry, {
      timeoutMs: 80, pollMs: 5, requireVisible: true, verifyHealedMatch: false,
    });
    const executor = new Executor(driver, resolver, { retries: 0, screenshotOnFailure: false });

    const result = await executor.runScenario(scenario([{
      keyword: 'Given', line: 1, text: 'cached login',
      intent: { kind: 'ensureLoggedIn', account: 'tcbs' },
    }]));

    assert.equal(result.verdict, 'passed');
    assert.equal(restored, 1);
    assert.equal(typed, 0);
  });

  it('dispatches a date selection and verifies the accepted field value', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-date-capability.json');
    registry.upsertElement({
      id: 'screen.fromDate', label: 'Ngày Từ', screen: 'screen',
      candidates: {
        web: [{ strategy: 'testId', value: 'from-date', weight: 0.95, origin: 'authored' }],
      },
    });
    let accepted = '';
    let ordinaryInputs = 0;
    const driver: UiDriver = {
      platform: 'web', device: 'mock-web',
      start: async () => {}, stop: async () => {}, launch: async () => {},
      find: async (candidate) => ({
        ...handle(candidate),
        value: async () => accepted,
      }),
      tap: async () => {}, longPress: async () => {}, input: async () => { ordinaryInputs += 1; },
      selectDate: async (_target, date) => { accepted = date; },
      inspectControl: async () => ({
        type: 'date',
        evidence: ['playwright-dom: data-mat-calendar', 'playwright-mcp: calendar button'],
      }),
      clear: async () => {}, selectOption: async () => {}, scrollIntoView: async () => {},
      swipe: async () => {}, scroll: async () => {}, back: async () => {},
      screenshot: async () => '', isIdle: async () => true,
    };
    const resolver = new Resolver(driver, registry, {
      timeoutMs: 80, pollMs: 5, requireVisible: true, verifyHealedMatch: false,
    });
    const executor = new Executor(driver, resolver, { retries: 0, screenshotOnFailure: false });

    const result = await executor.runScenario(scenario([{
      keyword: 'When', line: 1, text: 'I enter "01/01/2026" into "Ngày Từ"',
      intent: { kind: 'input', element: 'screen.fromDate', text: '01/01/2026' },
    }]));

    assert.equal(result.verdict, 'passed');
    assert.equal(accepted, '01/01/2026');
    assert.equal(ordinaryInputs, 0);
    assert.equal(registry.element('screen.fromDate').controlType, 'date');
    assert.ok(registry.element('screen.fromDate').controlEvidence?.some(
      (item) => item.startsWith('playwright-mcp:'),
    ));
  });

  it('dispatches hover, drag-drop and scroll through typed driver capabilities', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-action-capabilities.json');
    for (const [id, value] of [['screen.source', 'source'], ['screen.target', 'target']] as const) {
      registry.upsertElement({
        id, label: value, screen: 'screen',
        candidates: { web: [{ strategy: 'testId', value, weight: 0.95, origin: 'authored' }] },
      });
    }
    const calls: string[] = [];
    const driver: UiDriver = {
      platform: 'web', device: 'mock-web',
      start: async () => {}, stop: async () => {}, launch: async () => {},
      find: async (candidate) => handle(candidate, candidate.value),
      tap: async () => {},
      hover: async (target) => { calls.push(`hover:${target.candidate.value}`); },
      dragDrop: async (source, target) => {
        calls.push(`drag:${source.candidate.value}->${target.candidate.value}`);
      },
      longPress: async () => {}, input: async () => {}, clear: async () => {},
      selectOption: async () => {}, scrollIntoView: async () => {},
      swipe: async () => {},
      scroll: async (direction) => { calls.push(`scroll:${direction}`); },
      back: async () => {}, screenshot: async () => '', isIdle: async () => true,
    };
    const resolver = new Resolver(driver, registry, {
      timeoutMs: 80, pollMs: 5, requireVisible: true, verifyHealedMatch: false,
    });
    const executor = new Executor(driver, resolver, { retries: 0, screenshotOnFailure: false });

    const result = await executor.runScenario(scenario([
      { keyword: 'When', line: 1, text: 'hover', intent: { kind: 'hover', element: 'screen.source' } },
      {
        keyword: 'And', line: 2, text: 'drag',
        intent: { kind: 'dragDrop', source: 'screen.source', target: 'screen.target' },
      },
      { keyword: 'And', line: 3, text: 'scroll', intent: { kind: 'scroll', direction: 'down' } },
    ]));

    assert.equal(result.verdict, 'passed');
    assert.deepEqual(calls, ['hover:source', 'drag:source->target', 'scroll:down']);
  });

  it('rejects a false-positive click, tries the next row-relative candidate, and persists only the winner', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-verified-healing.json');
    registry.upsertElement({
      id: 'board.rowMenu',
      label: 'Icon ... tại dòng ADS',
      screen: 'board',
      candidates: {
        web: [{
          strategy: 'label', value: 'Icon ... tại dòng ADS', weight: 0.8, origin: 'authored',
        }],
      },
    });
    registry.upsertElement({
      id: 'board.remove',
      label: 'Xoá khỏi danh mục',
      screen: 'board',
      candidates: {
        web: [{ strategy: 'testId', value: 'remove-item', weight: 0.95, origin: 'authored' }],
      },
    });

    let menuOpen = false;
    const tapped: string[] = [];
    const driver: UiDriver = {
      platform: 'web', device: 'mock-web',
      start: async () => {}, stop: async () => {}, launch: async () => {},
      find: async (candidate) => {
        if (candidate.value === 'remove-item') {
          return menuOpen ? handle(candidate, 'Xoá khỏi danh mục') : null;
        }
        if (candidate.strategy === 'relative') return handle(candidate);
        return null;
      },
      tap: async (target) => {
        tapped.push(target.candidate.value);
        // The strongest metadata candidate is deliberately inert in this test.
        // The second contextual candidate is the one that actually opens menu.
        if (
          target.candidate.strategy === 'relative' &&
          target.candidate.value.endsWith(':accessible')
        ) menuOpen = true;
      },
      longPress: async () => {}, input: async () => {}, clear: async () => {},
      selectOption: async () => {}, scrollIntoView: async () => {},
      swipe: async () => {}, scroll: async () => {}, back: async () => {},
      screenshot: async () => '', isIdle: async () => true,
    };
    const resolver = new Resolver(driver, registry, {
      timeoutMs: 80, pollMs: 5, requireVisible: true, verifyHealedMatch: false,
    });
    const executor = new Executor(driver, resolver, {
      retries: 0,
      screenshotOnFailure: false,
      postconditionTimeoutMs: 30,
      actionHealingAttempts: 4,
    });

    const result = await executor.runScenario(scenario([
      {
        keyword: 'When', line: 1,
        text: 'I click "Icon ... tại dòng ADS"',
        intent: { kind: 'tap', element: 'board.rowMenu' },
      },
      {
        keyword: 'Then', line: 2,
        text: 'I wait for "Xoá khỏi danh mục"',
        intent: { kind: 'waitFor', element: 'board.remove' },
      },
    ]));

    assert.equal(result.verdict, 'passed');
    assert.equal(tapped.length, 2, 'the inert candidate must not be accepted as success');
    const stored = registry.candidates('board.rowMenu', 'web');
    assert.ok(stored.some((candidate) =>
      candidate.origin === 'healed' &&
      candidate.strategy === 'relative' &&
      candidate.value.endsWith(':accessible') &&
      candidate.approved === false,
    ), 'only the outcome-verified contextual locator is persisted');
    assert.ok(!stored.some((candidate) =>
      candidate.origin === 'healed' && candidate.value.endsWith(':metadata'),
    ), 'the false-positive locator is not persisted');
  });

  it('fails an ordinary click when its implied next state never appears', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-postcondition.json');
    registry.upsertElement({
      id: 'screen.open', label: 'Mở menu', screen: 'screen',
      candidates: { web: [{ strategy: 'testId', value: 'open', weight: 0.95, origin: 'authored' }] },
    });
    registry.upsertElement({
      id: 'screen.item', label: 'Menu item', screen: 'screen',
      candidates: { web: [{ strategy: 'testId', value: 'item', weight: 0.95, origin: 'authored' }] },
    });
    const driver: UiDriver = {
      platform: 'web', device: 'mock-web',
      start: async () => {}, stop: async () => {}, launch: async () => {},
      find: async (candidate) => candidate.value === 'open' ? handle(candidate) : null,
      tap: async () => {}, longPress: async () => {}, input: async () => {}, clear: async () => {},
      selectOption: async () => {}, scrollIntoView: async () => {},
      swipe: async () => {}, scroll: async () => {}, back: async () => {},
      screenshot: async () => '', isIdle: async () => true,
    };
    const resolver = new Resolver(driver, registry, {
      timeoutMs: 60, pollMs: 5, requireVisible: true, verifyHealedMatch: false,
    });
    const executor = new Executor(driver, resolver, {
      retries: 0, screenshotOnFailure: false, postconditionTimeoutMs: 25,
    });

    const result = await executor.runScenario(scenario([
      {
        keyword: 'When', line: 1, text: 'I tap "Mở menu"',
        intent: { kind: 'tap', element: 'screen.open' },
      },
      {
        keyword: 'Then', line: 2, text: 'I wait for "Menu item"',
        intent: { kind: 'waitFor', element: 'screen.item' },
      },
    ]));

    assert.equal(result.verdict, 'failed');
    assert.equal(result.runs[0]?.steps[0]?.status, 'failed');
    assert.match(
      result.runs[0]?.steps[0]?.error?.message ?? '',
      /không tạo đúng trạng thái/,
    );
    assert.equal(registry.raw.elements['screen.open']?.health, undefined,
      'a click without its expected outcome must not be recorded as successful');
  });

  it('accepts a selected period tab as proof of an equivalent business assertion', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-selected-period.json');
    registry.upsertElement({
      id: 'fund.price1m', label: 'Giá 1M', screen: 'fund',
      candidates: { web: [{ strategy: 'testId', value: 'period-1m', weight: 0.95, origin: 'authored' }] },
    });
    registry.upsertElement({
      id: 'fund.oneMonthTrend', label: 'Diễn biến giá trong vòng 1 tháng', screen: 'fund',
      candidates: {},
    });
    let selected = false;
    const driver: UiDriver = {
      platform: 'web', device: 'mock-web',
      start: async () => {}, stop: async () => {}, launch: async () => {},
      find: async (candidate) => candidate.value === 'period-1m'
        ? { ...handle(candidate, '1M'), selected: async () => selected }
        : null,
      tap: async () => { selected = true; }, longPress: async () => {}, input: async () => {},
      clear: async () => {}, selectOption: async () => {}, scrollIntoView: async () => {},
      swipe: async () => {}, scroll: async () => {}, back: async () => {},
      screenshot: async () => '', isIdle: async () => true,
    };
    const resolver = new Resolver(driver, registry, {
      timeoutMs: 50, pollMs: 5, requireVisible: true, verifyHealedMatch: false,
    });
    const executor = new Executor(driver, resolver, {
      retries: 0, screenshotOnFailure: false, postconditionTimeoutMs: 25,
    });

    const result = await executor.runScenario(scenario([
      {
        keyword: 'When', line: 1, text: 'I click "Giá 1M"',
        intent: { kind: 'tap', element: 'fund.price1m' },
      },
      {
        keyword: 'Then', line: 2, text: '"Diễn biến giá trong vòng 1 tháng" is visible',
        intent: { kind: 'assertVisible', element: 'fund.oneMonthTrend' },
      },
    ]));

    assert.equal(result.verdict, 'passed');
    assert.equal(result.runs[0]?.steps[0]?.status, 'passed');
    assert.equal(result.runs[0]?.steps[1]?.status, 'passed');
  });

  it('retries a locator failure with a fresh scenario attempt', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-locator-retry.json');
    registry.upsertElement({
      id: 'screen.target', label: 'Mục tiêu', screen: 'screen',
      candidates: { web: [{ strategy: 'testId', value: 'target', weight: 0.95, origin: 'authored' }] },
    });
    let scenarioAttempt = 0;
    const driver: UiDriver = {
      platform: 'web', device: 'mock-web',
      start: async () => {}, stop: async () => {}, launch: async () => {},
      beginScenario: async () => { scenarioAttempt += 1; },
      find: async (candidate) => scenarioAttempt >= 2 ? handle(candidate) : null,
      tap: async () => {}, longPress: async () => {}, input: async () => {}, clear: async () => {},
      selectOption: async () => {}, scrollIntoView: async () => {}, swipe: async () => {},
      scroll: async () => {}, back: async () => {}, screenshot: async () => '', isIdle: async () => true,
    };
    const resolver = new Resolver(driver, registry, {
      timeoutMs: 20, pollMs: 5, requireVisible: true, verifyHealedMatch: false,
    });
    const executor = new Executor(driver, resolver, { retries: 1, screenshotOnFailure: false });
    const result = await executor.runScenario(scenario([{
      keyword: 'Then', line: 1, text: 'Mục tiêu hiển thị',
      intent: { kind: 'assertVisible', element: 'screen.target' },
    }]));

    assert.equal(result.runs.length, 2);
    assert.equal(result.runs[0]?.steps[0]?.failureKind, 'locator');
    assert.equal(result.runs[1]?.status, 'passed');
    assert.equal(result.verdict, 'flaky');
  });

  it('does not retry a business assertion mismatch', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-assertion-retry.json');
    registry.upsertElement({
      id: 'screen.value', label: 'Giá trị', screen: 'screen',
      candidates: { web: [{ strategy: 'testId', value: 'value', weight: 0.95, origin: 'authored' }] },
    });
    let attempts = 0;
    const driver: UiDriver = {
      platform: 'web', device: 'mock-web',
      start: async () => {}, stop: async () => {}, launch: async () => {},
      beginScenario: async () => { attempts += 1; },
      find: async (candidate) => handle(candidate, 'Sai'),
      tap: async () => {}, longPress: async () => {}, input: async () => {}, clear: async () => {},
      selectOption: async () => {}, scrollIntoView: async () => {}, swipe: async () => {},
      scroll: async () => {}, back: async () => {}, screenshot: async () => '', isIdle: async () => true,
    };
    const resolver = new Resolver(driver, registry, {
      timeoutMs: 20, pollMs: 5, requireVisible: true, verifyHealedMatch: false,
    });
    const executor = new Executor(driver, resolver, { retries: 2, screenshotOnFailure: false });
    const result = await executor.runScenario(scenario([{
      keyword: 'Then', line: 1, text: 'Giá trị bằng Đúng',
      intent: { kind: 'assertText', element: 'screen.value', text: 'Đúng', mode: 'equals' },
    }]));

    assert.equal(attempts, 1);
    assert.equal(result.runs.length, 1);
    assert.equal(result.runs[0]?.steps[0]?.failureKind, 'assertion');
    assert.equal(result.verdict, 'failed');
  });
});


describe('Executor — a tap covered by its own result', () => {
  it('accepts the click when what it should produce is already on screen', async () => {
    // Clicking "..." opens the row menu, and the menu lands on top of the "..."
    // it came from. The driver's actionability retry then reports the click as
    // failed while the menu it opened is on screen carrying everything the next
    // step needs — the captured artifact showed exactly that. Dismissing the
    // overlay would close the step's own result and clicking another match
    // would act on a different row, so the outcome has to decide.
    const registry = await Registry.load('/dev/null/nonexistent-covered-tap.json');
    for (const [id, value] of [['p.more', 'more'], ['p.remove', 'remove']] as const) {
      registry.upsertElement({
        id, label: value, screen: 'p',
        candidates: { web: [{ strategy: 'testId', value, weight: 0.95, origin: 'authored' }] },
      });
    }

    let taps = 0;
    const driver: UiDriver = {
      platform: 'web', device: 'mock-web',
      start: async () => {}, stop: async () => {}, launch: async () => {},
      find: async (candidate) => handle(candidate),
      tap: async () => {
        taps += 1;
        throw new Error('locator.click: Timeout 5000ms exceeded. '
          + '<div class="cdk-overlay-container"> subtree intercepts pointer events');
      },
      longPress: async () => {}, input: async () => {}, clear: async () => {},
      selectOption: async () => {}, scrollIntoView: async () => {},
      swipe: async () => {}, scroll: async () => {}, back: async () => {},
      screenshot: async () => '', isIdle: async () => true,
    };
    const resolver = new Resolver(driver, registry, {
      timeoutMs: 100, pollMs: 5, requireVisible: true, verifyHealedMatch: false,
    });
    const executor = new Executor(driver, resolver, {
      retries: 0, screenshotOnFailure: false, postconditionTimeoutMs: 80, variables: {},
    });

    const result = await executor.runScenario(scenario([
      { keyword: 'When', text: 'I click "more"', line: 1, intent: { kind: 'tap', element: 'p.more' } },
      { keyword: 'Then', text: '"remove" is visible', line: 2, intent: { kind: 'assertVisible', element: 'p.remove' } },
    ]), []);

    assert.equal(result.verdict, 'passed');
    assert.equal(taps, 1, 'không bấm lại: cú bấm đầu đã trúng');
  });

  it('still fails when nothing the tap should produce appeared', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-covered-tap-2.json');
    for (const [id, value] of [['p.more', 'more'], ['p.remove', 'remove']] as const) {
      registry.upsertElement({
        id, label: value, screen: 'p',
        candidates: { web: [{ strategy: 'testId', value, weight: 0.95, origin: 'authored' }] },
      });
    }
    const driver: UiDriver = {
      platform: 'web', device: 'mock-web',
      start: async () => {}, stop: async () => {}, launch: async () => {},
      // Nothing resolves, so nothing can prove the click landed.
      find: async () => null,
      tap: async () => { throw new Error('locator.click: Timeout 5000ms exceeded.'); },
      longPress: async () => {}, input: async () => {}, clear: async () => {},
      selectOption: async () => {}, scrollIntoView: async () => {},
      swipe: async () => {}, scroll: async () => {}, back: async () => {},
      screenshot: async () => '', isIdle: async () => true,
    };
    const resolver = new Resolver(driver, registry, {
      timeoutMs: 60, pollMs: 5, requireVisible: true, verifyHealedMatch: false,
    });
    const executor = new Executor(driver, resolver, {
      retries: 0, screenshotOnFailure: false, postconditionTimeoutMs: 60, variables: {},
    });
    const result = await executor.runScenario(scenario([
      { keyword: 'When', text: 'I click "more"', line: 1, intent: { kind: 'tap', element: 'p.more' } },
      { keyword: 'Then', text: '"remove" is visible', line: 2, intent: { kind: 'assertVisible', element: 'p.remove' } },
    ]), []);
    assert.equal(result.verdict, 'failed', 'không có bằng chứng thì phải fail');
  });
});

describe('Executor — a list that is still settling', () => {
  it('waits for the row to arrive instead of counting once', async () => {
    // Adding a ticker and immediately asking how many rows carry it read 0 of
    // 30 while the row was on its way in. Waiting for a state, not retrying an
    // assertion: the loop ends the moment the condition holds.
    const registry = await Registry.load('/dev/null/nonexistent-settle.json');
    registry.upsertElement({
      id: 'p.rows', label: 'rows', screen: 'p',
      candidates: { web: [{ strategy: 'css', value: '.row', weight: 0.9, origin: 'authored' }] },
    });
    let reads = 0;
    const driver: UiDriver = {
      platform: 'web', device: 'mock-web',
      start: async () => {}, stop: async () => {}, launch: async () => {},
      find: async (candidate) => handle(candidate),
      // Empty at first, then the row appears — as a real list does.
      inspectMatches: async () => {
        reads += 1;
        return reads < 3
          ? { count: 30, texts: Array(30).fill('AAA'), focused: [] }
          : { count: 30, texts: ['VIC', ...Array(29).fill('AAA')], focused: [] };
      },
      tap: async () => {}, longPress: async () => {}, input: async () => {},
      clear: async () => {}, selectOption: async () => {}, scrollIntoView: async () => {},
      swipe: async () => {}, scroll: async () => {}, back: async () => {},
      screenshot: async () => '', isIdle: async () => true,
    };
    const resolver = new Resolver(driver, registry, {
      timeoutMs: 100, pollMs: 5, requireVisible: true, verifyHealedMatch: false,
    });
    const executor = new Executor(driver, resolver, {
      retries: 0, screenshotOnFailure: false, postconditionTimeoutMs: 80, variables: {},
    });
    const result = await executor.runScenario(scenario([{
      keyword: 'Then', text: '"rows" shows "VIC" exactly "1" times', line: 1,
      intent: {
        kind: 'assertCollection', element: 'p.rows',
        check: { kind: 'countMatching', text: 'VIC', operator: 'equals', value: 1 },
      },
    }]), []);
    assert.equal(result.verdict, 'passed');
    assert.ok(reads >= 3, 'phải đọc lại cho tới khi danh sách ổn định');
  });

  it('still fails a genuinely wrong assertion rather than waiting it out', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-settle-2.json');
    registry.upsertElement({
      id: 'p.rows', label: 'rows', screen: 'p',
      candidates: { web: [{ strategy: 'css', value: '.row', weight: 0.9, origin: 'authored' }] },
    });
    const driver: UiDriver = {
      platform: 'web', device: 'mock-web',
      start: async () => {}, stop: async () => {}, launch: async () => {},
      find: async (candidate) => handle(candidate),
      inspectMatches: async () => ({ count: 30, texts: Array(30).fill('AAA'), focused: [] }),
      tap: async () => {}, longPress: async () => {}, input: async () => {},
      clear: async () => {}, selectOption: async () => {}, scrollIntoView: async () => {},
      swipe: async () => {}, scroll: async () => {}, back: async () => {},
      screenshot: async () => '', isIdle: async () => true,
    };
    const resolver = new Resolver(driver, registry, {
      timeoutMs: 100, pollMs: 5, requireVisible: true, verifyHealedMatch: false,
    });
    const executor = new Executor(driver, resolver, {
      retries: 0, screenshotOnFailure: false, postconditionTimeoutMs: 80, variables: {},
    });
    const result = await executor.runScenario(scenario([{
      keyword: 'Then', text: '"rows" shows "VIC" exactly "1" times', line: 1,
      intent: {
        kind: 'assertCollection', element: 'p.rows',
        check: { kind: 'countMatching', text: 'VIC', operator: 'equals', value: 1 },
      },
    }]), []);
    assert.equal(result.verdict, 'failed', 'sai thật thì vẫn phải sai');
  });
});
