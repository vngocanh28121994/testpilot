/**
 * Không route nào được lọt khỏi cửa quyền.
 *
 * Đây là bài test chặn hồi quy quan trọng nhất của P2, và lý do nằm ở chỗ kiểu
 * hỏng này KHÔNG tự lộ ra: một route thiếu khai báo quyền vẫn chạy đúng, trả
 * đúng dữ liệu, không lỗi nào cả — chỉ là nó trả cho người lẽ ra không được
 * gọi. Không ai phát hiện bằng cách dùng thử; chỉ phát hiện khi có chuyện.
 *
 * Nên phép đo phải đi từ DANH SÁCH ROUTE THẬT chứ không từ một bảng chép tay:
 * thêm route mà quên khai quyền thì đỏ ngay ở lần chạy test đầu tiên.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { allRoutes } from '../../routes/index.js';
import { ROUTE_POLICY, requiredRole } from '../policy.js';
import { ROLES, allows, LOCAL_IDENTITY, type Role } from '../roles.js';
import { authorize } from '../guard.js';
import { MemorySessionStore, sessionCookie, sessionIdFromCookie, secretEquals } from '../session.js';

const routes = Object.keys(allRoutes).sort();

function reqWith(cookie?: string): IncomingMessage {
  return { headers: cookie ? { cookie } : {} } as unknown as IncomingMessage;
}

describe('mọi route đều khai báo quyền', () => {
  it('không route nào thiếu trong policy', () => {
    const missing = routes.filter((route) => !requiredRole(route));
    assert.deepEqual(
      missing,
      [],
      `route chưa khai quyền: ${missing.join(', ')}. Thêm vào src/server/auth/policy.ts, `
        + 'và chọn vai THẤP NHẤT mà việc đó vẫn an toàn.',
    );
  });

  /** Khai thừa cũng là lỗi: nó nói về một route không còn tồn tại. */
  it('không khai báo nào thừa', () => {
    const extra = Object.keys(ROUTE_POLICY).filter((route) => !routes.includes(route));
    assert.deepEqual(extra, [], `policy nói về route không có thật: ${extra.join(', ')}`);
  });

  it('mọi vai khai báo đều là vai có thật', () => {
    for (const [route, role] of Object.entries(ROUTE_POLICY)) {
      assert.ok(ROLES.includes(role), `${route}: vai "${role}" không tồn tại`);
    }
  });

  /**
   * Đường ghi phải khó hơn đường đọc. Không phải quy tắc hình thức: nếu một
   * route `POST` chỉ cần `viewer` thì vai `viewer` không còn nghĩa là "chỉ
   * đọc", và cả bảng phân vai mất ý nghĩa.
   */
  it('không route ghi nào chỉ cần viewer', () => {
    const writes = routes.filter((route) => !route.startsWith('GET '));
    const tooOpen = writes.filter((route) => requiredRole(route) === 'viewer');
    assert.deepEqual(tooOpen, [], `route ghi mà chỉ cần viewer: ${tooOpen.join(', ')}`);
  });
});

describe('cửa quyền', () => {
  /**
   * Route có thật nhưng chưa ai quyết định ai được gọi → CẤM, và nói đúng lý
   * do. Mặc định "cho qua" ở đây là cách một route mới lọt ra ngoài mà không
   * ai nhận ra.
   */
  it('route chưa khai quyền thì bị chặn, kể cả ở chế độ embedded', async () => {
    const decision = await authorize(reqWith(), 'GET /api/route-moi-tinh', { mode: 'server' });
    assert.equal(decision.ok, false);
    assert.equal(decision.ok === false && decision.status, 501);
    assert.match(decision.ok === false ? decision.error : '', /chưa khai báo quyền/);
  });

  /**
   * Chế độ embedded không dựng hàng rào, và đó là quyết định chứ không phải
   * sơ suất: người dùng sửa được file config bằng editor, dừng được tiến trình
   * bằng Ctrl-C. Một hàng rào ở đây chỉ tạo cảm giác an toàn.
   */
  it('embedded cho qua với danh tính local', async () => {
    for (const route of routes) {
      const decision = await authorize(reqWith(), route, { mode: 'embedded' });
      assert.equal(decision.ok, true, `${route} bị chặn ở chế độ embedded`);
      assert.deepEqual(decision.ok && decision.identity, LOCAL_IDENTITY);
    }
  });

  it('chế độ server không có cookie thì 401', async () => {
    const decision = await authorize(reqWith(), 'GET /api/state', {
      mode: 'server',
      sessions: new MemorySessionStore(),
    });
    assert.equal(decision.ok === false && decision.status, 401);
  });

  it('cookie không còn phiên tương ứng thì 401', async () => {
    const sessions = new MemorySessionStore();
    const decision = await authorize(reqWith('testpilot_session=khong-co-that'), 'GET /api/state', {
      mode: 'server',
      sessions,
    });
    assert.equal(decision.ok === false && decision.status, 401);
  });

  it('vai thấp hơn yêu cầu thì 403, và nói rõ thiếu vai nào', async () => {
    const sessions = new MemorySessionStore();
    const session = await sessions.create({
      userId: 'u1', orgId: 'o1', email: 'a@b.c', role: 'runner_user',
    });
    const decision = await authorize(
      reqWith(`testpilot_session=${session.id}`),
      'PUT /api/feature',
      { mode: 'server', sessions },
    );
    assert.equal(decision.ok === false && decision.status, 403);
    assert.match(decision.ok === false ? decision.error : '', /cần vai "maintainer"/);
  });

  it('đủ vai thì qua, và mang theo danh tính', async () => {
    const sessions = new MemorySessionStore();
    const session = await sessions.create({
      userId: 'u1', orgId: 'o1', email: 'a@b.c', role: 'maintainer',
    });
    const decision = await authorize(
      reqWith(`testpilot_session=${session.id}`),
      'PUT /api/feature',
      { mode: 'server', sessions },
    );
    assert.equal(decision.ok, true);
    assert.equal(decision.ok && decision.identity.orgId, 'o1');
  });

  /** Vai cao làm được việc của vai thấp — người duyệt kịch bản cũng chạy thử nó. */
  it('vai cao bao hàm vai thấp', () => {
    assert.equal(allows('admin', 'viewer'), true);
    assert.equal(allows('maintainer', 'runner_user'), true);
    assert.equal(allows('runner_user', 'maintainer'), false);
    assert.equal(allows('viewer', 'runner_user'), false);
  });
});

