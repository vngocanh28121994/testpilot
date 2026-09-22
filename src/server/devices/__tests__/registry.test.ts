/**
 * Quyền nhìn thấy thiết bị.
 *
 * Điều kiện hoàn thành của P4.2, viết thành khẳng định: **người B không tạo
 * được job trên thiết bị private của A, và cũng không THẤY nó trong danh
 * sách.** Hai nửa ấy phải đúng cùng lúc — thấy mà không đặt được job thì vẫn
 * là rò rỉ tên máy, còn đặt được job lên máy không thấy thì là chiếm máy.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryDeviceRegistry } from '../memoryRegistry.js';
import { maySee, type DeviceRecord } from '../registry.js';

const AN = { id: 'runner:an', orgId: 'org-1', ownerUserId: 'an', visibility: 'private' as const };
const LAB = { id: 'runner:lab', orgId: 'org-1', visibility: 'shared' as const };
const KHAC = { id: 'runner:khac', orgId: 'org-2', ownerUserId: 'ai-do', visibility: 'shared' as const };

const phone = (udid: string) => ({ platform: 'android' as const, udid, label: `máy ${udid}` });

const viewer = (userId: string, isAdmin = false) => ({ userId, orgId: 'org-1', isAdmin });

describe('sổ thiết bị', () => {
  it('máy dùng chung thì ai trong tổ chức cũng thấy', async () => {
    const devices = new MemoryDeviceRegistry();
    await devices.report(LAB, [phone('lab-1')]);

    for (const who of ['an', 'binh']) {
      assert.deepEqual(
        (await devices.list(viewer(who))).map((d) => d.udid), ['lab-1'],
      );
    }
  });

  /** Nửa thứ nhất của điều kiện P4.2. */
  it('máy riêng của A thì B KHÔNG thấy', async () => {
    const devices = new MemoryDeviceRegistry();
    await devices.report(AN, [phone('an-1')]);

    assert.deepEqual((await devices.list(viewer('an'))).map((d) => d.udid), ['an-1']);
    assert.deepEqual(await devices.list(viewer('binh')), []);
    assert.equal(await devices.find('an-1', viewer('binh')), undefined);
  });

  it('admin thấy cả máy riêng của người khác', async () => {
    const devices = new MemoryDeviceRegistry();
    await devices.report(AN, [phone('an-1')]);
    assert.equal((await devices.find('an-1', viewer('sep', true)))?.udid, 'an-1');
  });

  /** Tổ chức khác là bức tường cứng nhất: kể cả admin cũng không xuyên qua. */
  it('máy của tổ chức khác thì không ai thấy', async () => {
    const devices = new MemoryDeviceRegistry();
    await devices.report(KHAC, [phone('khac-1')]);

    assert.deepEqual(await devices.list(viewer('an')), []);
    assert.deepEqual(await devices.list(viewer('sep', true)), []);
  });

  /**
   * Báo cáo thay thế TOÀN BỘ phần của runner ấy: một chiếc máy bị rút ra là
   * một sự vắng mặt, và sự vắng mặt không có sự kiện nào để gửi.
   */
  it('báo cáo mới thay thế danh sách cũ của chính runner ấy', async () => {
    const devices = new MemoryDeviceRegistry();
    await devices.report(AN, [phone('an-1'), phone('an-2')]);
    await devices.report(LAB, [phone('lab-1')]);

    await devices.report(AN, [phone('an-2')]);

    const seen = (await devices.list(viewer('an'))).map((d) => d.udid).sort();
    assert.deepEqual(seen, ['an-2', 'lab-1'], 'máy của runner KHÁC không bị đụng tới');
  });

  /**
   * Máy tắt vẫn còn trong danh sách, kèm trạng thái. "Biến mất" và "đang tắt"
   * là hai câu khác nhau, và người dùng cần câu thứ hai.
   */
  it('runner tắt thì máy của nó thành offline, không biến mất', async () => {
    const devices = new MemoryDeviceRegistry();
    await devices.report(AN, [phone('an-1')]);

    assert.equal(await devices.markRunnerOffline('runner:an'), 1);
    const seen = await devices.list(viewer('an'));
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.state, 'offline');
  });

  it('máy thừa hưởng quyền nhìn từ runner', async () => {
    const devices = new MemoryDeviceRegistry();
    await devices.report(AN, [phone('an-1')]);
    await devices.report(LAB, [phone('lab-1')]);

    const all = await devices.list(viewer('sep', true));
    assert.equal(all.find((d) => d.udid === 'an-1')?.visibility, 'private');
    assert.equal(all.find((d) => d.udid === 'lab-1')?.visibility, 'shared');
  });
});

describe('maySee', () => {
  const base: DeviceRecord = {
    platform: 'android', udid: 'x', label: 'x',
    runnerId: 'r', orgId: 'org-1', visibility: 'private', ownerUserId: 'an',
    state: 'idle', updatedAt: '2026-09-22T00:00:00.000Z',
  };

  /**
   * Hàm thuần và xuất ra ngoài, vì cùng luật phải áp ở hai chỗ: lúc liệt kê,
   * và lúc ai đó nhắm một chiếc máy bằng tên. Hai bản chép tay sẽ lệch nhau.
   */
  it('luật gọn trong bốn dòng, và cả bốn đều được đo', () => {
    assert.equal(maySee(base, viewer('an')), true, 'chủ máy thấy máy mình');
    assert.equal(maySee(base, viewer('binh')), false, 'người khác không thấy');
    assert.equal(maySee(base, viewer('binh', true)), true, 'admin thấy');
    assert.equal(
      maySee({ ...base, visibility: 'shared' }, viewer('binh')), true, 'máy chung thì ai cũng thấy',
    );
    assert.equal(
      maySee({ ...base, orgId: 'org-2', visibility: 'shared' }, viewer('binh', true)), false,
      'tổ chức khác thì kể cả admin cũng không',
    );
  });
});
