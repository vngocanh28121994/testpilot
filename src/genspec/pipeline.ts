import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveModel, type TestPilotConfig } from '../config.js';
import { Registry } from '../core/registry.js';
import { ScenarioReviewStore } from '../core/scenarioReview.js';
import { adoptStoredApiKeys } from '../core/secrets.js';
import type { StageStatus } from '../core/history.js';
import { applyGeneratedTagPolicy } from '../core/tagTaxonomy.js';
import { resolveDocs } from '../ingest/resolve.js';
import {
  enforceFeatureCoverage,
  extractCoverageMap,
  type CoverageGateResult,
  type CoverageMap,
} from './coverage.js';
import { generateFeature, generateModel } from './generate.js';
import { reconcileGeneratedModel, type ReconciledModel } from './reconcile.js';
import { enrichDocsWithVisualEvidence } from './visual.js';
import { prepareExecutableDraft } from './draft.js';
import { loadExistingScenarios } from './existingScenarios.js';

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
  /** Business-facing name from the generated `Feature:` declaration. */
  featureName: string;
  visuals: number;
  screens: number;
  elements: number;
  scenarios: number;
  steps: number;
  coverageRequirements: number;
  coverageCovered: number;
  coverageMissing: Array<{
    id: string;
    priority: 'P0' | 'P1';
    rule: string;
  }>;
  coverageRepaired: boolean;
}

