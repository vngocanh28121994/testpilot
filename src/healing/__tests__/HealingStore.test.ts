import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Registry } from '../../core/registry.js';
import type { LocatorCandidate, ScenarioResult } from '../../core/types.js';
import { HealingStore } from '../HealingStore.js';

const oldLocator: LocatorCandidate = {
  strategy: 'testId', value: 'old-login', weight: 0.95, origin: 'authored',
};
const newLocator: LocatorCandidate = {
  strategy: 'css', value: 'button.login', weight: 0.8, origin: 'healed',
};

function result(): ScenarioResult {
  return {
    scenario: {
      id: 'login', name: 'Login', tags: ['@login'], platforms: ['web'], steps: [],
    },
    platform: 'web',
    device: 'Pixel 7',
    runs: [{
      attempt: 1,
      status: 'passed',
      startedAt: '2026-08-17T00:00:00.000Z',
      durationMs: 1,
      steps: [{
        step: {
          keyword: 'When', text: 'I tap "Login"', line: 1,
          intent: { kind: 'tap', element: 'login.submit' },
        },
        status: 'healed', durationMs: 1, attempts: 1,
        heal: { elementId: 'login.submit', from: oldLocator, to: newLocator },
      }],
    }],
    verdict: 'passed',
  };
}

test('accumulates healing evidence across runs and is idempotent', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'testpilot-healing-'));
  try {
    const registryFile = path.join(dir, 'elements.json');
    const dbFile = path.join(dir, 'healing.json');
    await writeFile(registryFile, JSON.stringify({
      version: 1,
      screens: { login: { id: 'login', title: 'Login' } },
      elements: {
        'login.submit': {
          id: 'login.submit', label: 'Login', screen: 'login',
          candidates: { web: [oldLocator, newLocator] },
        },
      },
    }));

    const registry = await Registry.load(registryFile);
    const store = await HealingStore.load(dbFile);
    assert.equal(store.ingest('run-1', [result()]), 1);
    assert.equal(store.ingest('run-1', [result()]), 0, 'same report must not double count');
    assert.equal(store.ingest('run-2', [result()]), 1);
    assert.equal(store.suggestions(registry).length, 0, 'two successes are below threshold');
    assert.equal(store.ingest('run-3', [result()]), 1);
    await store.save();

    const reloaded = await HealingStore.load(dbFile);
    const suggestions = reloaded.suggestions(registry);
    assert.equal(suggestions.length, 1);
    assert.equal(suggestions[0]?.elementId, 'login.submit');
    assert.equal(suggestions[0]?.successes, 3);
    assert.equal(suggestions[0]?.runs, 3);
    assert.equal(suggestions[0]?.proposed.value, 'button.login');

    const record = reloaded.records()[0]!;
    assert.equal(record.status, 'proposed');
    assert.deepEqual(record.runIds, ['run-1', 'run-2', 'run-3']);
    registry.promoteCandidate(record.elementId, record.platform, record.proposed);
    assert.equal(registry.candidates('login.submit', 'web')[0]?.value, 'button.login');
    assert.equal(registry.candidates('login.submit', 'web')[0]?.weight, 1);

    reloaded.review(record.id, 'rejected');
    assert.equal(reloaded.records()[0]?.status, 'rejected');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/** Same heal, but seen on a named device. */
function resultOn(device: string): ScenarioResult {
  return { ...result(), device };
}

test('pools evidence across devices while recording where it came from', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'testpilot-healing-dev-'));
  try {
    const registryFile = path.join(dir, 'elements.json');
    await writeFile(registryFile, JSON.stringify({
      version: 1,
      screens: { login: { id: 'login', title: 'Login' } },
      elements: {
        'login.submit': {
          id: 'login.submit', label: 'Login', screen: 'login',
          candidates: { web: [oldLocator, newLocator] },
        },
      },
    }));
    const registry = await Registry.load(registryFile);
    const store = await HealingStore.load(path.join(dir, 'healing.json'));

    // Three devices, one run each. Keyed per device this would be three entries
    // of one success apiece and nothing would ever reach the threshold.
    store.ingest('run-a', [resultOn('Pixel 7')]);
    store.ingest('run-b', [resultOn('Galaxy S23')]);
    store.ingest('run-c', [resultOn('Pixel 7')]);

    assert.equal(store.records().length, 1, 'one locator, one entry');
    const record = store.records()[0]!;
    assert.equal(record.successes, 3, 'evidence pools, so the threshold is reached');
    assert.deepEqual(record.devices, { 'Pixel 7': 2, 'Galaxy S23': 1 });
    assert.equal(record.deviceCount, 2);
    assert.equal(record.status, 'proposed');

    assert.equal(store.suggestions(registry).length, 1, 'one device minimum by default');
    assert.equal(store.suggestions(registry, 3, 2, 2).length, 1, 'two devices agreed');
    assert.equal(
      store.suggestions(registry, 3, 2, 3).length, 0,
      'a third device never saw it, so a stricter suite holds the proposal back',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('evidence recorded before the breakdown existed still counts as one device', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'testpilot-healing-legacy-'));
  try {
    const registryFile = path.join(dir, 'elements.json');
    await writeFile(registryFile, JSON.stringify({
      version: 1,
      screens: { login: { id: 'login', title: 'Login' } },
      elements: {
        'login.submit': {
          id: 'login.submit', label: 'Login', screen: 'login',
          candidates: { web: [oldLocator, newLocator] },
        },
      },
    }));
    const dbFile = path.join(dir, 'healing.json');
    // A database written before `devices` was a field.
    await writeFile(dbFile, JSON.stringify({
      version: 1,
      ingestedRuns: { 'run-1': 'x', 'run-2': 'x' },
      entries: {
        'login.submit::web::deadbeef': {
          elementId: 'login.submit', platform: 'web',
          from: oldLocator, to: newLocator,
          successes: 4, runIds: ['run-1', 'run-2'],
          firstSeen: '2026-01-01T00:00:00.000Z', lastSeen: '2026-01-02T00:00:00.000Z',
        },
      },
    }));

    const registry = await Registry.load(registryFile);
    const store = await HealingStore.load(dbFile);
    const record = store.records()[0]!;
    assert.equal(record.deviceCount, 1, 'it happened somewhere; 0 would be a lie');
    assert.deepEqual(record.devices, {});
    assert.equal(store.suggestions(registry).length, 1, 'an existing proposal survives');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
