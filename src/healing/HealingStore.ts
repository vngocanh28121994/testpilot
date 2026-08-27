import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Registry } from '../core/registry.js';
import type {
  HealSuggestion,
  LocatorCandidate,
  Platform,
  RunReport,
  ScenarioResult,
} from '../core/types.js';

interface HealingHistory {
  elementId: string;
  platform: Platform;
  from: LocatorCandidate;
  to: LocatorCandidate;
  successes: number;
  runIds: string[];
  /**
   * How many of the successes came from each device.
   *
   * Deliberately kept *inside* the entry rather than folded into its key. A key
   * per device would split one locator's evidence three ways, and since a
   * proposal needs several successes across several runs, three devices seeing
   * the same broken testId once each would produce three entries that each
   * prove nothing — the opposite of what running three devices is for.
   *
   * Pooled evidence is right; anonymous evidence is not. A locator that is
   * correct on two devices and wrong on a third heals only on the third, and
   * once that device has run enough times its evidence alone clears the bar for
   * a proposal that then applies to the whole platform. The breakdown is what
   * lets a reviewer see that before approving it.
   *
   * Absent on entries written before this existed; see `deviceCount`.
   */
  devices?: Record<string, number>;
  firstSeen: string;
  lastSeen: string;
  decision?: 'applied' | 'rejected';
  reviewedAt?: string;
}

export interface HealingRecord {
  id: string;
  elementId: string;
  platform: Platform;
  current: LocatorCandidate;
  proposed: LocatorCandidate;
  successes: number;
  runs: number;
  runIds: string[];
  /** Successes per device, so a reviewer can see where the evidence came from. */
  devices: Record<string, number>;
  /**
   * Distinct devices that contributed. Reported as 1 for evidence recorded
   * before the breakdown existed: it happened somewhere, and calling that 0
   * would make old entries look less supported than they are.
   */
  deviceCount: number;
  firstSeen: string;
  lastSeen: string;
  status: 'watching' | 'proposed' | 'applied' | 'rejected';
}

interface HealingDb {
  version: 1;
  /** Makes backfill and repeated Device Farm pulls idempotent. */
  ingestedRuns: Record<string, string>;
  entries: Record<string, HealingHistory>;
}

const emptyDb = (): HealingDb => ({ version: 1, ingestedRuns: {}, entries: {} });

/**
 * Persistent, cross-run evidence for locator healing.
 *
 * A report is a snapshot, while locator reliability is historical. Keeping the
 * counter here means three independent runs can justify one proposal; the old
 * implementation reset the counter for every run and therefore almost never
 * produced a proposal.
 */
export class HealingStore {
  private constructor(
    private readonly file: string,
    private readonly db: HealingDb,
  ) {}

