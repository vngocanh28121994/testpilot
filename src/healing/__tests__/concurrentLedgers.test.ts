/**
 * Hai lượt chạy song song không được xoá dữ liệu của nhau.
 *
 * Đây là kiểu hỏng đắt nhất trong cả P2, và nó không giống một lỗi: sổ healing
 * mất bằng chứng thì một đề xuất lẽ ra đủ điều kiện mãi không đủ — trông như
 * "chưa có gì đáng duyệt". Sổ flaky mất kết quả thì tỷ lệ được tính trên một
 * cửa sổ thiếu dữ liệu, và một kịch bản chập chờn được tuyên là ổn định —
 * trông như tin tốt. Không ai báo cáo tin tốt.
 *
 * Chạy song song không phải tình huống hiếm: nó chính là điều cả hệ thống này
 * hướng tới — nhiều thiết bị, nhiều runner, cùng một suite.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HealingStore } from '../HealingStore.js';
import { FlakeDetector, type FlakeDb } from '../../flaky/detector.js';
import type { Platform, ScenarioResult } from '../../core/types.js';

async function workspace(name: string): Promise<string> {
  return path.join(await mkdtemp(path.join(tmpdir(), 'tp-ledger-')), name);
}

/**
 * Một kết quả kịch bản có đúng một lần heal thành công.
 *
 * `runs[]` là từng LƯỢT THỬ của một kịch bản, và `heal` nằm ở step bên trong —
 * `ingest()` đi theo đường đó. Dựng sai một tầng thì nó không thấy gì và mọi
 * khẳng định bên dưới đều "đúng" vì cả hai bên đều rỗng.
 */
function healedScenario(device: string): ScenarioResult {
  return {
    scenario: { id: 'dang-nhap', name: 'Đăng nhập', tags: [], platforms: ['web'], steps: [] },
    platform: 'web' as Platform,
    device,
    runs: [{
      attempt: 1,
      status: 'passed',
      startedAt: '2026-09-22T00:00:00.000Z',
      durationMs: 30_000,
      steps: [{
        step: { keyword: 'When', text: 'I tap "Nút đăng nhập"', line: 1,
                intent: { kind: 'tap', element: 'login.submit' } },
        status: 'healed',
        durationMs: 10,
        attempts: 1,
        heal: {
          elementId: 'login.submit',
          from: { strategy: 'testId', value: 'cu', weight: 0.9, origin: 'authored' },
          to: { strategy: 'testId', value: 'moi', weight: 0.9, origin: 'runtime' },
        },
      }],
    }],
    verdict: 'passed',
  } as unknown as ScenarioResult;
}

describe('sổ healing gộp thay vì ghi đè', () => {
  it('hai lượt chạy song song cộng dồn bằng chứng, không xoá của nhau', async () => {
    const file = await workspace('healing.json');

    // Cả hai đọc cùng một sổ rỗng — đúng cảnh hai runner bắt đầu cùng lúc.
    const a = await HealingStore.load(file);
    const b = await HealingStore.load(file);
    a.ingest('run-A', [healedScenario('pixel')]);
    b.ingest('run-B', [healedScenario('iphone')]);

    await a.save();
    await b.save();

    const records = (await HealingStore.load(file)).records();
    assert.equal(records.length, 1, 'cùng một locator thì cùng một bản ghi');
    const record = records[0]!;
    assert.equal(record.successes, 2, `bằng chứng phải cộng dồn, nhận được ${record.successes}`);
    assert.deepEqual(record.runIds.sort(), ['run-A', 'run-B']);
    assert.deepEqual(Object.keys(record.devices).sort(), ['iphone', 'pixel']);
    assert.equal(record.deviceCount, 2);
  });

  /**
   * Quyết định của người không được biến mất vì một lượt chạy tự động kết thúc
   * sau đó — đó là khác biệt giữa "chưa ai xem" và "đã từ chối".
   */
  it('quyết định của người sống sót qua một lượt ghi tự động', async () => {
    const file = await workspace('healing.json');
    const seeded = await HealingStore.load(file);
    seeded.ingest('run-1', [healedScenario('pixel')]);
    await seeded.save();

    // Người mở màn Healing Center và từ chối đề xuất.
    const reviewer = await HealingStore.load(file);
    const id = reviewer.records()[0]!.id;
    reviewer.review(id, 'rejected');
    await reviewer.save();

    // Một lượt chạy khác đã đọc sổ TRƯỚC khi người kia bấm, và ghi sau.
    const late = await HealingStore.load(file);
    late.ingest('run-2', [healedScenario('pixel')]);
    await late.save();

    const after = (await HealingStore.load(file)).records()[0]!;
    assert.equal(after.status, 'rejected', 'quyết định của người bị một lượt chạy xoá mất');
    assert.equal(after.successes, 2, 'và bằng chứng mới vẫn phải được ghi nhận');
  });

  it('không nhân đôi ingestedRuns khi cả hai cùng nhập một report', async () => {
    const file = await workspace('healing.json');
    const a = await HealingStore.load(file);
    const b = await HealingStore.load(file);
    a.ingest('run-X', [healedScenario('pixel')]);
    b.ingest('run-X', [healedScenario('pixel')]);
    await a.save();
    await b.save();

    const record = (await HealingStore.load(file)).records()[0]!;
    assert.deepEqual(record.runIds, ['run-X'], 'cùng runId không được đếm hai lần');
  });
});

