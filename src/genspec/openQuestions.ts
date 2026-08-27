/**
 * Questions the generator raised instead of guessing.
 *
 * A document that does not state a limit, a rule or a value leaves the model
 * two options: invent one, or say so. Inventing produces a scenario that looks
 * exactly like a correct one and then passes or fails for a reason nobody can
 * check — the hardest kind of wrong to notice, and the kind this codebase has
 * spent days digging out of.
 *
 * So the prompt asks for a `# HỎI:` line above the scenario concerned. The
 * comment stays in the .feature file, where it sits beside the thing it is
 * about and survives every later read; this module lifts the same lines out so
 * a reviewer sees them collected rather than having to scroll for them.
 */
import type { OpenQuestion } from '../core/types.js';

const ASK = /^\s*#\s*HỎI\s*:\s*(.+?)\s*$/iu;

export function extractGeneratedQuestions(content: string): OpenQuestion[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const questions: OpenQuestion[] = [];
  for (let index = 0; index < lines.length; index++) {
    const match = ASK.exec(lines[index] ?? '');
    if (!match?.[1]) continue;
    questions.push({
      source: 'generation',
      prompt: match[1],
      line: index + 1,
      // The scenario the question sits above, when there is one. Tags and
      // further comments may separate them, so the search skips those rather
      // than giving up at the first line that is not a Scenario.
      ...(scenarioBelow(lines, index) ? { scenario: scenarioBelow(lines, index)! } : {}),
    });
  }
  return questions;
}

function scenarioBelow(lines: string[], from: number): string | undefined {
  for (let index = from + 1; index < lines.length; index++) {
    const line = (lines[index] ?? '').trim();
    if (!line || line.startsWith('#') || line.startsWith('@')) continue;
    const scenario = line.match(/^Scenario(?: Outline)?:\s*(.+?)\s*$/iu);
    return scenario?.[1];
  }
  return undefined;
}
