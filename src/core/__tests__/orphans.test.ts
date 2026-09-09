/**
 * Tiến trình test sống sót sau khi server chết.
 *
 * Trên POSIX giết cha không giết con. Server giữ handle của tiến trình chạy
 * test trong một Set nằm trong RAM, và Set đó là thứ duy nhất nút Dừng biết
 * tới — server chết là nút Dừng mất trí nhớ, còn điện thoại cắm ở bàn thì vẫn
 * tiếp tục bấm. Với một bộ test chuyển tiền thật thì đó không phải phiền toái.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { OrphanTracker } from '../orphans.js';

const tmpFile = () => path.join(mkdtempSync(path.join(tmpdir(), 'tp-pid-')), 'running-pids.json');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('OrphanTracker', () => {
  it('ghi PID xuống đĩa để server sau còn biết', () => {
    const file = tmpFile();
    OrphanTracker.load(file).add(4242, 'src/cli/run.ts', 'run web');
    assert.ok(existsSync(file), 'không ghi gì xuống đĩa thì server sau không biết PID nào');
    assert.equal(OrphanTracker.load(file).reapOrphans().length >= 0, true);
  });

  it('xoá dấu khi tiến trình kết thúc bình thường', () => {
    const file = tmpFile();
    const tracker = OrphanTracker.load(file);
    tracker.add(4242, 'x', 'y');
    tracker.remove(4242);
    assert.equal(existsSync(file), false, 'hết PID thì phải xoá tệp, không để lại tệp rỗng');
  });

  it('giết được tiến trình còn sống từ lần trước', async () => {
    const file = tmpFile();
    const child = spawn('sleep', ['30']);
    await sleep(150);
    OrphanTracker.load(file).add(child.pid!, 'sleep', 'sleep giả');

    const reaped = OrphanTracker.load(file).reapOrphans();
    assert.equal(reaped.length, 1);
    assert.equal(reaped[0]!.killed, true);
    await sleep(250);
    assert.notEqual(child.exitCode ?? child.signalCode, null, 'tiến trình vẫn còn sống');
  });

  /**
   * Hệ điều hành dùng lại PID. Giết theo PID trần là có ngày giết nhầm thứ
   * hoàn toàn khác — đúng cái bẫy mà chỗ dừng WebDriverAgent đã nêu.
   */
  it('không giết khi PID đã bị dùng lại cho thứ khác', async () => {
    const file = tmpFile();
    const child = spawn('sleep', ['30']);
    await sleep(150);
    // Chữ ký không khớp dòng lệnh thật của PID này.
    OrphanTracker.load(file).add(child.pid!, 'src/cli/run.ts', 'run web');

    assert.deepEqual(OrphanTracker.load(file).reapOrphans(), []);
    await sleep(200);
    assert.equal(child.exitCode ?? child.signalCode, null, 'đã giết nhầm một tiến trình không liên quan');
    child.kill('SIGKILL');
  });

  it('PID đã chết thì bỏ qua, không báo là đã giết', () => {
    const file = tmpFile();
    OrphanTracker.load(file).add(999_999, 'sleep', 'đã chết từ lâu');
    assert.deepEqual(OrphanTracker.load(file).reapOrphans(), []);
  });

  it('tệp hỏng không được chặn server khởi động', () => {
    const file = tmpFile();
    writeFileSync(file, '{ hỏng', 'utf8');
    assert.deepEqual(OrphanTracker.load(file).reapOrphans(), []);
  });
});