describe('sổ flaky cộng dồn thay vì ghi đè', () => {
  const scenario = (verdict: 'passed' | 'failed') => ({
    scenario: { id: 'dang-nhap', name: 'Đăng nhập', tags: [], platforms: ['web'], steps: [] },
    verdict,
    platform: 'web' as Platform,
    device: 'chromium',
    startedAt: '2026-09-22T00:00:00.000Z',
    finishedAt: '2026-09-22T00:00:10.000Z',
    steps: [],
  });

  it('hai lượt song song giữ lại kết quả của cả hai', async () => {
    const file = await workspace('flake.json');
    const a = await FlakeDetector.load(file);
    const b = await FlakeDetector.load(file);

    a.ingest([scenario('passed')] as never);
    b.ingest([scenario('failed')] as never);
    await a.save();
    await b.save();

    const db = JSON.parse(await readFile(file, 'utf8')) as FlakeDb;
    const outcomes = db.scenarios['dang-nhap::web::chromium']?.outcomes ?? [];
    assert.equal(outcomes.length, 2, `mất kết quả của một lượt: ${JSON.stringify(outcomes)}`);
    assert.deepEqual([...outcomes].sort(), ['f', 'p']);
  });

  /** Cửa sổ là N lần gần nhất; gộp không được làm nó phình ra. */
  it('không vượt quá kích thước cửa sổ', async () => {
    const file = await workspace('flake.json');
    await writeFile(file, JSON.stringify({
      version: 1, window: 3,
      scenarios: { 'dang-nhap::web::chromium': { outcomes: ['p', 'p', 'p'], lastSeen: '2026-09-21T00:00:00.000Z' } },
    }), 'utf8');

    const detector = await FlakeDetector.load(file);
    detector.ingest([scenario('failed')] as never);
    await detector.save();

    const db = JSON.parse(await readFile(file, 'utf8')) as FlakeDb;
    const outcomes = db.scenarios['dang-nhap::web::chromium']!.outcomes;
    assert.ok(outcomes.length <= db.window, `${outcomes.length} > cửa sổ ${db.window}`);
    assert.equal(outcomes[0], 'f', 'kết quả mới nhất phải ở đầu');
  });

  /** Sổ chưa có kịch bản này thì gộp đơn giản là thêm vào. */
  it('kịch bản mới xuất hiện đủ trong sổ', async () => {
    const file = await workspace('flake.json');
    const detector = await FlakeDetector.load(file);
    detector.ingest([scenario('passed')] as never);
    await detector.save();

    const db = JSON.parse(await readFile(file, 'utf8')) as FlakeDb;
    assert.deepEqual(db.scenarios['dang-nhap::web::chromium']?.outcomes, ['p']);
  });
});
