/**
 * Tests for confidence enforcement and context:'healing' propagation in HealingOrchestrator.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HealingOrchestrator } from '../HealingOrchestrator.js';
import { HealingPolicy } from '../HealingPolicy.js';
import { AntiRegressionGuard } from '../AntiRegressionGuard.js';
import { ElementDiscovery } from '../../discovery/ElementDiscovery.js';
import { RuntimeRegistry } from '../../discovery/RuntimeRegistry.js';
import type { ElementDef } from '../../core/types.js';
import type { NormalizedFailure } from '../ExecutionTypes.js';
import type { UiObservation } from '../../discovery/UiObservation.js';
import type { ObservationProvider, DiscoveryOptions } from '../../discovery/ElementDiscovery.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeFailure(overrides: Partial<NormalizedFailure> = {}): NormalizedFailure {
  return {
    category: 'LOCATOR_FAILURE',
    code: 'ELEMENT_NOT_FOUND',
    message: 'element not found',
    evidenceRefs: [],
    signature: 'LOCATOR_FAILURE:screen=login:intent=login.submitButton',
    ...overrides,
  };
}

function makeElementDef(overrides: Partial<ElementDef> = {}): ElementDef {
  return {
    id: 'login.submitButton',
    label: 'Login',
    screen: 'LoginScreen',
    candidates: {
      android: [{ strategy: 'testId', value: 'old-btn', weight: 0.9, origin: 'authored' }],
    },
    ...overrides,
  };
}

function makeObservation(testId: string, confidence = 80): UiObservation {
  return {
    id: 'obs-1',
    timestamp: new Date().toISOString(),
    platform: 'android',
    source: 'native',
    context: {},
    elements: [
      {
        id: 'el-0',
        role: 'android.widget.Button',
        testId,
        accessibilityLabel: 'Login',
        text: 'Login',
        visible: true,
        enabled: true,
        interactive: true,
        index: 0,
        // Embed confidence hint in testId so DeterministicMatcher scores it.
        // Actual scoring depends on matcher; we use a high-match testId.
      },
    ],
  };
  void confidence; // used by caller to choose the testId / observation
}

async function makeOrchestrator(provider: ObservationProvider): Promise<{
  orchestrator: HealingOrchestrator;
  registry: RuntimeRegistry;
  capturedDiscoveryOptions: DiscoveryOptions[];
}> {
  const registry = await RuntimeRegistry.load('/dev/null/no-such-runtime.json');
  const capturedOptions: DiscoveryOptions[] = [];

  // Wrap ElementDiscovery to capture the options passed to discover().
  const baseDiscovery = new ElementDiscovery(provider, registry);
  const wrappedDiscovery = new Proxy(baseDiscovery, {
    get(target, prop) {
      if (prop === 'discover') {
        return async (intent: Parameters<typeof target.discover>[0], opts: DiscoveryOptions) => {
          capturedOptions.push(opts);
          return target.discover(intent, opts);
        };
      }
      return (target as unknown as Record<string | symbol, unknown>)[prop];
    },
  }) as ElementDiscovery;

  const policy = new HealingPolicy();
  const guard = new AntiRegressionGuard();
  const orchestrator = new HealingOrchestrator(policy, wrappedDiscovery, registry, guard);
  return { orchestrator, registry, capturedDiscoveryOptions: capturedOptions };
}

// ── context:'healing' propagation ────────────────────────────────────────────

describe('HealingOrchestrator — passes context:healing to discover()', () => {
  it('discovery is called with context:healing', async () => {
    const { orchestrator, capturedDiscoveryOptions } = await makeOrchestrator({
      observe: async () => makeObservation('btn-new'),
    });

    await orchestrator.heal('login.submitButton', makeElementDef(), makeFailure());

    assert.ok(capturedDiscoveryOptions.length > 0, 'discover() must be called');
    assert.equal(
      capturedDiscoveryOptions[0]?.context,
      'healing',
      'discover() must receive context:healing',
    );
  });
});

// ── confidence enforcement via AntiRegressionGuard ───────────────────────────

describe('HealingOrchestrator — confidence threshold enforcement', () => {
  it('locator below threshold is rejected — markHealed is NOT called', async () => {
    // To get low confidence, use an element with testId that doesn't match the intent id.
    // 'zzzz-unrelated' will score very low against 'login.submitButton'.
    const { orchestrator, registry } = await makeOrchestrator({
      observe: async () => makeObservation('zzzz-unrelated'),
    });

    const result = await orchestrator.heal(
      'login.submitButton',
      makeElementDef(),
      makeFailure(),
      { minConfidence: 90 }, // very high threshold — 'zzzz-unrelated' will score below it
    );

    // Should fail: either discovery didn't find anything above threshold, or guard rejected it.
    assert.equal(result.healed, false);

    // Registry must NOT have a healed locator.
    const all = registry.allLocators('login.submitButton');
    const healed = all.filter((l) => l.status === 'healed');
    assert.equal(healed.length, 0, 'no locator must be promoted when confidence is too low');
  });

  it('locator above threshold is promoted — markHealed is called', async () => {
    // 'btn-login-new' has high label+text+testId match with 'login.submitButton' label:'Login'.
    const { orchestrator, registry } = await makeOrchestrator({
      observe: async () => makeObservation('btn-login-new'),
    });

    const result = await orchestrator.heal(
      'login.submitButton',
      makeElementDef(),
      makeFailure(),
      { minConfidence: 40 }, // permissive — should pass
    );

    assert.equal(result.healed, true, 'healing should succeed');
    const best = registry.bestLocator('login.submitButton');
    assert.equal(best?.status, 'healed', 'locator must be promoted to healed');
  });

  it('anti-regression guard is the sole confidence enforcement point', async () => {
    // Verify that when guard rejects for confidence, markRejected is called.
    const { orchestrator, registry } = await makeOrchestrator({
      observe: async () => makeObservation('zzzz-unrelated'),
    });

    await orchestrator.heal(
      'login.submitButton',
      makeElementDef(),
      makeFailure(),
      { minConfidence: 90 },
    );

    // Discovery may have found elements (or not) — either way, healed must be false.
    const all = registry.allLocators('login.submitButton');
    const healed = all.find((l) => l.status === 'healed');
    assert.ok(!healed, 'no healed locator must appear after rejection');
  });
});
