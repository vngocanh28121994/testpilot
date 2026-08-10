import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RuntimeRegistry, type RuntimeLocator } from '../RuntimeRegistry.js';

async function tempRegistry(): Promise<{ registry: RuntimeRegistry; dir: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'testpilot-rr-'));
  const registry = await RuntimeRegistry.load(path.join(dir, 'runtime-registry.json'));
  return { registry, dir };
}

function locator(partial: Partial<RuntimeLocator>): RuntimeLocator {
  return {
    strategy: 'resourceId',
    value: 'btn_login',
    source: 'runtime-observed',
    status: 'verified',
    confidence: 0.9,
    ...partial,
  };
}

describe('RuntimeRegistry — loading', () => {
  it('creates empty registry when file does not exist', async () => {
    const { registry } = await tempRegistry();
    assert.equal(registry.bestLocator('login.submitButton'), undefined);
    assert.deepEqual(registry.allLocators('login.submitButton'), []);
  });
});

describe('RuntimeRegistry — upsert and retrieve', () => {
  it('upsert and bestLocator returns the locator', async () => {
    const { registry } = await tempRegistry();
    registry.upsertLocator('login.submitButton', locator({ value: 'btn_login', confidence: 0.98 }));
    const best = registry.bestLocator('login.submitButton');
    assert.ok(best, 'should return a locator');
    assert.equal(best.value, 'btn_login');
  });

  it('updating same strategy+value replaces the entry', async () => {
    const { registry } = await tempRegistry();
    registry.upsertLocator('el', locator({ value: 'v1', confidence: 0.7 }));
    registry.upsertLocator('el', locator({ value: 'v1', confidence: 0.95 }));
    const all = registry.allLocators('el');
    assert.equal(all.length, 1, 'should not duplicate');
    assert.equal(all[0]!.confidence, 0.95);
  });

  it('different strategy+value produces two entries', async () => {
    const { registry } = await tempRegistry();
    registry.upsertLocator('el', locator({ strategy: 'testId', value: 'btn' }));
    registry.upsertLocator('el', locator({ strategy: 'resourceId', value: 'btn_id' }));
    assert.equal(registry.allLocators('el').length, 2);
  });
});

describe('RuntimeRegistry — priority ordering', () => {
  it('human-approved beats runtime-observed', async () => {
    const { registry } = await tempRegistry();
    registry.upsertLocator('el', locator({ source: 'runtime-observed', value: 'runtime', status: 'verified' }));
    registry.upsertLocator('el', locator({ source: 'human-approved', value: 'human', status: 'verified' }));
    assert.equal(registry.bestLocator('el')?.value, 'human');
  });

  it('runtime-observed beats document-generated', async () => {
    const { registry } = await tempRegistry();
    registry.upsertLocator('el', locator({ source: 'document-generated', value: 'doc', status: 'suggested' }));
    registry.upsertLocator('el', locator({ source: 'runtime-observed', value: 'runtime', status: 'verified' }));
    assert.equal(registry.bestLocator('el')?.value, 'runtime');
  });

  it('verified beats suggested for same source', async () => {
    const { registry } = await tempRegistry();
    registry.upsertLocator('el', locator({ source: 'runtime-observed', value: 'suggested-v', status: 'suggested' }));
    registry.upsertLocator('el', locator({ source: 'runtime-observed', value: 'verified-v', status: 'verified', strategy: 'testId' }));
    const best = registry.bestLocator('el');
    assert.equal(best?.value, 'verified-v');
  });

  it('rejected locator excluded from bestLocator', async () => {
    const { registry } = await tempRegistry();
    registry.upsertLocator('el', locator({ value: 'rejected', status: 'rejected', source: 'human-approved' }));
    registry.upsertLocator('el', locator({ strategy: 'testId', value: 'verified', status: 'verified', source: 'runtime-observed' }));
    assert.equal(registry.bestLocator('el')?.value, 'verified');
  });

  it('expired locator excluded from bestLocator', async () => {
    const { registry } = await tempRegistry();
    registry.upsertLocator('el', locator({ value: 'old', status: 'expired' }));
    registry.upsertLocator('el', locator({ strategy: 'testId', value: 'current', status: 'verified', source: 'runtime-observed' }));
    assert.equal(registry.bestLocator('el')?.value, 'current');
  });
});

describe('RuntimeRegistry — markVerified', () => {
  it('updates status to verified and sets verifiedAt', async () => {
    const { registry } = await tempRegistry();
    registry.upsertLocator('el', locator({ value: 'target', status: 'suggested' }));
    registry.markVerified('el', 'resourceId', 'target');
    const loc = registry.allLocators('el').find((l) => l.value === 'target');
    assert.equal(loc?.status, 'verified');
    assert.ok(loc?.verifiedAt, 'verifiedAt should be set');
  });

  it('no-op for unknown element', async () => {
    const { registry } = await tempRegistry();
    assert.doesNotThrow(() => registry.markVerified('nonexistent', 'testId', 'v'));
  });
});

describe('RuntimeRegistry — markRejected', () => {
  it('updates status to rejected', async () => {
    const { registry } = await tempRegistry();
    registry.upsertLocator('el', locator({ value: 'bad' }));
    registry.markRejected('el', 'resourceId', 'bad');
    const loc = registry.allLocators('el').find((l) => l.value === 'bad');
    assert.equal(loc?.status, 'rejected');
  });
});

describe('RuntimeRegistry — markExpired', () => {
  it('sets status to expired and records validUntil', async () => {
    const { registry } = await tempRegistry();
    registry.upsertLocator('el', locator({ value: 'old-version' }));
    registry.markExpired('el', 'resourceId', 'old-version');
    const loc = registry.allLocators('el').find((l) => l.value === 'old-version');
    assert.equal(loc?.status, 'expired');
    assert.ok(loc?.validUntil, 'validUntil should be set');
  });
});

describe('RuntimeRegistry — platform filtering', () => {
  it('returns platform-specific locator when platform matches', async () => {
    const { registry } = await tempRegistry();
    registry.upsertLocator('el', locator({ value: 'android-val', platform: 'android', status: 'verified' }));
    registry.upsertLocator('el', locator({ strategy: 'testId', value: 'ios-val', platform: 'ios', status: 'verified' }));
    assert.equal(registry.bestLocator('el', 'android')?.value, 'android-val');
    assert.equal(registry.bestLocator('el', 'ios')?.value, 'ios-val');
  });

  it('fallback to platform-agnostic locator when no platform set', async () => {
    const { registry } = await tempRegistry();
    registry.upsertLocator('el', locator({ value: 'universal', status: 'verified' }));
    assert.equal(registry.bestLocator('el', 'android')?.value, 'universal');
    assert.equal(registry.bestLocator('el', 'ios')?.value, 'universal');
  });

  it('platform-specific does not match different platform', async () => {
    const { registry } = await tempRegistry();
    registry.upsertLocator('el', locator({ value: 'android-only', platform: 'android', status: 'verified' }));
    // No iOS locator and no universal — should return undefined
    assert.equal(registry.bestLocator('el', 'ios'), undefined);
  });
});

describe('RuntimeRegistry — persistence', () => {
  it('save and reload preserves all data', async () => {
    const { registry, dir } = await tempRegistry();
    const filePath = path.join(dir, 'runtime-registry.json');
    registry.upsertLocator('el', locator({ value: 'persisted', confidence: 0.88 }));
    await registry.save();

    const reloaded = await RuntimeRegistry.load(filePath);
    const best = reloaded.bestLocator('el');
    assert.equal(best?.value, 'persisted');
    assert.equal(best?.confidence, 0.88);
  });
});
