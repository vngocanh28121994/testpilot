import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type {
  ElementDef,
  ElementHealth,
  ElementRegistry,
  LocatorCandidate,
  Platform,
  ScreenDef,
} from './types.js';
import { assessLocatorQuality, asUnapprovedFallback } from './locatorQuality.js';

/**
 * The element registry is the only file that maps a logical element to real
 * selectors. It is data, not code, so healing can rewrite it and a human can
 * review the diff. Tests never import selectors directly.
 */
/**
 * An alias may not name a control that already has a name.
 *
 * Duplicate *labels* are tolerated and disambiguated by screen — historical
 * generation produced plenty of them. An alias is different: it is a deliberate
 * statement that two names mean one control, so a collision is an authoring
 * mistake that would bind steps to the wrong element without ever failing.
 * Loud on load beats silent at runtime.
 */
function assertAliasesUnique(raw: ElementRegistry): void {
  const takenLabels = new Map<string, string>();
  for (const el of Object.values(raw.elements)) {
    takenLabels.set(el.label.toLowerCase(), el.id);
  }
  const takenAliases = new Map<string, string>();
  for (const el of Object.values(raw.elements)) {
    for (const alias of el.aliases ?? []) {
      const key = alias.toLowerCase();
      const labelOwner = takenLabels.get(key);
      if (labelOwner && labelOwner !== el.id) {
        throw new Error(
          `Alias "${alias}" của element "${el.id}" trùng với label của "${labelOwner}". `
          + 'Hai control khác nhau không được dùng chung tên — đổi alias hoặc gộp hai element.',
        );
      }
      const aliasOwner = takenAliases.get(key);
      if (aliasOwner && aliasOwner !== el.id) {
        throw new Error(
          `Alias "${alias}" được khai báo ở cả "${aliasOwner}" và "${el.id}". `
          + 'Mỗi alias chỉ được thuộc về một element.',
        );
      }
      takenAliases.set(key, el.id);
    }
  }
}

export class Registry {
  /**
   * The registry exactly as it was read from disk.
   *
   * Kept so a run can report what *it* learned rather than what it now holds.
   * The distinction only matters when several runs share one file: each starts
   * from the same numbers, so folding their end states together would count the
   * shared starting point once per device. See `changesSinceLoad()`.
   */
  private readonly baseline: ElementRegistry;

  private constructor(
    private readonly path: string,
    private data: ElementRegistry,
  ) {
    this.baseline = structuredClone(data);
  }

