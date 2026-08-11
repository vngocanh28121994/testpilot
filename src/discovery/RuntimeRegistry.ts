/**
 * Locator registry with full provenance tracking.
 *
 * Tracks where each locator came from, its verification status, and the
 * platform/app-version it was confirmed on.  Priority order:
 *
 *   human-approved > runtime-verified > healed-and-verified >
 *   historical > ai-discovered > document-generated
 *
 * Only verified or human-approved locators should be trusted for future runs.
 * Suggested or ai-discovered locators must go through verification first.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type LocatorSource =
  | 'document-generated'
  | 'runtime-observed'
  | 'ai-discovered'
  | 'historical'
  | 'human-approved';

export type LocatorStatus = 'suggested' | 'verified' | 'healed' | 'rejected' | 'expired';

const SOURCE_PRIORITY: Record<LocatorSource, number> = {
  'human-approved': 5,
  'runtime-observed': 4,
  historical: 3,
  'ai-discovered': 2,
  'document-generated': 1,
};

const STATUS_PRIORITY: Record<LocatorStatus, number> = {
  verified: 4,
  healed: 3,
  suggested: 1,
  rejected: 0,
  expired: 0,
};

export interface RuntimeLocator {
  strategy: string;
  value: string;
  source: LocatorSource;
  status: LocatorStatus;
  /** 0..1 */
  confidence: number;
  verifiedAt?: string;
  /** Filters locator to a specific platform when set. */
  platform?: string;
  appVersion?: string;
  osVersion?: string;
  validFrom?: string;
  validUntil?: string;
}

export interface RuntimeElementEntry {
  element: string;
  locators: RuntimeLocator[];
  lastUpdatedAt: string;
}

export interface RuntimeRegistryData {
  version: 1;
  entries: Record<string, RuntimeElementEntry>;
}

export class RuntimeRegistry {
  private constructor(
    private readonly filePath: string,
    private data: RuntimeRegistryData,
  ) {}

  static async load(filePath: string): Promise<RuntimeRegistry> {
    if (!existsSync(filePath)) {
      return new RuntimeRegistry(filePath, { version: 1, entries: {} });
    }
    const raw = JSON.parse(await readFile(filePath, 'utf8')) as RuntimeRegistryData;
    return new RuntimeRegistry(filePath, raw);
  }

  /**
   * Best available locator for the given element, respecting provenance priority.
   * Rejected and expired locators are always excluded.
   * When `platform` is provided, platform-specific locators are preferred over
   * platform-agnostic ones, but a locator with no platform set is a valid fallback.
   */
  bestLocator(elementId: string, platform?: string): RuntimeLocator | undefined {
    const entry = this.data.entries[elementId];
    if (!entry) return undefined;

    const usable = entry.locators.filter(
      (l) => l.status !== 'rejected' && l.status !== 'expired',
    );

    const platformMatch = platform
      ? usable.filter((l) => !l.platform || l.platform === platform)
      : usable;

    return [...platformMatch].sort(byPriority)[0];
  }

  /** All locators for an element, sorted by priority. */
  allLocators(elementId: string): RuntimeLocator[] {
    const entry = this.data.entries[elementId];
    if (!entry) return [];
    return [...entry.locators].sort(byPriority);
  }

  /**
   * Add or update a locator for an element.
   * If a locator with the same strategy+value already exists, it is replaced.
   */
  upsertLocator(elementId: string, locator: RuntimeLocator): void {
    const entry = (this.data.entries[elementId] ??= {
      element: elementId,
      locators: [],
      lastUpdatedAt: new Date().toISOString(),
    });

    const idx = entry.locators.findIndex(
      (l) => l.strategy === locator.strategy && l.value === locator.value,
    );

    if (idx >= 0) {
      entry.locators[idx] = locator;
    } else {
      entry.locators.push(locator);
    }

    entry.lastUpdatedAt = new Date().toISOString();
  }

  /** Mark a locator as runtime-verified. Records a timestamp. */
  markVerified(elementId: string, strategy: string, value: string): void {
    const loc = this.findLocator(elementId, strategy, value);
    if (!loc) return;
    loc.status = 'verified';
    loc.verifiedAt = new Date().toISOString();
    this.touch(elementId);
  }

  /**
   * Mark a locator as healed — it was found during a failure-recovery scenario
   * and passed all anti-regression checks.  Distinct from 'verified' (which
   * means the locator worked in a normal, non-failure run).  Both statuses are
   * accepted by KnownLocatorLookup; 'verified' has higher selection priority.
   */
  markHealed(elementId: string, strategy: string, value: string): void {
    const loc = this.findLocator(elementId, strategy, value);
    if (!loc) return;
    loc.status = 'healed';
    loc.verifiedAt = new Date().toISOString();
    this.touch(elementId);
  }

  /** Mark a locator as rejected — will be excluded from future lookups. */
  markRejected(elementId: string, strategy: string, value: string): void {
    const loc = this.findLocator(elementId, strategy, value);
    if (!loc) return;
    loc.status = 'rejected';
    this.touch(elementId);
  }

  /** Mark a locator as expired (e.g. after an app version upgrade). */
  markExpired(elementId: string, strategy: string, value: string): void {
    const loc = this.findLocator(elementId, strategy, value);
    if (!loc) return;
    loc.status = 'expired';
    loc.validUntil = new Date().toISOString();
    this.touch(elementId);
  }

  async save(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(
      this.filePath,
      JSON.stringify(this.data, null, 2) + '\n',
      'utf8',
    );
  }

  get raw(): RuntimeRegistryData {
    return this.data;
  }

  private findLocator(
    elementId: string,
    strategy: string,
    value: string,
  ): RuntimeLocator | undefined {
    return this.data.entries[elementId]?.locators.find(
      (l) => l.strategy === strategy && l.value === value,
    );
  }

  private touch(elementId: string): void {
    const entry = this.data.entries[elementId];
    if (entry) entry.lastUpdatedAt = new Date().toISOString();
  }
}

function byPriority(a: RuntimeLocator, b: RuntimeLocator): number {
  const src = (SOURCE_PRIORITY[b.source] ?? 0) - (SOURCE_PRIORITY[a.source] ?? 0);
  if (src !== 0) return src;
  const st = (STATUS_PRIORITY[b.status] ?? 0) - (STATUS_PRIORITY[a.status] ?? 0);
  if (st !== 0) return st;
  return b.confidence - a.confidence;
}
