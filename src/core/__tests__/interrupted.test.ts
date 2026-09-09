/**
 * Lượt chạy mà tiến trình chủ đã chết.
 *
 * `status: 'running'` nghĩa là "có một tiến trình đang chăm nó". Tiến trình ấy
 * chỉ ghi trạng thái kết thúc khi chạy xong, nên bị giết giữa chừng thì dòng đó
 * nằm lại `running` vĩnh viễn. History thật đã có hai lượt treo 10 và 17 tiếng,
 * hiện trên màn hình y như đang chạy.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { History } from '../history.js';

function historyWith(runs: unknown[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'tp-hist-'));
  const file = path.join(dir, 'history.json');
  writeFileSync(file, JSON.stringify({ runs }), 'utf8');
  return file;
}

const run = (over: Record<string, unknown>) => ({
  id: 'r1', feature: 'F', kind: 'workflow', startedAt: '2026-09-08T00:00:00.000Z',
  status: 'running', log: [],
  stages: [{ name: 'A', status: 'done' }, { name: 'B', status: 'running' }],
  ...over,
});

describe('History.closeInterrupted', () => {
  it('đóng lượt đang chạy và nói rõ vì sao', async () => {
    const history = await History.load(historyWith([run({})]));
    assert.equal(history.closeInterrupted(), 1);
    const [only] = history.list();
    assert.equal(only!.status, 'failed');
    assert.ok(only!.finishedAt);
    assert.match(only!.error ?? '', /server khởi động lại|đã dừng/);
  });

  it('bước đang chạy cũng phải thôi quay', () => {
    return History.load(historyWith([run({})])).then((history) => {
      history.closeInterrupted();
      assert.equal(history.list()[0]!.stages[1]!.status, 'failed');
      // Bước đã xong thì giữ nguyên — kết quả tới đó là thật.
      assert.equal(history.list()[0]!.stages[0]!.status, 'done');
    });
  });

  /**
   * Điểm dừng bền vững, cố ý sống lâu hơn tiến trình sinh ra nó. Đóng lại là
   * vứt mất bộ testcase đang chờ người duyệt.
   */
  it('KHÔNG đụng tới waiting_review và waiting_input', async () => {
    const history = await History.load(historyWith([
      run({ id: 'a', status: 'waiting_review' }),
      run({ id: 'b', status: 'waiting_input' }),
    ]));
    assert.equal(history.closeInterrupted(), 0);
    assert.deepEqual(history.list().map((r) => r.status).sort(), ['waiting_input', 'waiting_review']);
  });

  it('lượt đã xong thì không đụng tới', async () => {
    const history = await History.load(historyWith([run({ status: 'passed' })]));
    assert.equal(history.closeInterrupted(), 0);
  });
});
