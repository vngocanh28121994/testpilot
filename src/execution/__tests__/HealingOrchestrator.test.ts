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
import type { ObservationProvider } from '../../discovery/ElementDiscovery.js';

// ── test helpers ──────────────────────────────────────────────────────────────

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
    candidates: { android: [{ strategy: 'testId', value: 'old-btn', weight: 0.9, origin: 'authored' }] },
    ...overrides,
  };
}

function makeObservation(testId: string, interactive = true, enabled = true): UiObservation {
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
        enabled,
        interactive,
        index: 0,
      },
    ],
  };
}

async function makeOrchestrator(provider: ObservationProvider): Promise<{
  orchestrator: HealingOrchestrator;
  registry: RuntimeRegistry;
}> {
  const registry = await RuntimeRegistry.load('/dev/null/no-such-runtime.json');
  const discovery = new ElementDiscovery(provider, registry);
  const policy = new HealingPolicy();
  const guard = new AntiRegressionGuard();
  const orchestrator = new HealingOrchestrator(policy, discovery, registry, guard);
  return { orchestrator, registry };
}

// ── policy gate ───────────────────────────────────────────────────────────────

describe('HealingOrchestrator — policy gate', () => {
  it('returns healed=false for PRODUCT_DEFECT without calling discovery', async () => {
    let discoveryCalled = false;
    const { orchestrator } = await makeOrchestrator({
      observe: async () => {
        discoveryCalled = true;
        return makeObservation('should-not-reach');
      },
    });

    const result = await orchestrator.heal('login.submitButton', makeElementDef(), makeFailure({ category: 'PRODUCT_DEFECT', code: 'DEFECT' }));

    assert.equal(result.healed, false);
    assert.equal(discoveryCalled, false, 'discovery must not be called for PRODUCT_DEFECT');
    assert.ok(result.rejectionReason?.toLowerCase().includes('defect'));
  });

  it('returns healed=false for ASSERTION_MISMATCH', async () => {
    const { orchestrator } = await makeOrchestrator({ observe: async () => makeObservation('x') });
    const result = await orchestrator.heal('login.submitButton', makeElementDef(), makeFailure({ category: 'ASSERTION_MISMATCH', code: 'ASSERTION_FAILED' }));
    assert.equal(result.healed, false);
    assert.equal(result.method, 'none');
  });
});

// ── discovery failure ─────────────────────────────────────────────────────────

describe('HealingOrchestrator — discovery failure', () => {
  it('returns healed=false when observation has no matching elements', async () => {
    const { orchestrator } = await makeOrchestrator({
      observe: async () => ({ ...makeObservation('unrelated-id'), elements: [] }),
    });

    const result = await orchestrator.heal('login.submitButton', makeElementDef(), makeFailure());
    assert.equal(result.healed, false);
    assert.ok(result.rejectionReason?.includes('no matching'));
  });

  it('survives observation that throws', async () => {
    const { orchestrator } = await makeOrchestrator({
      observe: async () => { throw new Error('driver offline'); },
    });

    const result = await orchestrator.heal('login.submitButton', makeElementDef(), makeFailure());
    assert.equal(result.healed, false);
    assert.ok(result.evidence.some((e) => e.includes('threw') || e.includes('offline')));
  });
});

// ── successful healing path ───────────────────────────────────────────────────

describe('HealingOrchestrator — successful healing', () => {
  it('returns healed=true when discovery + anti-regression pass', async () => {
    const { orchestrator } = await makeOrchestrator({
      observe: async () => makeObservation('btn-login-new'),
    });

    const result = await orchestrator.heal('login.submitButton', makeElementDef(), makeFailure());

    assert.equal(result.healed, true);
    assert.equal(result.method, 'runtime-observation');
    assert.ok(result.newLocator?.value === 'btn-login-new');
    assert.equal(result.antiRegressionPassed, true);
    assert.equal(result.retryPassed, false, 'retryPassed is false until executor sets it');
  });

  it('marks locator as HEALED in registry after success', async () => {
    const { orchestrator, registry } = await makeOrchestrator({
      observe: async () => makeObservation('btn-login-new'),
    });

    await orchestrator.heal('login.submitButton', makeElementDef(), makeFailure());

    const best = registry.bestLocator('login.submitButton');
    assert.equal(best?.status, 'healed');
    assert.equal(best?.value, 'btn-login-new');
  });

  it('evidence trail includes discovery and registry lines', async () => {
    const { orchestrator } = await makeOrchestrator({
      observe: async () => makeObservation('btn-new'),
    });

    const result = await orchestrator.heal('login.submitButton', makeElementDef(), makeFailure());

    assert.ok(result.evidence.some((e) => e.includes('[policy]')));
    assert.ok(result.evidence.some((e) => e.includes('[discovery]')));
    assert.ok(result.evidence.some((e) => e.includes('[anti-regression]')));
    assert.ok(result.evidence.some((e) => e.includes('[registry]') && e.includes('HEALED')));
  });

  it('confidence is non-zero on success', async () => {
    const { orchestrator } = await makeOrchestrator({
      observe: async () => makeObservation('btn-login-new'),
    });

    const result = await orchestrator.heal('login.submitButton', makeElementDef(), makeFailure());
    assert.ok(result.confidence > 0);
  });
});

