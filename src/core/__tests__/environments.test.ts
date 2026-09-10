import { strict as assert } from 'node:assert';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ConfigSchema, applyEnv, assertEnvPackage } from '../../config.js';
import { Secrets, accountVariables } from '../secrets.js';
import { appFingerprint, needsReinstall } from '../deviceEnv.js';

const base = (extra: Record<string, unknown> = {}) =>
  ConfigSchema.parse({
    web: { baseUrl: 'https://prod.example.com' },
    ios: { app: 'build/App.ipa' },
    accounts: [
      { label: 'tcbs', username: 'PROD-1' },
      { label: 'tcbs-sit', username: 'SIT-1' },
    ],
    environments: {
      prod: { accounts: { tcbs: 'tcbs' } },
      sit: {
        accounts: { tcbs: 'tcbs-sit' },
        ios: { app: 'build/App-sit.ipa' },
        web: { baseUrl: 'https://sit.example.com' },
      },
    },
    ...extra,
  });

test('applyEnv overlays the environment onto the base config', () => {
  const { config, alias } = applyEnv(base(), 'sit');
  assert.equal(config.ios.app, 'build/App-sit.ipa');
  assert.equal(config.web.baseUrl, 'https://sit.example.com');
  assert.deepEqual(alias, { tcbs: 'tcbs-sit' });
  // Untouched keys survive the overlay.
  assert.equal(config.ios.signingId, 'Apple Development');
});

test('an environment that overrides nothing still resolves', () => {
  const { config, alias } = applyEnv(base(), 'prod');
  assert.equal(config.ios.app, 'build/App.ipa');
  assert.deepEqual(alias, { tcbs: 'tcbs' });
});

test('an unknown environment is refused, and says what exists', () => {
  assert.throws(() => applyEnv(base(), 'uat'), /uat.*prod, sit/s);
});

test('a config with no environments accepts any name unchanged', () => {
  const cfg = ConfigSchema.parse({ web: { baseUrl: 'https://x.test' } });
  const { config, alias } = applyEnv(cfg, 'whatever');
  assert.equal(config.web.baseUrl, 'https://x.test');
  assert.deepEqual(alias, {});
});

test('the role wins over a same-named label', async () => {
  // The trap: `tcbs` is both a role and a real prod label. On a SIT run the
  // feature's {{account.tcbs.username}} must be the SIT account, or the suite
  // logs into prod's app with prod's user and nobody notices.
  const secrets = await Secrets.load('does-not-exist.json');
  const { config, alias } = applyEnv(base(), 'sit');
  const vars = accountVariables(config.accounts, secrets, alias);
  assert.equal(vars['account.tcbs.username'], 'SIT-1');
  // The label itself stays reachable for a feature that really means it.
  assert.equal(vars['account.tcbs-sit.username'], 'SIT-1');
});

test('a role does not inherit the previous account\'s password', async () => {
  // Found by running it: the label pass writes account.tcbs.password from the
  // prod account, then the role pass re-points account.tcbs.username at the SIT
  // account. Leaving the password in place produces a SIT username paired with
  // a prod password — which reads as "resolved" to every check downstream.
  const secrets = await Secrets.load('does-not-exist.json');
  secrets.set('tcbs', 'prod-password');
  const { config, alias } = applyEnv(base(), 'sit');
  const vars = accountVariables(config.accounts, secrets, alias);
  assert.equal(vars['account.tcbs.username'], 'SIT-1');
  assert.equal(vars['account.tcbs.password'], undefined);
});

test('an environment without its own build is refused on native', () => {
  const cfg = base({ defaultEnv: 'prod' });
  // sit declares ios.app, so it is fine on iOS...
  assert.doesNotThrow(() => assertEnvPackage(cfg, 'sit', 'ios'));
  // ...but not on Android, where it declared nothing and would install prod's.
  assert.throws(() => assertEnvPackage(cfg, 'sit', 'android'), /android\.app/);
  // The default environment IS the base config's build.
  assert.doesNotThrow(() => assertEnvPackage(cfg, 'prod', 'ios'));
  assert.doesNotThrow(() => assertEnvPackage(cfg, 'prod', 'android'));
  // Web installs nothing; baseUrl is the whole difference.
  assert.doesNotThrow(() => assertEnvPackage(cfg, 'sit', 'web'));
  // A config with no environments has nothing to check.
  const plain = ConfigSchema.parse({ web: { baseUrl: 'https://x.test' } });
  assert.doesNotThrow(() => assertEnvPackage(plain, 'sit', 'ios'));
});

