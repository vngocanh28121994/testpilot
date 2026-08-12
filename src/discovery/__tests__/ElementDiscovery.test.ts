import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ElementDiscovery, findElementByLocator } from '../ElementDiscovery.js';
import { RuntimeRegistry } from '../RuntimeRegistry.js';
import { McpElementIdentityResolver } from '../mcp/ElementIdentityResolver.js';
import type { UiObservation } from '../UiObservation.js';
import type { ElementIntent } from '../ElementIntent.js';
import type { ObservationProvider } from '../ElementDiscovery.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeIntent(overrides: Partial<ElementIntent> = {}): ElementIntent {
  return {
    id: 'login-btn',
    action: 'tap',
    label: 'Login',
    semanticRole: 'button',
    ...overrides,
  };
}

function makeObservation(overrides: Partial<UiObservation> = {}): UiObservation {
  return {
    id: 'obs-test',
    timestamp: new Date().toISOString(),
    platform: 'android',
    source: 'native',
    context: {},
    elements: [],
    ...overrides,
  };
}

function makeProvider(obs: UiObservation): ObservationProvider {
  return { observe: async () => obs };
}

function failingProvider(msg = 'driver offline'): ObservationProvider {
  return {
    observe: async () => {
      throw new Error(msg);
    },
  };
}

async function emptyRegistry(): Promise<RuntimeRegistry> {
  return RuntimeRegistry.load('/dev/null/nonexistent-registry.json');
}

// ── known locator path ────────────────────────────────────────────────────────

describe('ElementDiscovery — known-locator path', () => {
  it('returns known locator when registry has a verified entry', async () => {
    const reg = await emptyRegistry();
    reg.upsertLocator('login-btn', {
      strategy: 'resourceId',
      value: 'btn_login',
      source: 'human-approved',
      status: 'verified',
      confidence: 1,
    });

    const discovery = new ElementDiscovery(failingProvider(), reg);
    const result = await discovery.discover(makeIntent());

    assert.equal(result.method, 'known-locator');
    assert.deepEqual(result.locator, { strategy: 'resourceId', value: 'btn_login' });
    assert.ok(result.evidence.some((e) => e.includes('known')));
  });

  it('skips suggested locators and falls through to observation', async () => {
    const reg = await emptyRegistry();
    reg.upsertLocator('login-btn', {
      strategy: 'resourceId',
      value: 'btn_login',
      source: 'document-generated',
      status: 'suggested',
      confidence: 0.7,
    });

    // observation returns no elements → expect 'failed'
    const discovery = new ElementDiscovery(makeProvider(makeObservation()), reg);
    const result = await discovery.discover(makeIntent());

    assert.notEqual(result.method, 'known-locator');
  });

  it('returns healed locator as a known locator', async () => {
    const reg = await emptyRegistry();
    reg.upsertLocator('login-btn', {
      strategy: 'accessibility',
      value: 'Login',
      source: 'runtime-observed',
      status: 'healed',
      confidence: 0.9,
    });

    const discovery = new ElementDiscovery(failingProvider(), reg);
    const result = await discovery.discover(makeIntent());

    assert.equal(result.method, 'known-locator');
    assert.equal(result.locator?.strategy, 'accessibility');
  });
});

// ── observation failure ───────────────────────────────────────────────────────

describe('ElementDiscovery — observation failure', () => {
  it('returns method=failed when observation throws', async () => {
    const reg = await emptyRegistry();
    const discovery = new ElementDiscovery(failingProvider('timeout'), reg);
    const result = await discovery.discover(makeIntent());

    assert.equal(result.method, 'failed');
    assert.ok(result.evidence.some((e) => e.includes('observation failed')));
    assert.ok(result.evidence.some((e) => e.includes('timeout')));
  });
});

// ── no matches ────────────────────────────────────────────────────────────────

