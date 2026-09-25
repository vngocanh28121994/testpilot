/**
 * Cắm máy Android mới vào mà danh sách thiết bị không hiện gì: điện thoại đang
 * chờ bấm "Cho phép gỡ lỗi USB" (adb báo `unauthorized`), và hệ thống lặng lẽ
 * bỏ những máy không ở trạng thái `device`.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseAdbDevices } from '../androidControl.js';

describe('parseAdbDevices', () => {
  it('máy chưa cho phép gỡ lỗi USB: vẫn báo lên, kèm việc cần làm', () => {
    const out = 'List of devices attached\nR5CY21WADDY            unauthorized usb:0-1 transport_id:20\n';
    const [entry] = parseAdbDevices(out);
    assert.equal(entry?.usable, false);
    assert.match(!entry?.usable ? entry!.unavailable : '', /Cho phép.*gỡ lỗi USB/);
    assert.equal(!entry?.usable ? entry!.label : '', 'Máy Android R5CY21WADDY');
  });

  it('máy dùng được và máy offline cùng lúc', () => {
    const out = [
      'List of devices attached',
      'emulator-5554          device product:sdk model:sdk_gphone64 device:emu64a transport_id:1',
      'R5CW525G35Y            offline usb:0-2 model:SM_S918B transport_id:3',
      '',
    ].join('\n');
    const [ok, off] = parseAdbDevices(out);
    assert.deepEqual(ok, { udid: 'emulator-5554', usable: true });
    assert.equal(off?.usable, false);
    assert.equal(!off?.usable ? off!.label : '', 'SM S918B · R5CW525G35Y');
    assert.match(!off?.usable ? off!.unavailable : '', /Rút cáp cắm lại/);
  });

  it('adb không trả gì: danh sách rỗng', () => {
    assert.deepEqual(parseAdbDevices(''), []);
  });
});
