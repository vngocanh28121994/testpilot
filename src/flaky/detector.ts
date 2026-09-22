import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import type { HealSuggestion, Platform, ScenarioResult } from '../core/types.js';
import type { Registry } from '../core/registry.js';

/**
 * Flakiness is a property of history, not of a single run. One red build tells
 * you nothing; the same scenario going red 3 times out of 40 on the same commit
 * range tells you everything. So the detector keeps a rolling window on disk.
 */

export interface ScenarioHistory {
  /** Newest first, capped at `window`. 'p' passed, 'f' failed, 'k' flaky, 's' skipped-while-quarantined. */
  outcomes: Array<'p' | 'f' | 'k' | 's'>;
  lastSeen: string;
  quarantinedSince?: string;
}

export interface FlakeDb {
  version: 1;
  window: number;
  scenarios: Record<string, ScenarioHistory>;
}

export interface FlakeVerdict {
  key: string;
  scenarioId: string;
  platform: Platform;
  device: string;
  /** 0..1 — share of the window that was not a clean pass. */
  flakeRate: number;
  runs: number;
  /** Consistently failing, not flaky: this is a real bug, do not quarantine it. */
  brokenNotFlaky: boolean;
  shouldQuarantine: boolean;
}

export interface FlakePolicy {
  window: number;
  /** Minimum runs before a verdict is meaningful. */
  minRuns: number;
  /** Above this rate the scenario is quarantined out of the blocking suite. */
  quarantineAt: number;
  /** At/above this failure rate it is broken, not flaky. */
  brokenAt: number;
}

export const DEFAULT_FLAKE_POLICY: FlakePolicy = {
  window: 30,
  minRuns: 10,
  quarantineAt: 0.15,
  brokenAt: 0.95,
};

export class FlakeDetector {
  /**
   * Sổ đúng như lúc đọc từ đĩa.
   *
   * `outcomes` là một vòng đệm: mỗi lượt chạy chèn kết quả vào ĐẦU và cắt đuôi
   * theo `window`. Nên "phần ta thêm" chính là số phần tử ta chèn thêm so với
   * bản này — và không có nó thì lúc ghi ta chỉ biết trạng thái cuối, không
   * biết mình đã thêm gì.
   */
  private readonly baseline: FlakeDb;

  private constructor(
    private readonly path: string,
    private db: FlakeDb,
    private readonly policy: FlakePolicy,
  ) {
    this.baseline = structuredClone(db);
  }

  static async load(path: string, policy: FlakePolicy = DEFAULT_FLAKE_POLICY): Promise<FlakeDetector> {
    const db: FlakeDb = existsSync(path)
      ? (JSON.parse(await readFile(path, 'utf8')) as FlakeDb)
      : { version: 1, window: policy.window, scenarios: {} };
    return new FlakeDetector(path, db, policy);
  }

  /** Key includes the device: a scenario can be flaky on one device and solid on another. */
  static key(r: Pick<ScenarioResult, 'platform' | 'device'> & { scenario: { id: string } }): string {
    return `${r.scenario.id}::${r.platform}::${r.device}`;
  }

  ingest(results: ScenarioResult[]): FlakeVerdict[] {
    const verdicts: FlakeVerdict[] = [];
    for (const r of results) {
      const key = FlakeDetector.key(r);
      const hist = (this.db.scenarios[key] ??= { outcomes: [], lastSeen: '' });
      hist.outcomes.unshift(r.verdict === 'passed' ? 'p' : r.verdict === 'flaky' ? 'k' : 'f');
      hist.outcomes.length = Math.min(hist.outcomes.length, this.policy.window);
      hist.lastSeen = new Date().toISOString();

      verdicts.push(this.#evaluate(key, hist));
    }
    return verdicts;
  }

  /**
   * Record a quarantine-skip for each scenario that was skipped this run.
   * Each 's' outcome dilutes the failure rate so the quarantine can lift
   * naturally once the window fills up with enough skips (or clean runs via
   * --include-quarantined).
   */
  ingestSkipped(items: Array<{ id: string; platform: Platform; device: string }>): void {
    const now = new Date().toISOString();
    for (const item of items) {
      const key = `${item.id}::${item.platform}::${item.device}`;
      const hist = (this.db.scenarios[key] ??= { outcomes: [], lastSeen: '' });
      hist.outcomes.unshift('s');
      hist.outcomes.length = Math.min(hist.outcomes.length, this.policy.window);
      hist.lastSeen = now;
      this.#evaluate(key, hist);
    }
  }

  #evaluate(key: string, hist: ScenarioHistory): FlakeVerdict {
    const [scenarioId = '', platform = '', device = ''] = key.split('::') as [string, Platform, string];
    const runs = hist.outcomes.length;
    // 's' (quarantine-skip) is neutral — not a failure, but counts as a run
    // so the failure rate dilutes over time and the quarantine can lift.
    const bad = hist.outcomes.filter((o) => o === 'f' || o === 'k').length;
    const hardFails = hist.outcomes.filter((o) => o === 'f').length;
    const flakeRate = runs === 0 ? 0 : bad / runs;
    const brokenNotFlaky = runs >= this.policy.minRuns && hardFails / runs >= this.policy.brokenAt;
    const shouldQuarantine =
      runs >= this.policy.minRuns && flakeRate >= this.policy.quarantineAt && !brokenNotFlaky;

    if (shouldQuarantine && !hist.quarantinedSince) {
      hist.quarantinedSince = new Date().toISOString();
    } else if (!shouldQuarantine) {
      delete hist.quarantinedSince;
    }

    return { key, scenarioId, platform: platform as Platform, device, flakeRate, runs, brokenNotFlaky, shouldQuarantine };
  }

