import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ScenarioReviewStore } from '../scenarioReview.js';
import { syncPomProject } from '../../pom/sync.js';

const feature = (secondStep = 'Given I open the app') => `Feature: Review gate

  @one
  Scenario: Kịch bản một
    Given I open the app

  @two
  Scenario: Kịch bản hai
    ${secondStep}
`;

test('legacy scenarios bootstrap approved but any content edit becomes pending', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'scenario-review-'));
  const store = await ScenarioReviewStore.load(path.join(dir, 'review.json'));
  const initial = store.syncFile('review.feature', feature(), {
    defaultStatus: 'approved',
    source: 'legacy',
  });
  assert.deepEqual(initial.map((item) => item.status), ['approved', 'approved']);

  const changed = store.syncFile('review.feature', feature('And I scroll down'), {
    defaultStatus: 'pending',
    source: 'manual',
  });
  assert.equal(changed.find((item) => item.scenarioName === 'Kịch bản một')?.status, 'approved');
  assert.equal(changed.find((item) => item.scenarioName === 'Kịch bản hai')?.status, 'pending');
});

test('a scenario added after legacy bootstrap cannot auto-approve itself', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'scenario-review-'));
  const reviewPath = path.join(dir, 'review.json');
  const initialStore = await ScenarioReviewStore.load(reviewPath);
  initialStore.syncFile('review.feature', feature(), {
    defaultStatus: 'approved',
    source: 'legacy',
  });
  await initialStore.save();

  const content = `${feature()}\n  @three\n  Scenario: Kịch bản ba\n    Given I open the app\n`;
  const reloaded = await ScenarioReviewStore.load(reviewPath);
  const entries = reloaded.syncFile('review.feature', content, {
    defaultStatus: 'approved',
    source: 'legacy',
  });
  assert.equal(entries.find((item) => item.scenarioName === 'Kịch bản một')?.status, 'approved');
  assert.equal(entries.find((item) => item.scenarioName === 'Kịch bản ba')?.status, 'pending');
});

test('approval is bound to exact content and edits revoke it', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'scenario-review-'));
  const original = feature();
  const store = await ScenarioReviewStore.load(path.join(dir, 'review.json'));
  store.syncFile('review.feature', original, { defaultStatus: 'pending', source: 'manual' });
  const approved = store.review('review.feature', 'Kịch bản một', original, 'approve');
  assert.equal(approved.status, 'approved');

  const edited = original.replace('Given I open the app', 'Given I scroll down');
  const entries = store.syncFile('review.feature', edited, {
    defaultStatus: 'pending',
    source: 'manual',
  });
  assert.equal(entries.find((item) => item.scenarioName === 'Kịch bản một')?.status, 'pending');
});

test('generated batches are pending even when text matches an approved version', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'scenario-review-'));
  const store = await ScenarioReviewStore.load(path.join(dir, 'review.json'));
  const content = feature();
  store.syncFile('review.feature', content, { defaultStatus: 'approved', source: 'legacy' });
  const generated = store.syncFile('review.feature', content, {
    defaultStatus: 'pending',
    source: 'generated',
    forcePending: true,
  });
  assert.deepEqual(generated.map((item) => item.status), ['pending', 'pending']);
});

test('POM sync emits only approved scenarios', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'scenario-pom-'));
  const featuresDir = path.join(dir, 'features');
  const registryDir = path.join(dir, 'registry');
  const outputDir = path.join(dir, 'generated');
  await mkdir(featuresDir, { recursive: true });
  await mkdir(registryDir, { recursive: true });
  const content = feature();
  await writeFile(path.join(featuresDir, 'review.feature'), content, 'utf8');
  await writeFile(
    path.join(registryDir, 'elements.json'),
    JSON.stringify({ version: 1, screens: {}, elements: {} }),
    'utf8',
  );

  const reviewPath = path.join(registryDir, 'scenario-review.json');
  const store = await ScenarioReviewStore.load(reviewPath);
  store.syncFile('review.feature', content, { defaultStatus: 'pending', source: 'generated' });
  store.review('review.feature', 'Kịch bản một', content, 'approve');
  await store.save();

  await syncPomProject({
    featuresDir,
    registryPath: path.join(registryDir, 'elements.json'),
    scenarioReviewPath: reviewPath,
    outputDir,
  });
  const spec = await readFile(path.join(outputDir, 'tests', 'review.spec.ts'), 'utf8');
  assert.match(spec, /Kịch bản một/);
  assert.doesNotMatch(spec, /Kịch bản hai/);
});
