/**
 * Tests for Resolver + ElementDiscovery wiring.
 *
 * These tests verify that the discovery pipeline is invoked as a fallback when
 * all registry candidates fail, and that the discovered locator is prepended to
 * the candidate list so the next tick can try it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Resolver, ElementNotFoundError } from '../resolver.js';
import { Registry } from '../../core/registry.js';
import { RuntimeRegistry } from '../../discovery/RuntimeRegistry.js';
import { ElementDiscovery } from '../../discovery/ElementDiscovery.js';
import { AppiumMcpElementDiscovery } from '../../discovery/mcp/AppiumMcpElementDiscovery.js';
import type { McpClient } from '../../discovery/ai/AiDiscoveryTypes.js';
import type { UiDriver, UiHandle } from '../../drivers/driver.js';
import type { LocatorCandidate } from '../../core/types.js';
import type { UiObservation } from '../../discovery/UiObservation.js';
import type { ObservationProvider } from '../../discovery/ElementDiscovery.js';

// ── test helpers ──────────────────────────────────────────────────────────────

function makeHandle(candidate: LocatorCandidate): UiHandle {
  return {
    candidate,
    isVisible: async () => true,
    text: async () => 'Login',
  };
}

/**
 * Minimal UiDriver mock.
 * findFn returns a handle for candidates it "knows about", null for all others.
 */
function makeDriver(
  findFn: (c: LocatorCandidate) => Promise<UiHandle | null> = async () => null,
): UiDriver {
  return {
    platform: 'android',
    device: 'test-device',
    start: async () => {},
    stop: async () => {},
    launch: async () => {},
    find: findFn,
    tap: async () => {},
    longPress: async () => {},
    input: async () => {},
    clear: async () => {},
    selectOption: async () => {},
    scrollIntoView: async () => {},
    swipe: async () => {},
    scroll: async () => {},
    back: async () => {},
    screenshot: async () => '',
    isIdle: async () => true,
  } as unknown as UiDriver;
}

/** Registry pre-seeded with one element that has a single android candidate. */
async function makeRegistry(
  elementId: string,
  candidate: LocatorCandidate,
): Promise<Registry> {
  const reg = await Registry.load('/dev/null/nonexistent-registry.json');
  reg.upsertElement({
    id: elementId,
    label: 'Login',
    screen: 'LoginScreen',
    candidates: { android: [candidate] },
  });
  return reg;
}

/** A UiObservation with one matching element. */
function makeObservation(testId: string): UiObservation {
  return {
    id: 'obs-test',
    timestamp: new Date().toISOString(),
    platform: 'android',
    source: 'native',
    context: {},
    elements: [
      {
        id: 'el-0',
        role: 'android.widget.Button',
        text: 'Login',
        accessibilityLabel: 'Login',
        testId,
        visible: true,
        enabled: true,
        interactive: true,
        index: 0,
      },
    ],
  };
}

async function makeDiscovery(
  provider: ObservationProvider,
): Promise<ElementDiscovery> {
  const runtimeReg = await RuntimeRegistry.load('/dev/null/nonexistent-runtime.json');
  return new ElementDiscovery(provider, runtimeReg);
}

// ── resolver without discovery (baseline) ────────────────────────────────────

