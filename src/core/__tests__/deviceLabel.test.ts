/**
 * Tên hiển thị của máy phải do đội quyết, không do người cầm máy.
 *
 * Ba nguồn, và hai trong ba không dùng được:
 *
 *  - `deviceName` là capability của Appium, không phải nhãn cho người đọc.
 *  - `settings global device_name` (cũng là tên trên Bluetooth) là bất cứ thứ
 *    gì người dùng đã gõ — trên máy thật nó ra "S25 Ultra của Ngoc". Một phòng
 *    lab đặt tên lung tung là danh sách chọn máy vô dụng.
 *
 * Nên có trường `label` riêng, nằm trong repo.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig } from '../../config.js';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function configWith(devices: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'tp-cfg-'));
  const file = path.join(dir, 'testpilot.config.json');
  writeFileSync(file, JSON.stringify({
    web: { baseUrl: 'https://example.com' },
    android: { deviceName: 'Android Device', devices },
    accounts: [],
  }), 'utf8');
  return file;
}

describe('device.label', () => {
  it('đọc được và giữ nguyên', async () => {
    const cfg = await loadConfig(configWith([
      { id: 'sm-s938b', deviceName: 'SM_S938B', udid: 'R5C', label: 'Galaxy S25 Ultra' },
    ]));
    assert.equal(cfg.android.devices?.[0]?.label, 'Galaxy S25 Ultra');
  });

  /** Không đặt cũng phải chạy: nhãn là trang trí, không phải điều kiện. */
  it('không có label thì config vẫn hợp lệ', async () => {
    const cfg = await loadConfig(configWith([
      { id: 'sm-s918b', deviceName: 'SM_S918B', udid: 'R5D' },
    ]));
    assert.equal(cfg.android.devices?.[0]?.label, undefined);
    assert.equal(cfg.android.devices?.[0]?.id, 'sm-s918b');
  });
});