describe('ElementDiscovery — no matching elements', () => {
  it('returns method=failed when observation is empty', async () => {
    const reg = await emptyRegistry();
    const obs = makeObservation({ elements: [] });
    const discovery = new ElementDiscovery(makeProvider(obs), reg);
    const result = await discovery.discover(makeIntent());

    assert.equal(result.method, 'failed');
    assert.ok(result.observation);
  });

  it('returns method=failed when all matches are below threshold', async () => {
    const reg = await emptyRegistry();
    // Element has no matching signals to the intent
    const obs = makeObservation({
      elements: [
        {
          id: 'el-0',
          role: 'android.widget.ImageView',
          visible: true,
          interactive: false,
        },
      ],
    });
    const discovery = new ElementDiscovery(makeProvider(obs), reg);
    const result = await discovery.discover(makeIntent({ label: 'Login', semanticRole: 'button' }));

    assert.equal(result.method, 'failed');
  });
});

// ── deterministic match ───────────────────────────────────────────────────────

describe('ElementDiscovery — deterministic match', () => {
  it('finds element by testId with high confidence', async () => {
    const reg = await emptyRegistry();
    const obs = makeObservation({
      elements: [
        {
          id: 'el-0',
          role: 'android.widget.Button',
          text: 'Login',
          accessibilityLabel: 'Login',
          testId: 'btn_login',
          visible: true,
          enabled: true,
          interactive: true,
          index: 0,
        },
      ],
    });

    const discovery = new ElementDiscovery(makeProvider(obs), reg);
    const result = await discovery.discover(
      makeIntent({ id: 'login-btn', action: 'tap', label: 'Login', semanticRole: 'button' }),
    );

    assert.equal(result.method, 'deterministic');
    assert.ok(result.locator, 'locator must be present');
    assert.ok(result.match?.confidence! >= 60, `confidence=${result.match?.confidence}`);
    assert.ok(result.verification?.passed, 'verification must pass');
    assert.ok(result.match?.verified, 'match must be marked verified');
  });

  it('stores verified locator in RuntimeRegistry after successful match', async () => {
    const reg = await emptyRegistry();
    const obs = makeObservation({
      elements: [
        {
          id: 'el-0',
          role: 'android.widget.Button',
          text: 'Submit',
          accessibilityLabel: 'Submit form',
          resourceId: 'btn_submit',
          visible: true,
          enabled: true,
          interactive: true,
          index: 0,
        },
      ],
    });

    const discovery = new ElementDiscovery(makeProvider(obs), reg);
    await discovery.discover(
      makeIntent({ id: 'submit-btn', action: 'tap', label: 'Submit', semanticRole: 'button' }),
    );

    const stored = reg.bestLocator('submit-btn');
    assert.ok(stored, 'locator must be stored in registry');
    assert.equal(stored?.status, 'verified');
    assert.equal(stored?.source, 'runtime-observed');
  });

  it('includes evidence audit trail', async () => {
    const reg = await emptyRegistry();
    const obs = makeObservation({
      elements: [
        {
          id: 'el-0',
          role: 'android.widget.Button',
          text: 'Login',
          accessibilityLabel: 'Login',
          testId: 'login',
          visible: true,
          enabled: true,
          interactive: true,
          index: 0,
        },
      ],
    });

    const discovery = new ElementDiscovery(makeProvider(obs), reg);
    const result = await discovery.discover(makeIntent());

    assert.ok(result.evidence.length >= 3, 'must have multiple evidence entries');
    assert.ok(result.evidence.some((e) => e.includes('observed')));
    assert.ok(result.evidence.some((e) => e.includes('matcher')));
    assert.ok(result.evidence.some((e) => e.includes('verification')));
  });
});

// ── verification failure ──────────────────────────────────────────────────────

