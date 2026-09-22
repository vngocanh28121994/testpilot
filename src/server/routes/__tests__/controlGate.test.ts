/**
 * Cửa lease của màn điều khiển, và phép kiểm động tác.
 *
 * Đây là bài test quan trọng nhất của P3.7: nó đo rằng một người có VAI ĐỦ vẫn
 * không xem được màn hình và không chạm được vào chiếc máy người khác đang
 * giữ. Vai chặn người ngoài; thứ chặn đồng nghiệp là lease, và đó là một hình
 * dạng phân quyền mà phần còn lại của server chưa có — nên nó dễ bị viết lại
 * sai ở lần sửa sau.
 *
 * Cả bốn đường từ chối đều được đo TRƯỚC khi handler chạm tới runner, nên bài
 * test này không cần một chiếc điện thoại nào.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { controlRoutes } from '../control.js';
import { checkAction } from '../../../protocol/control.js';
import { MemoryLeaseRepo } from '../../db/leaseRepo.js';
import type { Repos } from '../../db/repo.js';
import type { Identity } from '../../auth/roles.js';
import type { RouteContext } from '../types.js';

const DEV = 'emulator-5554';
/**
 * Lease CÒN HIỆU LỰC, tính từ lúc chạy test.
 *
 * Phải là thời gian thật, không phải một mốc cố định: `heldBy()` hỏi kho bằng
 * đồng hồ thật, nên một mốc cố định trong quá khứ làm mọi lease hết hạn — và
 * bài test "máy của người khác" sẽ đỏ vì một lý do khác (chưa ai giữ) chứ
 * không vì lý do nó muốn đo.
 *
 * Bài đầu tiên của file này từng dùng 10:00 cùng ngày và khẳng định lease đã
 * hết hạn. Chạy lúc 11:05 sáng thì mốc ấy ở TƯƠNG LAI, lease còn sống, cửa mở
 * — handler sinh một tiến trình `screenrecord` thật cùng một `setInterval`
 * không ai dọn, nên bài test treo 120 giây rồi bị giết. Một khẳng định phụ
 * thuộc giờ chạy là một khẳng định sai vào một nửa số buổi.
 */
const NOW = (): Date => new Date();

function person(userId: string, role: Identity['role'] = 'runner_user'): Identity {
  return { userId, orgId: 'org-1', email: `${userId}@x.dev`, role };
}

function fakeRes(): { res: ServerResponse; out: { status?: number; body: Record<string, unknown> } } {
  const out: { status?: number; body: Record<string, unknown> } = { body: {} };
  let raw = '';
  const res = {
    writeHead(status: number) { out.status = status; return this; },
    write(chunk: string) { raw += chunk; return true; },
    end(chunk?: unknown) {
      if (chunk) raw += String(chunk);
      try { out.body = JSON.parse(raw) as Record<string, unknown>; } catch { out.body = { raw }; }
    },
  } as unknown as ServerResponse;
  return { res, out };
}

function context(identity: Identity, leases: MemoryLeaseRepo): RouteContext {
  return {
    configFile: 'testpilot.config.json',
    configProfile: { owner: 't', source: 'personal' },
    identity,
    repos: { leases } as unknown as Repos,
  };
}

async function stream(identity: Identity, leases: MemoryLeaseRepo, query: string) {
  const { res, out } = fakeRes();
  // Handler chỉ dùng `req.on('close')`, nên một object hai dòng là đủ — và nó
  // KHÔNG được để lọt qua cửa lease, vì qua cửa nghĩa là sinh một tiến trình
  // `screenrecord` thật và một `setInterval` giữ tiến trình test sống mãi.
  const req = { on: () => undefined } as unknown as IncomingMessage;
  await controlRoutes['GET /api/device/control/stream']!(
    req, res, new URL(`http://x/api/device/control/stream${query}`), context(identity, leases),
  );
  return out;
}

async function input(identity: Identity, leases: MemoryLeaseRepo, body: unknown) {
  const { res, out } = fakeRes();
  const req = Readable.from([Buffer.from(JSON.stringify(body), 'utf8')]) as IncomingMessage;
  await controlRoutes['POST /api/device/control/input']!(
    req, res, new URL('http://x/api/device/control/input'), context(identity, leases),
  );
  return out;
}

