import type { SourceDoc } from '../ingest/types.js';
import { vocabularyDoc } from '../steps/vocabulary.js';

/**
 * Prompts live in their own file so they can be diffed and reviewed like code.
 * Both generation passes share the same document context, which is what makes
 * prompt caching worth wiring up (see genspec/generate.ts).
 */

export const MODEL_SYSTEM = `You are a senior QA automation engineer. You read product
specifications and turn them into a machine-checkable test model.

Rules:
- Only describe screens, elements and flows that the document actually states.
  Never invent a field, a button or a validation rule that is not in the source.
- Prefer accessibility-first locators. A testId is best, then an ARIA role plus
  accessible name, then visible text. CSS and XPath are last resorts and must be
  weighted low, because they break on the first refactor.
- Give every element two or three candidate locators per platform when the
  document supports it. The runtime falls back down that list when the first one
  stops matching, so ordering is the whole point: most stable first.
- Element ids are "screen.element" in lowerCamelCase, e.g. "login.submitButton".`;

export const FEATURE_SYSTEM = `You are a senior QA automation engineer writing Gherkin.

You may ONLY use the controlled step vocabulary listed below. A step that does not
match one of these patterns will be rejected by the parser before any test runs.

${vocabularyDoc()}

Rules:
- Reference elements by their registry id or their exact label, in double quotes.
- Tag scenarios with @web, @android or @ios only when the behaviour genuinely
  differs per platform. An untagged scenario runs everywhere, which is what you
  want for a business rule.
- Tag the happy path of each feature @smoke.
- Use a Scenario Outline with an Examples table whenever the document describes
  the same flow over several inputs. Do not copy-paste near-identical scenarios.
- One Feature per document section. Cover the negative and boundary cases the
  document states — not ones you imagine.
- Output the .feature file content only. No commentary, no code fences.`;

/** The shared, cacheable half of the prompt: the source documents themselves. */
export function documentContext(docs: SourceDoc[]): string {
  return docs
    .map(
      (d) =>
        `<document kind="${d.kind}" ref="${escapeAttr(d.ref)}" title="${escapeAttr(d.title)}">\n` +
        `${d.text}\n</document>`,
    )
    .join('\n\n');
}

/** Free-text guidance typed into the UI's "Additional Note" box. */
export interface ExtraContext {
  note?: string;
  /** Test accounts, by label. Usernames are shown; passwords never are. */
  accounts?: Array<{ label: string; username: string }>;
  /** What the generated feature should be called, when the user named it. */
  targetFeature?: string;
}

export function modelTask(extra: ExtraContext = {}): string {
  return (
    `From the documents above, produce the screen and element model.

For each element, fill candidates for every platform the document covers:
- web: testId / role (+name) / label / placeholder
- android: testId (accessibility id or resource-id) / label / role (widget class)
- ios: testId (accessibilityIdentifier) / label / role (XCUIElement type)

Weight each candidate 0..1 by how stable you expect it to be.` + noteBlock(extra)
  );
}

export function featureTask(elementsSummary: string, extra: ExtraContext = {}): string {
  const focus = extra.targetFeature
    ? `\n\nThe feature under test is "${extra.targetFeature}". Cover that flow; ignore\nparts of the documents that do not touch it.`
    : '';

  return (
    `Write Gherkin feature files for the documents above.

These are the only elements that exist. Referencing anything else is an error:

${elementsSummary}${focus}${accountBlock(extra.accounts)}

Return one .feature file. Start with the Feature: line.` + noteBlock(extra)
  );
}

/**
 * Credentials reach the runtime as placeholders, never as literals. A .feature
 * file is committed to git, so a real password written into a step would leak
 * the moment the suite is pushed — and the same suite would stop working the
 * moment the SIT account rotates.
 */
function accountBlock(accounts: ExtraContext['accounts']): string {
  const usable = (accounts ?? []).filter((a) => a.label.trim());
  if (usable.length === 0) return '';

  const rows = usable
    .map((a) => {
      const key = a.label.trim().toLowerCase();
      const who = a.username ? ` (user: ${a.username})` : '';
      return `- ${a.label}${who}: {{account.${key}.username}} / {{account.${key}.password}}`;
    })
    .join('\n');

  return `\n\nTest accounts available for login steps. Write the placeholder, never the
literal value — the runner substitutes it at execution time:

${rows}`;
}

function noteBlock(extra: ExtraContext): string {
  const note = extra.note?.trim();
  return note ? `\n\nAdditional instructions from the engineer:\n${note}` : '';
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;');
}
