/**
 * Phần phục vụ file tĩnh — chốt chặn path traversal và SPA fallback.
 *
 * Code này vừa được chuyển nguyên văn từ `src/ui/server.ts` sang
 * `src/server/http.ts` ở P1.1, và nó chưa từng có test. Nó lại đúng là chỗ
 * P2.5 sẽ thay bằng link có chữ ký của S3 — nên phải có lưới TRƯỚC khi bị đụng
 * vào, không phải sau.
 *
 * Một điều đo được khi chạy thật ngày 2026-09-21: `new URL()` chuẩn hoá `..`
 * trước khi request tới được nhánh `runs/`, nên qua HTTP thì `/runs/../../etc/passwd`
 * biến thành `/etc/passwd` và rơi vào SPA fallback. Chốt chặn dưới đây vẫn cần:
 * nó bảo vệ hợp đồng của chính hàm, cho mọi người gọi về sau.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { serveStaticRequest, serverMode } from '../http.js';

interface Captured {
  status?: number;
  headers: Record<string, string>;
  body: string;
}

function fakeRes(): { res: ServerResponse; out: Captured } {
  const out: Captured = { headers: {}, body: '' };
  const res = {
    writeHead(status: number, headers: Record<string, string> = {}) {
      out.status = status;
      Object.assign(out.headers, headers);
      return this;
    },
    end(chunk?: unknown) {
      if (chunk) out.body += String(chunk);
    },
  } as unknown as ServerResponse;
  return { res, out };
}

const getReq = { method: 'GET', headers: {} } as unknown as IncomingMessage;

/** `URL` tự chuẩn hoá `..`, nên một đường dẫn độc hại phải dựng bằng tay. */
function rawUrl(pathname: string): URL {
  return { pathname } as URL;
}

const cwd = process.cwd();
let workspace: string;

before(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), 'testpilot-static-'));
  await mkdir(path.join(workspace, 'runs', 'r1'), { recursive: true });
  await writeFile(path.join(workspace, 'runs', 'r1', 'index.html'), '<h1>report</h1>', 'utf8');
  await writeFile(path.join(workspace, 'secret.txt'), 'không được lộ', 'utf8');
  process.chdir(workspace);
});

after(() => process.chdir(cwd));

describe('phục vụ artifact của lượt chạy', () => {
  it('trả file trong runs/', async () => {
    const { res, out } = fakeRes();
    const handled = await serveStaticRequest(getReq, res, new URL('http://x/runs/r1/index.html'));

    assert.equal(handled, true);
    assert.equal(out.status, 200);
    assert.match(out.body, /report/);
  });

  /**
   * Chốt chặn thật sự: đường dẫn giải ra ngoài thư mục gốc thì 403, không phải
   * 404. Khác biệt ấy quan trọng — 404 nói "không có file", 403 nói "anh đang
   * đi ra khỏi chỗ được phép", và chỉ câu thứ hai mới đúng.
   */
  it('chặn đường dẫn đi ra ngoài thư mục runs/', async () => {
    const { res, out } = fakeRes();
    const handled = await serveStaticRequest(getReq, res, rawUrl('/runs/../secret.txt'));

    assert.equal(handled, true);
    assert.equal(out.status, 403);
    assert.doesNotMatch(out.body, /không được lộ/);
  });

  it('file không có trong runs/ thì 404, không phải 403', async () => {
    const { res, out } = fakeRes();
    await serveStaticRequest(getReq, res, new URL('http://x/runs/r1/khong-co.png'));
    assert.equal(out.status, 404);
  });
});

describe('bundle React', () => {
  /** Route của React không phải file; trả index.html để client tự định tuyến. */
  it('đường dẫn không có đuôi rơi vào SPA fallback', async () => {
    const { res, out } = fakeRes();
    const handled = await serveStaticRequest(getReq, res, new URL('http://x/settings'));

    assert.equal(handled, true);
    // Chạy trong repo đã build thì là index.html; chưa build thì 503 có lý do.
    assert.ok(out.status === 200 || out.status === 503, `status lạ: ${out.status}`);
  });

  /**
   * Asset thiếu phải là 404 JSON, không phải index.html: trình duyệt nhận HTML
   * ở chỗ chờ JavaScript sẽ báo lỗi cú pháp, và lỗi ấy nói sai hoàn toàn về
   * nguyên nhân.
   */
  it('asset thiếu trả 404 chứ không trả index.html', async () => {
    const { res, out } = fakeRes();
    await serveStaticRequest(getReq, res, new URL('http://x/assets/khong-co.js'));

    if (out.status === 503) return; // Chưa build UI.
    assert.equal(out.status, 404);
    assert.doesNotMatch(out.body, /<!doctype/i);
  });
});

describe('chế độ chạy', () => {
  it('mặc định là embedded — bản local không được vỡ', () => {
    assert.equal(serverMode(undefined), 'embedded');
    assert.equal(serverMode(''), 'embedded');
    assert.equal(serverMode('linh tinh'), 'embedded');
  });

  it('chỉ đúng chữ "server" mới bật chế độ server', () => {
    assert.equal(serverMode('server'), 'server');
    assert.equal(serverMode('  server  '), 'server');
  });

  it('không nhận POST — phần tĩnh chỉ phục vụ GET', async () => {
    const { res } = fakeRes();
    const post = { method: 'POST', headers: {} } as unknown as IncomingMessage;
    assert.equal(await serveStaticRequest(post, res, new URL('http://x/runs/r1/index.html')), false);
  });
});
