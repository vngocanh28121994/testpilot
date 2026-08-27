import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ConfigSchema } from '../../config.js';
import { parseAdbDevices, parseBootedSimulators, preflight, preflightSummary, resolveDevice } from '../preflight.js';

/**
 * The parsers matter more than they look: `adb` and `simctl` both pad their
 * output with lines that are not devices, and treating one of those as a device
 * would report a ready environment that cannot run anything.
 */

test('adb output distinguishes usable devices from ones merely plugged in', () => {
  const devices = parseAdbDevices(
    'List of devices attached\n'
    + 'R58M123ABCD\tdevice\n'
    + 'emulator-5554\tdevice\n'
    + '1234567890\tunauthorized\n'
    + 'ZY223KLMNO\toffline\n',
  );
  assert.deepEqual(devices.map((d) => d.state), ['device', 'device', 'unauthorized', 'offline']);
  assert.equal(devices.filter((d) => d.state === 'device').length, 2);
});

test('adb daemon chatter is not mistaken for a device', () => {
  const devices = parseAdbDevices(
    'List of devices attached\n'
    + '* daemon not running; starting now at tcp:5037\n'
    + '* daemon started successfully\n'
    + 'R58M123ABCD\tdevice\n',
  );
  // The daemon lines split into two words as well, so shape alone is not a
  // filter; the guard is that their second word is not an adb state. They must
  // be dropped entirely, not merely counted as unusable — a device called "*"
  // would otherwise be reported on screen as a phone needing attention.
  assert.deepEqual(devices, [{ serial: 'R58M123ABCD', state: 'device' }]);
});

test('an empty adb list is no devices, not one blank device', () => {
  assert.deepEqual(parseAdbDevices('List of devices attached\n\n'), []);
});

test('only booted simulators count', () => {
  const names = parseBootedSimulators(JSON.stringify({
    devices: {
      'com.apple.CoreSimulator.SimRuntime.iOS-17-0': [
        { name: 'iPhone 15', state: 'Booted' },
        { name: 'iPhone 15 Pro', state: 'Shutdown' },
      ],
      'com.apple.CoreSimulator.SimRuntime.iOS-16-4': [{ name: 'iPhone 14', state: 'Booted' }],
    },
  }));
  assert.deepEqual(names.sort(), ['iPhone 14', 'iPhone 15']);
});

test('unparseable simctl output yields no devices rather than throwing', () => {
  assert.deepEqual(parseBootedSimulators('xcrun: error: unable to find utility'), []);
});

test('web needs only a base URL, and says so without probing anything', async () => {
  const cfg = ConfigSchema.parse({ web: { baseUrl: 'https://example.com' } });
  const result = await preflight('web', cfg);
  assert.equal(result.ok, true);
  assert.equal(result.checks.length, 1);
  assert.match(preflightSummary(result), /sẵn sàng/);
});

test('the summary names every failing check, so a log line is actionable', () => {
  const summary = preflightSummary({
    platform: 'android',
    ok: false,
    checks: [
      { name: 'Thiết bị Android', ok: false, detail: 'Chưa có máy nào kết nối.' },
      { name: 'Appium server', ok: true, detail: 'Đang chạy ở 127.0.0.1:4723.' },
      { name: 'Bản build', ok: false, detail: 'Không thấy file build/app.apk.' },
    ],
  });
  assert.match(summary, /Thiết bị Android/);
  assert.match(summary, /Bản build/);
  // Passing checks are not repeated: the point of the line is what to fix.
  assert.doesNotMatch(summary, /Appium/);
});


/**
 * The device roster is a list of machines the suite *may* run on, and the only
 * question a workflow needs answered is whether exactly one of them is here.
 * Getting this wrong is not cosmetic: demanding all of them be attached reports
 * a failure for the ordinary case of having unplugged the other phone, and
 * failing to pin the one that is attached leaves the run to refuse for want of
 * `--device`.
 */

const twoPhones = ConfigSchema.parse({
  web: { baseUrl: 'https://example.com' },
  android: {
    appPackage: 'com.example',
    devices: [
      { id: 'sm-s918b', deviceName: 'SM_S918B', udid: 'R5CW525G35Y' },
      { id: 'sm-s938b', deviceName: 'SM_S938B', udid: 'R5CY21WADDY' },
    ],
  },
});

test('one rostered phone attached resolves to that phone, by its config id', () => {
  const r = resolveDevice(twoPhones, 'android', ['R5CY21WADDY'], 'R5CY21WADDY');
  assert.equal(r.device, 'sm-s938b');
  assert.equal(r.check.ok, true);
  // The other phone being unplugged is the ordinary case, and must not be
  // reported as a problem — that was the meaningless message this replaces.
  assert.doesNotMatch(r.check.detail, /R5CW525G35Y/);
});

