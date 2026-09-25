/**
 * Route giữ chỗ thiết bị, đo qua chính handler.
 *
 * Phần đáng đo không phải đường thành công, mà là bốn câu trả lời khi KHÔNG
 * được: máy đang có người (409 kèm tên người ấy), lease đã mất (409 kèm lệnh
 * dừng), nhả hộ người khác (từ chối), và cưỡng chế nhả không kèm lý do (từ
 * chối). Cả bốn đều là lúc hai người cùng muốn một chiếc điện thoại, và đó là
 * tình huống thường ngày của một phòng máy dùng chung.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { deviceRoutes } from '../devices.js';
import { MemoryLeaseRepo } from '../../db/leaseRepo.js';
import type { Repos } from '../../db/repo.js';
import type { Identity } from '../../auth/roles.js';
import type { RouteContext } from '../types.js';
import { MemoryRunnerRegistry } from '../../runners/memoryRegistry.js';
import { MemoryDeviceGrants } from '../../devices/memoryGrants.js';
import { MemorySessionStore } from '../../auth/session.js';
import { MemoryDeviceRegistry } from '../../devices/memoryRegistry.js';

function fakeRes(): { res: ServerResponse; out: { status?: number; body: unknown } } {
  const out: { status?: number; body: unknown } = { body: undefined };
  let raw = '';
  const res = {
    writeHead(status: number) { out.status = status; return this; },
    end(chunk?: unknown) {
      if (chunk) raw += String(chunk);
      out.body = raw ? JSON.parse(raw) : undefined;
    },
  } as unknown as ServerResponse;
  return { res, out };
}

function person(userId: string, role: Identity['role'] = 'runner_user'): Identity {
  return { userId, orgId: 'org-1', email: `${userId}@example.com`, role };
}

const PEOPLE: Record<string, string> = { 'user-1': 'an@congty.vn', 'user-2': 'binh@congty.vn' };
const people = { displayName: async (id: string) => PEOPLE[id] };
let devices = new MemoryDeviceRegistry();

function context(identity: Identity, leases: MemoryLeaseRepo): RouteContext {
  return {
    configFile: 'testpilot.config.json',
    configProfile: { owner: 't', source: 'personal' },
    identity,
    repos: { leases, people } as unknown as Repos,
    runners: new MemoryRunnerRegistry(),
    devices,
      grants: new MemoryDeviceGrants(),
      sessions: new MemorySessionStore(),
  };
}

async function call(
  route: string,
  identity: Identity,
  leases: MemoryLeaseRepo,
  body?: unknown,
) {
  const { res, out } = fakeRes();
  // Buffer, không phải string: `readJson` gom bằng `Buffer.concat`, đúng như
  // một request thật đưa tới.
  const req = Readable.from(
    body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')],
  ) as IncomingMessage;
  await deviceRoutes[route]!(req, res, new URL(`http://x${route.split(' ')[1]}`),
    context(identity, leases));
  return out as { status: number; body: Record<string, unknown> };
}

const ME = person('user-1');
const YOU = person('user-2');
const BOSS = person('user-9', 'admin');

describe('POST /api/device/lease', () => {
  it('giữ được máy rỗi', async () => {
    const leases = new MemoryLeaseRepo();
    const out = await call('POST /api/device/lease', ME, leases, { deviceId: 'dev-1' });

    assert.equal(out.status, 200);
    const lease = out.body.lease as Record<string, unknown>;
    assert.equal(lease.deviceId, 'dev-1');
    assert.deepEqual(lease.holder, { kind: 'human', userId: 'user-1' });
    assert.ok(!('orgId' in lease), 'mã nội bộ không được đi ra ngoài');
  });

  it('thiếu deviceId thì 400, không phải 500', async () => {
    const out = await call('POST /api/device/lease', ME, new MemoryLeaseRepo(), {});
    assert.equal(out.status, 400);
  });

  /**
   * 409 chứ không phải 403, và kèm tên người đang giữ.
   *
   * 403 sẽ khiến người dùng đi xin quyền cho một việc không liên quan gì tới
   * quyền, còn "không lấy được" mà không nói ai giữ thì họ chỉ còn cách bấm
   * lại mỗi mười giây.
   */
  it('máy đang có người thì 409 và nói rõ ai, tới khi nào', async () => {
    const leases = new MemoryLeaseRepo();
    await call('POST /api/device/lease', ME, leases, { deviceId: 'dev-1' });
    const out = await call('POST /api/device/lease', YOU, leases, { deviceId: 'dev-1' });

    assert.equal(out.status, 409);
    assert.deepEqual(out.body.holder, { kind: 'human', userId: 'user-1' });
    assert.ok(typeof out.body.expiresAt === 'string');
  });

  /**
   * Câu thật đã hiện trên màn hình: 'Thiết bị "00008101-…" đang được
   * 597d89e8-7791-… giữ tới 2026-09-24T09:26:29.496Z.' — udid, mã người dùng,
   * giờ UTC. Không ai đọc ra được đó là máy nào, ai giữ, và bao giờ trống.
   */
  it('câu 409 nói tên máy, email người giữ, và khi nào trống — không mã, không giờ UTC', async () => {
    devices = new MemoryDeviceRegistry();
    await devices.report({ id: 'runner:local', orgId: 'org-1', visibility: 'shared' },
      [{ platform: 'ios', udid: 'dev-1', label: 'iPhone 12 Pro Max · iOS 26.6.1' }]);
    const leases = new MemoryLeaseRepo();
    await call('POST /api/device/lease', ME, leases, { deviceId: 'dev-1' });
    const out = await call('POST /api/device/lease', YOU, leases, { deviceId: 'dev-1' });

    const error = String(out.body.error);
    assert.match(error, /^iPhone 12 Pro Max · iOS 26\.6\.1 đang được an@congty\.vn giữ\./);
    assert.match(error, /Nhả máy/);
    assert.match(error, /1 phút/);
    assert.doesNotMatch(error, /user-1|dev-1|T\d\d:\d\d/);
    devices = new MemoryDeviceRegistry();
  });

  it('máy đang chạy test thì nói thế', async () => {
    const leases = new MemoryLeaseRepo();
    await leases.acquire('dev-1', { kind: 'job', jobId: 'j-1' });
    const byJob = await call('POST /api/device/lease', ME, leases, { deviceId: 'dev-1' });
    assert.match(String(byJob.body.error), /đang chạy một lượt test/);

  });

  /**
   * Hai máy tính cùng đăng nhập `runner` từng cùng cầm MỘT lượt giữ và cùng
   * điều khiển một iPhone: kho lease coi "cùng người giữ lại" là gia hạn.
   */
  it('cùng người giữ lần hai (tab/máy khác): 409 và mời chuyển sang, không dùng chung', async () => {
    const leases = new MemoryLeaseRepo();
    const first = await call('POST /api/device/lease', ME, leases, { deviceId: 'dev-2' });
    const second = await call('POST /api/device/lease', ME, leases, { deviceId: 'dev-2' });
    assert.equal(first.status, 200);
    assert.equal(second.status, 409);
    assert.equal(second.body.sameUser, true);
    assert.match(String(second.body.error), /tab hoặc máy tính khác.*Giữ ở đây/);
  });

  it('"Giữ ở đây": lượt MỚI, khác mã — chỗ cũ mất quyền', async () => {
    const leases = new MemoryLeaseRepo();
    const first = await call('POST /api/device/lease', ME, leases, { deviceId: 'dev-2' });
    const moved = await call('POST /api/device/lease', ME, leases, { deviceId: 'dev-2', takeOver: true });
    const oldId = (first.body.lease as { id: string }).id;
    const newId = (moved.body.lease as { id: string }).id;
    assert.equal(moved.status, 200);
    assert.notEqual(newId, oldId);
    assert.equal((await leases.find('dev-2'))?.id, newId);
  });

  it('takeOver KHÔNG giật được máy của người khác', async () => {
    const leases = new MemoryLeaseRepo();
    await call('POST /api/device/lease', ME, leases, { deviceId: 'dev-3' });
    const out = await call('POST /api/device/lease', YOU, leases, { deviceId: 'dev-3', takeOver: true });
    assert.equal(out.status, 409);
    assert.notEqual(out.body.sameUser, true);
  });
});

