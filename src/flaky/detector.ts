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
  /** Newest first, capped at `window`. 'p' passed, 'f' failed, 'k' flaky (passed on retry). */
  outcomes: Array<'p' | 'f' | 'k'>;
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
  minRuns: 5,
  quarantineAt: 0.15,
  brokenAt: 0.95,
};

export class FlakeDetector {
  private constructor(
    private readonly path: string,
    private db: FlakeDb,
    private readonly policy: FlakePolicy,
  ) {}

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

      const runs = hist.outcomes.length;
      const bad = hist.outcomes.filter((o) => o !== 'p').length;
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

      verdicts.push({
        key,
        scenarioId: r.scenario.id,
        platform: r.platform,
        device: r.device,
        flakeRate,
        runs,
        brokenNotFlaky,
        shouldQuarantine,
      });
    }
    return verdicts;
  }

  isQuarantined(scenarioId: string, platform: Platform, device: string): boolean {
    return Boolean(this.db.scenarios[`${scenarioId}::${platform}::${device}`]?.quarantinedSince);
  }

  async save(): Promise<void> {
    await writeFile(this.path, JSON.stringify(this.db, null, 2) + '\n', 'utf8');
  }
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
