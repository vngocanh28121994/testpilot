/**
 * Runner tải bản build của job nó ĐANG GIỮ — và chỉ thế thôi.
 *
 * Route này đọc file trên máy chủ và gửi ra ngoài. Nhận một đường dẫn từ
 * runner là mở cửa cho bất cứ ai cầm một token runner đọc file tuỳ ý —
 * `.testpilot.secrets.json` trước tiên. Nên runner chỉ đưa mã job; máy chủ tự
 * tra file từ job, và chỉ khi đúng runner ấy đang giữ nó.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { runnerRoutes } from '../runner.js';
import { MemoryJobQueue } from '../../queue/memoryQueue.js';
import type { RouteContext } from '../types.js';
import type { Repos } from '../../db/repo.js';

let tmp: string;
let apk: string;
beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'tp-rb-'));
  apk = path.join(tmp, 'app.apk');
  await writeFile(apk, 'nội dung bản build');
});
afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

/** Response thật đủ để `pipeline` ghi vào, và gom lại byte nhận được. */
function capture() {
  const chunks: Buffer[] = [];
  const out: { status?: number; headers?: Record<string, string>; body: string } = { body: '' };
  const res = new Writable({
    write(chunk, _enc, done) { chunks.push(Buffer.from(chunk)); done(); },
  }) as unknown as ServerResponse & { writeHead: unknown };
  (res as unknown as { writeHead: (s: number, h?: Record<string, string>) => unknown }).writeHead =
    (status: number, headers?: Record<string, string>) => { out.status = status; out.headers = headers; return res; };
  const origEnd = res.end.bind(res);
  (res as unknown as { end: (c?: unknown) => unknown }).end = (chunk?: unknown) => {
    if (chunk) chunks.push(Buffer.from(String(chunk)));
    return origEnd();
  };
  return { res, out, body: () => Buffer.concat(chunks).toString('utf8') };
}

async function setup(runnerId: string, claim = true, size = Buffer.byteLength('nội dung bản build')) {
  const queue = new MemoryJobQueue();
  const job = await queue.create({
    orgId: 'org-1', kind: 'run_suite', createdBy: 'u1',
    spec: {
      orgId: 'org-1', kind: 'run_suite', createdBy: 'u1', timeoutMs: 60_000, deviceTokens: [],
      run: {
        platform: 'android', appSource: 'upload',
        appBuild: { key: apk, name: 'app.apk', sha256: 'a'.repeat(64), size },
      },
    },
  });
  if (claim) await queue.claim({ runnerId: 'r1' });
  const ctx = {
    identity: { userId: runnerId, orgId: 'org-1', email: '', role: 'runner_user' },
    repos: { queue } as unknown as Repos,
  } as unknown as RouteContext;
  return { ctx, jobId: job.id };
}

async function call(ctx: RouteContext, jobId: string) {
  const c = capture();
  await runnerRoutes['GET /api/runner/build']!(
    {} as IncomingMessage, c.res, new URL(`http://x/api/runner/build?job=${jobId}`), ctx,
  );
  return c;
}

describe('GET /api/runner/build', () => {
  it('runner đang giữ job nhận đúng file, kèm cỡ', async () => {
    const { ctx, jobId } = await setup('r1');
    const c = await call(ctx, jobId);
    assert.equal(c.out.status, 200);
    assert.equal(c.body(), 'nội dung bản build');
    assert.equal(c.out.headers?.['content-length'], String(Buffer.byteLength('nội dung bản build')));
  });

  it('runner KHÁC không lấy được, kể cả khi biết mã job', async () => {
    const { ctx, jobId } = await setup('r2');
    const c = await call(ctx, jobId);
    assert.equal(c.out.status, 404);
    assert.doesNotMatch(c.body(), /nội dung bản build/);
  });

  it('job chưa ai nhận thì không ai lấy được', async () => {
    const { ctx, jobId } = await setup('r1', false);
    assert.equal((await call(ctx, jobId)).out.status, 404);
  });

  it('file đã bị thay kể từ lúc đặt job thì nói ngay, không gửi 200 MB để runner tự phát hiện', async () => {
    const { ctx, jobId } = await setup('r1', true, 999);
    const c = await call(ctx, jobId);
    assert.equal(c.out.status, 409);
    assert.match(c.body(), /đã được thay/);
  });
});
