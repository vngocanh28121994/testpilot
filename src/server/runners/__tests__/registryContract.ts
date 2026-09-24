/**
 * Bộ khẳng định của sổ runner, dùng chung cho mọi hiện thực.
 *
 * Thứ đáng đo nhất ở đây là những lần KHÔNG cho vào: token sai, token đã thu
 * hồi, token của runner khác. Một sổ cho nhầm một lần là một máy lạ nhận được
 * job của tổ chức — và nó sẽ trả về kết quả mà không ai nghi ngờ.
 */
import assert from 'node:assert/strict';
import type { RunnerRegistry } from '../registry.js';

export function registryContract(
  it: (name: string, fn: () => Promise<void>) => void,
  fresh: () => Promise<RunnerRegistry>,
): void {
  const personal = {
    orgId: 'org-1', name: 'laptop của An', mode: 'personal' as const,
    ownerUserId: 'an', visibility: 'private' as const,
  };

  it('tạo runner thì token hiện MỘT lần và tra lại được', async () => {
    const registry = await fresh();
    const { runner, token } = await registry.create(personal);

    assert.ok(token.length >= 32, 'token phải đủ dài để không đoán được');
    assert.equal(runner.name, 'laptop của An');
    assert.equal(runner.ownerUserId, 'an');
    assert.equal(runner.visibility, 'private');
    // Máy chưa nối vào thì chưa online — trạng thái phải nói đúng sự thật.
    assert.equal(runner.state, 'offline');

    const found = await registry.findByToken(token);
    assert.equal(found?.id, runner.id);
  });

  it('máy chủ tự ghi mình vào sổ: dùng chung, online, và không token nào mở được nó', async () => {
    const registry = await fresh();
    await registry.seedLocalHost('runner:local', 'Máy chủ (test)');
    // Gọi lại mỗi nhịp báo máy: không được tạo dòng thứ hai.
    await registry.seedLocalHost('runner:local', 'Máy chủ (test)');
    const host = await registry.find('runner:local');
    assert.equal(host?.name, 'Máy chủ (test)');
    assert.equal(host?.visibility, 'shared');
    assert.equal(host?.state, 'online');
    assert.equal((await registry.list()).filter((r) => r.id === 'runner:local').length, 1);
    assert.equal(await registry.findByToken(''), undefined);
    assert.equal(await registry.findByToken('host:no-token'), undefined);
  });

  it('token sai thì không tra ra gì', async () => {
    const registry = await fresh();
    await registry.create(personal);
    assert.equal(await registry.findByToken('token-bia'), undefined);
  });

  /** Hai máy, hai token: đó là toàn bộ lý do bỏ token dùng chung. */
  it('token của máy này không mở được máy kia', async () => {
    const registry = await fresh();
    const a = await registry.create(personal);
    const b = await registry.create({ ...personal, name: 'laptop của Bình', ownerUserId: 'binh' });

    assert.equal((await registry.findByToken(a.token))?.id, a.runner.id);
    assert.equal((await registry.findByToken(b.token))?.id, b.runner.id);
    assert.notEqual(a.token, b.token);
  });

  it('đổi token thì token cũ chết ngay', async () => {
    const registry = await fresh();
    const { runner, token } = await registry.create(personal);

    const fresh2 = await registry.rotate(runner.id);
    assert.ok(fresh2);
    assert.equal(await registry.findByToken(token), undefined, 'token cũ phải chết');
    assert.equal((await registry.findByToken(fresh2))?.id, runner.id);
  });

  /**
   * Thu hồi KHÔNG xoá dòng: `job.runner_id` trỏ vào đây, và "job này chạy ở
   * máy nào" là câu mà một cuộc điều tra sau sự cố cần.
   */
  it('thu hồi thì token chết nhưng dòng vẫn còn', async () => {
    const registry = await fresh();
    const { runner, token } = await registry.create(personal);

    assert.equal(await registry.revoke(runner.id), true);
    assert.equal(await registry.findByToken(token), undefined);
    const still = await registry.find(runner.id);
    assert.ok(still, 'dòng runner phải còn để lịch sử job còn nghĩa');
    assert.equal(still.state, 'offline');
  });

  it('runner không có thì thu hồi và đổi token đều trả về "không có"', async () => {
    const registry = await fresh();
    assert.equal(await registry.revoke('runner:khong-co'), false);
    assert.equal(await registry.rotate('runner:khong-co'), undefined);
  });

  it('nói chuyện thì thành online và ghi lại lúc nào', async () => {
    const registry = await fresh();
    const { runner } = await registry.create(personal);
    await registry.touch(runner.id, new Date('2026-09-22T10:00:00.000Z'));

    const seen = await registry.find(runner.id);
    assert.equal(seen?.state, 'online');
    assert.equal(seen?.lastSeenAt, '2026-09-22T10:00:00.000Z');
  });

  /**
   * Máy cá nhân tắt lúc nào cũng được — đó là sự thật của P4, không phải lỗi.
   * Nhưng sổ phải NÓI ĐÚNG, nếu không job nằm chờ một chiếc máy đã tắt và
   * không ai hiểu vì sao.
   */
  it('im lặng quá lâu thì thành offline', async () => {
    const registry = await fresh();
    const { runner } = await registry.create(personal);
    const at = new Date('2026-09-22T10:00:00.000Z');
    await registry.touch(runner.id, at);

    // Chưa quá hạn: vẫn online.
    assert.equal(await registry.reapSilent(90_000, new Date(at.getTime() + 60_000)), 0);
    assert.equal((await registry.find(runner.id))?.state, 'online');

    assert.equal(await registry.reapSilent(90_000, new Date(at.getTime() + 120_000)), 1);
    assert.equal((await registry.find(runner.id))?.state, 'offline');
  });

  it('liệt kê được mọi runner của tổ chức', async () => {
    const registry = await fresh();
    await registry.create(personal);
    await registry.create({ ...personal, name: 'lab-01', mode: 'lab', visibility: 'shared' });

    const all = await registry.list();
    assert.equal(all.length, 2);
    assert.deepEqual(all.map((r) => r.name).sort(), ['lab-01', 'laptop của An']);
  });
}
