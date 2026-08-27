import type { ElementDef, ElementRegistry, ScreenDef } from '../core/types.js';
import { normalizeHumanText } from '../core/text.js';
import type { GeneratedModel } from './generate.js';

export interface ReconciledModel extends GeneratedModel {
  /** Generated id -> canonical registry id. */
  screenAliases: Record<string, string>;
  /** Generated id -> canonical registry id. */
  elementAliases: Record<string, string>;
  /** Existing, proven elements supplied to the feature-writing pass. */
  featureElements: ElementDef[];
}

/**
 * Reuse the logical model TestPilot has already learned before minting ids.
 *
 * LLMs reasonably produce `stockPriceBoard.addStockButton` for a document that
 * calls the screen "Bảng giá cổ phiếu", while an older run may already own the
 * proven id `priceBoard.addStockButton`. Keeping both is much worse than a
 * cosmetic duplicate: the new id has no locator, so the next run ignores the
 * selector that has already worked dozens of times.
 *
 * Reconciliation is deterministic. Exact screen titles are matched first and
 * the more mature screen wins. Elements then prefer rewritten exact ids, and
 * finally a conservative label/control/screen score. Ambiguous matches are
 * left as new elements for runtime discovery.
 */
export function reconcileGeneratedModel(
  generated: GeneratedModel,
  registry: ElementRegistry,
): ReconciledModel {
  const screenAliases: Record<string, string> = {};
  const elementAliases: Record<string, string> = {};
  const existingScreens = Object.values(registry.screens);
  const generatedScreens = new Map(generated.screens.map((screen) => [screen.id, screen]));

  const labelsByGeneratedScreen = labelsByScreen(generated.elements);
  const labelsByExistingScreen = labelsByScreen(Object.values(registry.elements));

  for (const screen of generated.screens) {
    const sameTitle = existingScreens
      .filter((candidate) => clean(candidate.title) === clean(screen.title))
      .sort((a, b) => screenMaturity(registry, b.id) - screenMaturity(registry, a.id));
    const exact = registry.screens[screen.id];
    const winner = sameTitle[0]
      ?? (exact && screenMaturity(registry, exact.id) > 0 ? exact : undefined);
    if (winner) screenAliases[screen.id] = winner.id;
  }

  // A second pass for screens no title matched, decided on what they contain.
  //
  // One run named the add-stock modal "Thêm mã cổ phiếu", the next "Thêm mã cổ
  // phiếu - Tìm kiếm", and an exact-title rule saw two screens. That mints a
  // second copy of every element on it, and once one label lives on two screens
  // the binder can no longer resolve it from the current screen at all — the
  // whole feature stops compiling over a renamed heading. Titles are the
  // model's prose and vary run to run; the elements a screen holds are what it
  // actually is. Deliberately not similarity of titles: "Bảng giá cổ phiếu" and
  // "Bảng giá cổ phiếu phái sinh" read as near-identical and are not the same
  // screen, while their element sets are quite different.
  const claimed = new Set(Object.values(screenAliases));
  for (const screen of generated.screens) {
    if (screenAliases[screen.id]) continue;
    const mine = labelsByGeneratedScreen.get(screen.id);
    if (!mine || mine.size === 0) continue;
    const ranked = existingScreens
      .filter((candidate) => !claimed.has(candidate.id) && screenMaturity(registry, candidate.id) > 0)
      .map((candidate) => ({
        candidate,
        overlap: overlapRatio(mine, labelsByExistingScreen.get(candidate.id)),
      }))
      .filter((entry) => entry.overlap.shared >= 2 && entry.overlap.ratio >= 0.6)
      .sort((a, b) => b.overlap.ratio - a.overlap.ratio);
    // A tie means the evidence does not single out one screen; keeping them
    // separate is recoverable, merging into the wrong one is not.
    const best = ranked[0];
    if (!best || (ranked[1] && ranked[1].overlap.ratio === best.overlap.ratio)) continue;
    screenAliases[screen.id] = best.candidate.id;
    claimed.add(best.candidate.id);
  }

  for (const screen of generated.screens) {
    screenAliases[screen.id] ??= screen.id;
  }

  const reconciledElements: ElementDef[] = [];
  const used = new Set<string>();
  const logicalElements = new Map<string, ElementDef>();

  for (const element of generated.elements) {
    const canonicalScreen = screenAliases[element.screen] ?? element.screen;
    const logicalKey = `${canonicalScreen}::${clean(element.label)}::${controlKind(element.label, element.controlType)}`;
    const alreadyReconciled = logicalElements.get(logicalKey);
    if (alreadyReconciled) {
      elementAliases[element.id] = alreadyReconciled.id;
      continue;
    }
    const suffix = element.id.includes('.') ? element.id.slice(element.id.indexOf('.') + 1) : element.id;
    const rewrittenId = `${canonicalScreen}.${suffix}`;
    // An exact logical id/label is valuable even before runtime discovery has
    // produced a selector. Ignoring selector-less entries caused every later
    // generation to mint another id for the same business control.
    const exact = registry.elements[rewrittenId] ?? registry.elements[element.id];
    const sameLogical = bestLogicalElement(element, canonicalScreen, registry);
    const semantic = exact ?? sameLogical ?? bestExistingElement(
      element,
      registry.screens[canonicalScreen] ?? generatedScreens.get(element.screen),
      registry,
    );
    const canonical = semantic
      ? structuredClone(semantic)
      : { ...structuredClone(element), id: rewrittenId, screen: canonicalScreen };

    elementAliases[element.id] = canonical.id;
    logicalElements.set(logicalKey, canonical);
    if (!used.has(canonical.id)) {
      used.add(canonical.id);
      reconciledElements.push(canonical);
    }
  }

  const canonicalScreenIds = new Set(Object.values(screenAliases));
  const featureElements = [...reconciledElements];
  for (const element of Object.values(registry.elements)) {
    if (!canonicalScreenIds.has(element.screen) || !provenElement(element) || used.has(element.id)) continue;
    used.add(element.id);
    featureElements.push(structuredClone(element));
  }

  const screens: ScreenDef[] = [];
  const seenScreens = new Set<string>();
  for (const screen of generated.screens) {
    const id = screenAliases[screen.id] ?? screen.id;
    if (seenScreens.has(id)) continue;
    seenScreens.add(id);
    screens.push(structuredClone(registry.screens[id] ?? { ...screen, id }));
  }

  return {
    screens,
    elements: reconciledElements,
    screenAliases,
    elementAliases,
    featureElements,
  };
}