describe('Resolver — baseline (no discovery)', () => {
  it('resolves immediately when candidate matches', async () => {
    const staleCandidate: LocatorCandidate = {
      strategy: 'testId', value: 'btn-login', weight: 0.95, origin: 'authored',
    };
    const driver = makeDriver(async (c) =>
      c.value === 'btn-login' ? makeHandle(c) : null,
    );
    const reg = await makeRegistry('login-btn', staleCandidate);
    const resolver = new Resolver(driver, reg, {
      timeoutMs: 500, pollMs: 50, requireVisible: true, verifyHealedMatch: false,
    });

    const result = await resolver.resolve('login-btn');
    assert.equal(result.healed, false);
    assert.equal(result.candidate.value, 'btn-login');
  });

  it('does not persist or runtime-confirm a fragile healed XPath', async () => {
    const authored: LocatorCandidate = {
      strategy: 'label', value: 'Icon ... tại dòng ADS', weight: 0.8, origin: 'authored',
    };
    const reg = await makeRegistry('priceBoard.iconTaiDongAds', authored);
    let confirms = 0;
    const discovery = {
      confirmLocator: () => { confirms += 1; },
    } as unknown as ElementDiscovery;
    const resolver = new Resolver(makeDriver(), reg, {
      timeoutMs: 500, pollMs: 50, requireVisible: true, verifyHealedMatch: false,
    }, discovery);
    const fragile: LocatorCandidate = {
      strategy: 'xpath',
      value: `((//*[not(*) and normalize-space(.)='ADS'])[1]/ancestor::*[` +
        `contains(concat(' ', normalize-space(@class), ' '), ' content-row ')][1]` +
        `//*[contains(translate(concat(@data-walkthrough,' ',@class),` +
        `'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'more')])[1]`,
      weight: 0.98,
      origin: 'healed',
    };

    resolver.confirmResolution('priceBoard.iconTaiDongAds', {
      handle: makeHandle(fragile),
      candidate: fragile,
      healed: true,
      previous: authored,
      attempts: 1,
    });

    assert.deepEqual(reg.candidates('priceBoard.iconTaiDongAds', 'android'), [authored]);
    assert.equal(confirms, 0);
  });

  it('instantiates one row-action template for different runtime row values', async () => {
    const template: LocatorCandidate = {
      strategy: 'relative',
      value: 'row("{{rowText}}") >> "...":metadata',
      weight: 0.95,
      origin: 'authored',
    };
    const reg = await makeRegistry('priceBoard.rowActionMenu', template);
    const seen: string[] = [];
    const driver = makeDriver(async (candidate) => {
      seen.push(candidate.value);
      return makeHandle(candidate);
    });
    const resolver = new Resolver(driver, reg, {
      timeoutMs: 500, pollMs: 50, requireVisible: true, verifyHealedMatch: false,
    });

    const ads = await resolver.resolve('priceBoard.rowActionMenu', {
      locatorParams: { rowText: 'ADS', action: '...' },
    });
    const fpt = await resolver.resolve('priceBoard.rowActionMenu', {
      locatorParams: { rowText: 'FPT', action: '...' },
    });

    assert.equal(ads.candidate.value, 'row("ADS") >> "...":metadata');
    assert.equal(fpt.candidate.value, 'row("FPT") >> "...":metadata');
    assert.deepEqual(seen, [
      'row("ADS") >> "...":metadata',
      'row("FPT") >> "...":metadata',
    ]);
    resolver.confirmResolution('priceBoard.rowActionMenu', ads);
    resolver.confirmResolution('priceBoard.rowActionMenu', fpt);
    const health = reg.raw.elements['priceBoard.rowActionMenu']?.health;
    assert.equal(health?.heals, 0);
    assert.equal(
      health?.winners[
        'relative:row("{{rowText}}") >> "...":metadata'
      ],
      2,
    );
  });

  it('reuses one text template for visible and absent checks with different values', async () => {
    const template: LocatorCandidate = {
      strategy: 'label', value: '{{text}}', weight: 0.9, origin: 'authored',
    };
    let visible = new Set(['ADS', 'FPT']);
    const reg = await makeRegistry('priceBoard.dynamicText', template);
    reg.element('priceBoard.dynamicText').label = '{{text}}';
    reg.element('priceBoard.dynamicText').template = { kind: 'text' };
    const driver = makeDriver(async (candidate) =>
      visible.has(candidate.value) ? makeHandle(candidate) : null,
    );
    const resolver = new Resolver(driver, reg, {
      timeoutMs: 100, pollMs: 10, requireVisible: true, verifyHealedMatch: false,
    });

    const ads = await resolver.resolve('priceBoard.dynamicText', {
      locatorParams: { text: 'ADS' },
    });
    const fpt = await resolver.resolve('priceBoard.dynamicText', {
      locatorParams: { text: 'FPT' },
    });
    assert.equal(ads.candidate.value, 'ADS');
    assert.equal(fpt.candidate.value, 'FPT');

    visible = new Set(['FPT']);
    await resolver.resolveAbsent('priceBoard.dynamicText', {
      locatorParams: { text: 'ADS' },
    });
    assert.equal(await resolver.isVisibleNow('priceBoard.dynamicText', {
      locatorParams: { text: 'FPT' },
    }), true);
  });

  it('throws ElementNotFoundError when all candidates fail', async () => {
    const stale: LocatorCandidate = {
      strategy: 'testId', value: 'old-id', weight: 0.95, origin: 'authored',
    };
    const driver = makeDriver(async () => null);
    const reg = await makeRegistry('login-btn', stale);
    const resolver = new Resolver(driver, reg, {
      timeoutMs: 100, pollMs: 50, requireVisible: true, verifyHealedMatch: false,
    });

    await assert.rejects(
      () => resolver.resolve('login-btn'),
      (err: Error) => err instanceof ElementNotFoundError,
    );
  });

  it('accepts a previously verified healed locator when it is now the primary candidate', async () => {
    const persisted: LocatorCandidate = {
      strategy: 'css',
      value: ".mat-autocomplete-panel mat-option[role='option']",
      weight: 0.95,
      origin: 'healed',
    };
    const driver = makeDriver(async (candidate) =>
      candidate.value === persisted.value
        ? {
            candidate,
            isVisible: async () => true,
            // The registry label is "Kết quả tìm kiếm đầu tiên". A real
            // autocomplete option has dynamic business text instead.
            text: async () => 'ADS-HOSE',
          }
        : null,
    );
    const reg = await makeRegistry('first-search-result', persisted);
    reg.element('first-search-result').label = 'Kết quả tìm kiếm đầu tiên';
    const resolver = new Resolver(driver, reg, {
      timeoutMs: 100,
      pollMs: 10,
      requireVisible: true,
      verifyHealedMatch: true,
    });

    const result = await resolver.resolve('first-search-result');

    assert.equal(result.candidate.value, persisted.value);
    assert.equal(result.healed, false, 'a persisted primary locator is no longer a fallback');
  });

  it('synthesizes a semantic label locator for a selector-less web element', async () => {
    const reg = await Registry.load('/dev/null/nonexistent-selectorless-web-registry.json');
    reg.upsertElement({
      id: 'priceBoard.removeFromWatchlist',
      label: 'Xoá khỏi danh mục',
      screen: 'priceBoard',
      candidates: {},
    });
    const driver = {
      ...makeDriver(async (candidate) =>
        candidate.strategy === 'label' && candidate.value === 'Xoá khỏi danh mục'
          ? { candidate, isVisible: async () => true, text: async () => 'Xóa khỏi danh mục' }
          : null,
      ),
      platform: 'web' as const,
    };
    const resolver = new Resolver(driver, reg, {
      timeoutMs: 100,
      pollMs: 10,
      requireVisible: true,
      verifyHealedMatch: true,
    });

    const result = await resolver.resolve('priceBoard.removeFromWatchlist');

    assert.equal(result.candidate.strategy, 'label');
    assert.equal(result.healed, true);
  });

  it('uses a cheap exact-leaf locator for a compact option in a business label', async () => {
    const reg = await Registry.load('/dev/null/nonexistent-compact-option-registry.json');
    reg.upsertElement({
      id: 'fund.price1m',
      label: 'Giá 1M',
      screen: 'fundDetail',
      candidates: {},
    });
    const expected = "//*[not(*) and normalize-space(.)='1M']";
    const driver = {
      ...makeDriver(async (candidate) =>
        candidate.strategy === 'xpath' && candidate.value === expected
          ? { candidate, isVisible: async () => true, text: async () => '1M' }
          : null,
      ),
      platform: 'web' as const,
    };
    const resolver = new Resolver(driver, reg, {
      timeoutMs: 100,
      pollMs: 10,
      requireVisible: true,
      verifyHealedMatch: true,
    });

    const result = await resolver.resolve('fund.price1m', { discoveryAction: 'tap' });

    assert.equal(result.candidate.strategy, 'xpath');
    assert.equal(result.candidate.value, expected);
    assert.equal(result.healed, true);
  });

  it('anchors a compact option inside the previously asserted business region', async () => {
    const reg = await Registry.load('/dev/null/nonexistent-contextual-option-registry.json');
    reg.upsertElement({
      id: 'fund.price1m',
      label: 'Giá 1M',
      screen: 'fundDetail',
      candidates: {},
    });
    const driver = {
      ...makeDriver(async (candidate) =>
        candidate.strategy === 'xpath' &&
        candidate.value.includes('Các quỹ có thể bạn quan tâm') &&
        candidate.value.includes("normalize-space(.)='1M'")
          ? { candidate, isVisible: async () => true, text: async () => 'Giá 1M' }
          : null,
      ),
      platform: 'web' as const,
    };
    const resolver = new Resolver(driver, reg, {
      timeoutMs: 100,
      pollMs: 10,
      requireVisible: true,
      verifyHealedMatch: true,
    });

    const result = await resolver.resolve('fund.price1m', {
      discoveryAction: 'tap',
      semanticContext: ['Các quỹ có thể bạn quan tâm', 'Diễn biến giá trong vòng 1 tháng'],
      contextAnchor: 'Các quỹ có thể bạn quan tâm',
    });

    assert.equal(result.candidate.strategy, 'xpath');
    assert.match(result.candidate.value, /Các quỹ có thể bạn quan tâm/);
    assert.notEqual(result.candidate.value, "//*[not(*) and normalize-space(.)='1M']");
  });
});

