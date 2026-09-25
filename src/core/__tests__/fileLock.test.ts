/**
 * Khoá tệp giữa các tiến trình: hai lượt gộp registry không được chồng lên nhau.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { withFileLock } from '../fileLock.js';

async function tempLock(): Promise<{ lock: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tp-lock-'));
  return { lock: path.join(dir, '.merge.lock'), cleanup: () => rm(dir, { recursive: true, force: true }) };
}

describe('withFileLock', () => {
  it('hai bên cùng xin khoá thì chạy LẦN LƯỢT, không chồng lên nhau', async () => {
    const { lock, cleanup } = await tempLock();
    try {
      let inside = 0;
      let peak = 0;
      const order: string[] = [];
      const work = (name: string) => withFileLock(lock, async () => {
        inside += 1;
        peak = Math.max(peak, inside);
        order.push(`${name}:vào`);
        await new Promise((resolve) => setTimeout(resolve, 30));
        order.push(`${name}:ra`);
        inside -= 1;
      }, { retryMs: 5 });
      await Promise.all([work('a'), work('b')]);
      assert.equal(peak, 1);
      assert.equal(order.length, 4);
      assert.equal(existsSync(lock), false, 'xong việc thì phải nhả khoá');
    } finally {
      await cleanup();
    }
  });

  it('nhả khoá cả khi việc bên trong ném lỗi', async () => {
    const { lock, cleanup } = await tempLock();
    try {
      await assert.rejects(withFileLock(lock, async () => { throw new Error('hỏng'); }), /hỏng/);
      assert.equal(existsSync(lock), false);
    } finally {
      await cleanup();
    }
  });

  it('khoá của một tiến trình đã chết thì được dọn, không chặn mãi', async () => {
    const { lock, cleanup } = await tempLock();
    try {
      // PID gần như chắc chắn không tồn tại.
      await writeFile(lock, '999999');
      assert.equal(await withFileLock(lock, async () => 'xong', { retryMs: 5, waitMs: 500 }), 'xong');
    } finally {
      await cleanup();
    }
  });

  it('khoá quá cũ thì coi như bị bỏ rơi, kể cả khi PID còn sống', async () => {
    const { lock, cleanup } = await tempLock();
    try {
      await writeFile(lock, String(process.pid));
      const old = new Date(Date.now() - 60_000);
      await utimes(lock, old, old);
      assert.equal(await withFileLock(lock, async () => 'xong', { staleMs: 1_000, retryMs: 5, waitMs: 500 }), 'xong');
    } finally {
      await cleanup();
    }
  });

  it('chờ quá lâu thì báo bằng câu nói được việc cần làm', async () => {
    const { lock, cleanup } = await tempLock();
    try {
      await writeFile(lock, String(process.pid));
      await assert.rejects(
        withFileLock(lock, async () => undefined, { retryMs: 5, waitMs: 30 }),
        /lượt chạy khác ghi kết quả vào registry/,
      );
    } finally {
      await cleanup();
    }
  });
});
