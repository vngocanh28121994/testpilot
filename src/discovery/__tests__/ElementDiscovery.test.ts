import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ElementDiscovery } from '../ElementDiscovery.js';
import { RuntimeRegistry } from '../RuntimeRegistry.js';
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
  it('returns unverified match when element is disabled for tap', async () => {
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
          enabled: false, // disabled!
          interactive: true,
          index: 0,
        },
      ],
    });

    const discovery = new ElementDiscovery(makeProvider(obs), reg);
    const result = await discovery.discover(makeIntent({ action: 'tap' }));

    // Match should be found but verification should fail
    assert.equal(result.method, 'deterministic');
    assert.ok(result.verification);
    assert.ok(!result.verification.passed, 'verification must fail for disabled element');
    assert.ok(!result.match?.verified, 'match must not be verified');
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