describe('cửa lease của màn điều khiển', () => {
  it('chưa giữ máy thì không xem được', async () => {
    const out = await stream(person('u1'), new MemoryLeaseRepo(), `?platform=android&deviceId=${DEV}&leaseId=x`);
    assert.equal(out.status, 409);
    assert.match(String(out.body.error), /Chưa giữ chỗ/);
  });

  it('thiếu tham số thì 400, không phải mở một luồng rỗng', async () => {
    const out = await stream(person('u1'), new MemoryLeaseRepo(), '?deviceId=');
    assert.equal(out.status, 400);
  });

  /**
   * Nền tảng do người gọi nói, và phải nói ĐÚNG một trong hai giá trị.
   *
   * Không đoán từ hình dạng `udid`: udid của simulator là một UUID, của máy
   * iOS thật là 25 hoặc 40 ký tự, Android thì tuỳ nhà sản xuất. Đoán sai nghĩa
   * là gửi lệnh `adb` cho một chiếc iPhone, và câu lỗi sẽ nói về `adb` chứ
   * không nói về chuyện đoán.
   */
  it('thiếu platform, hay platform lạ, đều là 400', async () => {
    const leases = new MemoryLeaseRepo();
    const lease = await leases.acquire(DEV, { kind: 'human', userId: 'u1' }, NOW());

    for (const query of [
      `?deviceId=${DEV}&leaseId=${lease.id}`,
      `?platform=&deviceId=${DEV}&leaseId=${lease.id}`,
      `?platform=windows&deviceId=${DEV}&leaseId=${lease.id}`,
      `?platform=ANDROID&deviceId=${DEV}&leaseId=${lease.id}`,
    ]) {
      const out = await stream(person('u1'), leases, query);
      assert.equal(out.status, 400, query);
    }
  });

  /**
   * Người khác đang giữ máy. Đây là đường mà VAI không chặn được: cả hai đều
   * là `runner_user`, và cả hai đều có quyền gọi route này.
   */
  it('máy của người khác thì không xem được, dù vai bằng nhau', async () => {
    const leases = new MemoryLeaseRepo();
    const lease = await leases.acquire(DEV, { kind: 'human', userId: 'u1' }, NOW());

    const out = await stream(person('u2'), leases, `?platform=android&deviceId=${DEV}&leaseId=${lease.id}`);
    assert.equal(out.status, 403);
    assert.match(String(out.body.error), /u1/);
  });

  /** Và vai CAO HƠN cũng không chen được. Không có đường "quyền to thì xem". */
  it('maintainer cũng không chen được vào máy người khác', async () => {
    const leases = new MemoryLeaseRepo();
    const lease = await leases.acquire(DEV, { kind: 'human', userId: 'u1' }, NOW());

    const out = await stream(person('u9', 'maintainer'), leases,
      `?platform=android&deviceId=${DEV}&leaseId=${lease.id}`);
    assert.equal(out.status, 403);
  });

  /** Máy đang chạy job: không ai được chạm vào giữa lượt test. */
  it('máy đang chạy job thì không ai chạm vào', async () => {
    const leases = new MemoryLeaseRepo();
    const lease = await leases.acquire(DEV, { kind: 'job', jobId: 'job-7' }, NOW());

    const out = await input(person('u1'), leases, {
      deviceId: DEV, leaseId: lease.id, platform: 'android',
      action: { kind: 'tap', x: 1, y: 1 },
    });
    assert.equal(out.status, 403);
    assert.match(String(out.body.error), /job-7/);
  });

  /**
   * `leaseId` cũ — máy đã đổi tay rồi quay lại.
   *
   * Nếu chỉ so người giữ thì client này được chấp nhận, và cái nó tưởng mình
   * thấy trên màn hình có thể là việc của một lượt giữ khác.
   */
  it('lượt giữ đã đổi thì từ chối, dù vẫn đúng người', async () => {
    const leases = new MemoryLeaseRepo();
    const me = { kind: 'human' as const, userId: 'u1' };
    const first = await leases.acquire(DEV, me, NOW());
    await leases.release(first.id, me);
    const second = await leases.acquire(DEV, me, NOW());
    assert.notEqual(first.id, second.id);

    const out = await stream(person('u1'), leases, `?platform=android&deviceId=${DEV}&leaseId=${first.id}`);
    assert.equal(out.status, 409);
    assert.match(String(out.body.error), /đã đổi/);
  });

  /**
   * Lease hết hạn thì mất quyền xem, và mốc lấy từ QUÁ KHỨ chứ không từ `T0`.
   *
   * Bản đầu của bài này dùng `T0` là 10:00 cùng ngày và khẳng định 409. Chạy
   * lúc 11:05 sáng thì T0 nằm ở TƯƠNG LAI, lease còn hiệu lực, cửa mở — và bài
   * test sinh ra một tiến trình `screenrecord` thật cùng một `setInterval`
   * không ai dọn, nên nó treo 120 giây rồi bị giết. Một khẳng định phụ thuộc
   * giờ chạy là một khẳng định sai vào một nửa số buổi.
   */
  it('lease hết hạn thì mất quyền xem ngay', async () => {
    const leases = new MemoryLeaseRepo();
    const long_ago = new Date('2020-01-01T00:00:00.000Z');
    const lease = await leases.acquire(DEV, { kind: 'human', userId: 'u1' }, long_ago);

    const out = await stream(person('u1'), leases, `?platform=android&deviceId=${DEV}&leaseId=${lease.id}`);
    assert.equal(out.status, 409);
    assert.match(String(out.body.error), /Chưa giữ chỗ/);
  });
});

