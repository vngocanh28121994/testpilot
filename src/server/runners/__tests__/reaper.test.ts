/**
 * Máy tắt giữa chừng: hệ thống phải NÓI ĐÚNG, không vờ như nó còn sống.
 *
 * Điều kiện hoàn thành của P4.6, và mỗi khẳng định ở đây là một nửa của câu
 * "job nằm chờ mãi mà không ai hiểu vì sao" — kiểu hỏng đắt nhất của một phòng
 * máy, vì nó không có triệu chứng nào ngoài sự im lặng.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRunnerRegistry } from '../memoryRegistry.js';
import { MemoryDeviceRegistry } from '../../devices/memoryRegistry.js';
import { MemoryJobQueue } from '../../queue/memoryQueue.js';
import { MemoryLeaseRepo } from '../../db/leaseRepo.js';
import { reapOnce } from '../reaper.js';

const T0 = new Date('2026-09-23T10:00:00.000Z');
const later = (ms: number) => new Date(T0.getTime() + ms);

async function scene() {
  const runners = new MemoryRunnerRegistry();
  const devices = new MemoryDeviceRegistry();
  const queue = new MemoryJobQueue();
  const leases = new MemoryLeaseRepo();

  const { runner } = await runners.create({
    orgId: 'org-1', name: 'laptop của An', mode: 'personal',
    ownerUserId: 'an', visibility: 'private',
  });
  await runners.touch(runner.id, T0);
  await devices.report(
    { id: runner.id, orgId: 'org-1', ownerUserId: 'an', visibility: 'private' },
    [{ platform: 'android', udid: 'may-cua-an', label: 'Pixel của An' }],
  );

  const job = await queue.create({
    orgId: 'org-1', kind: 'run_suite', createdBy: 'an',
    spec: {
      orgId: 'org-1', kind: 'run_suite', createdBy: 'an', timeoutMs: 60_000,
      deviceTokens: ['android:may-cua-an'], run: { platform: 'android' },
    },
  });
  await queue.claim({ runnerId: runner.id });
  const lease = await leases.acquire('may-cua-an', { kind: 'job', jobId: job.id }, T0);

  return { runners, devices, queue, leases, runner, job, lease };
}

const viewer = { userId: 'an', orgId: 'org-1', isAdmin: false };

describe('runner tắt giữa chừng', () => {
  it('còn trong hạn thì không đụng tới gì', async () => {
    const s = await scene();
    const result = await reapOnce({ ...s, silentMs: 90_000 }, later(60_000));

    assert.deepEqual(result, { runners: 0, jobs: 0 });
    assert.equal((await s.queue.find(s.job.id))?.state, 'running');
    assert.equal((await s.runners.find(s.runner.id))?.state, 'online');
  });

  it('im lặng quá hạn thì runner thành offline', async () => {
    const s = await scene();
    const result = await reapOnce({ ...s, silentMs: 90_000 }, later(120_000));

    assert.equal(result.runners, 1);
    assert.equal((await s.runners.find(s.runner.id))?.state, 'offline');
  });

  /**
   * "Không có máy nào" và "máy của bạn đang tắt" là hai câu khác nhau, và
   * người dùng cần câu thứ hai — nếu không họ đi tìm sợi cáp.
   */
  it('máy của nó thành offline nhưng KHÔNG biến mất', async () => {
    const s = await scene();
    await reapOnce({ ...s, silentMs: 90_000 }, later(120_000));

    const seen = await s.devices.list(viewer);
    assert.equal(seen.length, 1, 'máy phải còn trong danh sách');
    assert.equal(seen[0]!.state, 'offline');
  });

  /** Job treo `running` mãi mãi khoá cả thiết bị lẫn chỗ trong hàng đợi. */
  it('job đang chạy trên máy ấy thành interrupted, kèm lý do đọc được', async () => {
    const s = await scene();
    const result = await reapOnce({ ...s, silentMs: 90_000 }, later(120_000));

    assert.equal(result.jobs, 1);
    const job = await s.queue.find(s.job.id);
    assert.equal(job?.state, 'interrupted');
    assert.match(job?.error ?? '', /laptop của An/);
    assert.match(job?.error ?? '', /ngừng trả lời/);
  });

  /**
   * Lease có TTL nên nó tự hết sau 60 giây — nhưng chờ hết hạn nghĩa là chiếc
   * máy bị khoá thêm một phút sau khi ai cũng đã biết nó không còn chạy gì.
   */
  it('thiết bị được nhả ngay, không chờ hết hạn lease', async () => {
    const s = await scene();
    await reapOnce({ ...s, silentMs: 90_000 }, later(120_000));

    assert.equal(await s.leases.find('may-cua-an', later(120_000)), undefined);
  });

  /** Một máy tắt không được kéo theo việc của máy đang chạy tốt. */
  it('job của runner KHÁC không bị đụng tới', async () => {
    const s = await scene();
    const { runner: other } = await s.runners.create({
      orgId: 'org-1', name: 'lab-01', mode: 'lab', visibility: 'shared',
    });
    // Máy kia vừa nói chuyện, nên nó còn sống.
    await s.runners.touch(other.id, later(119_000));
    const mine = await s.queue.create({
      orgId: 'org-1', kind: 'run_suite', createdBy: 'binh',
      spec: {
        orgId: 'org-1', kind: 'run_suite', createdBy: 'binh', timeoutMs: 60_000,
        deviceTokens: [], run: { platform: 'web' },
      },
    });
    await s.queue.claim({ runnerId: other.id });

    await reapOnce({ ...s, silentMs: 90_000 }, later(120_000));

    assert.equal((await s.queue.find(mine.id))?.state, 'running', 'job của máy còn sống phải yên');
    assert.equal((await s.runners.find(other.id))?.state, 'online');
  });

  it('gọi lại lần nữa không làm gì thêm', async () => {
    const s = await scene();
    await reapOnce({ ...s, silentMs: 90_000 }, later(120_000));
    const again = await reapOnce({ ...s, silentMs: 90_000 }, later(180_000));

    assert.deepEqual(again, { runners: 0, jobs: 0 }, 'đã offline rồi thì không dọn lại');
  });
});