// ── anti-regression failure ───────────────────────────────────────────────────

describe('HealingOrchestrator — anti-regression failure', () => {
  it('returns healed=false when element is disabled', async () => {
    const { orchestrator, registry } = await makeOrchestrator({
      // 'btn-login-new' scores 67 (testId partial +32, label +35, text +20, disabled -20)
      // → passes discovery (assert-visible, minConf=40) but fails anti-regression (tap + disabled)
      observe: async () => makeObservation('btn-login-new', true, false), // enabled=false
    });

    const result = await orchestrator.heal('login.submitButton', makeElementDef(), makeFailure());

    assert.equal(result.healed, false);
    assert.equal(result.antiRegressionPassed, false);
    assert.ok(result.antiRegressionChecks?.some((c) => c.name === 'element-interactable' && !c.passed));

    // Rejected locator must NOT be in registry as healed
    const best = registry.bestLocator('login.submitButton');
    assert.notEqual(best?.status, 'healed');
  });

  it('marks locator as REJECTED in registry after anti-regression failure', async () => {
    const { orchestrator, registry } = await makeOrchestrator({
      // 'btn-login-notap' scores 87 (testId partial +32, label +35, text +20) — no disabled penalty
      // → passes discovery but fails anti-regression (interactive=false with tap action)
      observe: async () => makeObservation('btn-login-notap', false, true), // interactive=false, enabled=true
    });

    await orchestrator.heal('login.submitButton', makeElementDef(), makeFailure());

    const all = registry.allLocators('login.submitButton');
    const rejected = all.find((l) => l.value === 'btn-login-notap' && l.status === 'rejected');
    assert.ok(rejected, 'failed locator must be marked rejected');
  });

  it('evidence trail explains the rejection', async () => {
    const { orchestrator } = await makeOrchestrator({
      // 'btn-login-dis' scores 67: testId partial +32, label +35, text +20, disabled -20 → passes discovery
      observe: async () => makeObservation('btn-login-dis', true, false),
    });

    const result = await orchestrator.heal('login.submitButton', makeElementDef(), makeFailure());
    assert.ok(result.evidence.some((e) => e.includes('[anti-regression]') && e.includes('FAILED')));
    assert.ok(result.evidence.some((e) => e.includes('REJECTED')));
  });
});

// ── registry (markHealed) ─────────────────────────────────────────────────────

describe('RuntimeRegistry — markHealed', () => {
  it('changes status from verified to healed', async () => {
    const registry = await RuntimeRegistry.load('/dev/null/no-such.json');
    registry.upsertLocator('el', {
      strategy: 'testId',
      value: 'btn',
      source: 'runtime-observed',
      status: 'verified',
      confidence: 0.8,
    });

    registry.markHealed('el', 'testId', 'btn');

    const loc = registry.bestLocator('el');
    assert.equal(loc?.status, 'healed');
  });

  it('sets verifiedAt timestamp', async () => {
    const registry = await RuntimeRegistry.load('/dev/null/no-such.json');
    registry.upsertLocator('el', {
      strategy: 'testId', value: 'btn', source: 'runtime-observed', status: 'verified', confidence: 0.8,
    });

    registry.markHealed('el', 'testId', 'btn');

    const loc = registry.bestLocator('el');
    assert.ok(loc?.verifiedAt != null, 'verifiedAt must be set after markHealed');
  });

  it('no-ops when locator does not exist', async () => {
    const registry = await RuntimeRegistry.load('/dev/null/no-such.json');
    // Should not throw
    registry.markHealed('nonexistent', 'testId', 'btn');
  });
});