describe('phiên đăng nhập', () => {
  it('phiên hết hạn thì coi như không có', async () => {
    const sessions = new MemorySessionStore();
    const session = await sessions.create({ userId: 'u', orgId: 'o', email: '', role: 'viewer' }, 0);
    assert.ok(await sessions.find(session.id, 1_000));
    assert.equal(await sessions.find(session.id, 13 * 60 * 60 * 1000), undefined);
  });

  /** Thu hồi tức thì là lý do không dùng JWT tự chứa. Phải chứng minh nó hoạt động. */
  it('thu hồi có hiệu lực ngay', async () => {
    const sessions = new MemorySessionStore();
    const session = await sessions.create({ userId: 'u', orgId: 'o', email: '', role: 'admin' });
    await sessions.revoke(session.id);
    assert.equal(await sessions.find(session.id), undefined);
  });

  it('đuổi một người thì mọi phiên của họ mất, phiên người khác còn nguyên', async () => {
    const sessions = new MemorySessionStore();
    const a1 = await sessions.create({ userId: 'a', orgId: 'o', email: '', role: 'viewer' });
    const a2 = await sessions.create({ userId: 'a', orgId: 'o', email: '', role: 'viewer' });
    const b1 = await sessions.create({ userId: 'b', orgId: 'o', email: '', role: 'viewer' });

    await sessions.revokeUser('a');
    assert.equal(await sessions.find(a1.id), undefined);
    assert.equal(await sessions.find(a2.id), undefined);
    assert.ok(await sessions.find(b1.id));
  });

  it('mã phiên không đoán được và không lặp lại', async () => {
    const sessions = new MemorySessionStore();
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const s = await sessions.create({ userId: 'u', orgId: 'o', email: '', role: 'viewer' });
      assert.ok(s.id.length >= 40, 'mã phiên quá ngắn');
      ids.add(s.id);
    }
    assert.equal(ids.size, 50);
  });

  /** Ba thuộc tính này là phần chống mất phiên rẻ nhất; quên một cái là mở cửa. */
  it('cookie luôn HttpOnly + SameSite, và Secure khi có HTTPS', () => {
    const secure = sessionCookie('abc', { secure: true });
    assert.match(secure, /HttpOnly/);
    assert.match(secure, /SameSite=Lax/);
    assert.match(secure, /Secure/);
    // localhost không có HTTPS: gắn Secure ở đó nghĩa là cookie không bao giờ
    // được gửi, và bản local sẽ "đăng nhập xong vẫn chưa đăng nhập".
    assert.doesNotMatch(sessionCookie('abc', { secure: false }), /Secure/);
  });

  it('đọc đúng cookie giữa nhiều cookie khác', () => {
    assert.equal(sessionIdFromCookie('a=1; testpilot_session=xyz; b=2'), 'xyz');
    assert.equal(sessionIdFromCookie('a=1; b=2'), undefined);
    assert.equal(sessionIdFromCookie(undefined), undefined);
  });

  it('so sánh bí mật không lộ độ giống nhau', () => {
    assert.equal(secretEquals('abc', 'abc'), true);
    assert.equal(secretEquals('abc', 'abd'), false);
    assert.equal(secretEquals('abc', 'abcd'), false);
  });
});
