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
});

// ── resolver with discovery ───────────────────────────────────────────────────

describe('Resolver — with ElementDiscovery', () => {
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
});

describe('mapDiscoveryStrategy', () => {
  it('maps known strategies correctly', async () => {
    const { mapDiscoveryStrategy } = await import('../../discovery/DriverObservationAdapter.js');
    assert.equal(mapDiscoveryStrategy('testId'), 'testId');
    assert.equal(mapDiscoveryStrategy('resourceId'), 'testId');
    assert.equal(mapDiscoveryStrategy('accessibility'), 'label');
    assert.equal(mapDiscoveryStrategy('css'), 'css');
    assert.equal(mapDiscoveryStrategy('xpath'), 'xpath');
  });

  it('falls back to xpath for unknown strategies', async () => {
    const { mapDiscoveryStrategy } = await import('../../discovery/DriverObservationAdapter.js');
    assert.equal(mapDiscoveryStrategy('unknown-strategy'), 'xpath');
  });
});

// ── helper ────────────────────────────────────────────────────────────────────

function makeProvider(obs: UiObservation): ObservationProvider {
  return { observe: async () => obs };
}