test('reinstall is required when the device holds another environment', () => {
  const at = '2026-08-20T00:00:00.000Z';
  assert.equal(
    needsReinstall({ env: 'prod', app: 'a.ipa', at }, 'sit', 'a.ipa').reinstall,
    true,
  );
  assert.equal(
    needsReinstall({ env: 'sit', app: 'a.ipa', at }, 'sit', 'a.ipa').reinstall,
    false,
  );
  // A rebuilt package at the same path is a different build.
  assert.equal(
    needsReinstall({ env: 'sit', app: 'a.ipa', at }, 'sit', 'b.ipa').reinstall,
    true,
  );
  // Never recorded, and the default environment asked for: warn, touch nothing.
  // Reinstalling wipes app data, and every handset is unknown exactly once — on
  // the first run, which is the run least expecting its app to be replaced.
  assert.equal(needsReinstall(undefined, 'prod', 'a.ipa', true).reinstall, false);
  assert.equal(needsReinstall(undefined, 'prod', 'a.ipa', true).unknown, true);
  // Never recorded, but a *non-default* environment asked for: install it.
  // Being on that environment's build is the whole request.
  assert.equal(needsReinstall(undefined, 'sit', 'a.ipa', false).reinstall, true);
  // Nothing to install means nothing to enforce.
  assert.equal(needsReinstall(undefined, 'sit', undefined).reinstall, false);
});

/**
 * Bản build mới, cùng đường dẫn.
 *
 * Đây là đường đi bình thường của mọi bản build ở đây: tải lên đè đúng chỗ cũ
 * (`build/App.ipa`). So đường dẫn thì hai bản giống hệt nhau, nên không lượt
 * chạy nào cài lại và điện thoại lặng lẽ chạy bản cũ. Trước khi bật `noReset`
 * chuyện này tự khỏi vì XCUITest cài lại mỗi phiên; giờ thì không.
 */
const at = new Date().toISOString();

test('vân tay: cùng đường dẫn nhưng khác nội dung thì phải cài lại', () => {
  const decision = needsReinstall(
    { env: 'prod', app: 'build/App.ipa', appHash: 'aaa', at }, 'prod', 'build/App.ipa', true, 'bbb',
  );
  assert.equal(decision.reinstall, true);
  assert.match(decision.because, /nội dung/);
});

test('vân tay: cùng nội dung thì để yên', () => {
  assert.equal(
    needsReinstall(
      { env: 'prod', app: 'build/App.ipa', appHash: 'aaa', at }, 'prod', 'build/App.ipa', true, 'aaa',
    ).reinstall,
    false,
  );
});

/**
 * Bản ghi cũ không có trường này. Coi "thiếu vân tay" là "khác vân tay" sẽ bắt
 * mọi máy cài lại đúng một lần ngay sau khi nâng cấp tool — tức là gây ra đúng
 * cái mà tính năng này định tránh.
 */
test('vân tay: bản ghi cũ chưa có vân tay thì không bịa ra lý do cài lại', () => {
  assert.equal(
    needsReinstall({ env: 'prod', app: 'build/App.ipa', at }, 'prod', 'build/App.ipa', true, 'bbb')
      .reinstall,
    false,
  );
});

test('vân tay: không có file thì không có vân tay, và không được ném lỗi', async () => {
  assert.equal(await appFingerprint('build/khong-co-that.ipa'), undefined);
  assert.equal(await appFingerprint(undefined), undefined);
});

test('vân tay: đọc nội dung thật, không phải đường dẫn', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tp-fingerprint-'));
  try {
    const one = path.join(dir, 'a.ipa');
    const two = path.join(dir, 'b.ipa');
    await writeFile(one, 'bản cũ');
    await writeFile(two, 'bản mới');
    const a = await appFingerprint(one);
    const b = await appFingerprint(two);
    assert.ok(a && b);
    assert.notEqual(a, b);
    // Cùng nội dung ở đường dẫn khác vẫn phải ra cùng vân tay.
    await writeFile(two, 'bản cũ');
    assert.equal(await appFingerprint(two), a);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
