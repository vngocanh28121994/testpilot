/**
 * Which build and which device pool a workflow hands to Device Farm.
 *
 * `cfg.farm` is a snapshot of whichever platform was used last — the Device
 * Farm tab rewrites the whole block on every run, and uploading an app sets
 * `farm.platform` from the file extension. So a workflow that ticks the other
 * platform inherits the wrong build and the wrong pool: an .ipa uploaded as
 * ANDROID_APP, against a pool that holds no Android devices at all.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ConfigSchema } from '../../config.js';
import { resolveFarmTarget } from '../../farm/target.js';

/** Mirrors the shape of the real project: farm last used for iOS. */
const cfg = ConfigSchema.parse({
  web: { baseUrl: 'https://example.com' },
  android: { app: 'build/app_prod.apk', appPackage: 'com.example' },
  ios: { app: 'build/App.ipa', bundleId: 'com.example' },
  farm: {
    platform: 'ios',
    appPath: 'build/App.ipa',
    devicePoolArn: 'arn:pool/iphones',
    devicePools: { ios: 'arn:pool/iphones', android: 'arn:pool/galaxies' },
  },
});

test('the platform actually asked for decides the build, not the last one used', () => {
  assert.equal(resolveFarmTarget(cfg, 'android').appPath, 'build/app_prod.apk');
  assert.equal(resolveFarmTarget(cfg, 'ios').appPath, 'build/App.ipa');
});

test('each platform gets its own pool', () => {
  assert.equal(resolveFarmTarget(cfg, 'android').devicePoolArn, 'arn:pool/galaxies');
  assert.equal(resolveFarmTarget(cfg, 'ios').devicePoolArn, 'arn:pool/iphones');
});

/** A config from before pools were remembered per platform: iOS only. */
const older = ConfigSchema.parse({
  web: { baseUrl: 'https://example.com' },
  ios: { app: 'build/App.ipa' },
  farm: { platform: 'ios', appPath: 'build/App.ipa', devicePoolArn: 'arn:pool/iphones' },
});

test('the stored pool still serves the platform it belongs to', () => {
  assert.equal(resolveFarmTarget(older, 'ios').devicePoolArn, 'arn:pool/iphones');
});

test('and is refused for the platform it does not, with what to do about it', () => {
  // Refused rather than reused: sending an Android run to a pool of iPhones
  // spends the upload and the queue wait to learn nothing.
  assert.throws(() => resolveFarmTarget(older, 'android'), /device pool cho android/);
});

test('a platform with no build of its own is refused before anything is uploaded', () => {
  const noAndroidBuild = ConfigSchema.parse({
    web: { baseUrl: 'https://example.com' },
    ios: { app: 'build/App.ipa' },
    farm: {
      platform: 'ios',
      appPath: 'build/App.ipa',
      devicePools: { android: 'arn:pool/galaxies' },
    },
  });
  // The .ipa must not travel as the Android build just because it is the one
  // `farm.appPath` happens to hold.
  assert.throws(() => resolveFarmTarget(noAndroidBuild, 'android'), /bản build cho android/);
});

test('the central build wins over the farm\'s own legacy slot', () => {
  // `farm.appPath` used to be written by a separate uploader that guessed the
  // platform from the file extension, so it could drift from the build every
  // other run installs. It survives only as a fallback for configs written
  // before there was one store.
  const drifted = ConfigSchema.parse({
    web: { baseUrl: 'https://example.com' },
    ios: { app: 'build/App-new.ipa' },
    farm: {
      platform: 'ios',
      appPath: 'build/App-stale.ipa',
      devicePoolArn: 'arn:pool/iphones',
    },
  });
  assert.equal(resolveFarmTarget(drifted, 'ios').appPath, 'build/App-new.ipa');
});

test('the legacy slot still serves a config that has nothing else', () => {
  const legacyOnly = ConfigSchema.parse({
    web: { baseUrl: 'https://example.com' },
    farm: { platform: 'ios', appPath: 'build/App.ipa', devicePoolArn: 'arn:pool/iphones' },
  });
  assert.equal(resolveFarmTarget(legacyOnly, 'ios').appPath, 'build/App.ipa');
});
