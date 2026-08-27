/**
 * testpilot pom — generate typed Page Object Model code from feature files.
 *
 * Usage:
 *   tsx src/cli/pom.ts [--features features/] [--registry registry/elements.json]
 *                      [--output generated/] [--platform web|android|ios]
 *                      [--overwrite-driver]
 *
 * Reads every .feature file in the features directory, parses intents via the
 * existing vocabulary binding, then emits:
 *   generated/pages/{ScreenName}Page.ts  — one class per screen
 *   generated/tests/{slug}.spec.ts       — one spec per feature
 *   generated/support/driver.ts          — platform setup scaffold
 */

import { readdir } from 'node:fs/promises';
import { loadConfig } from '../config.js';
import { Registry } from '../core/registry.js';
import type { Platform } from '../core/types.js';
import { syncPomProject } from '../pom/sync.js';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cfg = await loadConfig(args.config ?? 'testpilot.config.json');

  const featuresDir = args.features ?? cfg.paths.features ?? 'features';
  const registryPath = args.registry ?? cfg.paths.registry ?? 'registry/elements.json';
  const outputDir = args.output ?? 'generated';
  const platform: Platform = args.platform ?? 'web';

  // Load registry
  const registry = await Registry.load(registryPath);
  const raw = registry.raw;

  // Load all feature files
  const featureFiles = (await readdir(featuresDir)).filter((f) => f.endsWith('.feature'));

  if (featureFiles.length === 0) {
    console.error(`[pom] No .feature files found in ${featuresDir}`);
    process.exit(1);
  }

  console.log(`[pom] ${featureFiles.length} feature file(s), registry has ${Object.keys(raw.elements).length} elements`);

  const result = await syncPomProject({
    featuresDir,
    registryPath,
    scenarioReviewPath: cfg.paths.scenarioReviewDb,
    outputDir,
    platform,
    overwriteDriver: args.overwriteDriver,
  });

  const pageCount = Object.keys(result.pages).length;
  const specCount = Object.keys(result.specs).length;

  console.log(`[pom] Generated ${pageCount} page object(s) → ${outputDir}/pages/`);
  for (const name of Object.keys(result.pages)) {
    console.log(`      ${outputDir}/pages/${name}`);
  }
  console.log(`[pom] Generated ${specCount} spec file(s) → ${outputDir}/tests/`);
  for (const name of Object.keys(result.specs)) {
    console.log(`      ${outputDir}/tests/${name}`);
  }
  console.log(`[pom] Driver scaffold → ${outputDir}/support/driver.ts (not overwritten if exists)`);
  const stale = result.changes.driverPlatformStale;
  if (stale) {
    console.warn(
      `[pom] support/driver.ts vẫn mặc định "${stale.existing}", không phải "${stale.current}". ` +
        'Thêm --overwrite-driver để cập nhật, hoặc đặt TESTPILOT_PLATFORM khi chạy spec.',
    );
  }
  const added = Object.values(result.changes.pageMethodsAdded).flat();
  console.log(
    `[pom] Incremental: ${result.changes.pagesCreated.length} page mới, ` +
      `${added.length} method mới, ${result.changes.preserved.length} file được giữ nguyên.`,
  );
}

interface PomArgs {
  config?: string;
  features?: string;
  registry?: string;
  output?: string;
  platform?: Platform;
  overwriteDriver: boolean;
}

function parseArgs(argv: string[]): PomArgs {
  const args: PomArgs = { overwriteDriver: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--config') args.config = argv[++i];
    else if (a === '--features') args.features = argv[++i];
    else if (a === '--registry') args.registry = argv[++i];
    else if (a === '--output') args.output = argv[++i];
    else if (a === '--platform') args.platform = argv[++i] as Platform;
    else if (a === '--overwrite-driver') args.overwriteDriver = true;
  }
  return args;
}

main().catch((err: Error) => {
  console.error(`[pom] ${err.message}`);
  if (process.env['DEBUG']) console.error(err.stack);
  process.exit(1);
});
