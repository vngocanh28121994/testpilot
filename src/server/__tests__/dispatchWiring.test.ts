/**
 * Đăng nhập xong thì route phải chấp nhận phiên đó.
 *
 * Nghe hiển nhiên, và nó đã hỏng thật ngày 2026-09-21: `dispatch` nhận kho
 * phiên qua tham số, còn `server.ts` gọi `dispatch` mà quên truyền kho ấy vào.
 * Hệ quả: đăng nhập thành công, `/api/auth/me` nói "đã đăng nhập", và MỌI
 * route khác trả 401. Người dùng thấy một vòng lặp đăng nhập không lối ra.
 *
 * Mọi test đều xanh lúc ấy, vì test của cửa quyền tự truyền kho vào — chỗ hỏng
 * nằm đúng ở đoạn nối hai phần đã được test riêng. Bài test này đo đoạn nối.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dispatch } from '../dispatch.js';
import { MemorySessionStore } from '../auth/session.js';

const bootstrap = readFileSync('src/ui/server.ts', 'utf8');

function fakeRes(): { res: ServerResponse; out: { status?: number; body: string } } {
  const out: { status?: number; body: string } = { body: '' };
  const res = {
    writeHead(status: number) { out.status = status; return this; },
    end(chunk?: unknown) { if (chunk) out.body += String(chunk); },
  } as unknown as ServerResponse;
  return { res, out };
}

const ctx = {
  configFile: 'testpilot.config.json',
  configProfile: { owner: 'test', source: 'personal' as const },
};

describe('dispatch nối đúng kho phiên', () => {
  it('có phiên hợp lệ thì route đọc được đi qua', async () => {
    const sessions = new MemorySessionStore();
    const session = await sessions.create({
      userId: 'u1', orgId: 'o1', email: 'a@b.c', role: 'viewer',
    });
    const { res, out } = fakeRes();
    await dispatch(
      { method: 'GET', headers: { cookie: `testpilot_session=${session.id}` } } as IncomingMessage,
      res,
      new URL('http://x/api/auth/me'),
      { mode: 'server', sessions, ...ctx },
    );
    assert.notEqual(out.status, 401, 'phiên hợp lệ mà vẫn 401 — kho phiên chưa được nối');
  });

  /**
   * Quên truyền kho phiên thì MỌI route đều 401, kể cả với cookie đúng. Đây
   * chính là hình dạng của lỗi đã xảy ra, viết lại thành một phép đo.
   */
  it('thiếu kho phiên thì phiên hợp lệ cũng bị từ chối', async () => {
    const sessions = new MemorySessionStore();
    const session = await sessions.create({
      userId: 'u1', orgId: 'o1', email: 'a@b.c', role: 'admin',
    });
    const { res, out } = fakeRes();
    await dispatch(
      { method: 'GET', headers: { cookie: `testpilot_session=${session.id}` } } as IncomingMessage,
      res,
      new URL('http://x/api/state'),
      { mode: 'server', ...ctx },
    );
    assert.equal(out.status, 401);
  });

  /** Và bản khởi động thật phải truyền nó. Đây là dòng đã bị quên. */
  it('server.ts truyền kho phiên vào dispatch', () => {
    const call = bootstrap.slice(bootstrap.indexOf('return dispatch('));
    assert.match(
      call.slice(0, 260),
      /\bsessions\b/,
      'server.ts gọi dispatch mà không truyền `sessions` — đăng nhập sẽ không có tác dụng',
    );
    assert.match(bootstrap, /from '\.\.\/server\/auth\/state\.js'/, 'phải dùng chung kho với route đăng nhập');
  });
});
