import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Registry } from '../registry.js';
import { mergeRunLearnings, writeLearned } from '../learned.js';
import { DEFAULT_FLAKE_POLICY } from '../../flaky/detector.js';
import type { ElementRegistry } from '../types.js';

/**
 * These cover the one thing that makes a parallel run safe: several processes
 * learning against the same files without erasing each other. The interesting
 * case is not that a merge happens, it is that the numbers come out right when
 * every process started from the same non-zero baseline.
 */

const SHARED: ElementRegistry = {
  version: 1,
  screens: {},
  elements: {
    'login.submitButton': {
      id: 'login.submitButton',
      label: 'Nút đăng nhập',
      screen: 'login',
      candidates: {
        web: [{ strategy: 'css', value: 'button.btn-login', weight: 0.95, origin: 'authored' }],
      },
      health: { resolutions: 10, heals: 2, winners: { 'css:button.btn-login': 10 } },
    },
  },
};

let dir = '';
let registryPath = '';

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'testpilot-learned-'));
  registryPath = path.join(dir, 'elements.json');
  await writeFile(registryPath, JSON.stringify(SHARED, null, 2));
});

/** One device's run: load the shared file, learn something, report the delta. */
async function deviceRun(resolutions: number, candidateValue: string) {
  const registry = await Registry.load(registryPath);
  for (let i = 0; i < resolutions; i++) {
    registry.recordResolution('login.submitButton', 'web', {
      strategy: 'css', value: 'button.btn-login', weight: 0.95, origin: 'authored',
    });
  }
  registry.upsertElement({
    id: 'login.submitButton',
    label: 'Nút đăng nhập',
    screen: 'login',
    candidates: { web: [{ strategy: 'label', value: candidateValue, weight: 0.7, origin: 'healed' }] },
  });
  return registry.changesSinceLoad();
}

describe('registry deltas across parallel runs', () => {
  it('reports only what a run added, not the baseline it started from', async () => {
    const delta = await deviceRun(3, 'Đăng nhập');
    const element = delta.elements['login.submitButton'];

    assert.equal(element?.health?.resolutions, 3, 'the 10 already on disk are not re-reported');
    assert.equal(element?.candidates.web?.length, 1, 'only the newly learned candidate');
    assert.equal(element?.candidates.web?.[0]?.value, 'Đăng nhập');
  });

  it('reports nothing for a run that learned nothing', async () => {
    const registry = await Registry.load(registryPath);
    assert.deepEqual(registry.changesSinceLoad().elements, {});
  });

  it('sums three devices onto the shared baseline exactly once', async () => {
    const deltas = [
      await deviceRun(3, 'Đăng nhập'),
      await deviceRun(5, 'Sign in'),
      await deviceRun(2, 'Login'),
    ];

    const shared = await Registry.load(registryPath);
    for (const delta of deltas) shared.mergeFrom(delta);

    const health = shared.raw.elements['login.submitButton']?.health;
    // 10 on disk + 3 + 5 + 2. Merging end states instead of deltas would give
    // 30 + 10, because each device carried the same starting 10 back with it.
    assert.equal(health?.resolutions, 20);
    assert.equal(health?.winners['css:button.btn-login'], 20);

    const values = shared.raw.elements['login.submitButton']?.candidates.web?.map((c) => c.value);
    assert.deepEqual(
      [...(values ?? [])].sort(),
      ['Login', 'Sign in', 'button.btn-login', 'Đăng nhập'].sort(),
      'every device keeps the locator it found',
    );
  });

  it('is unchanged by merging the same delta twice minus the counters', async () => {
    const delta = await deviceRun(3, 'Đăng nhập');
    const shared = await Registry.load(registryPath);
    shared.mergeFrom(delta);
    const afterOne = shared.raw.elements['login.submitButton']?.candidates.web?.length;
    shared.mergeFrom(delta);
    assert.equal(
      shared.raw.elements['login.submitButton']?.candidates.web?.length,
      afterOne,
      'a replayed delta must not duplicate candidates',
    );
  });
});

describe('mergeRunLearnings', () => {
  it('folds every run directory in and reports the ones that carried nothing', async () => {
    const runsRoot = path.join(dir, 'runs');
    const dirs: string[] = [];
    for (const [i, value] of ['Đăng nhập', 'Sign in'].entries()) {
      const runDir = path.join(runsRoot, `run-${i}`);
      await mkdir(runDir, { recursive: true });
      await writeLearned(runDir, {
        registry: await deviceRun(i + 1, value),
        runtime: { version: 1, entries: {} },
      });
      await writeFile(
        path.join(runDir, 'report.json'),
        JSON.stringify({ report: { runId: `r${i}`, startedAt: '', finishedAt: '', results: [], healSuggestions: [], quarantined: [] } }),
      );
      dirs.push(runDir);
    }
    // A device that died before writing anything must be visible, not silent.
    const empty = path.join(runsRoot, 'run-dead');
    await mkdir(empty, { recursive: true });
    dirs.push(empty);

    const summary = await mergeRunLearnings({
      runDirs: dirs,
      runsRoot,
      registryPath,
      runtimeRegistryPath: path.join(dir, 'runtime.json'),
      flakeDbPath: path.join(dir, 'flake.json'),
      healingDbPath: path.join(dir, 'healing.json'),
      flakePolicy: DEFAULT_FLAKE_POLICY,
    });

    assert.equal(summary.runIds.length, 3);
    assert.ok(summary.skipped.some((s) => s.runId === 'run-dead'), 'the empty run is reported');

    const merged = JSON.parse(await readFile(registryPath, 'utf8')) as ElementRegistry;
    assert.equal(merged.elements['login.submitButton']?.health?.resolutions, 13, '10 + 1 + 2');
  });

  it('consumes each learned.json so a second merge cannot double-count it', async () => {
    const runsRoot = path.join(dir, 'runs');
    const runDir = path.join(runsRoot, 'run-0');
    await mkdir(runDir, { recursive: true });
    await writeLearned(runDir, {
      registry: await deviceRun(4, 'Đăng nhập'),
      runtime: { version: 1, entries: {} },
    });
    await writeFile(path.join(runDir, 'report.json'), JSON.stringify({ report: { results: [] } }));

    const merge = () => mergeRunLearnings({
      runDirs: [runDir],
      runsRoot,
      registryPath,
      runtimeRegistryPath: path.join(dir, 'runtime.json'),
      flakeDbPath: path.join(dir, 'flake.json'),
      healingDbPath: path.join(dir, 'healing.json'),
      flakePolicy: DEFAULT_FLAKE_POLICY,
    });

    await merge();
    assert.equal(existsSync(path.join(runDir, 'learned.json')), false, 'the delta is consumed');

    const second = await merge();
    assert.ok(
      second.skipped.some((s) => s.reason === 'no learned.json'),
      'the second pass finds nothing left to apply',
    );

    const after = JSON.parse(await readFile(registryPath, 'utf8')) as ElementRegistry;
    assert.equal(
      after.elements['login.submitButton']?.health?.resolutions,
      14,
      '10 + 4, not 10 + 4 + 4',
    );
  });
});