describe('ElementDiscovery — verification failure', () => {
  it('returns method=failed for disabled element on tap (G06 interaction safety)', async () => {
    // G06: UNSAFE elements must return method='failed' — the interaction safety gate
    // fires BEFORE verification so a disabled element can never be accidentally tapped.
    const reg = await emptyRegistry();
    const obs = makeObservation({
      elements: [
        {
          id: 'el-0',
          role: 'android.widget.Button',
          text: 'Login',
          accessibilityLabel: 'Login',
          testId: 'login',
          visible: true,
          enabled: false, // disabled — UNSAFE for tap
          interactive: true,
          index: 0,
        },
      ],
    });

    const discovery = new ElementDiscovery(makeProvider(obs), reg);
    const result = await discovery.discover(makeIntent({ action: 'tap' }));

    // G06: disabled element for 'tap' → UNSAFE → method='failed' (not 'deterministic')
    assert.equal(result.method, 'failed');
    assert.ok(result.safety, 'safety result must be present');
    assert.equal(result.safety?.safety, 'UNSAFE');
    assert.ok(
      result.safety?.evidence.some((e) => e.includes('disabled')),
      'safety evidence must mention disabled',
    );
  });

  it('does not store unverified locator in registry', async () => {
    const reg = await emptyRegistry();
    const obs = makeObservation({
      elements: [
        {
          id: 'el-0',
          role: 'android.widget.Button',
          text: 'Login',
          accessibilityLabel: 'Login',
          testId: 'login',
          visible: false, // invisible!
          enabled: true,
          interactive: true,
          index: 0,
        },
      ],
    });

    const discovery = new ElementDiscovery(makeProvider(obs), reg);
    await discovery.discover(makeIntent({ action: 'tap' }));

    // Should NOT be stored since verification failed
    const stored = reg.bestLocator('login-btn');
    assert.equal(stored, undefined, 'failed verification must not store in registry');
  });
});

// ── G05 ambiguity policy ──────────────────────────────────────────────────────

describe('ElementDiscovery — G05 ambiguity policy', () => {
  it('blocks action when two candidates share the same text and role (AMBIGUOUS)', async () => {
    const reg = await emptyRegistry();
    // Two identical "Confirm" buttons — text alone gives score ~20 (below threshold 60),
    // so we add accessibilityLabel to push both above threshold (score=55→87 with testId).
    // With identical text+accessibilityLabel+role, margin between scores is 0 → G05 AMBIGUOUS.
    // G06 also catches them: same role|text|accessibilityLabel signature → not unique → AMBIGUOUS.
    const obs = makeObservation({
      elements: [
        {
          id: 'el-0',
          role: 'android.widget.Button',
          text: 'Confirm',
          accessibilityLabel: 'Confirm',
          testId: 'btn-confirm-a',
          visible: true,
          enabled: true,
          interactive: true,
          index: 0,
        },
        {
          id: 'el-1',
          role: 'android.widget.Button',
          text: 'Confirm',
          accessibilityLabel: 'Confirm',
          testId: 'btn-confirm-b',
          visible: true,
          enabled: true,
          interactive: true,
          index: 1,
        },
      ],
    });

    const discovery = new ElementDiscovery(makeProvider(obs), reg);
    const result = await discovery.discover(
      makeIntent({ label: 'Confirm', semanticRole: 'button', action: 'tap' }),
    );

    assert.equal(result.method, 'failed');
    // G05 catches it (margin too small) OR G06 catches it (duplicate signature)
    const blockedByAmbiguity =
      result.ambiguity?.outcome === 'AMBIGUOUS' ||
      result.safety?.safety === 'AMBIGUOUS';
    assert.ok(blockedByAmbiguity, `expected AMBIGUOUS block, got ambiguity=${result.ambiguity?.outcome} safety=${result.safety?.safety}`);
  });
});

// ── G02 MCP identity mapping ──────────────────────────────────────────────────

