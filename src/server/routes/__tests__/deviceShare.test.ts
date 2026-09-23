/**
 * Cho một người cụ thể mượn một chiếc máy riêng.
 *
 * Bài đáng giá nhất ở đây là những lần TỪ CHỐI, cùng hình dạng với lease ở
 * P3.7 và token runner ở P4.1: hai người cùng vai `runner_user` là giống nhau
 * ở cửa, nhưng chiếc máy thì của riêng một người — nên vai không trả lời được
 * câu "ai cho mượn được chiếc máy này".
 *
 * Và một tính chất không được phép lung lay: quyền mượn chỉ THÊM. Nó không
 * vượt qua ranh giới tổ chức, và không lấy được máy ra khỏi tay chủ.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { deviceRoutes } from '../devices.js';
import { controlRoutes } from '../control.js';
import { MemoryDeviceRegistry } from '../../devices/memoryRegistry.js';
import { MemoryDeviceGrants } from '../../devices/memoryGrants.js';
import { MemoryRunnerRegistry } from '../../runners/memoryRegistry.js';
import type { Identity, Role } from '../../auth/roles.js';
import type { Repos } from '../../db/repo.js';
import type { RouteContext } from '../types.js';

function person(userId: string, role: Role = 'runner_user'): Identity {
  return { userId, orgId: 'org-1', email: `${userId}@x.dev`, role };
}

function fakeRes(): { res: ServerResponse; out: { status?: number; body: any } } {
  const out: { status?: number; body: any } = { body: {} };
  let raw = '';
  const res = {
    writeHead(status: number) { out.status = status; return this; },
    end(chunk?: unknown) {
      if (chunk) raw += String(chunk);
      try { out.body = JSON.parse(raw); } catch { out.body = {}; }
    },
  } as unknown as ServerResponse;
  return { res, out };
}

describe('chia sẻ máy riêng', () => {
  let devices: MemoryDeviceRegistry;
  let grants: MemoryDeviceGrants;

  function context(identity: Identity): RouteContext {
    return {
      configFile: 'testpilot.config.json',
      configProfile: { owner: 't', source: 'personal' },
      identity,
      repos: {} as unknown as Repos,
      runners: new MemoryRunnerRegistry(),
      devices,
      grants,
    };
  }

  async function call(route: string, identity: Identity, body?: unknown, query = '') {
    const { res, out } = fakeRes();
    const req = Readable.from(
      body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')],
    ) as IncomingMessage;
    const table = route === 'GET /api/device/targets' ? controlRoutes : deviceRoutes;
    const path = route.split(' ')[1]!;
    await table[route]!(req, res, new URL(`http://x${path}${query}`), context(identity));
    return out;
  }

  beforeEach(async () => {
    devices = new MemoryDeviceRegistry();
    grants = new MemoryDeviceGrants();
    // Máy riêng của `an`, cắm vào laptop của chính họ.
    await devices.report(
      { id: 'runner:an', orgId: 'org-1', ownerUserId: 'an', visibility: 'private' },
      [{ platform: 'ios', udid: 'iphone-12', label: 'iPhone 12' }],
    );
    // Máy của phòng lab — của chung, không có chủ.
    await devices.report(
      { id: 'runner:lab', orgId: 'org-1', visibility: 'shared' },
      [{ platform: 'android', udid: 'pixel-7', label: 'Pixel 7' }],
    );
  });

  const targets = async (who: Identity) =>
    (await call('GET /api/device/targets', who)).body.devices.map(
      (device: { udid: string }) => device.udid,
    );

  it('trước khi cho mượn, người khác không thấy máy riêng', async () => {
    assert.deepEqual(await targets(person('binh')), ['pixel-7']);
  });

  it('chủ máy cho mượn thì người kia thấy — và chỉ chiếc máy ấy', async () => {
    const shared = await call('POST /api/device/share', person('an'), {
      udid: 'iphone-12', userId: 'binh',
    });
    assert.equal(shared.status, 200);
    assert.equal(shared.body.grant.grantedBy, 'an');

    assert.deepEqual((await targets(person('binh'))).sort(), ['iphone-12', 'pixel-7']);
    // Người thứ ba không được hưởng lây.
    assert.deepEqual(await targets(person('chi')), ['pixel-7']);
  });

  it('người không sở hữu KHÔNG cho mượn được, kể cả khi đang được mượn', async () => {
    await call('POST /api/device/share', person('an'), { udid: 'iphone-12', userId: 'binh' });

    // `binh` thấy chiếc máy, nhưng thấy không phải là sở hữu: cho mượn tiếp là
    // đường để một quyền lan ra cả tổ chức mà chủ máy không hề biết.
    const relayed = await call('POST /api/device/share', person('binh'), {
      udid: 'iphone-12', userId: 'chi',
    });
    assert.equal(relayed.status, 403);
    assert.deepEqual(await targets(person('chi')), ['pixel-7']);
  });

  it('người ngoài không cho mượn được máy mình còn chẳng thấy', async () => {
    const stranger = await call('POST /api/device/share', person('chi'), {
      udid: 'iphone-12', userId: 'chi',
    });
    // 404 chứ không 403: phân biệt "máy của người khác" với "máy không có
    // thật" là nói cho người lạ biết máy nào có thật.
    assert.equal(stranger.status, 404);
  });

  it('admin cho mượn được, kể cả máy không phải của mình', async () => {
    const byAdmin = await call('POST /api/device/share', person('sep', 'admin'), {
      udid: 'iphone-12', userId: 'chi',
    });
    assert.equal(byAdmin.status, 200);
    assert.ok((await targets(person('chi'))).includes('iphone-12'));
  });

  it('thu lại thì người kia thôi thấy', async () => {
    await call('POST /api/device/share', person('an'), { udid: 'iphone-12', userId: 'binh' });
    const gone = await call('POST /api/device/unshare', person('an'), {
      udid: 'iphone-12', userId: 'binh',
    });
    assert.equal(gone.body.revoked, true);
    assert.deepEqual(await targets(person('binh')), ['pixel-7']);
  });

  it('cho mượn hai lần không tạo hai dòng, và không làm mới mốc thời gian', async () => {
    const first = await call('POST /api/device/share', person('an'), {
      udid: 'iphone-12', userId: 'binh',
    });
    const second = await call('POST /api/device/share', person('an'), {
      udid: 'iphone-12', userId: 'binh',
    });
    assert.equal(second.body.grant.createdAt, first.body.grant.createdAt);
    assert.equal((await grants.forDevice('org-1', 'iphone-12')).length, 1);
  });

  it('quyền mượn KHÔNG vượt qua ranh giới tổ chức', async () => {
    // Ghi thẳng vào kho: không có route nào tạo được dòng này, và đó chính là
    // điều bài test muốn chắc chắn — kể cả khi có, phép lọc vẫn phải chặn.
    await grants.grant({
      orgId: 'org-1', udid: 'iphone-12', userId: 'nguoi-ngoai', grantedBy: 'an',
    });
    const outsider = { ...person('nguoi-ngoai'), orgId: 'org-2' };
    assert.deepEqual(await targets(outsider), []);
  });

  it('danh sách người đang mượn đọc được, và chỉ bởi người thấy máy', async () => {
    await call('POST /api/device/share', person('an'), { udid: 'iphone-12', userId: 'binh' });

    const mine = await call('GET /api/device/shares', person('an'), undefined, '?udid=iphone-12');
    assert.deepEqual(mine.body.grants.map((g: { userId: string }) => g.userId), ['binh']);

    const stranger = await call(
      'GET /api/device/shares', person('chi'), undefined, '?udid=iphone-12',
    );
    assert.equal(stranger.status, 404);
  });
});