  static async load(path: string): Promise<Registry> {
    if (!existsSync(path)) {
      return new Registry(path, { version: 1, screens: {}, elements: {} });
    }
    const raw = JSON.parse(await readFile(path, 'utf8')) as ElementRegistry;
    for (const el of Object.values(raw.elements)) {
      for (const [platform, list] of Object.entries(el.candidates) as Array<
        [Platform, LocatorCandidate[] | undefined]
      >) {
        if (!list) continue;
        // Historical versions persisted every successful runtime locator at up
        // to 0.98. Keep maintainable candidates as low-priority fallbacks, but
        // remove non-approved locator dumps that fail the quality gate.
        el.candidates[platform] = list
          .filter((candidate) =>
            candidate.origin !== 'healed' || candidate.approved === true || assessLocatorQuality(candidate).persistable,
          )
          .map((candidate) =>
            candidate.origin === 'healed' && candidate.approved !== true
              ? asUnapprovedFallback(candidate)
              : candidate,
          )
          .sort((a, b) => b.weight - a.weight);
      }
    }
    assertAliasesUnique(raw);
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

  screen(id: string): ScreenDef | undefined {
    return this.data.screens[id];
  }

  /** Ordered candidates to try for one platform. Empty list is a hard error at run time. */
  candidates(id: string, platform: Platform): LocatorCandidate[] {
    const el = this.element(id);
    const list = el.candidates[platform] ?? [];
    if (list.length === 0) {
      // A selector-less element was created from natural-language Gherkin.
      // Resolver will ask Playwright/Appium discovery to locate it at runtime.
      const hasAnyCandidate = Object.values(el.candidates).some((items) => (items?.length ?? 0) > 0);
      if (!hasAnyCandidate) return [];
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
    // Aliases accumulate for the same reason candidates do: a regeneration that
    // does not know about a name a human taught the element must not delete it.
    if (el.aliases?.length) {
      const merged = new Set([...(existing.aliases ?? []), ...el.aliases]);
      merged.delete(existing.label);
      existing.aliases = [...merged];
    }
    // Provenance only ever strengthens. An element first minted as a byproduct
    // and later given locators by an import is no longer a byproduct, but the
    // reverse must never happen: a regeneration touching a deliberately
    // supplied element must not downgrade it into something a cleanup rule
    // would feel free to delete.
    if (rank(el.provenance) > rank(existing.provenance)) existing.provenance = el.provenance;
    if (el.controlType) existing.controlType = el.controlType;
    if (el.controlEvidence?.length) existing.controlEvidence = [...new Set(el.controlEvidence)];
  }

  /** Persist a runtime-confirmed control capability for future runs and POMs. */
  recordControlType(id: string, controlType: NonNullable<ElementDef['controlType']>, evidence: string[]): void {
    const element = this.element(id);
    element.controlType = controlType;
    element.controlEvidence = [...new Set(evidence)].slice(0, 8);
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
    const recordedValue = winner.runtimeTemplateValue ?? winner.value;
    const key = `${winner.strategy}:${recordedValue}`;
    health.winners[key] = (health.winners[key] ?? 0) + 1;

    const list = el.candidates[platform] ?? [];
    if (list[0] && (
      list[0].strategy !== winner.strategy ||
      list[0].value !== recordedValue
    )) {
      health.heals += 1;
      health.lastHealedAt = new Date().toISOString();
    }
  }

  /** Promote a human-approved healed locator to primary for one platform. */
  promoteCandidate(id: string, platform: Platform, approved: LocatorCandidate): void {
    const quality = assessLocatorQuality(approved);
    if (!quality.promotable) {
      throw new Error(
        `Locator chưa đạt quality gate để làm primary (${quality.score}/100): ` +
        quality.reasons.join(', '),
      );
    }
    const element = this.element(id);
    const list = (element.candidates[platform] ??= []);
    let target = list.find(
      (candidate) => candidate.strategy === approved.strategy
        && candidate.value === approved.value
        && candidate.name === approved.name,
    );
    if (!target) {
      const { runtimeScope: _runtimeScope, ...persisted } = approved;
      target = { ...persisted, origin: 'healed' };
      list.push(target);
    }
    for (const candidate of list) {
      if (candidate !== target && candidate.weight >= 1) candidate.weight = 0.99;
    }
    target.weight = 1;
    target.origin = 'healed';
    target.approved = true;
    list.sort((a, b) => b.weight - a.weight);
  }

  /**
   * What this run learned, as something `mergeFrom` can apply to a shared file.
   *
   * Candidates are the ones absent at load; health is the difference in the
   * counters, not their current value. Elements that learned nothing are left
   * out entirely, so an untouched suite produces an empty delta.
   */
  changesSinceLoad(): ElementRegistry {
    const delta: ElementRegistry = { version: this.data.version, screens: {}, elements: {} };

    for (const element of Object.values(this.data.elements)) {
      const before = this.baseline.elements[element.id];
      const candidates: ElementDef['candidates'] = {};
      let learned = false;

      if (
        element.controlType !== before?.controlType ||
        JSON.stringify(element.controlEvidence ?? []) !== JSON.stringify(before?.controlEvidence ?? [])
      ) learned = true;

      for (const [platform, list] of Object.entries(element.candidates) as Array<
        [Platform, LocatorCandidate[] | undefined]
      >) {
        const known = before?.candidates[platform] ?? [];
        const fresh = (list ?? []).filter(
          (c) => !known.some((k) => k.strategy === c.strategy && k.value === c.value),
        );
        if (fresh.length === 0) continue;
        candidates[platform] = fresh;
        learned = true;
      }

      const now = element.health;
      const then = before?.health;
      let health: ElementHealth | undefined;
      if (now) {
        const winners: Record<string, number> = {};
        for (const [key, count] of Object.entries(now.winners ?? {})) {
          const delta = count - (then?.winners?.[key] ?? 0);
          if (delta > 0) winners[key] = delta;
        }
        const resolutions = now.resolutions - (then?.resolutions ?? 0);
        const heals = now.heals - (then?.heals ?? 0);
        if (resolutions !== 0 || heals !== 0 || Object.keys(winners).length > 0) {
          health = {
            resolutions,
            heals,
            winners,
            ...(now.lastHealedAt && now.lastHealedAt !== then?.lastHealedAt
              ? { lastHealedAt: now.lastHealedAt }
              : {}),
          };
          learned = true;
        }
      }

      if (!learned) continue;
      delta.elements[element.id] = {
        ...element,
        candidates,
        ...(health ? { health } : {}),
      };
      if (!health) delete delta.elements[element.id]!.health;
    }

    return delta;
  }

  /**
   * Folds another registry's learnings into this one.
   *
   * Written for parallel runs, where several processes each learn against their
   * own copy: `save()` rewrites the whole file, so three of them racing means
   * two lose everything they found. Merging instead of overwriting is the only
   * arrangement under which a second device can teach the suite anything.
   *
   * Candidates go through `upsertElement`, which already dedupes and keeps the
   * union. Health counters are summed rather than replaced — they are counts of
   * things that really happened on each device, and the point of running three
   * is that the totals add up.
   */
  mergeFrom(other: ElementRegistry): void {
    for (const element of Object.values(other.elements)) {
      const incomingHealth = element.health;
      // upsertElement merges candidates but treats health as part of a spec, so
      // hand it a copy without health and fold the counters in deliberately.
      const { health: _health, ...spec } = element;
      this.upsertElement(spec as ElementDef);
      if (!incomingHealth) continue;

      const target = this.data.elements[element.id];
      if (!target) continue;
      const health = (target.health ??= { resolutions: 0, heals: 0, winners: {} });
      if (health === incomingHealth) continue;
      health.resolutions += incomingHealth.resolutions;
      health.heals += incomingHealth.heals;
      for (const [key, count] of Object.entries(incomingHealth.winners ?? {})) {
        health.winners[key] = (health.winners[key] ?? 0) + count;
      }
      // Latest wins: "when did this last heal" is a point in time, not a total.
      if (
        incomingHealth.lastHealedAt &&
        (!health.lastHealedAt || incomingHealth.lastHealedAt > health.lastHealedAt)
      ) {
        health.lastHealedAt = incomingHealth.lastHealedAt;
      }
    }
  }

  async save(): Promise<void> {
    await writeFile(this.path, JSON.stringify(this.data, null, 2) + '\n', 'utf8');
  }
}

/**
 * How much deliberate intent a provenance represents, ascending.
 *
 * Unknown sits above `byproduct` on purpose: an element from before this field
 * existed might be anything, and the safe reading of "anything" is "someone
 * meant it".
 */
function rank(provenance: ElementDef['provenance']): number {
  switch (provenance) {
    case 'authored': return 5;
    case 'imported': return 4;
    case 'discovered': return 3;
    case 'generated': return 2;
    case undefined: return 1;
    case 'byproduct': return 0;
    default: return 1;
  }
}
