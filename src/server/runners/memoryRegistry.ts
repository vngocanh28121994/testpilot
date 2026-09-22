/**
 * Sổ runner trong bộ nhớ — chế độ `embedded`.
 *
 * Ở chế độ ấy máy chạy server CHÍNH LÀ máy có thiết bị, nên sổ này gần như
 * luôn có đúng một dòng. Nó vẫn tồn tại vì hai lý do: `authorize()` chỉ biết
 * một đường tra token cho cả hai chế độ, và một người dùng bản local vẫn có
 * thể cắm thêm một runner cá nhân thứ hai vào chính máy mình.
 *
 * Token nạp từ môi trường nếu có: `TESTPILOT_RUNNER_TOKEN` là cách P3.4 làm,
 * và bỏ nó đi sẽ làm hỏng mọi cấu hình đang chạy.
 */
import { randomUUID } from 'node:crypto';
import type { PrereqByPlatform } from '../../runner/prereqReport.js';
import {
  hashToken,
  mintToken,
  type NewRunner,
  type RunnerRecord,
  type RunnerRegistry,
} from './registry.js';

export class MemoryRunnerRegistry implements RunnerRegistry {
  private readonly runners = new Map<string, RunnerRecord>();
  private readonly tokens = new Map<string, string>();

  /**
   * Nạp token dùng chung từ môi trường thành một runner có thật.
   *
   * Nhờ vậy `authorize()` chỉ có MỘT đường tra: tra sổ. Giữ thêm một nhánh
   * "hoặc là token môi trường" là giữ hai đường quyết định quyền, và đường ít
   * được nhìn tới sẽ là đường sai.
   */
  seedFromEnv(orgId = 'local', env = process.env): void {
    const token = env.TESTPILOT_RUNNER_TOKEN?.trim();
    if (!token) return;
    const id = 'runner:env';
    if (this.runners.has(id)) return;
    this.runners.set(id, {
      id,
      orgId,
      name: env.TESTPILOT_RUNNER_NAME?.trim() || 'runner cục bộ',
      mode: 'lab',
      visibility: 'shared',
      state: 'online',
      createdAt: new Date().toISOString(),
    });
    this.tokens.set(hashToken(token), id);
  }

  async create(runner: NewRunner): Promise<{ runner: RunnerRecord; token: string }> {
    const token = mintToken();
    const record: RunnerRecord = {
      // Id KHÔNG chứa tên máy: tên do người dùng đặt và có dấu cách, dấu
      // tiếng Việt, đủ thứ — mà id thì đi vào log, URL và khoá ngoại. Bản
      // Postgres cũng dùng UUID, nên hai hiện thực giống nhau ở cả hình dạng.
      id: `runner:${randomUUID()}`,
      orgId: runner.orgId,
      name: runner.name,
      mode: runner.mode,
      ...(runner.ownerUserId ? { ownerUserId: runner.ownerUserId } : {}),
      visibility: runner.visibility,
      state: 'offline',
      createdAt: new Date().toISOString(),
    };
    this.runners.set(record.id, record);
    this.tokens.set(hashToken(token), record.id);
    return { runner: record, token };
  }

  async findByToken(token: string): Promise<RunnerRecord | undefined> {
    const id = this.tokens.get(hashToken(token));
    return id ? this.runners.get(id) : undefined;
  }

  async find(id: string): Promise<RunnerRecord | undefined> {
    return this.runners.get(id);
  }

  async list(): Promise<RunnerRecord[]> {
    return [...this.runners.values()];
  }

  async rotate(id: string): Promise<string | undefined> {
    if (!this.runners.has(id)) return undefined;
    for (const [hash, owner] of this.tokens) if (owner === id) this.tokens.delete(hash);
    const token = mintToken();
    this.tokens.set(hashToken(token), id);
    return token;
  }

  async revoke(id: string): Promise<boolean> {
    const record = this.runners.get(id);
    if (!record) return false;
    for (const [hash, owner] of this.tokens) if (owner === id) this.tokens.delete(hash);
    this.runners.set(id, { ...record, state: 'offline' });
    return true;
  }

  async touch(id: string, at = new Date()): Promise<void> {
    const record = this.runners.get(id);
    if (!record) return;
    this.runners.set(id, { ...record, state: 'online', lastSeenAt: at.toISOString() });
  }

  async reportPrereq(id: string, prereq: PrereqByPlatform): Promise<void> {
    const record = this.runners.get(id);
    if (!record) return;
    this.runners.set(id, { ...record, prereq });
  }

  async reapSilent(olderThanMs: number, now = new Date()): Promise<number> {
    let changed = 0;
    for (const [id, record] of this.runners) {
      if (record.state !== 'online') continue;
      const seen = record.lastSeenAt ? Date.parse(record.lastSeenAt) : 0;
      if (now.getTime() - seen < olderThanMs) continue;
      this.runners.set(id, { ...record, state: 'offline' });
      changed += 1;
    }
    return changed;
  }
}

/** MỘT sổ cho cả tiến trình — cùng lý do với `localQueue` và `localLeases`. */
export const localRunners = new MemoryRunnerRegistry();
