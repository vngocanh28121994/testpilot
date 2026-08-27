import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Registry } from '../core/registry.js';
import { ScenarioReviewStore, scenarioBlocks } from '../core/scenarioReview.js';
import type { Platform } from '../core/types.js';
import { parseFeature } from '../steps/binding.js';
import { generatePom, type PomOutput } from './generator.js';

export interface PomSyncOptions {
  featuresDir: string;
  registryPath: string;
  /** When supplied, only content-hash-approved scenarios enter generated specs. */
  scenarioReviewPath?: string;
  outputDir?: string;
  platform?: Platform;
  overwriteDriver?: boolean;
}

/**
 * Synchronise approved feature files into the reusable POM project.
 * Existing Page Object code is preserved; only missing generated methods are
 * appended by `generatePom`.
 */
export async function syncPomProject(opts: PomSyncOptions): Promise<PomOutput> {
  const registry = await Registry.load(opts.registryPath);
  const reviews = opts.scenarioReviewPath
    ? await ScenarioReviewStore.load(opts.scenarioReviewPath)
    : undefined;
  const files = (await readdir(opts.featuresDir))
    .filter((name) => name.endsWith('.feature'))
    .sort();
  const features = await Promise.all(
    files.map(async (name) => {
      const uri = path.join(opts.featuresDir, name);
      const content = await readFile(uri, 'utf8');
      const feature = parseFeature(uri, content, registry);
      if (!reviews) return feature;
      reviews.syncFile(name, content, { defaultStatus: 'approved', source: 'legacy' });
      const hashes = new Map(scenarioBlocks(content).map((block) => [block.name, block.contentHash]));
      return {
        ...feature,
        scenarios: feature.scenarios.filter((scenario) =>
          reviews.isApproved(name, scenario.name, hashes.get(scenario.name))),
      };
    }),
  );
  await reviews?.save();
  const out = await generatePom(features, registry.raw, {
    outputDir: opts.outputDir ?? 'generated',
    platform: opts.platform ?? 'web',
    overwriteDriver: opts.overwriteDriver ?? false,
  });
  // Approving is the moment a person is looking; an ambiguous label they never
  // hear about becomes a test that passes while touching the wrong control.
  const warnings = [...new Set(features.flatMap((feature) => feature.warnings ?? []))];
  return warnings.length > 0 ? { ...out, warnings } : out;
}
