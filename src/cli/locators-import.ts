/**
 * Import a locator library generated from the application's own source.
 *
 * The registry's weakest link has always been where a locator comes from. A
 * model reading a requirements document guesses: one such guess this week was
 * `placeholder="Nhập mã hoặc tên công ty"`, a plausible string that appears
 * nowhere in the app, and it failed five scenarios across four runs before
 * anyone looked at why. Reading the app's own templates removes that class of
 * invention — the text is the text.
 *
 * It does not remove every risk, so this importer is deliberately suspicious:
 *
 *   - Source templates are not the rendered DOM. Angular injects classes at
 *     runtime that no template contains, and `*ngIf` removes nodes that every
 *     template does. A selector can be faithful to the code and absent from the
 *     page.
 *   - A model reading source can still invent. Provenance is recorded as `llm`
 *     unless a person vouches for the file with --origin authored.
 *   - Nothing imported is trusted until a run proves it. Every candidate lands
 *     unapproved; `health.resolutions` is what separates a locator that works
 *     from one that merely looks right.
 *
 *   npm run locators:import -- --file locators.json [--dry-run] [--platform web]
 */

import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { loadConfig } from '../config.js';
import { Registry } from '../core/registry.js';
import { assessLocatorQuality } from '../core/locatorQuality.js';
import { normalizeHumanText } from '../core/text.js';
import type { ElementDef, LocatorCandidate, Platform } from '../core/types.js';

/** Below this the selector is structural enough that a refactor will break it. */
const QUALITY_FLOOR = 55;

const Strategy = z.enum([
  'testId', 'role', 'label', 'placeholder', 'relative', 'css', 'xpath', 'predicate',
]);

const LibrarySchema = z.object({
  version: z.literal(1).optional(),
  screens: z.array(z.object({
    id: z.string().min(1),
    title: z.string().min(1),
  })).default([]),
  elements: z.array(z.object({
    id: z.string().min(1),
    /** What a tester calls it. This is the half a selector list cannot supply. */
    label: z.string().min(1),
    screen: z.string().min(1),
    platform: z.enum(['web', 'android', 'ios']).default('web'),
    locators: z.array(z.object({
      strategy: Strategy,
      value: z.string().min(1),
      /** Only meaningful for `role`. */
      name: z.string().optional(),
      weight: z.number().min(0).max(1).optional(),
    })).min(1),
  })).min(1),
});

interface Args {
  file: string;
  dryRun: boolean;
  origin: 'llm' | 'authored';
}

export type LocatorLibrary = z.infer<typeof LibrarySchema>;

export interface ImportReport {
  accepted: number;
  rejected: number;
  /** One line per locator turned away, with the score that turned it away. */
  weak: string[];
}

/**
 * Fold a parsed library into a registry. Pure with respect to the filesystem so
 * the quality gate can be tested without a config or a saved registry.
 */
export function applyLocatorLibrary(
  registry: Registry,
  library: LocatorLibrary,
  origin: 'llm' | 'authored',
): ImportReport {
  let accepted = 0;
  let rejected = 0;
  const weak: string[] = [];

  for (const screen of library.screens) {
    if (registry.screen(screen.id)) continue;
    registry.raw.screens[screen.id] = { id: screen.id, title: screen.title };
  }

  for (const element of library.elements) {
    const platform = element.platform as Platform;
    const targetId = existingIdForLabel(registry, element.label, element.screen);
    if (!targetId) {
      // A label that is currently unique resolves without ever consulting the
      // screen. Introduce a second element carrying it — even on a different
      // screen — and every step that used it starts going through the screen
      // filter instead, which fails whenever the step's current screen is
      // neither of the two. Importing "Phái sinh" for the price board broke a
      // derivatives feature that had worked for weeks, on its second line.
      const elsewhere = labelUsedElsewhere(registry, element.label, element.screen);
      if (elsewhere) {
        rejected += element.locators.length;
        weak.push(`${element.id}: nhãn "${element.label}" đã tồn tại ở ${elsewhere} — `
          + 'thêm nữa sẽ làm mơ hồ và phá các kịch bản đang chạy');
        continue;
      }
    }
    const resolvedId = targetId ?? element.id;
    const keep: LocatorCandidate[] = [];
    for (const locator of element.locators) {
      const candidate: LocatorCandidate = {
        strategy: locator.strategy,
        value: locator.value,
        ...(locator.name ? { name: locator.name } : {}),
        weight: locator.weight ?? 0.8,
        origin,
        // Proven by a run or not at all. Importing is a proposal, not a fact.
        approved: false,
      };
      const vague = nonIdentifying(candidate);
      if (vague) {
        rejected += 1;
        weak.push(`${element.id}: ${locator.strategy}="${locator.value.slice(0, 46)}" (${vague})`);
        continue;
      }
      const quality = assessLocatorQuality(candidate);
      if (quality.score < QUALITY_FLOOR) {
        rejected += 1;
        weak.push(`${element.id}: ${locator.strategy}="${locator.value.slice(0, 46)}" `
          + `(${quality.score} — ${quality.reasons.join('; ')})`);
        continue;
      }
      keep.push(candidate);
      accepted += 1;
    }
    if (keep.length === 0) continue;

    // Land on the element the registry already has for this label, not on a new
    // id beside it. A library naturally names things its own way —
    // `priceBoard.addTicker` for what the registry calls
    // `priceBoard.addStockButton` — and importing under the new id creates two
    // elements with one label. That is the exact shape that stopped a whole
    // feature binding this week: once a label lives on two ids, the step can
    // resolve to the one with no locator.
    const existing = registry.raw.elements[resolvedId];
    registry.upsertElement({
      id: resolvedId,
      label: element.label,
      screen: element.screen,
      // Deliberately supplied against the real application. It may sit unused
      // until somebody writes the scenario for it, and that is not a defect.
      provenance: 'imported',
      // upsertElement merges candidate lists and never drops what healing has
      // already proven, so an import cannot overwrite a working locator.
      candidates: { ...(existing?.candidates ?? {}), [platform]: keep },
    } as ElementDef);
  }

  return { accepted, rejected, weak };
}