/** Element labels each screen holds, normalized for comparison. */
function labelsByScreen(elements: ElementDef[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const element of elements) {
    const set = out.get(element.screen) ?? new Set<string>();
    set.add(clean(element.label));
    out.set(element.screen, set);
  }
  return out;
}

/**
 * How much of the smaller screen the two share.
 *
 * Measured against the smaller set on purpose: a modal described in three
 * elements by one run and in eight by the next is still the same modal, and
 * dividing by the union would score that honest growth as a mismatch.
 */
function overlapRatio(
  mine: Set<string>,
  theirs: Set<string> | undefined,
): { shared: number; ratio: number } {
  if (!theirs || theirs.size === 0) return { shared: 0, ratio: 0 };
  let shared = 0;
  for (const label of mine) if (theirs.has(label)) shared += 1;
  return { shared, ratio: shared / Math.min(mine.size, theirs.size) };
}

function bestLogicalElement(
  generated: ElementDef,
  canonicalScreen: string,
  registry: ElementRegistry,
): ElementDef | undefined {
  const label = clean(generated.label);
  const kind = controlKind(generated.label, generated.controlType);
  return Object.values(registry.elements)
    .filter((candidate) =>
      candidate.screen === canonicalScreen
      && clean(candidate.label) === label
      && controlKind(candidate.label, candidate.controlType) === kind,
    )
    .sort((a, b) => elementMaturity(b) - elementMaturity(a) || a.id.localeCompare(b.id))[0];
}

