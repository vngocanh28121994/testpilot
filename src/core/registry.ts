import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type {
  ElementDef,
  ElementRegistry,
  LocatorCandidate,
  Platform,
} from './types.js';

/**
 * The element registry is the only file that maps a logical element to real
 * selectors. It is data, not code, so healing can rewrite it and a human can
 * review the diff. Tests never import selectors directly.
 */
export class Registry {
  private constructor(
    private readonly path: string,
    private data: ElementRegistry,
  ) {}

  static async load(path: string): Promise<Registry> {
    if (!existsSync(path)) {
      return new Registry(path, { version: 1, screens: {}, elements: {} });
    }
    const raw = JSON.parse(await readFile(path, 'utf8')) as ElementRegistry;
    for (const el of Object.values(raw.elements)) {
      for (const list of Object.values(el.candidates)) {
        list?.sort((a, b) => b.weight - a.weight);
      }
    }
    return new Registry(path, raw);
  }

  get raw(): ElementRegistry {
    return this.data;
  }

  element(id: string): ElementDef {
    const el = this.data.elements[id];
    if (!el) {
      throw new Error(
        `Unknown element "${id}". Add it to the registry, or re-run \`npm run gen\` ` +
          `so the spec generator can mint it from the source document.`,
      );
    }
    return el;
  }

  /** Ordered candidates to try for one platform. Empty list is a hard error at run time. */
  candidates(id: string, platform: Platform): LocatorCandidate[] {
    const el = this.element(id);
    const list = el.candidates[platform] ?? [];
    if (list.length === 0) {
      throw new Error(`Element "${id}" has no ${platform} locator candidates.`);
    }
    return list;
  }

  upsertElement(el: ElementDef): void {
    const existing = this.data.elements[el.id];
    if (!existing) {
      this.data.elements[el.id] = el;
      return;
    }
    // Merge candidates rather than overwrite: a regenerated spec must never
    // silently drop a locator that healing has proven to work.
    for (const [platform, list] of Object.entries(el.candidates) as Array<
      [Platform, LocatorCandidate[]]
    >) {
      const target = (existing.candidates[platform] ??= []);
      for (const cand of list) {
        if (!target.some((c) => c.strategy === cand.strategy && c.value === cand.value)) {
          target.push(cand);
        }
      }
      target.sort((a, b) => b.weight - a.weight);
    }
    existing.label = el.label || existing.label;
  }

  /**
   * Record which candidate actually won. This is the raw material for both the
   * flake report and the "your testId changed, here is the PR" suggestion.
   * It only bumps weights in memory — persistence is an explicit choice by the caller.
   */
  recordResolution(id: string, platform: Platform, winner: LocatorCandidate): void {
    const el = this.element(id);
    const health = (el.health ??= { resolutions: 0, heals: 0, winners: {} });
    health.resolutions += 1;
    const key = `${winner.strategy}:${winner.value}`;
    health.winners[key] = (health.winners[key] ?? 0) + 1;

    const list = el.candidates[platform] ?? [];
    if (list[0] && (list[0].strategy !== winner.strategy || list[0].value !== winner.value)) {
      health.heals += 1;
      health.lastHealedAt = new Date().toISOString();
    }
  }

  async save(): Promise<void> {
    await writeFile(this.path, JSON.stringify(this.data, null, 2) + '\n', 'utf8');
  }
}
