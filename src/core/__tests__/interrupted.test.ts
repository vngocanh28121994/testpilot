/**
 * Lượt chạy mà tiến trình chủ đã chết.
 *
 * `status: 'running'` nghĩa là "có một tiến trình đang chăm nó". Tiến trình ấy
 * chỉ ghi trạng thái kết thúc khi chạy xong, nên bị giết giữa chừng thì dòng đó
 * nằm lại `running` vĩnh viễn. History thật đã có hai lượt treo 10 và 17 tiếng,
 * hiện trên màn hình y như đang chạy.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { History } from '../history.js';
import { closeInterruptedRuns, writeRunMeta } from '../runstore.js';
import { readRunCheckpoint, writeRunCheckpoint } from '../runCheckpoint.js';
import { recoverInterruptedRunReports } from '../interruptedReport.js';
import type { ScenarioResult } from '../types.js';

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

function passedResult(id: string, name: string): ScenarioResult {
  return {
    scenario: { id, name, tags: [], steps: [], platforms: ['web'] },
    platform: 'web',
    device: 'Chrome',
    verdict: 'passed',
    runs: [{
      attempt: 1,
      status: 'passed',
      steps: [],
      startedAt: '2026-09-12T00:00:00.000Z',
      durationMs: 10,
    }],
  } as ScenarioResult;
}

describe('báo cáo cho local run bị gián đoạn', () => {
  it('checkpoint được thay nguyên tử và đọc lại đầy đủ', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tp-checkpoint-'));
    const base = {
      reportRunId: 'report-1',
      startedAt: '2026-09-12T00:00:00.000Z',
      platform: 'web' as const,
      device: 'Chrome',
      planned: [{ id: 'a', name: 'Ca A' }],
      results: [] as ScenarioResult[],
      quarantined: [],
      openQuestions: [],
    };
    await writeRunCheckpoint(dir, base);
    await writeRunCheckpoint(dir, { ...base, results: [passedResult('a', 'Ca A')] });

    const checkpoint = await readRunCheckpoint(dir);
    assert.equal(checkpoint?.results.length, 1);
    assert.equal(checkpoint?.results[0]?.scenario.name, 'Ca A');
    assert.equal(existsSync(path.join(dir, 'run-state.json')), true);
  });

  it('dựng report từ kết quả có cấu trúc và phân biệt interrupted/not run', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'tp-runs-'));
    const dir = path.join(root, 'run-a');
    await writeRunMeta(dir, {
      id: 'run-a', platform: 'web', kind: 'run', status: 'running',
      startedAt: '2026-09-12T00:00:00.000Z',
    });
    await writeRunCheckpoint(dir, {
      reportRunId: 'report-a',
      startedAt: '2026-09-12T00:00:00.000Z',
      platform: 'web',
      device: 'Chrome',
      planned: [
        { id: 'done', name: 'Đã chạy' },
        { id: 'active', name: 'Đang chạy thì crash' },
        { id: 'later', name: 'Chưa chạy' },
      ],
      results: [passedResult('done', 'Đã chạy')],
      quarantined: [],
      openQuestions: [],
      currentScenario: { id: 'active', name: 'Đang chạy thì crash' },
    });

    const closed = await closeInterruptedRuns(root);
    assert.deepEqual(closed, ['run-a']);
    assert.deepEqual(await recoverInterruptedRunReports(root, closed), ['run-a']);

    const json = JSON.parse(readFileSync(path.join(dir, 'report.json'), 'utf8'));
    assert.equal(json.report.status, 'interrupted');
    assert.equal(json.report.results.length, 1);
    assert.equal(json.report.interruption.activeScenario.name, 'Đang chạy thì crash');
    assert.deepEqual(json.report.interruption.notRun.map((item: { name: string }) => item.name), ['Chưa chạy']);
    const html = readFileSync(path.join(dir, 'index.html'), 'utf8');
    assert.match(html, /Lượt chạy bị gián đoạn/);
    assert.match(html, /Đang chạy thì crash/);
    assert.match(html, /not run/);
  });

  it('run cũ không có checkpoint vẫn có report giới hạn từ log', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'tp-runs-legacy-'));
    const dir = path.join(root, 'run-old');
    await writeRunMeta(dir, {
      id: 'run-old', platform: 'web', kind: 'run', status: 'interrupted',
      startedAt: '2026-09-12T00:00:00.000Z',
      finishedAt: '2026-09-12T00:01:00.000Z',
    });
    writeFileSync(path.join(dir, 'log.txt'), [
      '[run:running] … Ca xanh',
      '[run:passed] ✓ Ca xanh',
      '[run:running] … Ca đang chạy',
    ].join('\n'), 'utf8');

    assert.deepEqual(await recoverInterruptedRunReports(root, ['run-old']), ['run-old']);
    const json = JSON.parse(readFileSync(path.join(dir, 'report.json'), 'utf8'));
    assert.equal(json.report.interruption.source, 'log');
    assert.deepEqual(json.report.interruption.logRecoveredResults, [
      { name: 'Ca xanh', verdict: 'passed' },
    ]);
    assert.equal(json.report.interruption.activeScenario.name, 'Ca đang chạy');
  });
});