function elementMaturity(element: ElementDef): number {
  const candidates = Object.values(element.candidates)
    .reduce((count, list) => count + (list?.length ?? 0), 0);
  return candidates * 10 + (element.health?.resolutions ?? 0);
}

function bestExistingElement(
  generated: ElementDef,
  sourceScreen: ScreenDef | undefined,
  registry: ElementRegistry,
): ElementDef | undefined {
  const ranked = Object.values(registry.elements)
    .filter((candidate) => provenElement(candidate))
    .map((candidate) => ({
      candidate,
      score: elementScore(generated, candidate, sourceScreen, registry.screens[candidate.screen]),
    }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const second = ranked[1];
  if (!best || best.score < 0.64) return undefined;
  if (second && best.score - second.score < 0.04) return undefined;
  return best.candidate;
}

function elementScore(
  generated: ElementDef,
  existing: ElementDef,
  generatedScreen: ScreenDef | undefined,
  existingScreen: ScreenDef | undefined,
): number {
  const generatedKind = controlKind(generated.label, generated.controlType);
  const existingKind = controlKind(existing.label, existing.controlType);
  if (!compatibleKinds(generatedKind, existingKind)) return 0;

  const label = phraseSimilarity(generated.label, existing.label);
  if (label < 0.42) return 0;
  const screen = generated.screen === existing.screen
    ? 1
    : phraseSimilarity(generatedScreen?.title ?? generated.screen, existingScreen?.title ?? existing.screen);
  const kind = generatedKind === existingKind ? 1 : 0.72;
  return label * 0.68 + kind * 0.2 + screen * 0.12;
}

function screenMaturity(registry: ElementRegistry, screenId: string): number {
  return Object.values(registry.elements)
    .filter((element) => element.screen === screenId)
    .reduce((score, element) => score + elementMaturity(element), 0);
}

function provenElement(element: ElementDef | undefined): ElementDef | undefined {
  if (!element) return undefined;
  return Object.values(element.candidates).some((list) => (list?.length ?? 0) > 0)
    ? element
    : undefined;
}

function controlKind(label: string, declared?: ElementDef['controlType']): string {
  if (declared && declared !== 'unknown') return declared;
  const value = clean(label);
  if (/\b(kết quả|ket qua)\b/.test(value)) return 'result';
  if (/\b(danh sách|danh sach)\b/.test(value)) return 'list';
  if (/\b(ô|o)\b|\bnhập\b|\bnhap\b|input/.test(value)) return 'input';
  if (/\b(dòng|dong|row)\b/.test(value)) return 'row';
  if (/\b(nút|nut|button|icon|menu|tùy chọn|tuy chon)\b|\.\.\./.test(value)) return 'button';
  return 'text';
}

function compatibleKinds(a: string, b: string): boolean {
  if (a === b) return true;
  return (a === 'result' && b === 'list') || (a === 'list' && b === 'result');
}

function phraseSimilarity(a: string, b: string): number {
  const left = words(a);
  const right = words(b);
  if (left.length === 0 || right.length === 0) return 0;
  const aa = left.join(' ');
  const bb = right.join(' ');
  if (aa === bb) return 1;
  const shorter = left.length <= right.length ? aa : bb;
  const longer = left.length > right.length ? aa : bb;
  if (shorter.split(' ').length >= 2 && longer.includes(shorter)) return 0.94;

  const lset = new Set(left);
  const rset = new Set(right);
  const intersection = [...lset].filter((word) => rset.has(word)).length;
  const overlap = intersection / Math.min(lset.size, rset.size);
  const union = new Set([...lset, ...rset]).size;
  const jaccard = intersection / union;
  return overlap * 0.7 + jaccard * 0.3;
}

function words(value: string): string[] {
  return clean(value).split(' ').filter(Boolean);
}

function clean(value: string): string {
  return normalizeHumanText(value)
    .replace(/\{\{[^}]+\}\}/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
