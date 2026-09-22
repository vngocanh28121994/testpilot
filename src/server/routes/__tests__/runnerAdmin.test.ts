/**
 * "Thêm máy của tôi", và ai được đụng vào máy của ai.
 *
 * Bài đáng giá nhất ở đây là những lần TỪ CHỐI. Vai `runner_user` của hai
 * người là giống nhau, nhưng máy thì của riêng từng người — nên vai không trả
 * lời được câu "ai được thu hồi token máy này". Đây là cùng hình dạng phân
 * quyền với lease ở P3.7, và nó dễ bị viết lại sai ở lần sửa sau.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { runnerAdminRoutes } from '../runnerAdmin.js';
import { MemoryRunnerRegistry } from '../../runners/memoryRegistry.js';
import type { Repos } from '../../db/repo.js';
import type { Identity } from '../../auth/roles.js';
import type { RouteContext } from '../types.js';

function person(userId: string, role: Identity['role'] = 'runner_user'): Identity {
  return { userId, orgId: 'org-1', email: `${userId}@x.dev`, role };
}

function fakeRes(): { res: ServerResponse; out: { status?: number; body: Record<string, unknown> } } {
  const out: { status?: number; body: Record<string, unknown> } = { body: {} };
  let raw = '';
  const res = {
    writeHead(status: number) { out.status = status; return this; },
    end(chunk?: unknown) {
      if (chunk) raw += String(chunk);
      try { out.body = JSON.parse(raw) as Record<string, unknown>; } catch { out.body = {}; }
    },
  } as unknown as ServerResponse;
  return { res, out };
}

function context(identity: Identity, runners: MemoryRunnerRegistry): RouteContext {
  return {
    configFile: 'testpilot.config.json',
    configProfile: { owner: 't', source: 'personal' },
    identity,
    repos: {} as unknown as Repos,
    runners,
  };
}

async function call(
  route: string,
  identity: Identity,
  runners: MemoryRunnerRegistry,
  body?: unknown,
) {
  const { res, out } = fakeRes();
  const req = Readable.from(
    body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')],
  ) as IncomingMessage;
  await runnerAdminRoutes[route]!(
    req, res, new URL(`http://x${route.split(' ')[1]}`), context(identity, runners),
  );
  return out as { status: number; body: Record<string, unknown> };
}

const AN = person('an');
const BINH = person('binh');
const BOSS = person('sep', 'admin');

describe('POST /api/runners', () => {
  it('thêm máy của mình thì token hiện MỘT lần, kèm lời nhắc', async () => {
    const runners = new MemoryRunnerRegistry();
    const out = await call('POST /api/runners', AN, runners, { name: 'laptop của An' });

    assert.equal(out.status, 200);
    assert.ok(typeof out.body.token === 'string' && (out.body.token as string).length > 30);
    assert.match(String(out.body.note), /một lần/);

    const runner = out.body.runner as Record<string, unknown>;
    assert.equal(runner.ownerUserId, 'an');
    assert.equal(runner.mode, 'personal', 'mặc định là máy cá nhân');
    assert.equal(runner.visibility, 'private', 'laptop của một người không mở cho cả đội');
    assert.ok(!('tokenHash' in runner), 'hash không bao giờ đi ra ngoài');
  });

  it('máy phải có tên', async () => {
    const out = await call('POST /api/runners', AN, new MemoryRunnerRegistry(), { name: '  ' });
    assert.equal(out.status, 400);
  });

  /**
   * Một người tự biến laptop mình thành máy dùng chung rồi tắt đi là cách làm
   * hỏng hàng đợi của cả đội mà không cố ý.
   */
  it('người thường không tạo được máy dùng chung', async () => {
    const runners = new MemoryRunnerRegistry();
    for (const body of [
      { name: 'lab-01', mode: 'lab' },
      { name: 'lab-01', visibility: 'shared' },
    ]) {
      const out = await call('POST /api/runners', AN, runners, body);
      assert.equal(out.status, 403, JSON.stringify(body));
    }

    const boss = await call('POST /api/runners', BOSS, runners,
      { name: 'lab-01', mode: 'lab', visibility: 'shared' });
    assert.equal(boss.status, 200);
    assert.equal((boss.body.runner as Record<string, unknown>).visibility, 'shared');
  });
});

describe('GET /api/runners', () => {
  /** Danh sách laptop cá nhân của cả công ty là thứ không ai cần nhìn. */
  it('máy riêng của người khác KHÔNG hiện', async () => {
    const runners = new MemoryRunnerRegistry();
    await call('POST /api/runners', AN, runners, { name: 'laptop của An' });
    await call('POST /api/runners', BINH, runners, { name: 'laptop của Bình' });
    await call('POST /api/runners', BOSS, runners,
      { name: 'lab-01', mode: 'lab', visibility: 'shared' });

    const seen = (await call('GET /api/runners', AN, runners)).body.runners as Array<{
      name: string;
    }>;
    assert.deepEqual(seen.map((r) => r.name).sort(), ['lab-01', 'laptop của An']);
  });

  it('admin thấy hết', async () => {
    const runners = new MemoryRunnerRegistry();
    await call('POST /api/runners', AN, runners, { name: 'laptop của An' });
    await call('POST /api/runners', BINH, runners, { name: 'laptop của Bình' });

    const seen = (await call('GET /api/runners', BOSS, runners)).body.runners as unknown[];
    assert.equal(seen.length, 2);
  });
});

describe('đổi và thu hồi token', () => {
  async function makeRunnerOf(owner: Identity, runners: MemoryRunnerRegistry) {
    const created = await call('POST /api/runners', owner, runners, { name: `máy ${owner.userId}` });
    return {
      id: (created.body.runner as { id: string }).id,
      token: created.body.token as string,
    };
  }

  it('chủ máy đổi được token, và token cũ chết', async () => {
    const runners = new MemoryRunnerRegistry();
    const { id, token } = await makeRunnerOf(AN, runners);

    const out = await call('POST /api/runners/rotate', AN, runners, { id });
    assert.equal(out.status, 200);
    assert.notEqual(out.body.token, token);
    assert.equal(await runners.findByToken(token), undefined);
    assert.ok(await runners.findByToken(String(out.body.token)));
  });

  /** Vai giống nhau không có nghĩa quyền giống nhau — cùng luật với lease. */
  it('người khác KHÔNG đổi và KHÔNG thu hồi được máy của tôi', async () => {
    const runners = new MemoryRunnerRegistry();
    const { id, token } = await makeRunnerOf(AN, runners);

    assert.equal((await call('POST /api/runners/rotate', BINH, runners, { id })).status, 403);
    assert.equal((await call('POST /api/runners/revoke', BINH, runners, { id })).status, 403);
    assert.ok(await runners.findByToken(token), 'token phải còn nguyên');
  });

  it('admin thu hồi được máy của người khác', async () => {
    const runners = new MemoryRunnerRegistry();
    const { id, token } = await makeRunnerOf(AN, runners);

    assert.equal((await call('POST /api/runners/revoke', BOSS, runners, { id })).status, 200);
    assert.equal(await runners.findByToken(token), undefined);
    assert.ok(await runners.find(id), 'dòng vẫn còn để lịch sử job còn nghĩa');
  });

  it('máy không có thì 404', async () => {
    const runners = new MemoryRunnerRegistry();
    assert.equal(
      (await call('POST /api/runners/revoke', AN, runners, { id: 'runner:khong-co' })).status,
      404,
    );
  });
});
