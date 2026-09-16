import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { LocatorCandidate, ScenarioSpec } from '../../core/types.js';
import { Registry } from '../../core/registry.js';
import type { UiDriver, UiHandle } from '../../drivers/driver.js';
import { Resolver } from '../resolver.js';
import { Executor } from '../executor.js';
import type { ElementDiscovery } from '../../discovery/ElementDiscovery.js';
import type { SemanticElementDiscovery } from '../../discovery/ai/SemanticElementDiscovery.js';
import { VisionElementDiscovery } from '../../discovery/ai/VisionElementDiscovery.js';
import { RuntimeRegistry } from '../../discovery/RuntimeRegistry.js';
import type { UiObservation } from '../../discovery/UiObservation.js';

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
  it('persists a Vision locator only after the next step proves the action outcome', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-vision-outcome.json');
    registry.upsertElement({
      id: 'row.menu', label: 'Menu thao tác của dòng VIX', screen: 'board',
      candidates: { web: [{ strategy: 'testId', value: 'stale-menu', weight: 0.95, origin: 'authored' }] },
    });
    registry.upsertElement({
      id: 'row.menuPanel', label: 'Menu thao tác', screen: 'board',
      candidates: { web: [{ strategy: 'testId', value: 'menu-panel', weight: 0.95, origin: 'authored' }] },
    });
    const observation: UiObservation = {
      id: 'vision-action-screen', timestamp: new Date().toISOString(),
      platform: 'web', source: 'browser', context: {},
      elements: [{
        id: 'visual-menu', role: 'button', text: '⋯', testId: 'vision-menu',
        visible: true, enabled: true, interactive: true,
      }],
    };
    const runtime = await RuntimeRegistry.load('/dev/null/nonexistent-vision-outcome-runtime.json');
    let menuOpen = false;
    const driver: UiDriver = {
      platform: 'web', device: 'mock-web',
      start: async () => {}, stop: async () => {}, launch: async () => {},
      find: async (candidate) => {
        if (candidate.value === 'vision-menu') return handle(candidate, '⋯');
        if (candidate.value === 'menu-panel' && menuOpen) return handle(candidate, 'Menu thao tác');
        return null;
      },
      tap: async (target) => { if (target.candidate.value === 'vision-menu') menuOpen = true; },
      longPress: async () => {}, input: async () => {}, clear: async () => {},
      selectOption: async () => {}, scrollIntoView: async () => {}, swipe: async () => {},
      scroll: async () => {}, back: async () => {}, screenshot: async () => '',
      isIdle: async () => true,
    };
    const deterministic = {
      discover: async () => ({
        intent: { id: 'row.menu', action: 'tap' as const }, method: 'failed' as const,
        observation, evidence: ['forced deterministic miss'],
      }),
      confirmLocator: () => {},
    } as unknown as ElementDiscovery;
    const semantic = {
      discover: async () => ({
        intent: { id: 'row.menu', action: 'tap' as const }, method: 'failed' as const,
        observation, evidence: ['forced semantic miss'],
      }),
    } as unknown as SemanticElementDiscovery;
    const vision = new VisionElementDiscovery({
      findElementInScreenshot: async () => ({
        candidates: [{
          observedElementId: 'visual-menu', visualText: 'Menu thao tác của dòng VIX',
          confidence: 95, reasoning: 'Visible row action menu in the screenshot.',
        }],
      }),
    }, runtime);
    const resolver = new Resolver(
      driver, registry,
      { timeoutMs: 150, pollMs: 5, requireVisible: true, verifyHealedMatch: false },
      deterministic, semantic, 45, vision,
      { screenshot: async () => 'cG5n' },
    );
    const executor = new Executor(driver, resolver, {
      retries: 0, screenshotOnFailure: false, postconditionTimeoutMs: 80,
    });

    assert.equal(
      registry.candidates('row.menu', 'web').some((candidate) => candidate.value === 'vision-menu'),
      false,
      'Vision proposal must not be stored before execution',
    );
    const result = await executor.runScenario(scenario([
      {
        keyword: 'When', line: 1, text: 'I click "Menu thao tác của dòng VIX"',
        intent: { kind: 'tap', element: 'row.menu' },
      },
      {
        keyword: 'Then', line: 2, text: '"Menu thao tác" is visible',
        intent: { kind: 'assertVisible', element: 'row.menuPanel' },
      },
    ]));

    assert.equal(result.verdict, 'passed');
    assert.equal(menuOpen, true);
    assert.equal(
      registry.candidates('row.menu', 'web').some((candidate) => candidate.value === 'vision-menu'),
      true,
      'only the proven Vision locator should be learned',
    );
  });

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
          ...handle(candidate, value === 'first-result' ? query : value),
          value: async () => values.get(value) ?? '',
        };
      },
      tap: async (target) => {
        if (target.candidate.value === 'submit') loggedIn = true;
        // Clicking the first search result is what opens the feature — the
        // step no longer clicks an element found by the query text, because on
        // the real app that phrase appears in seven places outside the result
        // list and the wrong one won.
        if (target.candidate.value === query && target.candidate.runtimeScope === '.searched-feature-block') {
          opened = true;
        }
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

  it('does not accept an unrelated route change without destination evidence', async () => {
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
        return handle(candidate, candidate.value === 'first-result' ? query : candidate.value);
      },
      tap: async (target) => {
        // The route changes when the first search result is clicked; see the
        // note in the flow above for why the step no longer clicks by text.
        if (target.candidate.value === query && target.candidate.runtimeScope === '.searched-feature-block') {
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

    assert.equal(result.runs[0]?.steps[0]?.status, 'failed');
    assert.equal(result.runs[0]?.steps[1]?.status, 'skipped');
    assert.equal(url, 'https://example.test/tc-price?table=1');
  });

  it('accepts a same-route feature dialog by title and lets its selector-less first action reach discovery', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-same-route-title.json');
    registry.raw.screens.myReports = {
      id: 'myReports',
      title: 'Báo cáo của tôi',
      description: 'Dialog quản lý báo cáo được mount trên route Home.',
    };
    for (const [id, label, value] of [
      ['home.searchBox', 'Nút tìm kiếm', 'search-box'],
      ['home.searchInput', 'Ô tìm kiếm', 'search-input'],
    ] as const) {
      registry.upsertElement({
        id, label, screen: 'home',
        candidates: { web: [{ strategy: 'testId', value, weight: 0.95, origin: 'authored' }] },
      });
    }
    registry.upsertElement({
      id: 'myReports.addReportButton', label: 'Nút thêm mới báo cáo', screen: 'myReports',
      candidates: {},
    });

    let query = '';
    let searchOpen = false;
    let resultTaps = 0;
    let discoveryCalls = 0;
    const driver: UiDriver = {
      // The interaction surface is a WebView, but the run platform is Android.
      // The same-route search guard must therefore follow driver capability,
      // not the top-level platform label.
      platform: 'web', runPlatform: 'android', device: 'mock-web',
      start: async () => {}, stop: async () => {}, launch: async () => {},
      // Report management is a CDK dialog; opening it deliberately keeps /home.
      currentUrl: async () => 'https://example.test/home',
      find: async (candidate) => {
        if (candidate.value === 'search-box') return handle(candidate, 'Tìm kiếm');
        if (candidate.value === 'search-input') {
          return searchOpen ? handle(candidate, query) : null;
        }
        if (candidate.runtimeScope === '.searched-feature-block') {
          return searchOpen && candidate.value === query
            ? handle(candidate, query)
            : null;
        }
        if (candidate.strategy === 'xpath' && candidate.value.includes("normalize-space(.)='Báo cáo của tôi'")) {
          // Simulate the SPA's off-screen toolbox copy. The pre-navigation
          // gate must not let this mounted text skip the actual search click.
          return handle(candidate, 'Báo cáo của tôi');
        }
        return null;
      },
      tap: async (target) => {
        if (target.candidate.value === 'search-box') searchOpen = true;
        if (target.candidate.runtimeScope === '.searched-feature-block') {
          resultTaps += 1;
          searchOpen = false;
        }
      },
      input: async (_target, text) => { query = text; },
      longPress: async () => {}, clear: async () => {}, selectOption: async () => {},
      scrollIntoView: async () => {}, swipe: async () => {}, scroll: async () => {},
      back: async () => {}, screenshot: async () => '', isIdle: async () => true,
    };
    const discovery = {
      discover: async () => {
        discoveryCalls += 1;
        return {
          intent: { id: 'myReports.addReportButton', action: 'tap' as const },
          method: 'failed' as const,
          observation: {
            id: 'empty', timestamp: new Date().toISOString(), platform: 'web' as const,
            source: 'browser' as const, context: {}, elements: [],
          },
          evidence: ['test intentionally stops after proving discovery was reached'],
        };
      },
    } as unknown as ElementDiscovery;
    const resolver = new Resolver(driver, registry, {
      timeoutMs: 80, pollMs: 5, requireVisible: true, verifyHealedMatch: false,
    }, discovery);
    const executor = new Executor(driver, resolver, {
      retries: 0, screenshotOnFailure: false, postconditionTimeoutMs: 80,
    });

    const result = await executor.runScenario(scenario([{
      keyword: 'When', line: 1, text: 'I open feature "Báo cáo của tôi" from search',
      intent: { kind: 'openFeatureFromSearch', query: 'Báo cáo của tôi' },
    }, {
      keyword: 'When', line: 2, text: 'I click "Nút thêm mới báo cáo"',
      intent: { kind: 'tap', element: 'myReports.addReportButton' },
    }]));

    assert.equal(result.runs[0]?.steps[0]?.status, 'passed');
    assert.equal(result.runs[0]?.steps[1]?.status, 'failed');
    assert.equal(resultTaps, 1, 'đã vào dialog thì không được tìm kiếm lần hai');
    assert.ok(discoveryCalls > 0, 'action mới phải được đi vào discovery thay vì bị cổng điều hướng chặn');
  });

  it('recognises an already-open feature by a stable screen landmark', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-open-landmark.json');
    registry.upsertElement({
      id: 'priceBoard.categoryDropdown', label: 'Danh mục theo dõi', screen: 'priceBoard',
      candidates: {},
    });
    registry.upsertElement({
      id: 'priceBoard.addStockButton', label: 'Thêm mã', screen: 'priceBoard',
      candidates: { web: [{ strategy: 'testId', value: 'add-stock', weight: 0.9, origin: 'authored' }] },
      health: { resolutions: 10, heals: 0, winners: {} },
    });
    registry.upsertElement({
      id: 'home.searchBox', label: 'Nút tìm kiếm', screen: 'home',
      candidates: { web: [{ strategy: 'testId', value: 'search', weight: 0.9, origin: 'authored' }] },
    });
    let taps = 0;
    const driver: UiDriver = {
      platform: 'web', device: 'mock-web',
      start: async () => {}, stop: async () => {}, launch: async () => {},
      currentUrl: async () => 'https://example.test/tc-price?table=1',
      find: async (candidate) => candidate.value === 'add-stock' ? handle(candidate) : null,
      tap: async () => { taps += 1; }, longPress: async () => {}, input: async () => {},
      clear: async () => {}, selectOption: async () => {}, scrollIntoView: async () => {},
      swipe: async () => {}, scroll: async () => {}, back: async () => {},
      screenshot: async () => '', isIdle: async () => true,
    };
    const resolver = new Resolver(driver, registry, {
      timeoutMs: 50, pollMs: 5, requireVisible: true, verifyHealedMatch: false,
    });
    const executor = new Executor(driver, resolver, {
      retries: 0, screenshotOnFailure: false, postconditionTimeoutMs: 50,
    });
    const result = await executor.runScenario(scenario([{
      keyword: 'Given', line: 1, text: 'I open feature "Bảng giá cổ phiếu" from search',
      intent: { kind: 'openFeatureFromSearch', query: 'Bảng giá cổ phiếu' },
    }, {
      keyword: 'Then', line: 2, text: 'category is Following Cate',
      intent: { kind: 'assertText', element: 'priceBoard.categoryDropdown', text: 'Following Cate', mode: 'contains' },
    }]), []);

    assert.equal(result.runs[0]!.steps[0]!.status, 'passed');
    assert.equal(taps, 0, 'đã ở đúng feature thì không được bấm search ẩn');
  });

  it('does not mistake a feature landmark inside a Home widget for an open feature', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-home-widget-landmark.json');
    for (const [id, label, screen, value] of [
      ['home.searchBox', 'Nút tìm kiếm', 'home', 'search-box'],
      ['home.searchInput', 'Ô tìm kiếm', 'home', 'search-input'],
      ['priceBoard.marketTab', 'Cơ sở', 'priceBoard', 'basis-tab'],
      ['priceBoard.categoryDropdown', 'Danh mục theo dõi', 'priceBoard', 'category'],
    ] as const) {
      registry.upsertElement({
        id, label, screen,
        candidates: { web: [{ strategy: 'testId', value, weight: 0.9, origin: 'authored' }] },
        ...(id === 'priceBoard.marketTab' ? { health: { resolutions: 50, heals: 0, winners: {} } } : {}),
      });
    }
    registry.upsertElement({
      id: 'home.dynamicText', label: '{{text}}', screen: 'home', template: { kind: 'text' },
      candidates: { web: [{ strategy: 'label', value: '{{text}}', weight: 0.9, origin: 'authored' }] },
    });

    let url = 'https://example.test/home';
    let query = '';
    let resultTapped = 0;
    const driver: UiDriver = {
      platform: 'web', device: 'mock-web',
      start: async () => {}, stop: async () => {}, launch: async () => {},
      currentUrl: async () => url,
      find: async (candidate) => {
        // Home genuinely contains the same "Cơ sở" tab in a compact widget.
        if (candidate.value === 'basis-tab') return handle(candidate, 'Cơ sở');
        if (candidate.value === 'category' && url.endsWith('/home')) return null;
        if (candidate.value === query && candidate.runtimeScope === '.searched-feature-block') {
          return query ? handle(candidate, query) : null;
        }
        return handle(candidate, candidate.value);
      },
      tap: async (target) => {
        if (target.candidate.value === query && target.candidate.runtimeScope === '.searched-feature-block') {
          resultTapped += 1;
          url = 'https://example.test/tc-price?table=1';
        }
      },
      input: async (_target, text) => { query = text; },
      longPress: async () => {}, clear: async () => {}, selectOption: async () => {},
      scrollIntoView: async () => {}, swipe: async () => {}, scroll: async () => {}, back: async () => {},
      screenshot: async () => '', isIdle: async () => true,
    };
    const resolver = new Resolver(driver, registry, {
      timeoutMs: 50, pollMs: 5, requireVisible: true, verifyHealedMatch: false,
    });
    const executor = new Executor(driver, resolver, {
      retries: 0, screenshotOnFailure: false, postconditionTimeoutMs: 50,
    });
    const result = await executor.runScenario(scenario([{
      keyword: 'Given', line: 1, text: 'I open feature "Bảng giá cổ phiếu" from search',
      intent: { kind: 'openFeatureFromSearch', query: 'Bảng giá cổ phiếu' },
    }, {
      keyword: 'Then', line: 2, text: 'category is visible',
      intent: { kind: 'assertVisible', element: 'priceBoard.categoryDropdown' },
    }]));

    assert.equal(result.verdict, 'passed');
    assert.equal(resultTapped, 1, 'landmark trùng trên Home không được bỏ qua điều hướng');
    assert.equal(url, 'https://example.test/tc-price?table=1');
  });

  it('waits through a stale first result and clicks only the exact feature title', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-stale-search.json');
    for (const [id, value] of [
      ['home.searchBox', 'search-box'],
      ['home.searchInput', 'search-input'],
      ['home.searchFirstResult', 'first-result'],
      ['transfer.sourceAccount', 'source-account'],
    ] as const) {
      registry.upsertElement({
        id, label: value, screen: id.split('.')[0]!,
        candidates: { web: [{ strategy: 'testId', value, weight: 0.95, origin: 'authored' }] },
      });
    }

    let query = '';
    let resultReads = 0;
    const clicked: string[] = [];
    let opened = false;
    const driver: UiDriver = {
      platform: 'web', device: 'mock-web',
      start: async () => {}, stop: async () => {}, launch: async () => {},
      currentUrl: async () => opened ? 'https://example.test/transfer' : 'https://example.test/home',
      find: async (candidate) => {
        if (candidate.value === 'source-account' && !opened) return null;
        if (candidate.value === query && candidate.runtimeScope === '.searched-feature-block') {
          if (!query) return null;
          resultReads += 1;
          return handle(candidate, query);
        }
        return handle(candidate, candidate.value);
      },
      tap: async (target) => {
        const title = await target.text();
        clicked.push(title);
        if (target.candidate.value === query
          && target.candidate.runtimeScope === '.searched-feature-block'
          && title === query) opened = true;
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
      retries: 0, screenshotOnFailure: false, postconditionTimeoutMs: 500,
    });

    const result = await executor.runScenario(scenario([
      {
        keyword: 'When', line: 1, text: 'I open feature "Chuyển tiền" from search',
        intent: { kind: 'openFeatureFromSearch', query: 'Chuyển tiền' },
      },
      {
        keyword: 'When', line: 2, text: 'I select a source account',
        intent: { kind: 'tap', element: 'transfer.sourceAccount' },
      },
    ]));

    assert.equal(result.runs[0]?.steps[0]?.status, 'passed');
    assert.ok(resultReads >= 1);
    assert.deepEqual(clicked.filter((text) => text.includes('Bỏ phiếu')), []);
    assert.ok(clicked.includes('Chuyển tiền'));
  });

  it('returns to visible Home before retrying a wrong destination', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-search-retry.json');
    for (const [id, value] of [
      ['home.searchBox', 'search-box'],
      ['home.searchInput', 'search-input'],
      ['home.searchFirstResult', 'first-result'],
      ['transfer.sourceAccount', 'source-account'],
    ] as const) {
      registry.upsertElement({
        id, label: value, screen: id.split('.')[0]!,
        candidates: { web: [{ strategy: 'testId', value, weight: 0.95, origin: 'authored' }] },
      });
    }

    let url = 'https://example.test/home';
    let query = '';
    let searchClicks = 0;
    let backs = 0;
    const driver: UiDriver = {
      platform: 'web', device: 'mock-web',
      start: async () => {}, stop: async () => {}, launch: async () => {}, currentUrl: async () => url,
      find: async (candidate) => {
        const onHome = url.endsWith('/home');
        if (candidate.value.startsWith('search-')
          || candidate.runtimeScope === '.searched-feature-block') {
          if (!onHome) return null;
        }
        if (candidate.value === 'first-result' && !query) return null;
        if (candidate.value === 'source-account' && !url.endsWith('/transfer')) return null;
        return handle(candidate, candidate.value === 'first-result' ? query : candidate.value);
      },
      tap: async (target) => {
        if (target.candidate.value !== query
          || target.candidate.runtimeScope !== '.searched-feature-block') return;
        searchClicks += 1;
        url = searchClicks === 1
          ? 'https://example.test/evoting'
          : 'https://example.test/transfer';
      },
      input: async (_target, text) => { query = text; },
      back: async () => { backs += 1; url = 'https://example.test/home'; },
      longPress: async () => {}, clear: async () => {}, selectOption: async () => {},
      scrollIntoView: async () => {}, swipe: async () => {}, scroll: async () => {},
      screenshot: async () => '', isIdle: async () => true,
    };
    const resolver = new Resolver(driver, registry, {
      timeoutMs: 40, pollMs: 5, requireVisible: true, verifyHealedMatch: false,
    });
    const executor = new Executor(driver, resolver, {
      retries: 0, screenshotOnFailure: false, postconditionTimeoutMs: 40,
    });

    const result = await executor.runScenario(scenario([
      {
        keyword: 'When', line: 1, text: 'I open feature "Chuyển tiền" from search',
        intent: { kind: 'openFeatureFromSearch', query: 'Chuyển tiền' },
      },
      {
        keyword: 'When', line: 2, text: 'I select a source account',
        intent: { kind: 'tap', element: 'transfer.sourceAccount' },
      },
    ]));

    assert.equal(result.runs[0]?.steps[0]?.status, 'passed');
    assert.equal(searchClicks, 2);
    assert.equal(backs, 1);
    assert.equal(url, 'https://example.test/transfer');
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
  it('uses a later focus assertion to prove an idempotent selection tap', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-focus-proof.json');
    for (const [id, value] of [['p.result', 'result'], ['p.rows', 'rows']] as const) {
      registry.upsertElement({
        id, label: value, screen: 'p',
        candidates: { web: [{ strategy: 'testId', value, weight: 0.9, origin: 'authored' }] },
      });
    }
    let selected = false;
    const driver: UiDriver = {
      platform: 'web', device: 'mock-web',
      start: async () => {}, stop: async () => {}, launch: async () => {},
      find: async (candidate) => handle(candidate),
      inspectMatches: async (candidate) => candidate.value === 'rows'
        ? { count: 2, texts: ['VIC', 'TCB'], focused: selected ? [0] : [] }
        : { count: 1, texts: ['VIC'], focused: [] },
      tap: async () => { selected = true; }, longPress: async () => {}, input: async () => {},
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
    const result = await executor.runScenario(scenario([
      { keyword: 'When', line: 1, text: 'I click result', intent: { kind: 'tap', element: 'p.result' } },
      {
        keyword: 'Then', line: 2, text: 'rows show VIC once',
        intent: { kind: 'assertCollection', element: 'p.rows', check: {
          kind: 'countMatching', text: 'VIC', operator: 'equals', value: 1,
        } },
      },
      {
        keyword: 'And', line: 3, text: 'row is focused',
        intent: { kind: 'assertCollection', element: 'p.rows', check: { kind: 'focused' } },
      },
    ]), []);
    assert.equal(result.verdict, 'passed');
    assert.deepEqual(result.runs[0]!.steps.map((step) => step.status), ['passed', 'passed', 'passed']);
  });

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

describe('Executor — numerical assertion proves the preceding tap', () => {
  async function runDelta(changesBalance: boolean, tapFails = false) {
    const registry = await Registry.load('/dev/null/nonexistent-deferred-delta.json');
    for (const [id, label, value] of [
      ['transfer.confirm', 'Nút XÁC NHẬN', 'confirm'],
      ['transfer.balance', 'Được chuyển', 'balance'],
    ] as const) {
      registry.upsertElement({
        id, label, screen: 'transfer',
        candidates: { web: [{ strategy: 'testId', value, weight: 0.95, origin: 'authored' }] },
      });
    }

    let balance = 23_329;
    const driver: UiDriver = {
      platform: 'web', device: 'mock-web',
      start: async () => {}, stop: async () => {}, launch: async () => {},
      find: async (candidate) => handle(
        candidate,
        candidate.value === 'balance' ? balance.toLocaleString('en-US') : candidate.value,
      ),
      tap: async (target) => {
        if (target.candidate.value === 'confirm' && tapFails) throw new Error('driver click failed');
        if (target.candidate.value === 'confirm' && changesBalance) balance -= 1_000;
      },
      longPress: async () => {}, input: async () => {}, clear: async () => {},
      selectOption: async () => {}, scrollIntoView: async () => {}, swipe: async () => {},
      scroll: async () => {}, back: async () => {}, screenshot: async () => '',
      isIdle: async () => true,
    };
    const resolver = new Resolver(driver, registry, {
      timeoutMs: 100, pollMs: 5, requireVisible: true, verifyHealedMatch: false,
    });
    const executor = new Executor(driver, resolver, {
      retries: 0, screenshotOnFailure: false, postconditionTimeoutMs: 80,
    });
    return executor.runStepsWithoutTeardown([
      {
        keyword: 'And', line: 84, text: 'I remember "Được chuyển" as "trước"',
        intent: { kind: 'rememberNumber', element: 'transfer.balance', as: 'trước' },
      },
      {
        keyword: 'And', line: 87, text: 'I click "Nút XÁC NHẬN"',
        intent: { kind: 'tap', element: 'transfer.confirm' },
      },
      {
        keyword: 'Then', line: 88, text: '"Được chuyển" decreased by "1000" from "trước"',
        intent: {
          kind: 'assertNumberDelta', element: 'transfer.balance', as: 'trước',
          direction: 'decreased', by: 1_000,
        },
      },
    ]);
  }

  it('nâng tap thành passed khi delta ngay sau đó khớp', async () => {
    const steps = await runDelta(true);
    assert.deepEqual(steps.map((step) => step.status), ['passed', 'passed', 'passed']);
  });

  it('giữ tap là unverified khi delta không khớp', async () => {
    const steps = await runDelta(false);
    assert.deepEqual(steps.map((step) => step.status), ['passed', 'unverified', 'failed']);
  });

  it('không dùng visibility của số dư để nuốt lỗi click thật', async () => {
    const steps = await runDelta(false, true);
    assert.deepEqual(steps.map((step) => step.status), ['passed', 'failed', 'skipped']);
    assert.match(steps[1]?.error?.message ?? '', /driver click failed/);
  });
});