describe('ElementDiscovery — G02 MCP identity', () => {
  it('findElementByLocator resolves element via providerElementId (not TestPilot id)', () => {
    const obs = makeObservation({
      elements: [
        {
          id: 'tp-el-7',
          provider: 'appium-mcp',
          providerElementId: 'abc123',
          role: 'XCUITypeButton',
          text: 'Login',
          visible: true,
        },
      ],
    });

    // Provider ID lookup must succeed
    const found = findElementByLocator(obs, 'id', 'abc123');
    assert.ok(found, 'must find element by providerElementId');
    assert.equal(found?.id, 'tp-el-7', 'must return TestPilot id, not provider id');
    assert.equal(found?.providerElementId, 'abc123');

    // TestPilot observation id is NOT a locator value — must not match
    const notFound = findElementByLocator(obs, 'id', 'tp-el-7');
    assert.equal(
      notFound,
      undefined,
      '"tp-el-7" is an observation-scoped id, not a locator value — must not be found by findElementByLocator',
    );
  });

  it('McpElementIdentityResolver returns undefined for stale/missing provider id (G02 stale)', () => {
    const obs = makeObservation({
      elements: [
        {
          id: 'tp-el-7',
          provider: 'appium-mcp',
          providerElementId: 'abc123',
          role: 'XCUITypeButton',
          text: 'Login',
          visible: true,
        },
      ],
    });

    const resolver = new McpElementIdentityResolver();

    // Valid lookup
    const valid = resolver.resolveTestPilotId(obs, 'abc123');
    assert.equal(valid, 'tp-el-7', 'valid provider id must resolve to TestPilot id');

    // Stale provider id — element no longer in the observation (UI changed)
    const stale = resolver.resolveTestPilotId(obs, 'xyz-stale-999');
    assert.equal(
      stale,
      undefined,
      'stale provider id must return undefined, signalling re-observe is needed',
    );

    // Reverse: TestPilot id → provider reference
    const ref = resolver.resolveProviderElement(obs, 'tp-el-7');
    assert.ok(ref, 'must resolve TestPilot id → provider reference');
    assert.equal(ref?.provider, 'appium-mcp');
    assert.equal(ref?.providerElementId, 'abc123');
  });
});

// ── context:'healing' — G01 bypass ───────────────────────────────────────────

describe('ElementDiscovery — context:healing bypasses G01', () => {
  // TEST A: observe() is forced even when registry has a known locator.
  it('TEST A: calls observe() even when registry has a known verified locator', async () => {
    let observeCallCount = 0;
    const provider: ObservationProvider = {
      observe: async () => {
        observeCallCount++;
        return makeObservation({
          elements: [
            {
              id: 'el-new',
              role: 'android.widget.Button',
              text: 'Login',
              accessibilityLabel: 'Login',
              testId: 'btn-login',
              visible: true,
              enabled: true,
              interactive: true,
              index: 0,
            },
          ],
        });
      },
    };

    const reg = await emptyRegistry();
    // Seed a verified locator — G01 would normally return this without observing.
    reg.upsertLocator('login-btn', {
      strategy: 'testId',
      value: 'btn-old',
      source: 'human-approved',
      status: 'verified',
      confidence: 1,
    });

    const discovery = new ElementDiscovery(provider, reg);
    // skipKnownLocatorVerification=true: without healing bypass, G01 returns immediately
    // and never calls observe(). With healing, observe() MUST be called.
    await discovery.discover(makeIntent(), {
      context: 'healing',
      minConfidence: 40,
      skipKnownLocatorVerification: true,
    });

    assert.ok(observeCallCount > 0, 'observe() MUST be called when context=healing, even with a registry hit');
  });

  it('TEST A (evidence): G01 bypass is recorded in the evidence trail', async () => {
    const reg = await emptyRegistry();
    const discovery = new ElementDiscovery(makeProvider(makeObservation()), reg);
    const result = await discovery.discover(makeIntent(), { context: 'healing' });

    assert.ok(
      result.evidence.some((e) => e.includes('healing') && e.includes('G01')),
      `evidence must include healing/G01 bypass message, got: ${JSON.stringify(result.evidence)}`,
    );
  });

  // TEST D: stale registry locator is NOT returned with context='healing'.
  it('TEST D: does not return the stale registry locator when context=healing', async () => {
    const provider: ObservationProvider = {
      observe: async () =>
        makeObservation({
          elements: [
            {
              id: 'el-fresh',
              role: 'android.widget.Button',
              text: 'Login',
              accessibilityLabel: 'Login',
              testId: 'btn-fresh',
              visible: true,
              enabled: true,
              interactive: true,
              index: 0,
            },
          ],
        }),
    };

    const reg = await emptyRegistry();
    reg.upsertLocator('login-btn', {
      strategy: 'testId',
      value: 'btn-stale',
      source: 'runtime-observed',
      status: 'verified',
      confidence: 0.95,
    });

    const discovery = new ElementDiscovery(provider, reg);
    const result = await discovery.discover(makeIntent(), {
      context: 'healing',
      minConfidence: 40,
    });

    // 'btn-stale' must NOT be returned — healing forces fresh discovery.
    assert.notEqual(result.locator?.value, 'btn-stale', 'G01 must be bypassed — stale locator must not be returned directly');
  });
});

