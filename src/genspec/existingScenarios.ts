/**
 * The tests this project already has, so a new document does not re-write them.
 *
 * Two business features living on one screen share flows, and each is generated
 * from its own document. The model is shown the registry before it names an
 * element — which is why one control no longer ends up with two names — but it
 * has never been shown the scenarios, so it cannot tell that the rule it is
 * about to cover is already covered next door. The result is the same test in
 * two files: run twice, failing twice for one cause, and drifting apart the
 * first time somebody edits one of them.
 *
 * The feature being written is deliberately excluded. Regeneration must be free
 * to rewrite its own scenarios; only somebody else's are off limits.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { scenarioBlocks } from '../core/scenarioReview.js';

export interface ExistingScenario {
  feature: string;
  file: string;
  name: string;
}

export async function loadExistingScenarios(
  featuresDir: string,
  excludeSlug: string,
): Promise<ExistingScenario[]> {
  const files = await readdir(featuresDir).catch(() => [] as string[]);
  const out: ExistingScenario[] = [];
  for (const file of files.filter((name) => name.endsWith('.feature')).sort()) {
    if (excludeSlug && path.basename(file, '.feature') === excludeSlug) continue;
    const content = await readFile(path.join(featuresDir, file), 'utf8').catch(() => '');
    if (!content) continue;
    const feature = content.match(/^\s*Feature:\s*(.+?)\s*$/mi)?.[1]?.trim() ?? file;
    for (const block of scenarioBlocks(content)) {
      out.push({ feature, file, name: block.name });
    }
  }
  return out;
}