  isQuarantined(scenarioId: string, platform: Platform, device: string): boolean {
    return Boolean(this.db.scenarios[`${scenarioId}::${platform}::${device}`]?.quarantinedSince);
  }

  /**
   * Ghi bằng cách CỘNG DỒN kết quả mới vào sổ đang có trên đĩa.
   *
   * Đây là số liệu, không phải một bản ghi có phiên bản. Bản cũ ghi đè cả tệp,
   * nên hai lượt chạy song song thì lượt kết thúc sau xoá luôn kết quả của
   * lượt kia — và hậu quả không phải một lỗi mà là một CÂU TRẢ LỜI SAI: tỷ lệ
   * flaky tính trên một cửa sổ thiếu dữ liệu, rồi một kịch bản chập chờn được
   * tuyên là ổn định. Không ai báo cáo chuyện đó, vì trông nó giống tin tốt.
   */
  async save(): Promise<void> {
    const onDisk: FlakeDb = existsSync(this.path)
      ? (JSON.parse(await readFile(this.path, 'utf8')) as FlakeDb)
      : { version: 1, window: this.policy.window, scenarios: {} };
    await writeFile(
      this.path,
      JSON.stringify(mergeFlake(onDisk, this.baseline, this.db, this.policy.window), null, 2) + '\n',
      'utf8',
    );
  }
}

/**
 * Gộp ba bản sổ flaky: bản trên đĩa, bản lúc ta đọc, bản ta đang giữ.
 *
 * `outcomes` mới nhất nằm ở ĐẦU mảng, nên phần ta thêm là đoạn đầu dài
 * `mine.length - base.length`. Đặt nó trước đoạn của bản đĩa rồi cắt theo
 * `window`: thứ tự thời gian giữa hai lượt chạy song song không xác định được,
 * và cũng không cần — cửa sổ chỉ hỏi "trong N lần gần đây có bao nhiêu lần
 * hỏng", không hỏi thứ tự chính xác.
 *
 * `quarantinedSince` là thứ chỉ được ĐẶT chứ không tự mất: giữ mốc sớm hơn
 * trong hai bên, vì đó là lúc kịch bản bắt đầu bị cách ly. Bản nào vừa gỡ cách
 * ly thì nó không còn mốc, và lúc ấy kết quả cũng không còn mốc.
 */
function mergeFlake(disk: FlakeDb, base: FlakeDb, mine: FlakeDb, window: number): FlakeDb {
  const out: FlakeDb = { version: 1, window, scenarios: { ...disk.scenarios } };

  for (const [key, mineHist] of Object.entries(mine.scenarios)) {
    const baseHist = base.scenarios[key];
    const diskHist = out.scenarios[key];
    const addedCount = Math.max(0, mineHist.outcomes.length - (baseHist?.outcomes.length ?? 0));
    const added = mineHist.outcomes.slice(0, addedCount);

    if (!diskHist) {
      out.scenarios[key] = mineHist;
      continue;
    }

    const outcomes = [...added, ...diskHist.outcomes].slice(0, window);
    const bothCleared = !mineHist.quarantinedSince && !diskHist.quarantinedSince;
    const since = bothCleared
      ? undefined
      : [mineHist.quarantinedSince, diskHist.quarantinedSince]
          .filter((value): value is string => Boolean(value))
          .sort()[0];

    out.scenarios[key] = {
      outcomes,
      lastSeen: diskHist.lastSeen > mineHist.lastSeen ? diskHist.lastSeen : mineHist.lastSeen,
      ...(since ? { quarantinedSince: since } : {}),
    };
  }
  return out;
}

/**
 * Turn healing telemetry into reviewable proposals.
 *
 * Nothing here rewrites the registry. A locator that healed once was probably a
 * race; a locator that healed on every single resolution is a locator the app
 * team actually renamed — only that second case is worth a human's attention.
 */
export function collectHealSuggestions(
  registry: Registry,
  results: ScenarioResult[],
  minSuccesses = 3,
): HealSuggestion[] {
  const seen = new Map<string, { platform: Platform; count: number; from: string; to: string }>();

  for (const r of results) {
    for (const run of r.runs) {
      for (const step of run.steps) {
        if (!step.heal) continue;
        const k = `${step.heal.elementId}::${r.platform}`;
        const entry = seen.get(k) ?? {
          platform: r.platform,
          count: 0,
          from: `${step.heal.from.strategy}:${step.heal.from.value}`,
          to: `${step.heal.to.strategy}:${step.heal.to.value}`,
        };
        entry.count += 1;
        seen.set(k, entry);
      }
    }
  }

  const out: HealSuggestion[] = [];
  for (const [k, entry] of seen) {
    if (entry.count < minSuccesses) continue;
    const elementId = k.split('::')[0]!;
    const list = registry.raw.elements[elementId]?.candidates[entry.platform] ?? [];
    const current = list[0];
    const proposed = list.find((c) => `${c.strategy}:${c.value}` === entry.to);
    if (!current || !proposed) continue;
    out.push({
      elementId,
      platform: entry.platform,
      current,
      proposed,
      successes: entry.count,
      rationale:
        `The primary locator (${entry.from}) failed and the fallback (${entry.to}) succeeded ` +
        `${entry.count} times in this run. Promote the fallback, or ask the app team to restore the test id.`,
    });
  }
  return out.sort((a, b) => b.successes - a.successes);
}