// ── context:'initial' and omitted context → G01 runs normally ────────────────

describe('ElementDiscovery — G01 runs when context is initial or omitted', () => {
  // TEST B: context='initial' preserves G01.
  it('TEST B: context=initial returns known-locator without calling observe()', async () => {
    // failingProvider ensures observe() is never called.
    // If G01 runs, it returns the known locator without needing an observation
    // (because skipKnownLocatorVerification=true).
    const reg = await emptyRegistry();
    reg.upsertLocator('login-btn', {
      strategy: 'testId',
      value: 'btn-known',
      source: 'human-approved',
      status: 'verified',
      confidence: 1,
    });

    const discovery = new ElementDiscovery(failingProvider('must not be called'), reg);
    const result = await discovery.discover(makeIntent(), {
      context: 'initial',
      skipKnownLocatorVerification: true,
    });

    assert.equal(result.method, 'known-locator', 'G01 must run and return known locator for context=initial');
    assert.equal(result.locator?.value, 'btn-known');
  });

  // TEST C: omitted context preserves G01 (default behaviour).
  it('TEST C: omitting context returns known-locator without calling observe()', async () => {
    const reg = await emptyRegistry();
    reg.upsertLocator('login-btn', {
      strategy: 'testId',
      value: 'btn-default',
      source: 'human-approved',
      status: 'verified',
      confidence: 1,
    });

    const discovery = new ElementDiscovery(failingProvider('must not be called'), reg);
    const result = await discovery.discover(makeIntent(), {
      skipKnownLocatorVerification: true,
      // no context field
    });

    assert.equal(result.method, 'known-locator', 'G01 must run when context is omitted');
    assert.equal(result.locator?.value, 'btn-default');
  });
});

// ── screen bonus ──────────────────────────────────────────────────────────────

describe('ElementDiscovery — options', () => {
  it('respects custom minConfidence threshold', async () => {
    const reg = await emptyRegistry();
    const obs = makeObservation({
      elements: [
        {
          id: 'el-0',
          role: 'android.widget.Button',
          text: 'OK',
          visible: true,
          enabled: true,
          interactive: true,
          index: 0,
        },
      ],
    });

    // Low-signal match (text="OK" only, no testId/resourceId)
    // Use a very high threshold to force failure
    const discovery = new ElementDiscovery(makeProvider(obs), reg);
    const result = await discovery.discover(
      makeIntent({ label: 'OK' }),
      { minConfidence: 99 },
    );

    assert.equal(result.method, 'failed');
    assert.ok(result.evidence.some((e) => e.includes('99')));
  });
});