  static async load(file: string): Promise<HealingStore> {
    if (!existsSync(file)) return new HealingStore(file, emptyDb());
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<HealingDb>;
      return new HealingStore(file, {
        version: 1,
        ingestedRuns: parsed.ingestedRuns ?? {},
        entries: parsed.entries ?? {},
      });
    } catch {
      // A damaged telemetry file must not prevent the suite from running. The
      // retained run reports can rebuild it on the next backfill.
      return new HealingStore(file, emptyDb());
    }
  }

  /** Import retained reports once so existing healing evidence is not lost. */
  async backfill(runsDir: string): Promise<number> {
    if (!existsSync(runsDir)) return 0;
    let imported = 0;
    for (const entry of await readdir(runsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || this.db.ingestedRuns[entry.name]) continue;
      const reportFile = path.join(runsDir, entry.name, 'report.json');
      if (!existsSync(reportFile)) continue;
      try {
        const raw = JSON.parse(await readFile(reportFile, 'utf8')) as
          | { report?: RunReport }
          | RunReport;
        const report = 'report' in raw && raw.report ? raw.report : raw as RunReport;
        imported += this.ingest(entry.name, report.results ?? [], report.finishedAt);
      } catch {
        // One incomplete report should not discard evidence from every other run.
      }
    }
    return imported;
  }

  /** Returns the number of healing events newly recorded. */
  ingest(runId: string, results: ScenarioResult[], seenAt = new Date().toISOString()): number {
    if (this.db.ingestedRuns[runId]) return 0;
    let added = 0;

    for (const result of results) {
      for (const attempt of result.runs) {
        for (const step of attempt.steps) {
          if (!step.heal) continue;
          const from = persisted(step.heal.from);
          const to = persisted(step.heal.to);
          if (sameLocator(from, to)) continue;

          const key = historyKey(step.heal.elementId, result.platform, from, to);
          const history = (this.db.entries[key] ??= {
            elementId: step.heal.elementId,
            platform: result.platform,
            from,
            to,
            successes: 0,
            runIds: [],
            firstSeen: seenAt,
            lastSeen: seenAt,
          });
          history.successes += 1;
          if (!history.runIds.includes(runId)) history.runIds.push(runId);
          const device = result.device || 'unknown';
          history.devices = { ...history.devices, [device]: (history.devices?.[device] ?? 0) + 1 };
          history.lastSeen = seenAt;
          added += 1;
        }
      }
    }

    this.db.ingestedRuns[runId] = seenAt;
    return added;
  }

  /**
   * Produce at most one well-supported proposal per logical element/platform.
   * Three successes spanning at least two runs avoids promoting a one-off race.
   */
  suggestions(
    registry: Registry,
    minSuccesses = 3,
    minRuns = 2,
    /**
     * Devices that must have seen the heal. Defaults to 1, which is every
     * suite that runs one device and therefore changes nothing for them. Raise
     * it when several devices run the same suite and a locator is only allowed
     * to become the platform's primary if more than one of them agreed.
     */
    minDevices = 1,
  ): HealSuggestion[] {
    const eligible = Object.values(this.db.entries)
      .filter((h) => h.successes >= minSuccesses && h.runIds.length >= minRuns)
      .filter((h) => deviceCountOf(h) >= minDevices)
      .filter((h) => Boolean(registry.raw.elements[h.elementId]))
      .sort((a, b) => b.successes - a.successes || b.lastSeen.localeCompare(a.lastSeen));

    const selected = new Map<string, HealingHistory>();
    for (const history of eligible) {
      const key = `${history.elementId}::${history.platform}`;
      if (!selected.has(key)) selected.set(key, history);
    }

    return [...selected.values()].map((history) => ({
      elementId: history.elementId,
      platform: history.platform,
      current: history.from,
      proposed: history.to,
      successes: history.successes,
      runs: history.runIds.length,
      firstSeen: history.firstSeen,
      lastSeen: history.lastSeen,
      rationale:
        `Primary locator failed and this fallback succeeded ${history.successes} times ` +
        `across ${history.runIds.length} runs. Review and promote it as the new primary locator.`,
    }));
  }

  records(minSuccesses = 3, minRuns = 2): HealingRecord[] {
    return Object.entries(this.db.entries)
      .map(([id, history]): HealingRecord => {
        const status: HealingRecord['status'] = history.decision ?? (
          history.successes >= minSuccesses && history.runIds.length >= minRuns
            ? 'proposed'
            : 'watching'
        );
        return {
          id,
          elementId: history.elementId,
          platform: history.platform,
          current: history.from,
          proposed: history.to,
          successes: history.successes,
          runs: history.runIds.length,
          runIds: [...history.runIds],
          devices: { ...history.devices },
          deviceCount: deviceCountOf(history),
          firstSeen: history.firstSeen,
          lastSeen: history.lastSeen,
          status,
        };
      })
      .sort((a, b) => {
        const priority = { proposed: 0, watching: 1, applied: 2, rejected: 3 } as const;
        return priority[a.status] - priority[b.status]
          || b.successes - a.successes
          || b.lastSeen.localeCompare(a.lastSeen);
      });
  }

  review(id: string, decision: 'applied' | 'rejected'): HealingRecord {
    const history = this.db.entries[id];
    if (!history) throw new Error('Không tìm thấy đề xuất healing.');
    const eligible = history.successes >= 3 && history.runIds.length >= 2;
    if (!eligible && decision === 'applied') {
      throw new Error('Đề xuất chưa đủ bằng chứng để áp dụng.');
    }
    history.decision = decision;
    history.reviewedAt = new Date().toISOString();
    return this.records().find((record) => record.id === id)!;
  }

  async save(): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(this.db, null, 2) + '\n', 'utf8');
  }
}

function persisted(candidate: LocatorCandidate): LocatorCandidate {
  const { runtimeScope: _runtimeScope, ...rest } = candidate;
  return rest;
}

/**
 * Distinct devices behind an entry's evidence.
 *
 * An entry recorded before the breakdown existed reports 1, not 0: the heal
 * demonstrably happened, only its device went unrecorded, and treating that as
 * "no device agreed" would retire every existing proposal the moment a suite
 * asked for more than one.
 */
function deviceCountOf(history: { devices?: Record<string, number> }): number {
  const n = Object.keys(history.devices ?? {}).length;
  return n === 0 ? 1 : n;
}

function sameLocator(a: LocatorCandidate, b: LocatorCandidate): boolean {
  return a.strategy === b.strategy && a.value === b.value && a.name === b.name;
}

function historyKey(
  elementId: string,
  platform: Platform,
  from: LocatorCandidate,
  to: LocatorCandidate,
): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([from.strategy, from.value, from.name, to.strategy, to.value, to.name]))
    .digest('hex')
    .slice(0, 16);
  return `${elementId}::${platform}::${digest}`;
}