// ── resolver with discovery ───────────────────────────────────────────────────

describe('Resolver — with ElementDiscovery', () => {
  it('discovers and stores a locator for a selector-less natural-language element', async () => {
    const driver = makeDriver(async (c) =>
      c.value === 'stock-code-input' ? makeHandle(c) : null,
    );
    const reg = await Registry.load('/dev/null/nonexistent-selectorless-registry.json');
    reg.upsertElement({
      id: 'priceBoard.stockCodeInput',
      label: 'Ô mã cổ phiếu',
      screen: 'priceBoard',
      candidates: {},
    });
    const discovery = await makeDiscovery(makeProvider({
      ...makeObservation('stock-code-input'),
      platform: 'android',
      elements: [{
        id: 'stock-input',
        role: 'android.widget.EditText',
        text: '',
        accessibilityLabel: 'Ô mã cổ phiếu',
        testId: 'stock-code-input',
        visible: true,
        enabled: true,
        interactive: true,
        index: 0,
      }],
    }));
    const resolver = new Resolver(driver, reg, {
      timeoutMs: 1000, pollMs: 50, requireVisible: true, verifyHealedMatch: false,
    }, discovery);

    const result = await resolver.resolve('priceBoard.stockCodeInput', {
      discoveryAction: 'input',
    });

    assert.equal(result.candidate.value, 'stock-code-input');
    assert.equal(result.candidate.origin, 'healed');
    assert.equal(reg.candidates('priceBoard.stockCodeInput', 'android').length, 0,
      'a discovered locator stays provisional until its operation succeeds');
    resolver.confirmResolution('priceBoard.stockCodeInput', result);
    assert.equal(reg.candidates('priceBoard.stockCodeInput', 'android')[0]?.value, 'stock-code-input');
  });

  it('uses discovered locator when registry candidate fails', async () => {
    const staleCandidate: LocatorCandidate = {
      strategy: 'testId', value: 'old-id', weight: 0.95, origin: 'authored',
    };
    // Driver knows the discovered id but not the stale one.
    const driver = makeDriver(async (c) =>
      c.value === 'discovered-id' ? makeHandle(c) : null,
    );
    const reg = await makeRegistry('login-btn', staleCandidate);
    const discovery = await makeDiscovery(makeProvider(makeObservation('discovered-id')));
    const resolver = new Resolver(driver, reg, {
      timeoutMs: 1000, pollMs: 50, requireVisible: true, verifyHealedMatch: false,
    }, discovery);

    const result = await resolver.resolve('login-btn');
    assert.equal(result.healed, true, 'should be marked as healed since it is not the primary');
    assert.equal(result.candidate.value, 'discovered-id');
    assert.equal(result.candidate.origin, 'healed');
  });

  it('still resolves without discovery when primary candidate works', async () => {
    let discoveryCalled = 0;
    const workingCandidate: LocatorCandidate = {
      strategy: 'testId', value: 'btn-login', weight: 0.95, origin: 'authored',
    };
    const driver = makeDriver(async (c) =>
      c.value === 'btn-login' ? makeHandle(c) : null,
    );
    const reg = await makeRegistry('login-btn', workingCandidate);
    const discovery = await makeDiscovery({
      observe: async () => {
        discoveryCalled++;
        return makeObservation('should-not-be-called');
      },
    });
    const resolver = new Resolver(driver, reg, {
      timeoutMs: 500, pollMs: 50, requireVisible: true, verifyHealedMatch: false,
    }, discovery);

    const result = await resolver.resolve('login-btn');
    assert.equal(result.healed, false, 'primary candidate worked — not healed');
    assert.equal(discoveryCalled, 0, 'discovery must not be called when primary candidate succeeds');
  });

  it('throws ElementNotFoundError when both registry and discovery fail', async () => {
    const stale: LocatorCandidate = {
      strategy: 'testId', value: 'old-id', weight: 0.95, origin: 'authored',
    };
    // Driver never matches anything.
    const driver = makeDriver(async () => null);
    const reg = await makeRegistry('login-btn', stale);
    // Discovery returns an observation with no elements → no match.
    const discovery = await makeDiscovery(makeProvider({
      ...makeObservation('unreachable'),
      elements: [],
    }));
    const resolver = new Resolver(driver, reg, {
      timeoutMs: 200, pollMs: 50, requireVisible: true, verifyHealedMatch: false,
    }, discovery);

    await assert.rejects(
      () => resolver.resolve('login-btn'),
      (err: Error) => err instanceof ElementNotFoundError,
    );
  });

  it('survives a discovery engine that throws', async () => {
    const stale: LocatorCandidate = {
      strategy: 'testId', value: 'old-id', weight: 0.95, origin: 'authored',
    };
    const driver = makeDriver(async () => null);
    const reg = await makeRegistry('login-btn', stale);
    const discovery = await makeDiscovery({
      observe: async () => { throw new Error('driver offline'); },
    });
    const resolver = new Resolver(driver, reg, {
      timeoutMs: 150, pollMs: 50, requireVisible: true, verifyHealedMatch: false,
    }, discovery);

    // Should not throw due to discovery error — should throw ElementNotFoundError.
    await assert.rejects(
      () => resolver.resolve('login-btn'),
      (err: Error) => err instanceof ElementNotFoundError,
    );
  });

  it('attempts discovery only once even across multiple ticks', async () => {
    const stale: LocatorCandidate = {
      strategy: 'testId', value: 'old-id', weight: 0.95, origin: 'authored',
    };
    let observeCallCount = 0;
    const driver = makeDriver(async () => null);
    const reg = await makeRegistry('login-btn', stale);
    const discovery = await makeDiscovery({
      observe: async () => {
        observeCallCount++;
        return { ...makeObservation('x'), elements: [] };
      },
    });
    const resolver = new Resolver(driver, reg, {
      // Long enough for 3+ ticks.
      timeoutMs: 300, pollMs: 50, requireVisible: true, verifyHealedMatch: false,
    }, discovery);

    await resolver.resolve('login-btn').catch(() => {/* expected */});

    assert.ok(observeCallCount <= 1, `observe called ${observeCallCount} times — must be ≤1`);
  });

  it('discovered candidate weight is clamped to 0.95', async () => {
    const stale: LocatorCandidate = {
      strategy: 'testId', value: 'old-id', weight: 0.95, origin: 'authored',
    };
    let discoveredCandidate: LocatorCandidate | undefined;
    const driver = makeDriver(async (c) => {
      if (c.origin === 'healed') {
        discoveredCandidate = c;
        return makeHandle(c);
      }
      return null;
    });
    const reg = await makeRegistry('login-btn', stale);
    const discovery = await makeDiscovery(makeProvider(makeObservation('discovered-id')));
    const resolver = new Resolver(driver, reg, {
      timeoutMs: 1000, pollMs: 50, requireVisible: true, verifyHealedMatch: false,
    }, discovery);

    await resolver.resolve('login-btn');
    assert.ok(discoveredCandidate, 'healed candidate must be attempted');
    assert.ok(
      discoveredCandidate!.weight <= 0.95,
      `weight=${discoveredCandidate!.weight} must be ≤0.95`,
    );
  });
});

