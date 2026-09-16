import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import type { DuplicateElementPair } from './duplicateElements.js';

/**
 * Quyết định của con người về những cặp element bị nghi là cùng một control.
 *
 * Chỉ QUYẾT ĐỊNH được lưu, còn danh sách nghi vấn thì tính lại từ registry mỗi
 * lần hỏi. Cặp nào registry đổi làm nó hết nghi thì tự biến mất, không cần ai
 * đi dọn — và một quyết định cũ không bao giờ hồi sinh một cặp đã hết nghi.
 *
 * Có chỗ ghi "không phải trùng" là điều kiện sống của cả cơ chế. Bốn cặp đầu
 * tiên đo được trên registry thật có ít nhất một cặp gần như chắc chắn là cố ý
 * — cùng một trường trên màn nhập và màn xác nhận chuyển tiền — và một danh
 * sách không bao giờ về 0 thì sẽ bị ngó lơ cả phần đúng trong nó.
 */
export type DuplicateDecision = 'merged' | 'distinct';

export interface DuplicateReviewEntry {
  decision: DuplicateDecision;
  at: string;
}

interface DuplicateReviewDb {
  version: 1;
  decisions: Record<string, DuplicateReviewEntry>;
}

/** Khoá theo cặp id, xếp cố định để đổi chỗ hai bên vẫn là một cặp. */
export function pairKey(a: string, b: string): string {
  return [a, b].sort().join('::');
}

export class DuplicateReviewStore {
  private constructor(
    private readonly file: string,
    private db: DuplicateReviewDb,
  ) {}

  static async load(file: string): Promise<DuplicateReviewStore> {
    if (!existsSync(file)) {
      return new DuplicateReviewStore(file, { version: 1, decisions: {} });
    }
    const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<DuplicateReviewDb>;
    return new DuplicateReviewStore(file, {
      version: 1,
      decisions: parsed.decisions ?? {},
    });
  }

  decisionFor(a: string, b: string): DuplicateReviewEntry | undefined {
    return this.db.decisions[pairKey(a, b)];
  }

  /** Cặp chưa ai quyết định — thứ duy nhất đáng hiện ra để duyệt. */
  pending(pairs: DuplicateElementPair[]): DuplicateElementPair[] {
    return pairs.filter((pair) => !this.decisionFor(pair.strong, pair.weak));
  }

  decide(a: string, b: string, decision: DuplicateDecision): void {
    this.db.decisions[pairKey(a, b)] = { decision, at: new Date().toISOString() };
  }

  async save(): Promise<void> {
    await writeFile(this.file, JSON.stringify(this.db, null, 2) + '\n', 'utf8');
  }
}
