/**
 * "Workflow đang chờ bạn" hiện ở MỌI lần vào màn Kịch bản, mãi mãi.
 *
 * `waiting_review` cố ý sống lâu hơn tiến trình sinh ra nó — đó là điểm dừng để
 * người ta đi duyệt rồi quay lại. Nhưng không có gì kết thúc nó ngoài chính
 * người đó bấm nút. Trong history thật có một lượt treo hai ngày, trong khi
 * người dùng đã duyệt tay và chạy test hàng chục lần từ đó.
 */
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { History } from '../history.js';

async function historyWith(runs: unknown[]): Promise<History> {
  const dir = await mkdtemp(path.join(tmpdir(), 'tp-history-'));
  const file = path.join(dir, 'history.json');
  await writeFile(file, JSON.stringify({ version: 1, runs }), 'utf8');
  return History.load(file);
}

const waiting = (id: string, kind = 'workflow') => ({
  id,
  kind,
  feature: 'chuyen-tien-noi-bo',
  status: 'waiting_review',
  startedAt: '2026-09-09T06:53:48.000Z',
  stages: [],
  log: [],
});

describe('thay chỗ lượt đang chờ duyệt', () => {
  it('đóng lượt chờ cũ khi một workflow mới bắt đầu', async () => {
    const history = await historyWith([waiting('cu')]);
    assert.equal(history.supersedeWaiting('workflow'), 1);
    const run = history.find('cu')!;
    assert.equal(run.status, 'failed');
    assert.match(run.error!, /đã thay chỗ lượt này/);
    // Nói rõ việc đã làm vẫn còn: đóng cổng không phải xoá kịch bản đã sinh.
    assert.match(run.error!, /vẫn còn trong danh sách duyệt/);
  });

  it('không đụng tới lượt chạy thuộc loại khác', async () => {
    const history = await historyWith([waiting('cua-farm', 'farm')]);
    assert.equal(history.supersedeWaiting('workflow'), 0);
    assert.equal(history.find('cua-farm')!.status, 'waiting_review');
  });

  it('không đụng tới lượt đã kết thúc', async () => {
    const history = await historyWith([{ ...waiting('xong'), status: 'passed' }]);
    assert.equal(history.supersedeWaiting('workflow'), 0);
    assert.equal(history.find('xong')!.status, 'passed');
  });

  /** waiting_input cũng là một điểm dừng chờ người, và cũng kẹt y như vậy. */
  it('đóng cả lượt đang chờ trả lời câu hỏi', async () => {
    const history = await historyWith([{ ...waiting('hoi'), status: 'waiting_input' }]);
    assert.equal(history.supersedeWaiting('workflow'), 1);
  });
});