// ── G06 safety in discovery path ─────────────────────────────────────────────

describe('Resolver — G06 safety gate in discovery path', () => {
  it('blocks action when discovery finds only invisible elements', async () => {
    // Primary locator is stale — driver returns null.
    // Discovery observes an invisible element → G06 (not visible) → method=failed
    // → tryDiscovery() returns null → ElementNotFoundError.
    const stale: LocatorCandidate = {
      strategy: 'testId', value: 'old-id', weight: 0.95, origin: 'authored',
    };
    const driver = makeDriver(async () => null);
    const reg = await makeRegistry('login-btn', stale);

    const invisibleObs: UiObservation = {
      id: 'obs-invisible',
      timestamp: new Date().toISOString(),
      platform: 'android',
      source: 'native',
      context: {},
      elements: [
        {
          id: 'el-0',
          role: 'android.widget.Button',
          text: 'Login',
          accessibilityLabel: 'Login',
          testId: 'btn-login',
          visible: false, // G06: not visible → UNSAFE → discovery returns method=failed
          enabled: true,
          interactive: true,
          index: 0,
        },
      ],
    };

    const discovery = await makeDiscovery(makeProvider(invisibleObs));
    const resolver = new Resolver(driver, reg, {
      timeoutMs: 300, pollMs: 50, requireVisible: true, verifyHealedMatch: false,
    }, discovery);

    // G06 blocks the discovered element → tryDiscovery returns null → ElementNotFoundError
    await assert.rejects(
      () => resolver.resolve('login-btn'),
      (err: Error) => err instanceof ElementNotFoundError,
    );
  });

  it('allows action when discovery finds a safe (visible, enabled) element', async () => {
    // Primary locator is stale. Discovery finds a safe element.
    // G05/G06 pass → locator prepended → driver resolves on next tick.
    const stale: LocatorCandidate = {
      strategy: 'testId', value: 'old-id', weight: 0.95, origin: 'authored',
    };
    const driver = makeDriver(async (c) =>
      c.value === 'btn-login-new' ? makeHandle(c) : null,
    );
    const reg = await makeRegistry('login-btn', stale);

    const safeObs: UiObservation = {
      id: 'obs-safe',
      timestamp: new Date().toISOString(),
      platform: 'android',
      source: 'native',
      context: {},
      elements: [
        {
          id: 'el-0',
          role: 'android.widget.Button',
          text: 'Login',
          accessibilityLabel: 'Login',
          testId: 'btn-login-new',
          visible: true,
          enabled: true,
          interactive: true,
          index: 0,
        },
      ],
    };

    const discovery = await makeDiscovery(makeProvider(safeObs));
    const resolver = new Resolver(driver, reg, {
      timeoutMs: 1000, pollMs: 50, requireVisible: true, verifyHealedMatch: false,
    }, discovery);

    const result = await resolver.resolve('login-btn');
    assert.equal(result.healed, true, 'resolved via healed locator');
    assert.equal(result.candidate.value, 'btn-login-new');
  });
});

