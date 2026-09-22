import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRunnerRegistry } from '../memoryRegistry.js';
import { hashToken, mintToken } from '../registry.js';
import { registryContract } from './registryContract.js';

describe('MemoryRunnerRegistry', () => {
  registryContract(it, async () => new MemoryRunnerRegistry());

  /**
   * Token dùng chung của P3.4 phải còn chạy: bỏ nó đi làm hỏng mọi cấu hình
   * đang chạy, và một bản nâng cấp làm hỏng thứ đang dùng được là một bản nâng
   * cấp không ai cài.
   */
  it('nạp token dùng chung từ môi trường thành một runner có thật', async () => {
    const registry = new MemoryRunnerRegistry();
    registry.seedFromEnv('local', { TESTPILOT_RUNNER_TOKEN: 'bi-mat-cu' } as NodeJS.ProcessEnv);

    const found = await registry.findByToken('bi-mat-cu');
    assert.ok(found, 'token của P3.4 phải còn mở được cửa');
    assert.equal(found.orgId, 'local');
    assert.equal(found.mode, 'lab');
  });

  it('không đặt biến môi trường thì không có runner nào', async () => {
    const registry = new MemoryRunnerRegistry();
    registry.seedFromEnv('local', {} as NodeJS.ProcessEnv);
    assert.deepEqual(await registry.list(), []);
  });
});

describe('token', () => {
  /** Đoán được token là chiếm được quyền chạy lệnh trên máy của một người. */
  it('mỗi lần sinh ra một token khác nhau, đủ dài', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => mintToken()));
    assert.equal(tokens.size, 50);
    for (const token of tokens) assert.ok(token.length >= 40, token);
  });

  it('hash cùng chuỗi cho cùng kết quả, và không đọc ngược được', () => {
    const token = mintToken();
    assert.equal(hashToken(token), hashToken(token));
    assert.match(hashToken(token), /^[0-9a-f]{64}$/);
    assert.ok(!hashToken(token).includes(token.slice(0, 8)));
  });
});