describe('checkAction', () => {
  const screen = { width: 1080, height: 2400 };

  it('chạm trong màn hình thì qua, làm tròn về số nguyên', () => {
    const checked = checkAction({ kind: 'tap', x: 100.6, y: 200.2 }, screen);
    assert.deepEqual(checked, { ok: true, action: { kind: 'tap', x: 101, y: 200 } });
  });

  /**
   * Toạ độ ngoài màn hình là dấu hiệu CLIENT TÍNH SAI tỉ lệ khung video, không
   * phải ý muốn của người dùng. Để nó đi qua thì `input tap` nhận một toạ độ
   * vô nghĩa và không báo gì — cú chạm đơn giản không xảy ra.
   */
  it('chạm ngoài màn hình thì từ chối, kèm kích thước thật', () => {
    const checked = checkAction({ kind: 'tap', x: 2000, y: 100 }, screen);
    assert.equal(checked.ok, false);
    assert.match(checked.ok === false ? checked.error : '', /1080x2400/);
  });

  it('thiếu toạ độ, toạ độ âm, hay NaN đều bị từ chối', () => {
    for (const bad of [
      { kind: 'tap' },
      { kind: 'tap', x: -1, y: 0 },
      { kind: 'tap', x: Number.NaN, y: 0 },
      { kind: 'tap', x: '100', y: 100 },
    ]) {
      assert.equal(checkAction(bad, screen).ok, false, JSON.stringify(bad));
    }
  });

  it('quét kiểm cả hai đầu, và kẹp thời lượng về khoảng dùng được', () => {
    assert.equal(checkAction({ kind: 'swipe', x: 1, y: 1, toX: 9_999, toY: 1 }, screen).ok, false);
    const long = checkAction({ kind: 'swipe', x: 1, y: 1, toX: 2, toY: 2, durationMs: 99_999 }, screen);
    assert.deepEqual(long.ok === true ? long.action : null,
      { kind: 'swipe', x: 1, y: 1, toX: 2, toY: 2, durationMs: 10_000 });
  });

  it('chuỗi rỗng và chuỗi quá dài đều bị từ chối', () => {
    assert.equal(checkAction({ kind: 'text', text: '' }, screen).ok, false);
    assert.equal(checkAction({ kind: 'text', text: 'a'.repeat(1_001) }, screen).ok, false);
    assert.equal(checkAction({ kind: 'text', text: 'xin chào' }, screen).ok, true);
  });

  /** Danh sách phím đóng: `power` phải bị từ chối ở tầng này, trước cả adb. */
  it('chỉ phím trong danh sách, và power không có trong đó', () => {
    assert.equal(checkAction({ kind: 'key', key: 'back' }, screen).ok, true);
    assert.equal(checkAction({ kind: 'key', key: 'power' }, screen).ok, false);
    assert.equal(checkAction({ kind: 'key', key: 'KEYCODE_POWER' }, screen).ok, false);
  });

  /**
   * iOS có ít phím hơn, và đó là sự thật của nền tảng: iPhone không có nút
   * Quay lại. Câu từ chối phải nói ra điều đó thay vì chỉ "sai".
   */
  it('phím của Android không tự nhiên dùng được trên iOS', () => {
    assert.equal(checkAction({ kind: 'key', key: 'back' }, screen, 'android').ok, true);
    assert.equal(checkAction({ kind: 'key', key: 'recents' }, screen, 'android').ok, true);

    const denied = checkAction({ kind: 'key', key: 'back' }, screen, 'ios');
    assert.equal(denied.ok, false);
    assert.match(denied.ok === false ? denied.error : '', /ios/);
    // Câu lỗi liệt kê phím CÓ dùng được, vì người đọc cần biết bấm gì thay thế.
    assert.match(denied.ok === false ? denied.error : '', /home/);

    for (const key of ['home', 'enter', 'delete']) {
      assert.equal(checkAction({ kind: 'key', key }, screen, 'ios').ok, true, key);
    }
    assert.equal(checkAction({ kind: 'key', key: 'power' }, screen, 'ios').ok, false);
  });

  it('động tác lạ thì từ chối, không rơi vào nhánh mặc định nào', () => {
    assert.equal(checkAction({ kind: 'shell', text: 'rm -rf /' }, screen).ok, false);
    assert.equal(checkAction({}, screen).ok, false);
    assert.equal(checkAction(null, screen).ok, false);
  });
});
