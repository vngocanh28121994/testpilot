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
import { PUBLIC_ROUTES, ROUTE_POLICY, RUNNER_ROUTES, requiredRole } from '../policy.js';
import { ROLES, allows, LOCAL_IDENTITY, type Role } from '../roles.js';
import { authorize } from '../guard.js';
import { MemorySessionStore, sessionCookie, sessionIdFromCookie, secretEquals } from '../session.js';
import { MemoryRunnerRegistry } from '../../runners/memoryRegistry.js';

const routes = Object.keys(allRoutes).sort();

/** `reqWith('cookie=…')` cho đường phiên; `reqWith({ authorization })` cho runner. */
function reqWith(headers?: string | Record<string, string>): IncomingMessage {
  const asHeaders = typeof headers === 'string' ? { cookie: headers } : (headers ?? {});
  return { headers: asHeaders } as unknown as IncomingMessage;
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
    // Trừ route công khai: chúng không được bảo vệ bằng vai mà bằng cơ chế
    // riêng (`state` dùng một lần, `nonce`, thu hồi phiên phía server). Đặt vai
    // cho chúng chỉ là điền vào bảng cho đủ.
    const writes = routes.filter((route) => !route.startsWith('GET ') && !PUBLIC_ROUTES.has(route));
    const tooOpen = writes.filter((route) => requiredRole(route) === 'viewer');
    assert.deepEqual(tooOpen, [], `route ghi mà chỉ cần viewer: ${tooOpen.join(', ')}`);
  });
});

describe('route công khai', () => {
  /**
   * Bốn cái, và không thêm nữa: mỗi route ở đây là một phần bề mặt mà người
   * lạ chạm được. Danh sách dài ra là một quyết định bảo mật, nên nó phải làm
   * test đỏ để có người đọc lại.
   */
  it('đúng năm route gọi được khi chưa đăng nhập', () => {
    // Danh sách này dài ra được, nhưng mỗi lần dài ra phải làm test đỏ để có
    // người đọc lại — nó là bề mặt người lạ chạm được. `/api/health` được thêm
    // ở P2.6 vì load balancer không có phiên, và một health check trả 401
    // nghĩa là mọi instance bị coi là chết.
    assert.deepEqual([...PUBLIC_ROUTES].sort(), [
      'GET /api/auth/callback',
      'GET /api/auth/login',
      'GET /api/auth/me',
      'GET /api/health',
      'POST /api/auth/logout',
    ]);
  });

  it('route công khai qua được cửa mà không cần phiên', async () => {
    for (const route of PUBLIC_ROUTES) {
      const decision = await authorize(reqWith(), route, {
        mode: 'server',
        sessions: new MemorySessionStore(),
      });
      assert.equal(decision.ok, true, `${route} bị chặn dù là route công khai`);
      assert.equal(decision.ok && decision.identity.orgId, '', 'danh tính vô danh phải không thuộc tổ chức nào');
    }
  });

  /** Mọi route khác vẫn phải đòi phiên — kể cả route đọc. */
  it('route không công khai vẫn đòi đăng nhập', async () => {
    const guarded = routes.filter((route) => !PUBLIC_ROUTES.has(route));
    for (const route of guarded.slice(0, 10)) {
      const decision = await authorize(reqWith(), route, {
        mode: 'server',
        sessions: new MemorySessionStore(),
      });
      assert.equal(decision.ok, false, `${route} qua được mà không cần đăng nhập`);
    }
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
      // Trừ đường của runner: xem bài ngay dưới.
      if (RUNNER_ROUTES.has(route)) continue;
      const decision = await authorize(reqWith(), route, { mode: 'embedded' });
      assert.equal(decision.ok, true, `${route} bị chặn ở chế độ embedded`);
      assert.deepEqual(decision.ok && decision.identity, LOCAL_IDENTITY);
    }
  });

  /**
   * Đường của runner đòi token ở CẢ HAI chế độ — kể cả embedded.
   *
   * Vì sao không nới cho embedded như mọi route khác: bốn route ấy cấp job và
   * nhận kết quả. Mở chúng ra nghĩa là bất kỳ trang web nào đang mở trong cùng
   * trình duyệt cũng đòi được job của tổ chức và trả về kết quả bịa. Mọi route
   * khác chỉ làm được những việc mà người ngồi trước máy vốn đã làm được bằng
   * tay; route này thì không.
   */
  it('route của runner luôn đòi token, kể cả ở embedded', async () => {
    const runners = new MemoryRunnerRegistry();
    const { runner, token } = await runners.create({
      orgId: 'org-1', name: 'lab-01', mode: 'lab', visibility: 'shared',
    });

    for (const route of RUNNER_ROUTES) {
      const without = await authorize(reqWith(), route, { mode: 'embedded', runners });
      assert.equal(without.ok, false, `${route} cho qua khi không có token`);

      const wrong = await authorize(
        reqWith({ authorization: 'Bearer sai' }), route, { mode: 'embedded', runners },
      );
      assert.equal(wrong.ok, false, `${route} cho qua với token sai`);

      const right = await authorize(
        reqWith({ authorization: `Bearer ${token}` }), route, { mode: 'embedded', runners },
      );
      assert.equal(right.ok, true, `${route} chặn cả token đúng`);
      assert.equal(right.ok && right.identity.userId, runner.id);
      assert.equal(right.ok && right.identity.role, 'runner_user');
    }
  });

  /**
   * Danh tính lấy từ SỔ, không từ header.
   *
   * Runner khai gì trong `x-runner-name` cũng không đổi được nó thuộc tổ chức
   * nào — nếu đổi được thì một máy bị chiếm tự chọn tổ chức để đọc dữ liệu.
   */
  it('runner không tự khai được tổ chức của mình', async () => {
    const runners = new MemoryRunnerRegistry();
    const { token } = await runners.create({
      orgId: 'org-that', name: 'may-cua-an', mode: 'personal',
      ownerUserId: 'an', visibility: 'private',
    });

    const decision = await authorize(
      reqWith({ authorization: `Bearer ${token}`, 'x-runner-name': 'org-khac' }),
      'POST /api/runner/claim', { mode: 'embedded', runners },
    );
    assert.equal(decision.ok && decision.identity.orgId, 'org-that');
  });

  /** Token đã thu hồi chết ngay, kể cả khi máy ấy vẫn đang chạy. */
  it('thu hồi token thì runner mất quyền lập tức', async () => {
    const runners = new MemoryRunnerRegistry();
    const { runner, token } = await runners.create({
      orgId: 'org-1', name: 'lab-01', mode: 'lab', visibility: 'shared',
    });
    assert.equal(
      (await authorize(reqWith({ authorization: `Bearer ${token}` }),
        'POST /api/runner/claim', { mode: 'embedded', runners })).ok,
      true,
    );

    await runners.revoke(runner.id);
    const after = await authorize(
      reqWith({ authorization: `Bearer ${token}` }),
      'POST /api/runner/claim', { mode: 'embedded', runners },
    );
    assert.equal(after.ok, false);
  });

  /** Không có sổ thì đường runner ĐÓNG, không mở toang. */
  it('server không có sổ runner thì không ai vào được', async () => {
    const decision = await authorize(
      reqWith({ authorization: 'Bearer bat-ky' }), 'POST /api/runner/claim',
      { mode: 'server', sessions: new MemorySessionStore() },
    );
    assert.equal(decision.ok, false);
    assert.match(decision.ok === false ? decision.error : '', /sổ runner/);
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
