/**
 * Catch a number the scenario asserts but never put there.
 *
 * A generated scenario claimed `"Được chuyển" shows "8,829"`. The figure came
 * from the source document, which had quoted a balance on the day it was
 * written; the scenario then transferred 1,000 and the balance moved away from
 * it for good — 7,329, 5,329, 1,329 — failing every run while the application
 * behaved perfectly. Nobody had asserted a rule; they had asserted a snapshot.
 *
 * The distinction that matters is who produced the number. An amount the
 * scenario typed in is fair to assert: entering 1,000 and checking the
 * confirmation shows 1,000 is a real claim about the product. An amount that
 * appears from nowhere is account state, and account state is different on
 * every run and every environment.
 *
 * The generation prompt already asks for `remember` + delta instead. This is
 * the check that runs when the model does it anyway — guidance to a model has
 * been an unreliable guarantee all the way through this codebase.
 */
import { parseDisplayedNumber } from '../core/number.js';
import type { FeatureSpec, ScenarioSpec } from '../core/types.js';

/** A number, possibly with thousands separators — not a code or a date. */
const LOOKS_NUMERIC = /^-?\d[\d.,]*$/u;

export function absoluteValueWarnings(feature: FeatureSpec): string[] {
  return feature.scenarios.flatMap(scenarioWarnings);
}

function scenarioWarnings(scenario: ScenarioSpec): string[] {
  const typed = new Set<number>();
  for (const step of scenario.steps) {
    if (step.intent.kind !== 'input') continue;
    const value = numberOf(step.intent.text);
    if (value !== undefined) typed.add(value);
  }

  const warnings: string[] = [];
  for (const step of scenario.steps) {
    if (step.intent.kind !== 'assertText') continue;
    if (step.intent.mode === 'notContains') continue;
    const value = numberOf(step.intent.text);
    // Not a number at all, or one this scenario put on the screen itself.
    if (value === undefined || typed.has(value)) continue;
    warnings.push(
      `Dòng ${step.line}: "${step.intent.text}" là một con số kịch bản không tự nhập vào, `
      + 'nhiều khả năng là số dư/tổng thay đổi theo từng lần chạy. '
      + 'Nên dùng I remember "..." as "..." rồi khẳng định mức thay đổi, '
      + `thay vì ghi cứng — xem scenario "${scenario.name}".`,
    );
  }
  return warnings;
}

/**
 * The number a step wrote, or nothing.
 *
 * Deliberately strict: `"VIC"`, `"MEL-HNX"` and `"26/08/2026"` are not amounts,
 * and treating a ticker or a date as a balance would bury the real warnings.
 */
function numberOf(text: string): number | undefined {
  const trimmed = text.trim();
  if (!LOOKS_NUMERIC.test(trimmed)) return undefined;
  try {
    return parseDisplayedNumber(trimmed);
  } catch {
    return undefined;
  }
}
