import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveModel, type TestPilotConfig } from '../config.js';
import { Registry } from '../core/registry.js';
import type { StageStatus } from '../core/history.js';
import { resolveDocs } from '../ingest/resolve.js';
import { parseFeature } from '../steps/binding.js';
import { generateFeature, generateModel } from './generate.js';

/**
 * docs -> element registry -> .feature file -> bound steps.
 *
 * The CLI and the UI both call this, so a workflow started from the browser and
 * one started from a terminal cannot drift apart. The stage callback is what
 * feeds the "3/7" column in Scenario Studio; the stage list it indexes into is
 * GEN_STAGES in core/history.ts and the two must stay in the same order.
 */
export interface PipelineEvents {
  log: (line: string) => void;
  stage?: (index: number, status: StageStatus) => void;
}

export interface PipelineResult {
  file: string;
  screens: number;
  elements: number;
  scenarios: number;
  steps: number;
}

export async function runGenPipeline(
  cfg: TestPilotConfig,
  ev: PipelineEvents,
): Promise<PipelineResult> {
  const model = resolveModel(cfg.llm.model);
  const extra = {
    note: cfg.llm.note,
    accounts: cfg.accounts,
    targetFeature: cfg.targetFeature,
  };
  const at = (index: number, status: StageStatus) => ev.stage?.(index, status);

  /** Marks a stage running, runs it, marks it done — or failed, and rethrows. */
  const step = async <T>(index: number, fn: () => Promise<T>): Promise<T> => {
    at(index, 'running');
    try {
      const out = await fn();
      at(index, 'done');
      return out;
    } catch (err) {
      at(index, 'failed');
      throw err;
    }
  };

  const docs = await step(0, async () => {
    const found = await resolveDocs(cfg, ev.log);
    if (found.length === 0) {
      throw new Error(
        'Không đọc được tài liệu nào. Thêm link Confluence/Figma (cần MCP server) ' +
          `hoặc đặt file .md/.txt vào ${cfg.paths.docs}/.`,
      );
    }
    ev.log(`${found.length} tài liệu, ~${found.reduce((n, d) => n + d.text.length, 0)} ký tự.`);
    return found;
  });

  ev.log(`Model: ${model} · effort: ${cfg.llm.effort}`);

  const generated = await step(1, async () => {
    const out = await generateModel(docs, { model, effort: cfg.llm.effort, extra });
    ev.log(`${out.screens.length} màn hình, ${out.elements.length} element.`);
    return out;
  });

  const registry = await step(2, async () => {
    const reg = await Registry.load(cfg.paths.registry);
    for (const s of generated.screens) reg.raw.screens[s.id] = s;
    for (const e of generated.elements) reg.upsertElement(e);
    await mkdir(path.dirname(cfg.paths.registry), { recursive: true });
    await reg.save();
    ev.log(`registry → ${cfg.paths.registry}`);
    return reg;
  });

  const gherkin = await step(3, () =>
    generateFeature(docs, generated.elements, { model, effort: cfg.llm.effort, extra }),
  );

  const file = await step(4, async () => {
    await mkdir(cfg.paths.features, { recursive: true });
    const name = slug(cfg.targetFeature || docs[0]?.title || 'generated');
    const out = path.join(cfg.paths.features, `${name}.feature`);
    await writeFile(out, gherkin.trimEnd() + '\n', 'utf8');
    ev.log(`→ ${out}`);
    return out;
  });

  // Bind immediately: generation that produces steps the runtime cannot execute
  // is a failure, and it should fail here at zero device cost.
  const spec = await step(5, async () => parseFeature(file, gherkin, registry));
  const steps = spec.scenarios.reduce((n, s) => n + s.steps.length, 0);

  await step(6, async () => {
    ev.log(`Bind OK — ${spec.scenarios.length} scenario, ${steps} step.`);
  });

  return {
    file,
    screens: generated.screens.length,
    elements: generated.elements.length,
    scenarios: spec.scenarios.length,
    steps,
  };
}

export function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'generated'
  );
}