export async function importLocators(args: Args): Promise<number> {
  const cfg = await loadConfig();
  const registry = await Registry.load(cfg.paths.registry);
  const parsed = LibrarySchema.safeParse(JSON.parse(await readFile(args.file, 'utf8')));
  if (!parsed.success) {
    console.error('[locators] file không đúng định dạng:');
    for (const issue of parsed.error.issues.slice(0, 10)) {
      console.error(`  · ${issue.path.join('.')}: ${issue.message}`);
    }
    return 1;
  }
  const library = parsed.data;
  const { accepted, rejected, weak } = applyLocatorLibrary(registry, library, args.origin);

  console.log(`[locators] ${library.elements.length} element, ${accepted} locator nhận, ${rejected} loại.`);
  if (weak.length > 0) {
    console.log('[locators] loại vì quá mong manh (sẽ vỡ khi refactor):');
    for (const line of weak.slice(0, 12)) console.log(`  · ${line}`);
    if (weak.length > 12) console.log(`  · … và ${weak.length - 12} cái nữa`);
  }
  console.log(
    '[locators] tất cả đều chưa được duyệt. Chạy một lượt thật, rồi tin cái nào '
    + 'health.resolutions > 0.',
  );

  if (args.dryRun) {
    console.log('[locators] --dry-run: không ghi gì vào registry.');
    return 0;
  }
  await registry.save();
  console.log(`[locators] registry → ${cfg.paths.registry}`);
  return 0;
}

/**
 * The id the registry already uses for this label on this screen.
 *
 * Compared with tone marks and case folded away, because "Xóa" and "Xoá" are
 * one label written two correct ways and must not become two elements.
 */
function existingIdForLabel(
  registry: Registry,
  label: string,
  screen: string,
): string | undefined {
  const wanted = normalizeHumanText(label);
  for (const element of Object.values(registry.raw.elements)) {
    if (element.screen !== screen) continue;
    if (normalizeHumanText(element.label) === wanted) return element.id;
  }
  return undefined;
}

/** Where else this label already lives, or undefined when it is unique. */
function labelUsedElsewhere(
  registry: Registry,
  label: string,
  screen: string,
): string | undefined {
  const wanted = normalizeHumanText(label);
  const hit = Object.values(registry.raw.elements)
    .find((element) => element.screen !== screen && normalizeHumanText(element.label) === wanted);
  return hit ? `${hit.id} (màn hình ${hit.screen})` : undefined;
}

/**
 * Why a locator cannot identify anything, or undefined when it can.
 *
 * The shared quality score rates `role` without a name at 74 — respectable,
 * because on a well-built page a role narrows things a lot. On a real screen it
 * does not: a price board has dozens of buttons, the resolver takes the first
 * match, and the step clicks whichever one the DOM happens to list first. That
 * is worse than a fragile selector, which at least fails loudly. Thirteen of
 * the guesses already in this registry are exactly this shape, so the importer
 * refuses to add more.
 */
function nonIdentifying(candidate: LocatorCandidate): string | undefined {
  if (candidate.strategy === 'role' && !candidate.name?.trim()) {
    return 'role không kèm tên — khớp mọi phần tử cùng loại trên màn hình';
  }
  if (
    (candidate.strategy === 'css' || candidate.strategy === 'xpath')
    && /^[a-z][\w-]*$/i.test(candidate.value.trim())
  ) {
    return 'chỉ là tên thẻ — không phân biệt được phần tử nào';
  }
  return undefined;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const file = get('--file');
  if (!file) throw new Error('Thiếu --file <locators.json>');
  const origin = get('--origin') === 'authored' ? 'authored' : 'llm';
  return { file, dryRun: argv.includes('--dry-run'), origin };
}

const invokedDirectly = process.argv[1]?.endsWith('locators-import.ts')
  || process.argv[1]?.endsWith('locators-import.js');
if (invokedDirectly) {
  importLocators(parseArgs(process.argv.slice(2)))
    .then((code) => process.exit(code))
    .catch((err: Error) => {
      console.error(`[locators] ${err.message}`);
      process.exit(1);
    });
}