describe('GET /api/device/leases', () => {
  it('trả kèm tên người giữ đọc được', async () => {
    const leases = new MemoryLeaseRepo();
    await call('POST /api/device/lease', ME, leases, { deviceId: 'dev-1' });
    const asMe = await call('GET /api/device/leases', ME, leases);
    const asYou = await call('GET /api/device/leases', YOU, leases);
    assert.equal((asMe.body.leases as Array<{ holderLabel: string }>)[0]!.holderLabel, 'bạn');
    assert.equal((asYou.body.leases as Array<{ holderLabel: string }>)[0]!.holderLabel, 'an@congty.vn');
  });
});

describe('POST /api/device/lease/renew', () => {
  it('người đang giữ gia hạn được', async () => {
    const leases = new MemoryLeaseRepo();
    const taken = await call('POST /api/device/lease', ME, leases, { deviceId: 'dev-1' });
    const id = (taken.body.lease as { id: string }).id;

    const out = await call('POST /api/device/lease/renew', ME, leases, { leaseId: id });
    assert.equal(out.status, 200);
  });

  it('người khác gia hạn thì 409 kèm lệnh dừng', async () => {
    const leases = new MemoryLeaseRepo();
    const taken = await call('POST /api/device/lease', ME, leases, { deviceId: 'dev-1' });
    const id = (taken.body.lease as { id: string }).id;

    const out = await call('POST /api/device/lease/renew', YOU, leases, { leaseId: id });
    assert.equal(out.status, 409);
    assert.match(String(out.body.error), /Dừng dùng thiết bị/);
  });
});

