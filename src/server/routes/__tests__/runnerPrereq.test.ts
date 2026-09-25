/**
 * Máy tự khai môi trường của nó, và server phải lọc lời khai ấy.
 *
 * Runner là dữ liệu từ ngoài như mọi thứ khác đến qua HTTP — kể cả khi nó đến
 * kèm một token hợp lệ. Ba nền tảng, và chỉ ba; `ok` phải là boolean thật, vì
 * một chuỗi "false" là truthy và màn hình sẽ nói "sẵn sàng" về một chiếc máy
 * vừa khai rằng nó không chạy được.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { runnerRoutes } from '../runner.js';
import { MemoryRunnerRegistry } from '../../runners/memoryRegistry.js';
import { MemoryDeviceGrants } from '../../devices/memoryGrants.js';
import { MemorySessionStore } from '../../auth/session.js';
import { MemoryDeviceRegistry } from '../../devices/memoryRegistry.js';
import type { Repos } from '../../db/repo.js';
import type { RouteContext } from '../types.js';

describe('runner báo môi trường của máy nó', () => {
  let runners: MemoryRunnerRegistry;
  let devices: MemoryDeviceRegistry;
  let id: string;

  async function report(body: unknown) {
    const out: { status?: number } = {};
    const res = {
      writeHead(status: number) { out.status = status; return this; },
      end() {},
    } as unknown as ServerResponse;
    const req = Readable.from([Buffer.from(JSON.stringify(body), 'utf8')]) as IncomingMessage;
    const ctx: RouteContext = {
      configFile: 'testpilot.config.json',
      configProfile: { owner: 't', source: 'personal' },
      identity: { userId: id, orgId: 'org-1', email: 'r@x.dev', role: 'runner_user' },
      repos: {} as unknown as Repos,
      runners,
      devices,
      grants: new MemoryDeviceGrants(),
      sessions: new MemorySessionStore(),
    };
    await runnerRoutes['POST /api/runner/devices']!(
      req, res, new URL('http://x/api/runner/devices'), ctx,
    );
    return out;
  }

  beforeEach(async () => {
    runners = new MemoryRunnerRegistry();
    devices = new MemoryDeviceRegistry();
    const made = await runners.create({
      orgId: 'org-1', name: 'laptop', mode: 'personal',
      ownerUserId: 'an', visibility: 'private',
    });
    id = made.runner.id;
  });

  it('giữ nguyên lời khai hợp lệ, kèm lý do', async () => {
    await report({
      devices: [],
      prereq: {
        web: { ok: true, at: '2026-09-23T00:00:00.000Z' },
        android: { ok: false, reason: 'Appium chưa chạy trên máy này.', at: '2026-09-23T00:00:00.000Z' },
      },
    });

    const stored = (await runners.find(id))?.prereq;
    assert.equal(stored?.web?.ok, true);
    assert.equal(stored?.android?.ok, false);
    assert.equal(stored?.android?.reason, 'Appium chưa chạy trên máy này.');
  });

  it('bỏ nền tảng lạ và lời khai không có `ok` là boolean', async () => {
    await report({
      devices: [],
      prereq: {
        web: { ok: true, at: 'now' },
        windows: { ok: true, at: 'now' },
        android: { ok: 'false', at: 'now' },
        ios: { reason: 'thiếu Xcode' },
      },
    });

    const stored = (await runners.find(id))?.prereq;
    assert.deepEqual(Object.keys(stored ?? {}), ['web']);
  });

  it('không gửi prereq thì KHÔNG xoá lời khai trước', async () => {
    // Một nhịp báo cáo hỏng nửa chừng không được làm màn hình quên mất máy ấy
    // thiếu gì — "chưa đo" và "đo rồi, không sao" nhìn khác nhau trên bảng.
    await report({ devices: [], prereq: { web: { ok: true, at: 'now' } } });
    await report({ devices: [] });
    assert.equal((await runners.find(id))?.prereq?.web?.ok, true);
  });

  it('lý do dài bị cắt, không cho một máy đẩy cả trang log vào sổ', async () => {
    await report({
      devices: [],
      prereq: { web: { ok: false, reason: 'x'.repeat(5_000), at: 'now' } },
    });
    assert.equal((await runners.find(id))?.prereq?.web?.reason?.length, 500);
  });

  /**
   * Gợi ý sửa và tunnel từng bị bộ lọc này vứt đi: máy ở laptop người dùng
   * không bao giờ hiện "tunnel chưa chạy" hay nút sửa trên web.
   */
  it('giữ gợi ý sửa Appium và trạng thái tunnel đo trên máy ấy', async () => {
    await report({
      devices: [],
      prereq: {
        android: { ok: false, reason: 'Appium chưa chạy.', fix: 'appium', at: 'now' },
        ios: { ok: true, at: 'now', tunnel: { ok: false, detail: 'Tunnel chưa chạy.', service: true } },
      },
    });
    const stored = (await runners.find(id))?.prereq;
    assert.equal(stored?.android?.fix, 'appium');
    assert.deepEqual(stored?.ios?.tunnel, { ok: false, detail: 'Tunnel chưa chạy.', service: true });
  });

  it('gợi ý sửa lạ bị bỏ, không đi lên màn hình người khác', async () => {
    await report({ devices: [], prereq: { android: { ok: false, fix: 'rm -rf', at: 'now' } } });
    assert.equal((await runners.find(id))?.prereq?.android?.fix, undefined);
  });

  /** Cắm máy mới chưa cho phép gỡ lỗi USB: vẫn vào sổ, tắt, kèm việc cần làm. */
  it('máy chưa dùng được vào sổ ở trạng thái tắt, kèm lý do', async () => {
    await report({
      devices: [{ platform: 'android', udid: 'R5CY', label: 'Máy Android R5CY', unavailable: 'Chưa cho phép gỡ lỗi USB.' }],
    });
    const [device] = await devices.list({ userId: 'an', orgId: 'org-1', isAdmin: true });
    assert.equal(device?.state, 'offline');
    assert.equal(device?.unavailable, 'Chưa cho phép gỡ lỗi USB.');
  });
});