// ── DriverObservationAdapter ──────────────────────────────────────────────────

describe('observedToUiObservation', () => {
  it('converts Observed[] fields correctly', async () => {
    const { observedToUiObservation } = await import('../../discovery/DriverObservationAdapter.js');
    const obs = observedToUiObservation(
      [
        {
          testId: 'btn1',
          role: 'android.widget.Button',
          name: 'Login',
          text: 'Login',
          interactive: true,
          index: 0,
          container: false,
        },
      ],
      'android',
    );
    assert.equal(obs.platform, 'android');
    assert.equal(obs.source, 'native');
    assert.equal(obs.elements.length, 1);
    const el = obs.elements[0]!;
    assert.equal(el.testId, 'btn1');
    assert.equal(el.accessibilityLabel, 'Login');
    assert.equal(el.interactive, true);
    assert.equal(el.visible, true);
    assert.equal(el.enabled, true);
  });

  it('sets source=browser for web platform', async () => {
    const { observedToUiObservation } = await import('../../discovery/DriverObservationAdapter.js');
    const obs = observedToUiObservation([], 'web');
    assert.equal(obs.source, 'browser');
    assert.equal(obs.platform, 'web');
  });

  it('container=true produces childIds=[]', async () => {
    const { observedToUiObservation } = await import('../../discovery/DriverObservationAdapter.js');
    const obs = observedToUiObservation(
      [{ role: 'android.widget.FrameLayout', interactive: false, index: 0, container: true }],
      'android',
    );
    assert.deepEqual(obs.elements[0]?.childIds, []);
  });
});