describe('POST /api/device/lease/release', () => {
  it('người giữ nhả được, người khác thì không', async () => {
    const leases = new MemoryLeaseRepo();
    const taken = await call('POST /api/device/lease', ME, leases, { deviceId: 'dev-1' });
    const id = (taken.body.lease as { id: string }).id;

    const stolen = await call('POST /api/device/lease/release', YOU, leases, { leaseId: id });
    assert.equal(stolen.status, 409, 'vai đủ để gọi route, nhưng lease không phải của họ');
    assert.ok(await leases.find('dev-1'), 'máy vẫn phải còn trong tay người giữ');

    const mine = await call('POST /api/device/lease/release', ME, leases, { leaseId: id });
    assert.equal(mine.status, 200);
    assert.equal(await leases.find('dev-1'), undefined);
  });
});

describe('POST /api/device/lease/force-release', () => {
  /** Người bị lấy máy sẽ hỏi vì sao, nên câu trả lời phải có sẵn lúc bấm. */
  it('không có lý do thì không cưỡng chế được', async () => {
    const leases = new MemoryLeaseRepo();
    const taken = await call('POST /api/device/lease', ME, leases, { deviceId: 'dev-1' });
    const id = (taken.body.lease as { id: string }).id;

    const out = await call('POST /api/device/lease/force-release', BOSS, leases, { leaseId: id });
    assert.equal(out.status, 400);
    assert.ok(await leases.find('dev-1'), 'từ chối thì không được nhả nửa vời');
  });

  it('có lý do thì nhả, và trả lại ai vừa bị lấy máy', async () => {
    const leases = new MemoryLeaseRepo();
    const taken = await call('POST /api/device/lease', ME, leases, { deviceId: 'dev-1' });
    const id = (taken.body.lease as { id: string }).id;

    const out = await call('POST /api/device/lease/force-release', BOSS, leases,
      { leaseId: id, reason: 'máy treo từ hôm qua' });
    assert.equal(out.status, 200);
    assert.equal(out.body.deviceId, 'dev-1');
    assert.deepEqual(out.body.previousHolder, { kind: 'human', userId: 'user-1' });
    assert.equal(await leases.find('dev-1'), undefined);
  });

  it('lease không còn thì 404', async () => {
    const out = await call('POST /api/device/lease/force-release', BOSS, new MemoryLeaseRepo(),
      { leaseId: 'khong-co', reason: 'dọn' });
    assert.equal(out.status, 404);
  });
});

describe('GET /api/device/leases', () => {
  it('liệt kê ai đang giữ máy nào', async () => {
    const leases = new MemoryLeaseRepo();
    await call('POST /api/device/lease', ME, leases, { deviceId: 'dev-1' });
    await call('POST /api/device/lease', YOU, leases, { deviceId: 'dev-2' });

    const out = await call('GET /api/device/leases', ME, leases);
    assert.equal(out.status, 200);
    const list = out.body.leases as Array<{ deviceId: string }>;
    assert.deepEqual(list.map((lease) => lease.deviceId).sort(), ['dev-1', 'dev-2']);
  });
});
