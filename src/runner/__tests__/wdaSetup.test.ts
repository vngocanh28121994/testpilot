/**
 * Cài WebDriverAgent cho một iPhone mới.
 *
 * Kiểu hỏng thật đã gặp: iPhone 16 Pro Max cắm vào, lượt chạy dùng WDA cài sẵn,
 * và máy chưa có trong provisioning profile của WDA — profile chỉ liệt kê máy
 * cũ. Bước sửa là một lần build với `-allowProvisioningDeviceRegistration`, và
 * trước đây không ai biết phải làm thế nếu không có người chỉ.
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { bestProfile, explainBuildFailure, setupWda, type Sh } from '../wdaSetup.js';
import type { TestPilotConfig } from '../../config.js';

const APP_ID = 'TEAM1.com.me.WDA.xctrunner';
const cfg = {
  ios: { teamId: 'TEAM1', wdaBundleId: 'com.me.WDA', usePreinstalledWDA: true },
} as TestPilotConfig;

const profile = (expires: string, devices: string[], appId = APP_ID) =>
  ({ file: 'x', expires, devices, appId });

describe('bestProfile', () => {
  const now = new Date('2026-09-26T00:00:00Z');

  it('lấy bản còn hạn lâu nhất của đúng bundle', () => {
    const picked = bestProfile([
      profile('2026-09-28T00:00:00Z', ['A']),
      profile('2026-10-02T00:00:00Z', ['A', 'B']),
      profile('2026-12-01T00:00:00Z', ['A'], 'TEAM1.com.khac.xctrunner'),
    ], APP_ID, now);
    assert.deepEqual(picked?.devices, ['A', 'B']);
  });

  it('bỏ bản đã hết hạn', () => {
    assert.equal(bestProfile([profile('2026-09-20T00:00:00Z', ['A'])], APP_ID, now), undefined);
  });
});

describe('explainBuildFailure', () => {
  it('Xcode chưa đăng nhập thì nói đúng chỗ đăng nhập', () => {
    assert.match(explainBuildFailure('error: No Accounts: Add a new account in Accounts settings.'), /Settings › Accounts/);
  });

  it('hết lượt đăng ký máy thì nói đúng chỗ xoá bớt', () => {
    assert.match(explainBuildFailure('error: You have reached the maximum number of registered iPhone devices'), /developer\.apple\.com/);
  });
});

describe('setupWda — iPhone mới chưa có trong profile', () => {
  async function fixture(devices: string[]) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wda-test-'));
    const profiles = path.join(root, 'profiles');
    await mkdir(profiles);
    await writeFile(path.join(profiles, 'a.mobileprovision'), 'x');
    const appiumHome = path.join(root, 'appium');
    await mkdir(path.join(appiumHome, 'node_modules', 'appium-xcuitest-driver', 'node_modules',
      'appium-webdriveragent', 'WebDriverAgent.xcodeproj'), { recursive: true });
    process.env.APPIUM_HOME = appiumHome;

    const calls: Array<{ file: string; args: string[] }> = [];
    const run: Sh = async (file, args) => {
      calls.push({ file, args });
      if (file === 'security') return { ok: true, stdout: 'decoded', stderr: '' };
      if (file === 'plutil') {
        const key = args[1];
        if (key === 'ExpirationDate') return { ok: true, stdout: '2099-01-01T00:00:00Z', stderr: '' };
        if (key === 'ProvisionedDevices') return { ok: true, stdout: JSON.stringify(devices), stderr: '' };
        return { ok: true, stdout: APP_ID, stderr: '' };
      }
      if (file === 'xcodebuild') {
        return { ok: false, stdout: '', stderr: 'error: No Accounts: Add a new account in Accounts settings.' };
      }
      return { ok: false, stdout: '', stderr: 'không giả lập' };
    };
    return { calls, run, profiles };
  }

  it('build một lần với cờ đăng ký máy, nhắm đúng chiếc máy mới', async () => {
    const { calls, run, profiles } = await fixture(['MAY-CU']);
    await assert.rejects(setupWda(cfg, 'MAY-MOI', () => {}, run, profiles), /Settings › Accounts/);

    const build = calls.find((call) => call.file === 'xcodebuild');
    assert.ok(build, 'phải build để Xcode đăng ký máy');
    assert.ok(build.args.includes('-allowProvisioningDeviceRegistration'));
    assert.ok(build.args.includes('-allowProvisioningUpdates'));
    assert.ok(build.args.includes('id=MAY-MOI'));
    assert.ok(build.args.includes('PRODUCT_BUNDLE_IDENTIFIER=com.me.WDA'));
    assert.ok(build.args.includes('DEVELOPMENT_TEAM=TEAM1'));
  });

  it('máy đã có trong profile thì KHÔNG build lại', async () => {
    const { calls, run, profiles } = await fixture(['MAY-CU', 'MAY-MOI']);
    // Đi tiếp tới bước tải bản dựng sẵn — ở đây giả lập hỏng, đủ để dừng.
    await assert.rejects(setupWda(cfg, 'MAY-MOI', () => {}, run, profiles));
    assert.equal(calls.some((call) => call.file === 'xcodebuild'), false);
  });

  it('thiếu team ký thì dừng ngay, nói chỗ điền', async () => {
    await assert.rejects(
      setupWda({ ios: {} } as TestPilotConfig, 'X', () => {}),
      /ios\.teamId/,
    );
  });
});
