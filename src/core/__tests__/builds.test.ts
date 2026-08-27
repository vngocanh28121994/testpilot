/**
 * Which package each environment installs.
 *
 * The trap this avoids is inheritance. Every environment of the app shares one
 * bundle id, so a phone cannot tell SIT's build from prod's — an environment
 * pointed at the default one would install prod and log a SIT account into it,
 * and the runner refuses that. So an environment either has its own build or it
 * has none, and a path it merely inherited must never be reported as a build it
 * has.
 */
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { ConfigSchema } from '../../config.js';
import { buildInventory } from '../builds.js';

const ROOT = 'artifacts/test-builds';

async function seed(files: Record<string, number>): Promise<void> {
  await rm(ROOT, { recursive: true, force: true });
  for (const [rel, bytes] of Object.entries(files)) {
    const abs = path.join(ROOT, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, Buffer.alloc(bytes));
  }
}

const cfg = (extra: Record<string, unknown> = {}) => ConfigSchema.parse({
  web: { baseUrl: 'https://example.com' },
  android: { app: `${ROOT}/app.apk` },
  ios: { app: `${ROOT}/App.ipa` },
  ...extra,
});

test('the default environment reads the base config, which is its build', async () => {
  await seed({ 'app.apk': 2 * 1024 * 1024, 'App.ipa': 1024 * 1024 });
  const inv = await buildInventory(cfg({ defaultEnv: 'prod', environments: { prod: {} } }), ROOT);
  const prod = inv.environments.find((e) => e.env === 'prod')!;
  assert.equal(prod.isDefault, true);
  assert.equal(prod.android?.path, `${ROOT}/app.apk`);
  assert.equal(prod.android?.sizeMb, 2);
  assert.equal(prod.ios?.sizeMb, 1);
});

test('an environment with no build of its own has none — not the shared one', async () => {
  await seed({ 'app.apk': 1024, 'App.ipa': 1024 });
  const inv = await buildInventory(
    cfg({ defaultEnv: 'prod', environments: { prod: {}, sit: {} } }),
    ROOT,
  );
  const sit = inv.environments.find((e) => e.env === 'sit')!;
  // The shared file is right there and would install cleanly — that is the
  // danger. Reporting it here would present prod's package as SIT's.
  assert.equal(sit.android, null);
  assert.equal(sit.ios, null);
  assert.equal(sit.missing.length, 0);
});

test("an environment's own build is reported for that environment", async () => {
  await seed({ 'app.apk': 1024, 'App.ipa': 1024, 'sit/app.apk': 3 * 1024 * 1024 });
  const inv = await buildInventory(
    cfg({
      defaultEnv: 'prod',
      environments: { prod: {}, sit: { android: { app: `${ROOT}/sit/app.apk` } } },
    }),
    ROOT,
  );
  const sit = inv.environments.find((e) => e.env === 'sit')!;
  assert.equal(sit.android?.path, `${ROOT}/sit/app.apk`);
  assert.equal(sit.android?.sizeMb, 3);
  // Android only; iOS was never uploaded for SIT.
  assert.equal(sit.ios, null);
});

test('a config pointing at a file that is not there says so', async () => {
  await seed({ 'App.ipa': 1024 });
  const inv = await buildInventory(cfg({ defaultEnv: 'prod', environments: { prod: {} } }), ROOT);
  const prod = inv.environments.find((e) => e.env === 'prod')!;
  // Distinct from "chưa có": something is configured, and Appium will fail on
  // it minutes into a run rather than at the typo.
  assert.equal(prod.android, null);
  assert.deepEqual(prod.missing, [{ platform: 'android', path: `${ROOT}/app.apk` }]);
});

test('a config with no environments still has one row to upload into', async () => {
  await seed({ 'app.apk': 1024, 'App.ipa': 1024 });
  const inv = await buildInventory(cfg(), ROOT);
  assert.equal(inv.environments.length, 1);
  assert.equal(inv.environments[0]!.env, '');
  assert.equal(inv.environments[0]!.isDefault, true);
  assert.equal(inv.environments[0]!.android?.path, `${ROOT}/app.apk`);
  await rm(ROOT, { recursive: true, force: true });
});

test('every configured environment gets a row, in config order', async () => {
  await seed({ 'app.apk': 1024, 'App.ipa': 1024 });
  const inv = await buildInventory(
    cfg({ defaultEnv: 'prod', environments: { sit: {}, uat: {}, prod: {} } }),
    ROOT,
  );
  assert.deepEqual(inv.environments.map((e) => e.env), ['sit', 'uat', 'prod']);
  assert.deepEqual(inv.environments.map((e) => e.isDefault), [false, false, true]);
  await rm(ROOT, { recursive: true, force: true });
});
