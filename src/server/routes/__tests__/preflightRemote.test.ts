/**
 * Preflight cho chiếc máy cắm ở RUNNER KHÁC.
 *
 * Endpoint này là thứ CẢ HAI màn đọc — Local Runner và App Automation Studio.
 * Trước đây nó chỉ hỏi `adb` tại máy chủ, nên chọn một chiếc máy ở laptop
 * người khác là thẻ preflight báo đỏ "không nằm trong số đang cắm", dù lượt
 * chạy qua hàng đợi vẫn tới được chiếc máy ấy. Hai màn hình nói sai cùng một
 * câu, và người dùng tin màn hình.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { prereqRoutes } from '../prereq.js';
import { MemoryRunnerRegistry } from '../../runners/memoryRegistry.js';
import { MemoryDeviceRegistry } from '../../devices/memoryRegistry.js';
import { MemoryDeviceGrants } from '../../devices/memoryGrants.js';
import { MemorySessionStore } from '../../auth/session.js';
import type { RouteContext } from '../types.js';
import type { Repos } from '../../db/repo.js';

function fakeRes() {
  const out: { status?: number; body: Record<string, unknown> } = { body: {} };
  let raw = '';
  const res = {
    writeHead(status: number) { out.status = status; return this; },
    setHeader() { return this; },
    write(chunk: string) { raw += chunk; return true; },
    end(chunk?: unknown) {
      if (chunk) raw += String(chunk);
      out.body = JSON.parse(raw) as Record<string, unknown>;
    },
  } as unknown as ServerResponse;
  return { res, out };
}

describe('preflight cho máy ở runner khác', () => {
  it('trả lời bằng thứ runner ấy đã đo, không bằng adb của máy chủ', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'tp-pf-'));
    const configFile = path.join(tmp, 'cfg.json');
    await writeFile(configFile, JSON.stringify({ web: { baseUrl: 'https://x.dev' } }));

    const runners = new MemoryRunnerRegistry();
    const { runner } = await runners.create({
      orgId: 'org-1', name: 'laptop của Bình', mode: 'personal',
      ownerUserId: 'binh', visibility: 'shared',
    });
    await runners.touch(runner.id);
    const devices = new MemoryDeviceRegistry();
    await devices.report(
      { id: runner.id, orgId: 'org-1', visibility: 'shared' },
      [{ platform: 'android', udid: 'R5CY21WADDY', label: 'Samsung SM-S938B' }],
    );

    const ctx = {
      configFile,
      configProfile: { owner: 't', source: 'personal' },
      identity: { userId: 'an', orgId: 'org-1', email: 'an@x.dev', role: 'runner_user' },
      repos: {} as Repos,
      runners, devices,
      grants: new MemoryDeviceGrants(),
      sessions: new MemorySessionStore(),
    } as unknown as RouteContext;

    try {
      const { res, out } = fakeRes();
      await prereqRoutes['GET /api/preflight']!(
        {} as IncomingMessage, res,
        new URL('http://x/api/preflight?platform=android&device=R5CY21WADDY'), ctx,
      );
      const checks = out.body.checks as Array<{ name: string; ok: boolean; detail: string }>;
      assert.equal(out.body.ok, true);
      assert.match(checks[0]!.detail, /laptop của Bình/);
      assert.doesNotMatch(JSON.stringify(checks), /không nằm trong số đang cắm/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
