import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type ScenarioReviewStatus = 'pending' | 'approved' | 'rejected';
export type ScenarioReviewSource = 'generated' | 'manual' | 'legacy';

export interface ScenarioReviewEntry {
  id: string;
  filename: string;
  scenarioName: string;
  contentHash: string;
  status: ScenarioReviewStatus;
  source: ScenarioReviewSource;
  updatedAt: string;
  reviewedAt?: string;
}

interface ScenarioReviewDb {
  version: 1;
  entries: Record<string, ScenarioReviewEntry>;
}

export interface ScenarioBlock {
  name: string;
  content: string;
  contentHash: string;
}

export interface SyncScenarioOptions {
  /** Status assigned only to scenarios that have never been seen before. */
  defaultStatus: ScenarioReviewStatus;
  source: ScenarioReviewSource;
  /** Generated output is always a new review batch, even when text is equal. */
  forcePending?: boolean;
}

const emptyDb = (): ScenarioReviewDb => ({ version: 1, entries: {} });

/**
 * Persistent approval gate for executable scenarios.
 *
 * Approval belongs to the exact reviewed content, not merely to a scenario
 * name. Editing one character changes the hash and puts that scenario back in
 * pending, so a previously approved name can never smuggle unreviewed steps
 * into a local or Device Farm run.
 */
export class ScenarioReviewStore {
  private dirty = false;

  private constructor(
    private readonly file: string,
    private readonly db: ScenarioReviewDb,
    /** True only while bootstrapping a project that never had a review DB. */
    private legacyBootstrapAllowed: boolean,
  ) {}

  static async load(file: string): Promise<ScenarioReviewStore> {
    if (!existsSync(file)) return new ScenarioReviewStore(file, emptyDb(), true);
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<ScenarioReviewDb>;
      return new ScenarioReviewStore(file, {
        version: 1,
        entries: parsed.entries ?? {},
      }, false);
    } catch {
      // Fail closed: a damaged review DB must never turn unreviewed feature
      // files into legacy-approved scenarios.
      return new ScenarioReviewStore(file, emptyDb(), false);
    }
  }

  /**
   * Reconcile one feature file with its current scenario blocks.
   *
   * Existing projects call this with defaultStatus=approved once, preserving
   * backwards compatibility. Every newly generated/created scenario uses
   * pending. Changed content always becomes pending regardless of its source.
   */
  syncFile(filename: string, content: string, opts: SyncScenarioOptions): ScenarioReviewEntry[] {
    const now = new Date().toISOString();
    const blocks = scenarioBlocks(content);
    const live = new Set(blocks.map((block) => scenarioKey(filename, block.name)));

    for (const [key, entry] of Object.entries(this.db.entries)) {
      if (entry.filename === filename && !live.has(key)) {
        delete this.db.entries[key];
        this.dirty = true;
      }
    }

    const result: ScenarioReviewEntry[] = [];
    for (const block of blocks) {
      const key = scenarioKey(filename, block.name);
      const existing = this.db.entries[key];
      if (!existing) {
        const status = opts.forcePending
          ? 'pending'
          : opts.source === 'legacy' && !this.legacyBootstrapAllowed
            ? 'pending'
            : opts.defaultStatus;
        const entry: ScenarioReviewEntry = {
          id: key,
          filename,
          scenarioName: block.name,
          contentHash: block.contentHash,
          status,
          source: opts.source,
          updatedAt: now,
        };
        this.db.entries[key] = entry;
        this.dirty = true;
        result.push(entry);
        continue;
      }

      if (opts.forcePending || existing.contentHash !== block.contentHash) {
        existing.contentHash = block.contentHash;
        existing.status = 'pending';
        existing.source = opts.source;
        existing.updatedAt = now;
        delete existing.reviewedAt;
        this.dirty = true;
      }
      result.push(existing);
    }
    return result;
  }

  review(
    filename: string,
    scenarioName: string,
    content: string,
    decision: 'approve' | 'reject',
  ): ScenarioReviewEntry {
    const block = scenarioBlocks(content).find((item) => item.name === scenarioName);
    if (!block) throw new Error(`Không tìm thấy kịch bản “${scenarioName}” trong ${filename}.`);
    const key = scenarioKey(filename, scenarioName);
    const existing = this.db.entries[key];
    const now = new Date().toISOString();
    const entry: ScenarioReviewEntry = existing ?? {
      id: key,
      filename,
      scenarioName,
      contentHash: block.contentHash,
      status: 'pending',
      source: 'manual',
      updatedAt: now,
    };
    entry.contentHash = block.contentHash;
    entry.status = decision === 'approve' ? 'approved' : 'rejected';
    entry.updatedAt = now;
    entry.reviewedAt = now;
    this.db.entries[key] = entry;
    this.dirty = true;
    return entry;
  }

  entry(filename: string, scenarioName: string): ScenarioReviewEntry | undefined {
    return this.db.entries[scenarioKey(filename, scenarioName)];
  }

  isApproved(filename: string, scenarioName: string, contentHash?: string): boolean {
    const entry = this.entry(filename, scenarioName);
    return Boolean(
      entry?.status === 'approved'
      && (!contentHash || entry.contentHash === contentHash),
    );
  }

  /**
   * Nội dung kịch bản không đổi, chỉ nhãn phân loại đổi.
   *
   * syncFile() thấy contentHash khác là đưa về `pending`, và với một lượt gán
   * lại tag thì luật đó cho kết quả sai: các bước test không đổi một chữ, nên
   * quyết định duyệt trước đó vẫn còn nguyên giá trị — bắt duyệt lại 26 kịch
   * bản chỉ vì sửa một cái nhãn là phí, và tệ hơn là dạy người ta bấm duyệt
   * hàng loạt cho xong.
   *
   * Chỉ dùng khi thứ duy nhất đổi là dòng tag. Trả về true khi có mang trạng
   * thái cũ đi tiếp.
   */
  retagged(filename: string, scenarioName: string, contentHash: string): boolean {
    const entry = this.db.entries[scenarioKey(filename, scenarioName)];
    if (!entry || entry.contentHash === contentHash) return false;
    entry.contentHash = contentHash;
    entry.updatedAt = new Date().toISOString();
    this.dirty = true;
    return true;
  }

  async save(): Promise<void> {
    if (!this.dirty && existsSync(this.file)) return;
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(this.db, null, 2) + '\n', 'utf8');
    this.dirty = false;
    this.legacyBootstrapAllowed = false;
  }
}

/** Extract complete scenario blocks, including their scenario-level tags. */
export function scenarioBlocks(content: string): ScenarioBlock[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const scenarios: Array<{ name: string; line: number; start: number }> = [];
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index]?.match(/^\s*Scenario(?: Outline)?:\s*(.+?)\s*$/iu);
    if (!match?.[1]) continue;
    let start = index;
    while (start > 0 && /^\s*@\S+/.test(lines[start - 1] ?? '')) start--;
    scenarios.push({ name: match[1].trim(), line: index, start });
  }

  return scenarios.map((scenario, index) => {
    const next = scenarios[index + 1];
    const end = next?.start ?? lines.length;
    const block = lines.slice(scenario.start, end).join('\n').trim();
    return {
      name: scenario.name,
      content: block,
      contentHash: scenarioContentHash(block),
    };
  });
}

export function scenarioContentHash(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n').trim().replace(/[ \t]+$/gm, '');
  return createHash('sha256').update(normalized).digest('hex');
}

function scenarioKey(filename: string, scenarioName: string): string {
  return `${filename}::${scenarioName}`;
}