export async function runGenPipeline(
  cfg: TestPilotConfig,
  ev: PipelineEvents,
): Promise<PipelineResult> {
  await adoptStoredApiKeys();
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
  ev.log(
    'Đang áp dụng quy tắc TestPilot: phủ hết yêu cầu bắt buộc, gộp case trùng, ' +
      'dùng luồng nghiệp vụ chung và không tự suy diễn yêu cầu.',
  );

  let analysisDocs = docs;
  let analyzedVisuals = 0;
  let coverageMap!: CoverageMap;
  const generated = await step(1, async () => {
    const visual = await enrichDocsWithVisualEvidence(docs, {
      model,
      log: ev.log,
    });
    analysisDocs = visual.docs;
    analyzedVisuals = visual.analyzed;
    // "Không có ảnh" was true of a page full of screenshots for as long as the
    // reason lived one layer down; the note says which of the two it is.
    const notes = docs.flatMap((doc) => doc.visualNotes ?? []);
    for (const note of notes) ev.log(`⚠️  ${note}`);
    if (visual.discovered === 0 && notes.length === 0) {
      ev.log('Không có ảnh/design đính kèm trong tài liệu nguồn.');
    }
    // Loaded before generation, not after: the model needs the names this
    // project already uses while it is still choosing names.
    // Best guess at the file this run will write, so the feature's own
    // scenarios are not presented to it as somebody else's work. It is a guess
    // because the final name comes from the `Feature:` line the model has not
    // written yet; naming the target in the Studio form makes it exact.
    const likelyTarget = slug(cfg.targetFeature || docs[0]?.title || '');
    const existingScenarios = await loadExistingScenarios(cfg.paths.features, likelyTarget);
    const known = await Registry.load(cfg.paths.registry)
      .then((reg) => ({
        screens: Object.values(reg.raw.screens),
        elements: Object.values(reg.raw.elements),
        existingScenarios,
      }))
      .catch(() => undefined);
    if (known) {
      ev.log(`Vốn từ sẵn có: ${known.screens.length} màn hình, ${known.elements.length} element.`);
    }
    if (existingScenarios.length > 0) {
      ev.log(
        `${existingScenarios.length} testcase đã có ở feature khác — AI được yêu cầu không viết lại.`,
      );
    }
    const [out, extractedCoverage] = await Promise.all([
      generateModel(analysisDocs, { model, effort: cfg.llm.effort, extra, known }),
      extractCoverageMap(analysisDocs, { model, log: ev.log }),
    ]);
    coverageMap = extractedCoverage;
    ev.log(`${out.screens.length} màn hình, ${out.elements.length} element.`);
    const p0 = coverageMap.requirements.filter((requirement) => requirement.priority === 'P0').length;
    const p1 = coverageMap.requirements.filter((requirement) => requirement.priority === 'P1').length;
    ev.log(
      `Coverage map: ${coverageMap.sourceUnits} ý nguồn đã phân loại → ` +
      `${p0 + p1} yêu cầu bắt buộc phải có testcase.`,
    );
    return out;
  });

  let reconciled!: ReconciledModel;
  const registry = await step(2, async () => {
    const reg = await Registry.load(cfg.paths.registry);
    reconciled = reconcileGeneratedModel(generated, reg.raw);
    for (const s of reconciled.screens) {
      // A mature screen owns route/scope metadata learned from real runs. A
      // regenerated document may enrich an empty definition, but must not
      // overwrite those runtime facts merely because the LLM chose a new id.
      reg.raw.screens[s.id] ??= s;
    }
    for (const e of reconciled.elements) reg.upsertElement({ ...e, provenance: 'generated' });
    await mkdir(path.dirname(cfg.paths.registry), { recursive: true });
    await reg.save();
    const reusedScreens = Object.entries(reconciled.screenAliases)
      .filter(([from, to]) => from !== to);
    const reusedElements = Object.entries(reconciled.elementAliases)
      .filter(([from, to]) => from !== to);
    if (reusedScreens.length > 0 || reusedElements.length > 0) {
      ev.log(
        `Tái sử dụng registry: ${reusedScreens.length} màn hình, ` +
          `${reusedElements.length} element đã có locator.`,
      );
    }
    ev.log(`registry → ${cfg.paths.registry}`);
    return reg;
  });

  let coverageGate!: CoverageGateResult;
  const generatedGherkin = await step(3, async () => {
    const draft = await generateFeature(analysisDocs, reconciled.featureElements, {
      model,
      effort: cfg.llm.effort,
      extra,
      coverage: coverageMap.requirements,
    });
    coverageGate = await enforceFeatureCoverage(
      analysisDocs,
      draft,
      reconciled.featureElements,
      coverageMap,
      { model, log: ev.log },
    );
    const covered = coverageGate.audit.mappings.filter((mapping) => mapping.status === 'covered').length;
    if (coverageGate.audit.decision === 'ready') {
      ev.log(
        `Đã phủ đủ — ${covered}/${coverageMap.requirements.length} yêu cầu bắt buộc đều có testcase` +
        (coverageGate.repaired ? ' sau một vòng tự bổ sung.' : '.'),
      );
    } else {
      ev.log(
        `Còn thiếu testcase — mới phủ ${covered}/${coverageMap.requirements.length} yêu cầu bắt buộc; ` +
        `${coverageGate.audit.missingRequirementIds.length} quy tắc còn thiếu sẽ được hiển thị ở màn Duyệt.`,
      );
    }
    return coverageGate.feature;
  });

  // Generated requirements are allowed to stay concise. Normalize common
  // business wording into typed intents, then register any clearly named target
  // without inventing a locator. The live Playwright/Appium observation owns
  // selector discovery when the scenario reaches that screen.
  const generatedBusinessName =
    generatedGherkin.match(/^\s*Feature:\s*(.+?)\s*$/mi)?.[1]?.trim() ||
    cfg.targetFeature ||
    docs[0]?.title ||
    'generated';
  const taggedGherkin = applyGeneratedTagPolicy(
    generatedGherkin,
    generatedBusinessName,
    coverageMap.requirements,
    coverageGate.audit.mappings,
  );
  // Prompt compliance is not a lifecycle guarantee. Enforce the application
  // launch deterministically so a fresh Playwright page never starts a shared
  // login precondition at about:blank.
  const lifecycleSafe = ensureLaunchBackground(taggedGherkin);

  // When the user leaves the optional feature name empty, let the generated
  // business specification name itself. This is more useful than a Confluence
  // page title such as "Sprint 34 requirements" and keeps filenames readable.
  const generatedFeatureName =
    lifecycleSafe.match(/^\s*Feature:\s*(.+?)\s*$/mi)?.[1]?.trim() ||
    cfg.targetFeature ||
    docs[0]?.title ||
    'generated';

  const name = slug(cfg.targetFeature || generatedFeatureName);
  const file = path.join(cfg.paths.features, `${name}.feature`);

  // Compile in memory first. The reviewer must never receive a draft that
  // still contains parser/binding errors, and a failed compile must not leave
  // an orphan .feature file behind.
  const prepared = await step(4, async () => {
    const result = await prepareExecutableDraft(lifecycleSafe, registry, {
      model,
      uri: file,
      log: ev.log,
      maxRepairs: 2,
      // Kept out of `features/` on purpose — an uncompilable draft must not
      // look like a test — but kept somewhere, because the alternative is a
      // workflow that fails and destroys the only evidence of why.
      onFailure: async ({ content, problems }) => {
        const dir = path.join(cfg.paths.artifacts, 'failed-drafts');
        await mkdir(dir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const dump = path.join(dir, `${name}-${stamp}.feature`);
        await writeFile(
          dump,
          `# Bản nháp KHÔNG compile được — chỉ để chẩn đoán, không phải testcase.\n` +
            problems.map((problem) => `# ${problem}`).join('\n') +
            `\n\n${content}\n`,
          'utf8',
        );
        ev.log(`Bản nháp lỗi đã lưu để chẩn đoán: ${dump}`);
      },
    });
    // Preparation may add selector-less elements, reusable templates or a
    // deterministic authored candidate. Persist every successful compile, not
    // only the branch that happened to return a pending element.
    await registry.save();
    if (result.pendingElements.length > 0) {
      ev.log(
        `${result.pendingElements.length} logical element chưa có locator — ` +
          'Playwright/Appium sẽ tự tìm từ UI thật khi chạy.',
      );
    }
    if (result.repaired) ev.log('AI đã tự sửa lỗi cú pháp/binding trước màn duyệt.');
    return result;
  });
  const gherkin = prepared.content;
  const spec = prepared.spec;
  const steps = spec.scenarios.reduce((n, s) => n + s.steps.length, 0);

  await step(5, async () => {
    await mkdir(cfg.paths.features, { recursive: true });
    const out = file;
    await writeFile(out, gherkin.trimEnd() + '\n', 'utf8');
    const coverageDir = path.join(path.dirname(cfg.paths.scenarioReviewDb), 'coverage');
    await mkdir(coverageDir, { recursive: true });
    await writeFile(
      path.join(coverageDir, `${path.basename(out)}.json`),
      JSON.stringify({
        version: 1,
        featureFile: path.basename(out),
        generatedAt: new Date().toISOString(),
        repaired: coverageGate.repaired,
        sourceUnits: coverageMap.sourceUnits,
        classifiedSources: coverageMap.classifiedSources,
        requirements: coverageMap.requirements,
        audit: coverageGate.audit,
      }, null, 2) + '\n',
      'utf8',
    );
    ev.log(`→ ${out}`);
    ev.log(`coverage → ${path.join(coverageDir, `${path.basename(out)}.json`)}`);
    // Generated scenarios are drafts. A successful compile proves technical
    // executability only; business approval remains the one human gate.
    const reviews = await ScenarioReviewStore.load(cfg.paths.scenarioReviewDb);
    reviews.syncFile(path.basename(file), gherkin, {
      defaultStatus: 'pending',
      source: 'generated',
      forcePending: true,
    });
    await reviews.save();
  });

  await step(6, async () => {
    ev.log(
      `Bind OK — ${spec.scenarios.length} scenario, ${steps} step. ` +
      'Toàn bộ testcase mới đang chờ người dùng duyệt/chỉnh sửa trước khi chạy.',
    );
  });

  return {
    file,
    featureName: spec.name || generatedFeatureName,
    visuals: analyzedVisuals,
    screens: reconciled.screens.length,
    elements: reconciled.elements.length,
    scenarios: spec.scenarios.length,
    steps,
    coverageRequirements: coverageMap.requirements.length,
    coverageCovered: coverageGate.audit.mappings.filter((mapping) => mapping.status === 'covered').length,
    coverageMissing: coverageMap.requirements
      .filter((requirement) => coverageGate.audit.missingRequirementIds.includes(requirement.id))
      .map((requirement) => ({
        id: requirement.id,
        priority: requirement.priority,
        rule: requirement.rule,
      })),
    coverageRepaired: coverageGate.repaired,
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

/** Ensure generated features always establish an application surface. */
export function ensureLaunchBackground(content: string): string {
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  const featureIndex = lines.findIndex((line) => /^\s*Feature\s*:/i.test(line));
  if (featureIndex < 0) return content;

  const backgroundIndex = lines.findIndex((line, index) =>
    index > featureIndex && /^\s*Background\s*:/i.test(line));

  if (backgroundIndex >= 0) {
    const sectionEnd = lines.findIndex((line, index) =>
      index > backgroundIndex && /^\s*(?:Rule|Scenario|Scenario Outline)\s*:/i.test(line));
    const end = sectionEnd < 0 ? lines.length : sectionEnd;
    const alreadyLaunches = lines
      .slice(backgroundIndex + 1, end)
      .some((line) => /^\s*(?:Given|When|And)\s+I open the app\s*$/i.test(line));
    if (!alreadyLaunches) lines.splice(backgroundIndex + 1, 0, '    Given I open the app');
    return lines.join(newline);
  }

  lines.splice(featureIndex + 1, 0, '', '  Background:', '    Given I open the app');
  return lines.join(newline);
}
