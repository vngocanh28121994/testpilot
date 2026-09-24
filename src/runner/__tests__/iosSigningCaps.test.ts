/**
 * iPhone thật hiện trong sổ máy nhưng màn điều khiển đứng mãi ở "đang mở":
 * phiên Appium của màn điều khiển không mang chữ ký WDA, nên xcodebuild hỏng
 * ngay bước ký. Lượt chạy test thì có — hai đường phải ký giống nhau.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { explainWdaStart, signingCaps } from '../iosControl.js';

describe('signingCaps', () => {
  it('simulator: không gửi gì', () => {
    assert.deepEqual(signingCaps(undefined), {});
  });

  it('máy thật build WDA: gửi team, bundle id và cho phép tạo profile', () => {
    const caps = signingCaps({
      teamId: 'TMAP9PAQXM', signingId: 'Apple Development',
      wdaBundleId: 'com.tuoiha17.WebDriverAgentRunner', usePrebuiltWDA: true,
      derivedDataPath: '/dd',
    });
    assert.equal(caps['appium:xcodeOrgId'], 'TMAP9PAQXM');
    assert.equal(caps['appium:updatedWDABundleId'], 'com.tuoiha17.WebDriverAgentRunner');
    assert.equal(caps['appium:allowProvisioningDeviceRegistration'], true);
    assert.equal(caps['appium:usePrebuiltWDA'], true);
    assert.equal(caps['appium:derivedDataPath'], '/dd');
    // Cổng WDA do phiên tự lấy (cổng trống), không lấy từ chữ ký.
    assert.equal(caps['appium:wdaLocalPort'], undefined);
  });

  it('dùng lại WDA đã cài: không gửi cờ ký, để Appium không build lại', () => {
    const caps = signingCaps({ teamId: 'TMAP9PAQXM', wdaBundleId: 'x.y', usePreinstalledWDA: true });
    assert.equal(caps['appium:xcodeOrgId'], undefined);
    assert.equal(caps['appium:usePreinstalledWDA'], true);
    assert.equal(caps['appium:updatedWDABundleId'], 'x.y');
  });
});

describe('explainWdaStart', () => {
  it('code 70: nói tới profile hết hạn', () => {
    assert.match(explainWdaStart('xcodebuild failed with code 70. …'), /profile đã hết hạn/);
  });
  it('code 65: nói tới Tin cậy trên máy', () => {
    assert.match(explainWdaStart('xcodebuild failed with code 65. …'), /Tin cậy/);
  });
  it('máy đang khoá: bảo mở khoá', () => {
    const raw = 'Unable to launch WebDriverAgent. … because the device was not, or could not be, '
      + 'unlocked). … BSErrorCodeDescription = Locked';
    assert.match(explainWdaStart(raw), /đang khoá màn hình/);
  });
  it('lỗi khác: giữ nguyên', () => {
    assert.equal(explainWdaStart('Appium không trả lời kịp.'), 'Appium không trả lời kịp.');
  });
});

describe('sổ phiên điều khiển trên đĩa', () => {
  it('ghi, đọc lại, và xoá theo từng máy', async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const { readSessionRecord, writeSessionRecord } = await import('../iosControl.js');
    const file = path.join(await mkdtemp(path.join(tmpdir(), 'tp-sess-')), 'sub', 's.json');
    assert.deepEqual(await readSessionRecord(file), {});
    await writeSessionRecord('iphone', 'A', file);
    await writeSessionRecord('sim', 'B', file);
    assert.deepEqual(await readSessionRecord(file), { iphone: 'A', sim: 'B' });
    await writeSessionRecord('iphone', undefined, file);
    assert.deepEqual(await readSessionRecord(file), { sim: 'B' });
  });
});