test('both rostered phones attached is refused rather than guessed', () => {
  const r = resolveDevice(twoPhones, 'android', ['R5CW525G35Y', 'R5CY21WADDY'], 'R5CW525G35Y, R5CY21WADDY');
  assert.equal(r.device, undefined);
  assert.equal(r.check.ok, false);
  // Running on the wrong phone is the failure nobody catches: the report is
  // green and describes a device that was never under test.
  assert.match(r.check.detail, /sm-s918b/);
  assert.match(r.check.detail, /sm-s938b/);
});

test('a phone attached that the config does not know names both sides', () => {
  const r = resolveDevice(twoPhones, 'android', ['UNKNOWN123'], 'UNKNOWN123');
  assert.equal(r.device, undefined);
  assert.equal(r.check.ok, false);
  assert.match(r.check.detail, /UNKNOWN123/);
  assert.match(r.check.detail, /sm-s918b/);
});

test('a config with no device list needs no choice and pins nothing', () => {
  const plain = ConfigSchema.parse({
    web: { baseUrl: 'https://example.com' },
    android: { appPackage: 'com.example' },
  });
  const r = resolveDevice(plain, 'android', ['R5CY21WADDY'], 'R5CY21WADDY');
  assert.equal(r.device, undefined);
  assert.equal(r.check.ok, true);
});

test('a matched device is named by its config id, which is what --device takes', () => {
  const r = resolveDevice(twoPhones, 'android', ['R5CW525G35Y'], 'R5CW525G35Y');
  // The serial is what `adb` shows and the id is what the run needs; both are
  // in the line so the two can be tied together.
  assert.match(r.check.detail, /sm-s918b/);
  assert.match(r.check.detail, /R5CW525G35Y/);
});

/**
 * With two phones on the desk somebody has to say which one. The choice is a
 * preference, not a command: honouring a stored pick whose device is no longer
 * attached would run the suite somewhere else and report green about a handset
 * that was never under test.
 */

/** The same roster, plus a saved choice. */
function withPick(id: string) {
  return ConfigSchema.parse({
    web: { baseUrl: 'https://example.com' },
    android: {
      appPackage: 'com.example',
      devices: [
        { id: 'sm-s918b', deviceName: 'SM_S918B', udid: 'R5CW525G35Y' },
        { id: 'sm-s938b', deviceName: 'SM_S938B', udid: 'R5CY21WADDY' },
      ],
    },
    workflow: { platforms: ['android'], devices: { android: id } },
  });
}

const bothSerials = ['R5CW525G35Y', 'R5CY21WADDY'];

test('with two attached and no choice, both are offered rather than one guessed', () => {
  const r = resolveDevice(twoPhones, 'android', bothSerials, bothSerials.join(', '));
  assert.equal(r.check.ok, false);
  assert.equal(r.device, undefined);
  assert.deepEqual(r.candidates?.map((c) => c.id), ['sm-s918b', 'sm-s938b']);
  // The label carries the serial too, so the list matches what `adb` shows.
  assert.match(r.candidates![0]!.label, /R5CW525G35Y/);
});

test('a saved choice settles it and pins that device', () => {
  const r = resolveDevice(withPick('sm-s918b'), 'android', bothSerials, bothSerials.join(', '));
  assert.equal(r.check.ok, true);
  assert.equal(r.device, 'sm-s918b');
  // Still offered, so the pick can be changed without unplugging anything.
  assert.equal(r.candidates?.length, 2);
});

test('an unsaved choice from the screen settles it the same way', () => {
  const r = resolveDevice(twoPhones, 'android', bothSerials, bothSerials.join(', '), 'sm-s938b');
  assert.equal(r.check.ok, true);
  assert.equal(r.device, 'sm-s938b');
});

test('the override wins over a stale saved choice', () => {
  const r = resolveDevice(withPick('sm-s918b'), 'android', bothSerials, bothSerials.join(', '), 'sm-s938b');
  assert.equal(r.device, 'sm-s938b');
});

test('a choice whose device was unplugged is refused, not quietly swapped', () => {
  // sm-s918b was picked, but only the other phone is attached now.
  const r = resolveDevice(withPick('sm-s918b'), 'android', bothSerials, bothSerials.join(', '), 'sm-s000x');
  assert.equal(r.check.ok, false);
  assert.equal(r.device, undefined);
  assert.match(r.check.detail, /sm-s000x/);
});

test('a single attached device needs no choice, so nothing is offered', () => {
  const r = resolveDevice(twoPhones, 'android', ['R5CY21WADDY'], 'R5CY21WADDY');
  assert.equal(r.device, 'sm-s938b');
  assert.equal(r.candidates, undefined);
});
