import { loadConfig } from '../config.js';
import { runGenPipeline } from '../genspec/pipeline.js';

/**
 * docs -> element registry -> .feature files.
 *
 * The pipeline itself lives in genspec/pipeline.ts because the UI runs the very
 * same one; this file is only the terminal front end for it.
 */
async function main(): Promise<void> {
  const cfg = await loadConfig();
  const result = await runGenPipeline(cfg, { log: (line) => console.log(`[gen] ${line}`) });
  console.log(
    `[gen] ${result.file}: ${result.scenarios} scenarios, ${result.steps} steps — all bound.`,
  );
}

main().catch((err: Error) => {
  console.error(`[gen] ${err.message}`);
  process.exit(1);
});