describe('buildElementIntent', () => {
  it('builds intent with assert-visible action and element label', async () => {
    const { buildElementIntent } = await import('../../discovery/DriverObservationAdapter.js');
    const intent = buildElementIntent('login-btn', {
      id: 'login-btn',
      label: 'Login',
      screen: 'LoginScreen',
      candidates: {},
    });
    assert.equal(intent.id, 'login-btn');
    assert.equal(intent.action, 'assert-visible');
    assert.equal(intent.label, 'Login');
    assert.equal(intent.screen, 'LoginScreen');
  });

  it('preserves the runtime action so discovery rejects a non-interactive match', async () => {
    const { buildElementIntent } = await import('../../discovery/DriverObservationAdapter.js');
    const intent = buildElementIntent('stock-input', {
      id: 'stock-input',
      label: 'Ô mã cổ phiếu',
      screen: 'priceBoard',
      candidates: {},
    }, 'input');
    assert.equal(intent.action, 'input');
    assert.equal(intent.semanticRole, 'textbox');
    assert.equal(intent.placeholder, 'mã cổ phiếu');
  });
});

describe('mapDiscoveryStrategy', () => {
  it('maps known strategies correctly', async () => {
    const { mapDiscoveryStrategy } = await import('../../discovery/DriverObservationAdapter.js');
    assert.equal(mapDiscoveryStrategy('testId'), 'testId');
    assert.equal(mapDiscoveryStrategy('resourceId'), 'testId');
    assert.equal(mapDiscoveryStrategy('accessibility'), 'label');
    assert.equal(mapDiscoveryStrategy('placeholder'), 'placeholder');
    assert.equal(mapDiscoveryStrategy('css'), 'css');
    assert.equal(mapDiscoveryStrategy('xpath'), 'xpath');
  });

  /**
   * KHÔNG còn rơi về xpath. Nhánh cũ dán nhãn `xpath` cho mọi chiến lược lạ
   * trong khi giá trị vẫn là chữ, nên `{strategy:'text', value:'TCB,VNM,FPT…'}`
   * thành `xpath="TCB,VNM,FPT…"` — một locator không bao giờ khớp, mang vẻ
   * ngoài của một locator hợp lệ. Đo trên máy thật: AI tìm đúng ô nhập với tin
   * cậy 90, đề xuất hỏng ở bước dán nhãn, cả kịch bản đỏ.
   */
  it('chiến lược lạ hiểu như khớp theo chữ, không bịa thành xpath', async () => {
    const { mapDiscoveryStrategy } = await import('../../discovery/DriverObservationAdapter.js');
    assert.equal(mapDiscoveryStrategy('unknown-strategy'), 'label');
  });
});

