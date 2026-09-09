/**
 * Lượt chạy đang sống, và log của nó, giữ ở phía server.
 *
 * Trước đây log chỉ tồn tại trên đường dây SSE tới đúng cái tab đã bấm nút.
 * Tab tải lại là đứt, và không có đường nối lại: job store nằm trong RAM của
 * trang, `log.txt` tới cuối lượt chạy mới được ghi, `/api/state` không nói gì.
 * Thiết bị vẫn bấm, tool nói không có gì đang chạy — và nút Dừng, thứ vốn vẫn
 * hoạt động, không được hiện ra vì giao diện tưởng chẳng có gì để dừng.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { activeRuns, beginActiveRun, endActiveRun, findActiveRun } from '../activeRuns.js';

describe('sổ lượt chạy đang sống', () => {
  it('hiện ra khi bắt đầu, biến mất khi kết thúc', () => {
    const before = activeRuns().length;
    const run = beginActiveRun('web · @tag', 'run');
    assert.equal(activeRuns().length, before + 1);
    assert.ok(findActiveRun(run.id));
    endActiveRun(run);
    assert.equal(activeRuns().length, before);
    assert.equal(findActiveRun(run.id), undefined);
  });

  /** Đây là toàn bộ điểm của việc nối lại: người tới sau vẫn thấy phần đã qua. */
  it('người nối vào sau vẫn nhận đủ log đã trôi qua', () => {
    const run = beginActiveRun('web', 'run');
    run.push('dòng 1');
    run.push('dòng 2');
    const seen: string[] = [];
    const { history, off } = run.subscribe((line) => seen.push(line));
    assert.deepEqual(history, ['dòng 1', 'dòng 2']);
    run.push('dòng 3');
    assert.deepEqual(seen, ['dòng 3']);
    off();
    run.push('dòng 4');
    assert.deepEqual(seen, ['dòng 3'], 'huỷ đăng ký rồi vẫn còn nhận');
    endActiveRun(run);
  });

  /**
   * Thư mục chỉ biết được sau khi tiến trình con báo, tức muộn hơn dòng log đầu
   * tiên. Những dòng đã trôi qua phải được ghi bù, không thì log trên đĩa thiếu
   * đúng phần đầu — phần nói vì sao lượt chạy bắt đầu như vậy.
   */
  it('ghi log.txt dần, và ghi bù phần trước khi biết thư mục', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tp-run-'));
    const run = beginActiveRun('web', 'run');
    run.push('trước khi biết thư mục');
    run.attachDir(dir);
    run.push('sau khi biết');
    const written = readFileSync(path.join(dir, 'log.txt'), 'utf8');
    assert.match(written, /trước khi biết thư mục/);
    assert.match(written, /sau khi biết/);
    endActiveRun(run);
  });

  it('thư mục hỏng không làm chết lượt chạy', () => {
    const run = beginActiveRun('web', 'run');
    run.attachDir('/khong/ton/tai/va/khong/tao/duoc\0');
    run.push('vẫn phải chạy tiếp');
    assert.equal(run.view().lines, 1);
    endActiveRun(run);
  });

  it('đệm có trần, và nói ra số dòng đã cắt', () => {
    const run = beginActiveRun('web', 'run');
    for (let i = 0; i < 8_100; i += 1) run.push(`dòng ${i}`);
    const view = run.view();
    assert.ok(view.lines <= 8_000, 'đệm không có trần thì một lượt dài ăn hết RAM');
    assert.ok(view.dropped > 0, 'cắt bớt mà im lặng thì người đọc tưởng log đầy đủ');
    endActiveRun(run);
  });
});
