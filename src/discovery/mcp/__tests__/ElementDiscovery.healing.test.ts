/**
 * Tests for the context:'healing' G01 bypass in ElementDiscovery.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ElementDiscovery } from '../../ElementDiscovery.js';
import { RuntimeRegistry } from '../../RuntimeRegistry.js';
import type { UiObservation, ObservedElement } from '../../UiObservation.js';
import type { ObservationProvider } from '../../ElementDiscovery.js';
import type { ElementIntent } from '../../ElementIntent.js';

// ── fixtures ──────────────────────────────────────────────────────────────────

function makeIntent(overrides: Partial<ElementIntent> = {}): ElementIntent {
  return {
    id: 'login.submitButton',
    label: 'Login',
    action: 'tap',
    screen: 'LoginScreen',
    ...overrides,
  };
}

function makeObservation(testId: string): UiObservation {
  const el: ObservedElement = {
    id: 'el-0',
    role: 'android.widget.Button',
    testId,
    accessibilityLabel: 'Login',
    text: 'Login',
    visible: true,
    enabled: true,
    interactive: true,
    index: 0,
  };
  return {
    id: 'obs-test',
    timestamp: new Date().toISOString(),
    platform: 'android',
    source: 'native',
    context: {},
    elements: [el],
  };
}

async function makeDiscovery(
  provider: ObservationProvider,
): Promise<{ discovery: ElementDiscovery; registry: RuntimeRegistry }> {
  const registry = await RuntimeRegistry.load('/dev/null/no-such-registry.json');
  const discovery = new ElementDiscovery(provider, registry);
  return { discovery, registry };
}

// ── context:'healing' bypasses G01 ───────────────────────────────────────────

describe('ElementDiscovery — context:healing bypasses G01', () => {
  it('skips G01 even when registry has a matching locator', async () => {
    let observeCallCount = 0;
    const provider: ObservationProvider = {
      observe: async () => {
        observeCallCount++;
        return makeObservation('btn-new');
      },
    };
    const { discovery, registry } = await makeDiscovery(provider);

    // Seed registry with a known locator for the intent.
    registry.upsertLocator('login.submitButton', {
      strategy: 'testId',
      value: 'btn-old',
      source: 'runtime-observed',
      status: 'verified',
      confidence: 0.9,
    });

    const result = await discovery.discover(makeIntent(), { context: 'healing' });

    // G01 bypass means observe() was called (to get a fresh snapshot).
    assert.ok(observeCallCount > 0, 'observe() must be called when context=healing');
    // The result should NOT just return the stale 'btn-old' locator.
    assert.notEqual(result.locator?.value, 'btn-old', 'G01 must be bypassed — stale locator must not be returned');
  });

  it('continues through the same discovery pipeline after bypassing G01', async () => {
    const provider: ObservationProvider = {
      observe: async () => makeObservation('btn-fresh'),
    };
    const { discovery } = await makeDiscovery(provider);

    // minConfidence:40 mirrors what HealingOrchestrator uses; the element scores
    // ~55 (label+text match) which is above 40 but below the default 60.
    const result = await discovery.discover(makeIntent(), { context: 'healing', minConfidence: 40 });

    // Should find the element via the normal deterministic pipeline.
    assert.ok(result.method !== 'failed', `discovery should succeed, got: ${result.method}`);
  });

  it('evidence trail shows G01 bypass message', async () => {
    const provider: ObservationProvider = {
      observe: async () => makeObservation('btn'),
    };
    const { discovery } = await makeDiscovery(provider);

    const result = await discovery.discover(makeIntent(), { context: 'healing' });
    assert.ok(
      result.evidence.some((e) => e.includes('healing') && e.includes('G01')),
      `evidence must mention G01 bypass, got: ${JSON.stringify(result.evidence)}`,
    );
  });
});

// ── context:'initial' and no context → G01 runs normally ─────────────────────

describe('ElementDiscovery — G01 runs when context is initial or omitted', () => {
  it('context:initial uses G01 when registry has a matching locator', async () => {
    let observeCallCount = 0;
    const provider: ObservationProvider = {
      observe: async () => {
        observeCallCount++;
        return makeObservation('btn-new');
      },
    };
    const { discovery, registry } = await makeDiscovery(provider);

    registry.upsertLocator('login.submitButton', {
      strategy: 'testId',
      value: 'btn-new',   // same value as observation so G01 semantic check passes
      source: 'runtime-observed',
      status: 'verified',
      confidence: 0.9,
    });

    const result = await discovery.discover(makeIntent(), { context: 'initial' });

    // G01 ran and returned the registry locator.
    assert.equal(result.method, 'known-locator');
  });

  it('omitting context uses G01 (default behaviour unchanged)', async () => {
    const provider: ObservationProvider = {
      observe: async () => makeObservation('btn-new'),
    };
    const { discovery, registry } = await makeDiscovery(provider);

    registry.upsertLocator('login.submitButton', {
      strategy: 'testId',
      value: 'btn-new',
      source: 'runtime-observed',
      status: 'verified',
      confidence: 0.9,
    });

    const result = await discovery.discover(makeIntent()); // no context option

    assert.equal(result.method, 'known-locator');
  });
});