// ── AppiumMcpElementDiscovery integration ─────────────────────────────────────
//
// Proves the actual runtime path:
//   Resolver → ElementDiscovery → AppiumMcpElementDiscovery → McpClient.inspect()
//
// This is the integration gap that was identified: run.ts previously created
// Resolver without elementDiscovery, so McpClient.inspect() was never called.

describe('Resolver — AppiumMcpElementDiscovery as ObservationProvider', () => {
  it('retries a known locator before spending time on discovery', async () => {
    let findCalls = 0;
    let inspectCallCount = 0;
    const mockMcpClient: McpClient = {
      async inspect() {
        inspectCallCount += 1;
        return { platform: 'android', elements: [] };
      },
      async findElement(_desc: string) { return {}; },
      async screenshot() { return ''; },
    };
    const appiumMcp = new AppiumMcpElementDiscovery(mockMcpClient);
    const runtimeReg = await RuntimeRegistry.load('/dev/null/nonexistent-known-grace.json');
    const discovery = new ElementDiscovery(appiumMcp, runtimeReg);
    const candidate: LocatorCandidate = {
      strategy: 'testId', value: 'total-assets', weight: 0.95, origin: 'authored',
    };
    const driver = makeDriver(async (current) => {
      findCalls += 1;
      return findCalls >= 3 ? makeHandle(current) : null;
    });
    const reg = await makeRegistry('home.totalAssets', candidate);
    const resolver = new Resolver(driver, reg, {
      timeoutMs: 500, pollMs: 10, requireVisible: true, verifyHealedMatch: false,
    }, discovery);

    const result = await resolver.resolve('home.totalAssets');

    assert.equal(result.candidate.value, 'total-assets');
    assert.equal(findCalls, 3);
    assert.equal(inspectCallCount, 0,
      'a locator that appears during the initial grace polls must not trigger discovery');
  });

  it('calls McpClient.inspect() exactly once when registry candidates fail', async () => {
    let inspectCallCount = 0;

    const mockMcpClient: McpClient = {
      async inspect() {
        inspectCallCount++;
        return {
          platform: 'android',
          elements: [
            {
              type: 'android.widget.Button',
              text: 'Login',
              testId: 'btn-login-discovered',
              visible: true,
              enabled: true,
              interactable: true,
            },
          ],
        };
      },
      async findElement(_desc: string) { return {}; },
      async screenshot() { return ''; },
    };

    // AppiumMcpElementDiscovery implements ObservationProvider:
    //   observe() → inspect() → mockMcpClient.inspect()
    const appiumMcp = new AppiumMcpElementDiscovery(mockMcpClient);
    const runtimeReg = await RuntimeRegistry.load('/dev/null/nonexistent.json');
    const discovery = new ElementDiscovery(appiumMcp, runtimeReg);

    const staleCandidate: LocatorCandidate = {
      strategy: 'testId', value: 'old-id', weight: 0.95, origin: 'authored',
    };
    // Driver knows the discovered testId but not the stale one.
    const driver = makeDriver(async (c) =>
      c.value === 'btn-login-discovered' ? makeHandle(c) : null,
    );
    const reg = await makeRegistry('login-btn', staleCandidate);
    const resolver = new Resolver(driver, reg, {
      timeoutMs: 1000, pollMs: 50, requireVisible: true, verifyHealedMatch: false,
    }, discovery);

    const result = await resolver.resolve('login-btn');

    // Primary assertion: McpClient.inspect() was called through the chain.
    assert.equal(inspectCallCount, 1,
      'McpClient.inspect() must be called once via AppiumMcpElementDiscovery.observe()');
    // Secondary: resolver found the element via the discovered locator.
    assert.equal(result.healed, true, 'resolved via healed (discovered) locator');
    assert.equal(result.candidate.value, 'btn-login-discovered',
      'discovered locator value must match testId returned by McpClient');
    assert.equal(result.candidate.origin, 'healed');
  });
});

// ── helper ────────────────────────────────────────────────────────────────────

function makeProvider(obs: UiObservation): ObservationProvider {
  return { observe: async () => obs };
}
