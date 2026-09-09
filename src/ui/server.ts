import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { OrphanTracker } from '../core/orphans.js';
import { closeInterruptedRuns } from '../core/runstore.js';
import { firstJsonObject } from '../llm/json.js';
import net from 'node:net';
import os from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { closeSync, createWriteStream, existsSync, openSync, readdirSync, statSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { completeJson, listModels, llmAvailable, missingKeyHint, pickModel } from '../llm/client.js';
import { ConfigSchema, applyEnv, loadConfig, resolveModel, saveConfig, type TestPilotConfig } from '../config.js';
// Hợp đồng dùng chung với app React ở ui/. Chỉ có type — không kéo theo gì
// lúc chạy. Gắn kiểu trả về cho handler ở đây chính là chỗ TypeScript bắt
// được lệch hợp đồng, thay vì để nó nổ ở trình duyệt. Xem contracts.ts.
import type {
  Build,
  HealingResponse,
  HistoryResponse,
  RunHistoryEntry,
  StateResponse,
  FeatureNormalizeResponse,
} from './contracts.js';
import { Registry } from '../core/registry.js';
import { KnownIssueStore } from '../core/knownIssues.js';
import { ScenarioReviewStore, scenarioBlocks } from '../core/scenarioReview.js';
import { listRuns } from '../core/runstore.js';
import {
  FARM_STAGES,
  WORKFLOW_STAGES,
  History,
  stagesDone,
  type WorkflowRun,
} from '../core/history.js';
import {
  pendingQuestions,
  QuestionError,
  submitAnswers,
  type AnswerSubmission,
} from '../core/questions.js';
import { adoptStoredApiKeys, Secrets, farmSecretEnv, secretEnvName } from '../core/secrets.js';
import { DeviceEnvLog } from '../core/deviceEnv.js';
import { preflight, preflightSummary } from '../core/preflight.js';
import { resolveFarmTarget } from '../farm/target.js';
import { buildInventory } from '../core/builds.js';
import { normalizeFeatureTags, tagTaxonomyView } from '../core/tagTaxonomy.js';
import {
  assertFarmReady,
  awsLogin,
  awsStatus,
  createDevicePool,
  listDevicePools,
  listDevices,
  listProjects,
  scheduleFarmRun,
} from '../farm/devicefarm.js';
import { runGenPipeline } from '../genspec/pipeline.js';
import { prepareExecutableDraft } from '../genspec/draft.js';
import {
  auditFeatureCoverage,
  type CoverageAudit,
  type CoverageRequirement,
} from '../genspec/coverage.js';
import { McpBridge, guessToolNames } from '../ingest/mcp.js';
import { parseFeature } from '../steps/binding.js';
import { normalizeNaturalSteps, registerMissingElementIntents } from '../steps/normalizer.js';
import {
  applyScenarioPlan,
  deterministicScenarioPlan,
  planningInput,
  validateScenarioPlan,
  type RawScenarioPlan,
  type ScenarioPlan,
} from '../steps/scenarioPlan.js';
import { STEP_RULES, vocabularyDoc } from '../steps/vocabulary.js';
import { chaptersOf, isWholeRunRecording, testWindowSeconds } from '../report/videoIndex.js';
import { syncPomProject } from '../pom/sync.js';
import { HealingStore } from '../healing/HealingStore.js';
import { assessLocatorQuality } from '../core/locatorQuality.js';
import {
  ActionRegistry,
  type LearnedActionDef,
  type LearnedActionKind,
} from '../actions/ActionRegistry.js';

/**
 * Local control panel. Single user, single machine — so it is a plain node:http
 * server phục vụ bundle React đã build. Nó đọc và ghi cùng
 * `testpilot.config.json` the CLI reads, which keeps the UI a convenience
 * rather than a second source of truth.
 */

/** Vite bundle duy nhất sau cutover. `/api` và artifact paths vẫn do server này sở hữu. */
const PUBLIC_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'dist',
  'ui',
  'app',
);
const execFileAsync = promisify(execFile);

const PORT = Number(process.env.TESTPILOT_UI_PORT ?? 4300);
const CONFIG_FILE = process.env.TESTPILOT_CONFIG ?? 'testpilot.config.json';

/**
 * Shown when the Anthropic Models API cannot be reached despite a key being
 * present — offline, a restricted org, a transient 5xx.
 *
 * Deliberately NOT shown when there is no key at all. A server with no key can
 * run none of these, and offering them tells someone whose config pins a
 * DeepSeek model that their model has disappeared and four Anthropic ones have
 * arrived — a list that is wrong in both directions. Silence plus the reason is
 * the honest answer there.
 */
const FALLBACK_MODELS = [
  { id: 'claude-opus-5', display_name: 'Claude Opus 5' },
  { id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5' },
  { id: 'claude-opus-4-8', display_name: 'Claude Opus 4.8' },
  { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5' },
];

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  // Without the right type the browser downloads the recording instead of
  // playing it inline, which defeats the point of embedding it.
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
};

await adoptStoredApiKeys();

const runChildren = new Set<ReturnType<typeof spawn>>();
const orphans = OrphanTracker.load();

/**
 * Dọn dẹp lúc khởi động, trước khi nhận request nào.
 *
 * Hai thứ sống sót sau khi một server chết giữa chừng, và cả hai đều nói dối
 * người dùng: dòng history vẫn ghi `running` như thể còn ai đó chăm nó, và
 * tiến trình test vẫn bấm vào thiết bị thật mà không nút nào dừng được.
 */
{
  const reaped = orphans.reapOrphans();
  for (const item of reaped) {
    console.log(`[cleanup] dừng tiến trình mồ côi từ lần chạy trước: ${item.label} (pid ${item.pid})`);
  }
  const history = await History.load();
  const closed = history.closeInterrupted();
  if (closed > 0) {
    await history.save();
    console.log(`[cleanup] đóng ${closed} workflow bị treo ở trạng thái "đang chạy".`);
  }
  // meta.json của từng lượt chạy là bản ghi RIÊNG, và màn Local Runner đọc nó
  // chứ không đọc history — đóng một bên mà bỏ bên kia thì vẫn còn nói dối.
  const cfgForCleanup = await loadConfig(CONFIG_FILE).catch(() => undefined);
  if (cfgForCleanup) {
    const runs = await closeInterruptedRuns(cfgForCleanup.paths.runs);
    if (runs.length > 0) {
      console.log(`[cleanup] đóng ${runs.length} lượt chạy local bị treo: ${runs.join(', ')}`);
    }
  }
}

/**
 * Và dọn lúc thoát, để lần sau không phải dọn.
 *
 * SIGKILL không bắt được — đó chính là lý do tệp PID tồn tại. Nhưng phần lớn
 * lần server dừng là SIGTERM hoặc Ctrl-C, và những lần đó nên sạch ngay.
 */
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    for (const child of runChildren) child.kill('SIGTERM');
    process.exit(signal === 'SIGINT' ? 130 : 143);
  });
}

createServer((req, res) => {
  handle(req, res).catch((err: Error) => {
    if (!res.headersSent) json(res, 500, { error: err.message });
    else res.end();
  });
}).listen(PORT, () => {
  console.log(`TestPilot UI  →  http://localhost:${PORT}`);
});

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const route = `${req.method} ${url.pathname}`;

  switch (route) {
    case 'GET /api/state':
      return json(res, 200, await state());

    case 'PUT /api/config': {
      const body = await readJson<TestPilotConfig>(req);
      const parsed = ConfigSchema.safeParse(body);
      if (!parsed.success) {
        return json(res, 400, {
          error: 'Config không hợp lệ',
          issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        });
      }
      await saveConfig(parsed.data, CONFIG_FILE);
      return json(res, 200, { ok: true, config: parsed.data });
    }

    case 'POST /api/model-key': {
      const body = await readJson<{
        provider: 'anthropic' | 'deepseek' | 'gemini';
        key: string;
      }>(req);
      const keyNames = {
        anthropic: 'ANTHROPIC_API_KEY',
        deepseek: 'DEEPSEEK_API_KEY',
        gemini: 'GEMINI_API_KEY',
      } as const;
      const name = keyNames[body.provider];
      if (!name) return json(res, 400, { error: 'AI provider không hợp lệ.' });
      const key = body.key?.trim();
      if (!key) return json(res, 400, { error: 'API key không được để trống.' });
      const secrets = await Secrets.load();
      secrets.setApiKey(name, key);
      await secrets.save();
      process.env[name] = key;
      return json(res, 200, { ok: true });
    }

    /**
     * The Confluence credential, stored the same way model keys are: written to
     * the local secrets file, adopted into this process, and never read back.
     * The GET reports only whether one is set, so a screen-share of the settings
     * page cannot leak it.
     */
    case 'GET /api/confluence-auth': {
      const secrets = await Secrets.load();
      const email = secrets.apiKey('CONFLUENCE_EMAIL') || process.env.CONFLUENCE_EMAIL || '';
      const hasToken = Boolean(
        secrets.apiKey('CONFLUENCE_API_TOKEN') || process.env.CONFLUENCE_API_TOKEN,
      );
      return json(res, 200, { email, hasToken });
    }

    case 'POST /api/confluence-auth': {
      const body = await readJson<{ email?: string; token?: string }>(req);
      const email = body.email?.trim();
      const token = body.token?.trim();
      if (!email || !token) {
        return json(res, 400, { error: 'Cần cả email Atlassian và API token.' });
      }
      const secrets = await Secrets.load();
      secrets.setApiKey('CONFLUENCE_EMAIL', email);
      secrets.setApiKey('CONFLUENCE_API_TOKEN', token);
      await secrets.save();
      process.env.CONFLUENCE_EMAIL = email;
      process.env.CONFLUENCE_API_TOKEN = token;
      return json(res, 200, { ok: true });
    }

    case 'POST /api/mcp/tools':
      return json(res, 200, await mcpTools(await readJson(req)));

    case 'GET /api/models':
      return json(res, 200, await models());

    case 'GET /api/history': {
      const body: HistoryResponse = { runs: await recentRuns() };
      return json(res, 200, body);
    }

    case 'GET /api/healing': {
      const cfg = await loadConfig(CONFIG_FILE);
      return json(res, 200, await healingState(cfg));
    }

    case 'POST /api/healing/review': {
      const body = await readJson<{ id: string; action: 'apply' | 'reject' }>(req);
      if (!body.id || !['apply', 'reject'].includes(body.action)) {
        return json(res, 400, { error: 'Healing action không hợp lệ.' });
      }
      const cfg = await loadConfig(CONFIG_FILE);
      const registry = await Registry.load(cfg.paths.registry);
      const healing = await HealingStore.load(cfg.paths.healingDb);
      const record = healing.records().find((item) => item.id === body.id);
      if (!record) return json(res, 404, { error: 'Không tìm thấy đề xuất healing.' });

      if (body.action === 'apply') {
        registry.promoteCandidate(record.elementId, record.platform, record.proposed);
        await registry.save();
        healing.review(body.id, 'applied');
      } else {
        healing.review(body.id, 'rejected');
      }
      await healing.save();
      return json(res, 200, await healingState(cfg));
    }

    // Saving and running are separate on purpose. Generation needs an API key,
    // so without this the only way to persist a test account was to run the
    // whole pipeline — and anyone without a key typed their credentials into a
    // form that silently discarded them.
    case 'POST /api/studio/save': {
      const saved = await applyForm(await readJson<StudioForm>(req));
      const secrets = await Secrets.load();
      return json(res, 200, {
        ok: true,
        accounts: saved.accounts.map((a) => ({ ...a, hasPassword: secrets.has(a.label) })),
      });
    }

    case 'POST /api/gen': {
      const form = await readJson<StudioForm>(req);
      // Persist before streaming: the form is the config, and a run whose inputs
      // were never saved could not be reproduced from a terminal.
      const cfg = await applyForm(form);
      return stream(res, (log, stage) => runWorkflow(cfg, log, stage));
    }

    case 'GET /api/workflow/questions': {
      const runId = url.searchParams.get('runId');
      if (!runId) return json(res, 400, { error: 'Thiếu workflow ID.' });
      const history = await History.load();
      const run = history.find(runId);
      if (!run) return json(res, 404, { error: 'Không tìm thấy workflow.' });
      return json(res, 200, {
        status: run.status,
        questions: run.questions ?? [],
        pending: pendingQuestions(run).length,
      });
    }

    case 'POST /api/workflow/answers': {
      const { runId, answers } = await readJson<{
        runId: string;
        answers: AnswerSubmission[];
      }>(req);
      if (!runId) return json(res, 400, { error: 'Thiếu workflow ID.' });
      const history = await History.load();
      const run = history.find(runId);
      if (!run) return json(res, 404, { error: 'Không tìm thấy workflow.' });
      try {
        const { remaining } = submitAnswers(run, answers ?? []);
        await history.save();
        // Answering is deliberately separate from resuming. The operator may
        // answer half the questions, walk away, and come back; persisting each
        // batch means that work is never lost, and the run only moves when
        // nothing is left open.
        return json(res, 200, { remaining, status: run.status });
      } catch (err) {
        if (err instanceof QuestionError) return json(res, 400, { error: err.message });
        throw err;
      }
    }

    case 'POST /api/workflow/complete': {
      const { runId } = await readJson<{ runId: string }>(req);
      if (!runId) return json(res, 400, { error: 'Thiếu workflow ID.' });
      return stream(res, (log, stage) => continueWorkflow(runId, log, stage));
    }

    case 'POST /api/run': {
      const body = await readJson<{
        platform: string; tag?: string; headed?: boolean;
        includeQuarantined?: boolean; devices?: string[]; env?: string;
      }>(req);
      // Ticked devices arrive qualified as `platform:id`, because an id alone
      // cannot say which phone it means once both platforms are on offer.
      const picked = (body.devices ?? []).map(parseDeviceToken).filter(Boolean) as PickedDevice[];

      // One device is the single-device path, unchanged — not a parallel run of
      // size one, which would suffix its directory and defer its writes for no
      // reason. Only a genuine second device changes how this runs.
      if (picked.length > 1) {
        // The platforms to run are the ones actually ticked, not whatever the
        // Platform select happens to show: the select is only the default for
        // when nothing is ticked at all.
        const platforms = [...new Set(picked.map((d) => d.platform))].join(',');
        const tokens = picked.map((d) => `${d.platform}:${d.id}`);
        return stream(res, (log) =>
          runSuiteParallel(platforms, tokens, body.tag, Boolean(body.includeQuarantined), log, body.env));
      }

      const one = picked[0];
      // A platform with no `devices` list has a single synthesised entry whose
      // id is the platform's own name. Passing `--device` for it would suffix
      // the run directory and gain nothing, so the plain path is used instead.
      const named = one ? await isNamedDevice(one) : false;
      return stream(res, async (log) => {
        await runSuite(
          one?.platform ?? body.platform,
          body.tag,
          Boolean(body.headed),
          Boolean(body.includeQuarantined),
          log,
          named ? one!.id : undefined,
          body.env,
        );
      });
    }

    case 'POST /api/run/stop':
      return json(res, 200, await stopSuite());

    case 'PUT /api/feature': {
      const { filename, content, create, baseRevision } = await readJson<{
        filename: string; content: string; create?: boolean; baseRevision?: string;
      }>(req);
      const cfg = await loadConfig(CONFIG_FILE);
      const name = path.basename(filename);
      if (!/^[\w.-]+\.feature$/.test(name)) return json(res, 400, { error: 'Tên file không hợp lệ' });
      const file = path.resolve(cfg.paths.features, name);
      if (!file.startsWith(path.resolve(cfg.paths.features) + path.sep)) return json(res, 403, { error: 'forbidden' });
      // Saving an edit overwrites by design; creating must not. Without this the
      // endpoint answers "new file called X" and "replace everything in X" the
      // same way, and a name collision silently discards someone's scenarios.
      if (create && existsSync(file)) {
        return json(res, 409, { error: `features/${name} đã tồn tại.` });
      }
      if (!create && baseRevision && existsSync(file)) {
        const current = await readFile(file, 'utf8');
        const currentRevision = featureRevision(current);
        if (currentRevision !== baseRevision) {
          return json(res, 409, {
            error:
              `Kịch bản ${name} đã được workflow hoặc người dùng khác cập nhật. ` +
              'Nội dung cũ không được ghi đè. Hãy đóng editor và mở lại bản mới nhất.',
            revision: currentRevision,
          });
        }
      }
      const normalizedTags = normalizeFeatureTags(content);
      const registry = await Registry.load(cfg.paths.registry);
      // Saving from the business editor is a compile operation, not a raw file
      // write. Resolve natural wording and binding mistakes first so the user
      // never has to understand the controlled vocabulary or registry ids.
      const prepared = await prepareExecutableDraft(normalizedTags.content, registry, {
        model: pickModel(cfg.llm.model),
        uri: file,
        maxRepairs: 2,
      });
      const savedContent = prepared.content.trimEnd() + '\n';
      await registry.save();
      await writeFile(file, savedContent, 'utf8');
      const revision = featureRevision(savedContent);
      // Saving is not approval. New or changed content is pending until the
      // user explicitly accepts that exact hash in Scenario Review.
      const reviews = await ScenarioReviewStore.load(cfg.paths.scenarioReviewDb);
      const review = reviews.syncFile(name, savedContent, {
        defaultStatus: 'pending',
        source: 'manual',
      });
      await reviews.save();

      // Remove pending/rejected scenarios from managed specs immediately. Page
      // methods already learned remain reusable, but no unapproved test may be
      // projected into executable generated specs.
      try {
        const pom = await syncPomProject({
          featuresDir: cfg.paths.features,
          registryPath: cfg.paths.registry,
          scenarioReviewPath: cfg.paths.scenarioReviewDb,
        });
        return json(res, 200, {
          ok: true,
          revision,
          review,
          pom: pom.changes,
          ...(pom.warnings ? { pomWarnings: pom.warnings } : {}),
          content: savedContent,
          tagsNormalized: normalizedTags.changed,
          autoRepaired: prepared.repaired,
        });
      } catch (err) {
        return json(res, 200, {
          ok: true,
          revision,
          review,
          content: savedContent,
          tagsNormalized: normalizedTags.changed,
          autoRepaired: prepared.repaired,
          pomWarning: `Đã lưu feature nhưng chưa đồng bộ POM: ${(err as Error).message}`,
        });
      }
    }

    case 'POST /api/feature/review': {
      const body = await readJson<{
        filename: string;
        scenarioName: string;
        decision: 'approve' | 'reject';
      }>(req);
      if (!body.filename || !body.scenarioName || !['approve', 'reject'].includes(body.decision)) {
        return json(res, 400, { error: 'Quyết định duyệt kịch bản không hợp lệ.' });
      }
      const cfg = await loadConfig(CONFIG_FILE);
      const name = path.basename(body.filename);
      if (!/^[\w.-]+\.feature$/.test(name)) return json(res, 400, { error: 'Tên file không hợp lệ' });
      const file = path.resolve(cfg.paths.features, name);
      if (!file.startsWith(path.resolve(cfg.paths.features) + path.sep) || !existsSync(file)) {
        return json(res, 404, { error: 'Không tìm thấy feature file.' });
      }
      const content = await readFile(file, 'utf8');
      const registry = await Registry.load(cfg.paths.registry);
      // Approval is a stronger gate than saving: the complete file must bind
      // successfully before any one scenario is allowed into execution.
      parseFeature(file, content, registry);
      const reviews = await ScenarioReviewStore.load(cfg.paths.scenarioReviewDb);
      reviews.syncFile(name, content, { defaultStatus: 'pending', source: 'manual' });
      const review = reviews.review(name, body.scenarioName, content, body.decision);
      await reviews.save();
      try {
        const pom = await syncPomProject({
          featuresDir: cfg.paths.features,
          registryPath: cfg.paths.registry,
          scenarioReviewPath: cfg.paths.scenarioReviewDb,
        });
        return json(res, 200, {
          ok: true, review, pom: pom.changes,
          ...(pom.warnings ? { pomWarnings: pom.warnings } : {}),
        });
      } catch (err) {
        // The review decision is already durable and the CLI gate reads it
        // directly. Surface projection trouble as a warning instead of making
        // the UI claim that approval itself failed after it was persisted.
        return json(res, 200, {
          ok: true,
          review,
          pomWarning: `Đã lưu quyết định duyệt nhưng chưa đồng bộ POM: ${(err as Error).message}`,
        });
      }
    }

    /**
     * Gắn hoặc gỡ nhãn Known issue cho một kịch bản.
     *
     * Chỉ con người mới gắn được — không có đường nào cho máy tự gắn, và đó là
     * chủ ý: một nhãn tự động sẽ biến thành cách để suite tự làm mình xanh.
     */
    /**
     * Gắn hoặc gỡ nhãn Known issue cho một kịch bản.
     *
     * Khoá theo `scenarioId`, không theo tên file + tên kịch bản. Lý do rất
     * thực tế: người ta biết một kịch bản là Known issue SAU KHI đọc report,
     * mà report chỉ có id — nó không mang theo tên file. Khoá theo id thì cả
     * bảng Kịch bản lẫn report đều gọi được cùng một endpoint.
     *
     * Chỉ con người mới gắn được — không có đường nào cho máy tự gắn, và đó là
     * chủ ý: một nhãn tự động sẽ biến thành cách để suite tự làm mình xanh.
     */
    case 'POST /api/feature/known-issue': {
      const body = await readJson<{ scenarioId: string; note?: string; remove?: boolean }>(req);
      if (!body.scenarioId) return json(res, 400, { error: 'Thiếu scenarioId.' });

      const cfg = await loadConfig(CONFIG_FILE);
      const known = await KnownIssueStore.load(cfg.paths.knownIssuesDb);
      if (body.remove) {
        const removed = known.unmark(body.scenarioId);
        await known.save();
        return json(res, 200, { ok: true, removed });
      }

      const note = (body.note ?? '').trim();
      if (!note) {
        // Một nhãn không kèm lý do thì năm sau không ai giải thích được vì sao
        // kịch bản này được miễn.
        return json(res, 400, { error: 'Hãy ghi lý do vì sao sản phẩm chưa đáp ứng.' });
      }

      const found = await findScenarioById(cfg, body.scenarioId);
      if (!found) return json(res, 404, { error: 'Không tìm thấy kịch bản nào mang id đó.' });
      const issue = known.mark({
        id: body.scenarioId,
        filename: found.filename,
        scenarioName: found.name,
        contentHash: found.contentHash,
        note,
      });
      await known.save();
      return json(res, 200, { ok: true, issue });
    }

    case 'POST /api/feature/review-bulk': {
      const body = await readJson<{
        items: Array<{ filename: string; scenarioName: string }>;
        decision: 'approve' | 'reject';
      }>(req);
      if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 5_000
          || !['approve', 'reject'].includes(body.decision)) {
        return json(res, 400, { error: 'Danh sách kịch bản cần duyệt không hợp lệ.' });
      }

      const cfg = await loadConfig(CONFIG_FILE);
      const registry = await Registry.load(cfg.paths.registry);
      const reviews = await ScenarioReviewStore.load(cfg.paths.scenarioReviewDb);
      const files = new Map<string, string>();
      const unique = new Map<string, { filename: string; scenarioName: string }>();

      for (const item of body.items) {
        const name = path.basename(item.filename ?? '');
        if (!/^[\w.-]+\.feature$/.test(name) || !item.scenarioName) {
          return json(res, 400, { error: 'Có kịch bản hoặc feature file không hợp lệ.' });
        }
        const file = path.resolve(cfg.paths.features, name);
        if (!file.startsWith(path.resolve(cfg.paths.features) + path.sep) || !existsSync(file)) {
          return json(res, 404, { error: `Không tìm thấy feature file ${name}.` });
        }
        if (!files.has(name)) {
          const content = await readFile(file, 'utf8');
          parseFeature(file, content, registry);
          files.set(name, content);
          reviews.syncFile(name, content, { defaultStatus: 'pending', source: 'manual' });
        }
        unique.set(`${name}::${item.scenarioName}`, { filename: name, scenarioName: item.scenarioName });
      }

      const reviewed = [];
      for (const item of unique.values()) {
        reviewed.push(reviews.review(
          item.filename,
          item.scenarioName,
          files.get(item.filename)!,
          body.decision,
        ));
      }
      await reviews.save();

      try {
        const pom = await syncPomProject({
          featuresDir: cfg.paths.features,
          registryPath: cfg.paths.registry,
          scenarioReviewPath: cfg.paths.scenarioReviewDb,
        });
        return json(res, 200, {
          ok: true, reviewed: reviewed.length, reviews: reviewed, pom: pom.changes,
          ...(pom.warnings ? { pomWarnings: pom.warnings } : {}),
        });
      } catch (err) {
        return json(res, 200, {
          ok: true,
          reviewed: reviewed.length,
          reviews: reviewed,
          pomWarning: `Đã duyệt ${reviewed.length} kịch bản nhưng chưa đồng bộ POM: ${(err as Error).message}`,
        });
      }
    }

    // The cheat sheet shown beside the scenario editor. Generated from the
    // vocabulary and the action registry so it cannot describe a syntax the
    // runner does not accept.
    // Upload a build straight from the machine the browser is on. The config
    // still stores a path — everything downstream (Appium's `app`, the version
    // check, the farm bundler) reads one — but nobody has to know what the path
    // should be, which is the part that was unanswerable from the UI.
    case 'POST /api/app/upload': {
      const platform = url.searchParams.get('platform') ?? '';
      if (platform !== 'android' && platform !== 'ios') {
        return json(res, 400, { error: 'platform phải là android hoặc ios.' });
      }
      const requested = url.searchParams.get('filename') ?? '';
      const name = safeBuildName(requested, platform);
      if (!name) return json(res, 400, { error: rejectedBuildReason(requested, platform) });

      // An environment's build is parked in its own subdirectory. Without that,
      // a SIT ipa exported under the same name as the prod one — which is the
      // normal case, since they are the same app — would overwrite the prod
      // build sitting at the path the base config points at.
      const envDir = safeEnvSegment(url.searchParams.get('env') ?? '');
      if (url.searchParams.has('env') && !envDir) {
        return json(res, 400, { error: 'Tên môi trường không hợp lệ.' });
      }
      const dir = envDir ? path.resolve('build', envDir) : path.resolve('build');
      await mkdir(dir, { recursive: true });
      // Written under a temporary name first: an upload that dies halfway
      // would otherwise leave a truncated apk sitting at the path the config
      // points at, and Appium's failure would say nothing about why.
      const temp = path.join(dir, `.upload-${Date.now()}-${name}`);
      try {
        await pipeline(req, createWriteStream(temp));
      } catch (err) {
        await rm(temp, { force: true });
        return json(res, 500, { error: `Tải lên thất bại: ${uploadError(err)}` });
      }
      const written = await stat(temp);
      if (written.size === 0) {
        await rm(temp, { force: true });
        return json(res, 400, { error: 'File rỗng.' });
      }
      await rename(temp, path.join(dir, name));

      const rel = envDir ? path.posix.join('build', envDir, name) : path.posix.join('build', name);
      // Read for every build, not just the farm's: knowing which version is on
      // the phone is what turns "it worked yesterday" into a question with an
      // answer, and Device Farm labels its runs with it.
      const version = await readAppVersion(path.join(dir, name));
      // Whether the config is written depends on who is asking. The
      // environments editor is an unsaved form, so an upload from there returns
      // a path and lets the form own it — writing would half-save edits nobody
      // asked to save. The build screen has no form, so it says `persist`, and
      // an upload there is finished when it finishes.
      const persist = !envDir || url.searchParams.get('persist') === '1';
      if (persist) {
        const cfg = await loadConfig(CONFIG_FILE);
        if (envDir) {
          // `accounts` is required on an environment, so a row created by an
          // upload starts with none rather than being invalid.
          const env = cfg.environments[envDir] ?? { accounts: {} };
          cfg.environments[envDir] = {
            ...env,
            [platform]: { ...(platform === 'android' ? env.android : env.ios), app: rel },
          };
        } else {
          cfg[platform].app = rel;
        }
        // Kept beside the farm's other run metadata, which is where the run
        // name and the AWS console label are read from.
        cfg.farm.appVersionName = version.versionName ?? '';
        cfg.farm.appVersionCode = version.versionCode ?? '';
        cfg.farm.appLabel = version.appLabel ?? '';
        await saveConfig(cfg, CONFIG_FILE);
      }
      return json(res, 200, {
        path: rel,
        sizeMb: Math.round(written.size / 1024 / 1024),
        size: written.size,
        ...version,
      });
    }

    case 'GET /api/vocabulary': {
      const cfg = await loadConfig(CONFIG_FILE);
      const [registry, actions] = await Promise.all([
        Registry.load(cfg.paths.registry),
        ActionRegistry.load(cfg.paths.actionsDb),
      ]);
      return json(res, 200, {
        forms: STEP_RULES.map((rule) => ({
          id: rule.id,
          group: rule.group,
          doc: rule.doc,
          hint: rule.hint,
        })),
        actions: actions
          .list()
          .filter((action) => action.status === 'approved')
          .map((action) => ({
            id: action.id,
            label: action.label,
            phraseTemplate: action.phraseTemplate,
            parameters: action.parameters,
          })),
        elements: Object.values(registry.raw.elements)
          .map((el) => ({ id: el.id, label: el.label, screen: el.screen }))
          .sort((a, b) => a.screen.localeCompare(b.screen) || a.label.localeCompare(b.label)),
      });
    }

    case 'POST /api/feature/normalize': {
      const { content } = await readJson<{ content: string }>(req);
      const cfg = await loadConfig(CONFIG_FILE);
      const registry = await Registry.load(cfg.paths.registry);
      const actions = await ActionRegistry.load(cfg.paths.actionsDb);
      return json(res, 200, await normalizeFeatureDraft(content, registry, actions, pickModel(cfg.llm.model)));
    }

    case 'GET /api/actions': {
      const cfg = await loadConfig(CONFIG_FILE);
      const actions = await ActionRegistry.load(cfg.paths.actionsDb);
      return json(res, 200, { actions: actions.list() });
    }

    case 'POST /api/actions/review': {
      const body = await readJson<{ id: string; decision: 'approve' | 'reject' }>(req);
      if (!body.id || !['approve', 'reject'].includes(body.decision)) {
        return json(res, 400, { error: 'Quyết định action không hợp lệ.' });
      }
      const cfg = await loadConfig(CONFIG_FILE);
      const actions = await ActionRegistry.load(cfg.paths.actionsDb);
      const action = actions.review(body.id, body.decision);
      await actions.save();
      return json(res, 200, { action, actions: actions.list() });
    }

    case 'GET /api/builds':
      return json(res, 200, await buildInventory(await loadConfig(CONFIG_FILE)));

    /**
     * Nội dung log của một lượt chạy, lấy riêng khi người dùng bung nó ra.
     *
     * Tách khỏi /api/state vì log là thứ dài nhất mà lại ít được xem nhất: gửi
     * kèm nghĩa là trả giá cho nó sau mỗi thao tác trên trang, cho mọi lượt chạy.
     */
    case 'GET /api/run/log': {
      const id = url.searchParams.get('id') ?? '';
      const cfg = await loadConfig(CONFIG_FILE);
      // Id đi thẳng vào đường dẫn file, nên phải chặn ../ trước khi chạm đĩa.
      const dir = path.resolve(cfg.paths.runs, id);
      if (!id || !dir.startsWith(path.resolve(cfg.paths.runs) + path.sep)) {
        return json(res, 400, { error: 'Run id không hợp lệ.' });
      }
      const file = path.join(dir, 'log.txt');
      if (!existsSync(file)) return json(res, 404, { error: 'Lượt chạy này không có log.' });
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(await readFile(file, 'utf8'));
      return;
    }

    case 'GET /api/preflight': {
      // Asked from the Studio the moment a platform is ticked, so the answer
      // arrives while the choice is still being made rather than half an hour
      // later when the run reaches its first step.
      const asked = url.searchParams.get('platform');
      const platform = asked === 'android' || asked === 'ios' || asked === 'web' ? asked : 'web';
      return json(
        res,
        200,
        await preflight(platform, await loadConfig(CONFIG_FILE), url.searchParams.get('device') ?? undefined),
      );
    }

    /* ---- AWS Device Farm ---- */

    case 'POST /api/aws/login':
      // Streamed: `aws login` prints a URL and then waits for a human, so the
      // useful part is the output as it arrives, not the exit code.
      return stream(res, (log) => awsLogin(region(url), log));

    case 'GET /api/aws':
      return json(res, 200, await awsStatus(region(url)));

    case 'GET /api/farm/projects':
      return json(res, 200, await guarded(() => listProjects(region(url))));

    case 'GET /api/farm/pools':
      return json(
        res,
        200,
        await guarded(() => listDevicePools(region(url), url.searchParams.get('projectArn') ?? '')),
      );

    case 'GET /api/farm/devices': {
      const platform = url.searchParams.get('platform') === 'ios' ? 'ios' : 'android';
      return json(res, 200, await guarded(() => listDevices(region(url), platform)));
    }

    case 'POST /api/farm/pool': {
      const body = await readJson<{
        region: string;
        projectArn: string;
        name: string;
        deviceArns: string[];
      }>(req);
      return json(
        res,
        200,
        await guarded(() =>
          createDevicePool(body.region, body.projectArn, body.name, body.deviceArns),
        ),
      );
    }

    case 'POST /api/farm/run': {
      const body = await readJson<FarmForm>(req);
      const saved = await applyFarmForm(body);
      // Reject an incomplete form as a 400 before a run exists, rather than
      // recording a history entry whose first stage "failed" for no real reason.
      let cfg: TestPilotConfig;
      try {
        // Same resolution the workflow handoff uses, so both routes take the
        // build from one place. Without this the tab kept its own `appPath`
        // and the two could disagree about what "the build" is.
        const target = resolveFarmTarget(saved, saved.farm.platform);
        cfg = { ...saved, farm: { ...saved.farm, ...target } };
        assertFarmReady(cfg.farm);
      } catch (err) {
        return json(res, 400, { error: (err as Error).message });
      }
      // The id is only useful to a workflow that handed off; this endpoint
      // streams the run itself, so it is dropped here.
      return stream(res, async (log, stage) => {
        await runOnFarm(cfg, Boolean(body.bundle), log, stage);
      });
    }

    case 'POST /api/prereq/appium':
      return stream(res, (log) => prereqAppium(log));

    case 'POST /api/prereq/appium/restart':
      return stream(res, (log) => restartAppium(log));

    case 'GET /api/prereq/appium/status':
      return json(res, 200, await prereqAppiumStatus());

    case 'GET /api/prereq/adb':
      return json(res, 200, await prereqAdb());

    case 'GET /api/prereq/xcode':
      return json(res, 200, await prereqXcode());

    case 'GET /api/prereq/ios-devices':
      return json(res, 200, await prereqIosDevices());

    case 'POST /api/prereq/driver': {
      const { driver } = await readJson<{ driver: string }>(req);
      return stream(res, (log) => prereqInstallDriver(driver, log));
    }
  }

  // A run directory holds its own screenshots and videos, so serving `runs`
  // is enough for a current report. `reports` and `artifacts` stay reachable
  // for runs recorded under the old per-platform layout.
  for (const dir of ['runs', 'reports', 'artifacts'] as const) {
    if (req.method === 'GET' && url.pathname.startsWith(`/${dir}/`)) {
      const root = path.resolve(dir);
      const file = path.resolve(root, url.pathname.replace(new RegExp(`^/${dir}/+`), ''));
      if (!file.startsWith(root + path.sep)) return json(res, 403, { error: 'forbidden' });
      return serveFile(res, file, req.headers.range);
    }
  }

  if (req.method === 'GET') {
    if (!existsSync(PUBLIC_DIR)) {
      return json(res, 503, { error: 'Chưa build UI. Chạy `npm run ui:build`.' });
    }
    const rel = url.pathname.replace(/^\/+/, '');
    const file = path.resolve(PUBLIC_DIR, rel || 'index.html');
    if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) {
      return json(res, 403, { error: 'forbidden' });
    }
    if (rel && existsSync(file) && statSync(file).isFile()) return serveFile(res, file, req.headers.range);
    // SPA fallback cho route React. Asset thiếu vẫn trả 404 JSON để browser
    // không cố parse index.html thành JavaScript.
    if (path.extname(rel)) return json(res, 404, { error: `Not found: ${rel}` });
    return serveFile(res, path.join(PUBLIC_DIR, 'index.html'));
  }
  json(res, 404, { error: `No route for ${route}` });
}

/* ------------------------------------------------------------------ */
/* Handlers                                                            */
/* ------------------------------------------------------------------ */

async function state(): Promise<StateResponse> {
  let config: TestPilotConfig;
  let configError: string | null = null;
  try {
    config = await loadConfig(CONFIG_FILE);
  } catch (err) {
    configError = (err as Error).message;
    // An unconfigured install should still render the UI, with defaults filled in.
    config = ConfigSchema.parse({ web: { baseUrl: 'https://example.com' } });
  }

  const features = await listFeatures(config);
  const elements = await countElements(config);
  const reports = await listReports(config);
  const secrets = await Secrets.load();

  return {
    config,
    configError,
    configFile: path.resolve(CONFIG_FILE),
    features,
    elements,
    reports,
    runs: await recentRuns(),
    // Passwords are never sent to the browser — only the fact that one exists,
    // so the field can render a "đã lưu" placeholder instead of looking empty.
    accounts: config.accounts.map((a) => ({ ...a, hasPassword: secrets.has(a.label) })),
    hasApiKey: llmAvailable(),
    modelKeys: {
      deepseek: Boolean(secrets.apiKey('DEEPSEEK_API_KEY') || process.env.DEEPSEEK_API_KEY),
      gemini: Boolean(
        secrets.apiKey('GEMINI_API_KEY') ||
        process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_API_KEY
      ),
      anthropic: Boolean(secrets.apiKey('ANTHROPIC_API_KEY') || process.env.ANTHROPIC_API_KEY),
    },
    appBuilds: {
      android: await describeBuild(config.android.app),
      ios: await describeBuild(config.ios.app),
    },
    // Keyed by udid. Lets the run card warn before a run that the handset is
    // holding another environment's build, instead of after it fails at login.
    deviceEnv: (await DeviceEnvLog.load(config.paths.deviceEnvDb)).all(),
    // The build each environment resolves to, already merged. The run card
    // reports on the selected environment's package rather than on the base
    // config's, which is only ever the default environment's.
    envBuilds: await envBuilds(config),
    tagTaxonomy: tagTaxonomyView(),
  };
}

/** Per environment, whether its android/ios package is actually on disk. */
async function envBuilds(
  cfg: TestPilotConfig,
): Promise<Record<string, { android: Build; ios: Build }>> {
  const out: Record<string, { android: Build; ios: Build }> = {};
  for (const [name, override] of Object.entries(cfg.environments)) {
    const { config: merged } = applyEnv(cfg, name);
    // `own` separates "this environment has a build" from "this environment
    // inherited the default one". On disk they look identical — the inherited
    // file exists and reports its size — but the runner refuses to start on the
    // second, so the card must not show it as ready.
    out[name] = {
      android: withOwn(await describeBuild(merged.android.app), Boolean(override.android?.app)),
      ios: withOwn(await describeBuild(merged.ios.app), Boolean(override.ios?.app)),
    };
  }
  return out;
}

/**
 * Whether a configured local build actually exists, and how big it is.
 *
 * Reported from the config rather than from a path the browser sends, so no
 * request can ask this server about an arbitrary file. A missing build is worth
 * saying out loud: Appium fails on it minutes into a run, long after the typo.
 */


const withOwn = (build: Build, own: boolean): Build => (build ? { ...build, own } : build);

async function describeBuild(rel: string | undefined): Promise<Build> {
  if (!rel) return null;
  try {
    const info = await stat(path.resolve(rel));
    return { path: rel, exists: true, sizeMb: Math.round(info.size / 1024 / 1024) };
  } catch {
    return { path: rel, exists: false };
  }
}

async function healingState(cfg: TestPilotConfig): Promise<HealingResponse> {
  const healing = await HealingStore.load(cfg.paths.healingDb);
  const imported = await healing.backfill(cfg.paths.runs);
  if (imported > 0) await healing.save();
  const registry = await Registry.load(cfg.paths.registry);
  const records = healing.records().map((record) => ({
    ...record,
    // `current` in healing telemetry is a historical snapshot: the candidate
    // that failed when this event happened. Expose today's actual primary
    // separately so the review table never presents the snapshot as live state.
    primary: registry.raw.elements[record.elementId]?.candidates[record.platform]?.[0] ?? null,
    quality: assessLocatorQuality(record.proposed),
  }));
  return {
    policy: { minSuccesses: 3, minRuns: 2 },
    records,
    summary: {
      total: records.length,
      proposed: records.filter((item) => item.status === 'proposed').length,
      watching: records.filter((item) => item.status === 'watching').length,
      applied: records.filter((item) => item.status === 'applied').length,
      rejected: records.filter((item) => item.status === 'rejected').length,
    },
  };
}

interface FeatureCoverageRecord {
  version: number;
  featureFile: string;
  generatedAt: string;
  repaired?: boolean;
  sourceUnits?: number;
  classifiedSources?: number;
  requirements: CoverageRequirement[];
  audit: CoverageAudit;
  auditedAt?: string;
}

function featureCoveragePath(cfg: TestPilotConfig, filename: string): string {
  return path.join(path.dirname(cfg.paths.scenarioReviewDb), 'coverage', `${path.basename(filename)}.json`);
}

async function readFeatureCoverage(
  cfg: TestPilotConfig,
  filename: string,
): Promise<FeatureCoverageRecord | null> {
  const file = featureCoveragePath(cfg, filename);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as FeatureCoverageRecord;
    if (!Array.isArray(parsed.requirements) || !parsed.audit?.mappings) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function saveFeatureCoverageAudit(
  cfg: TestPilotConfig,
  record: FeatureCoverageRecord,
  audit: CoverageAudit,
): Promise<void> {
  const file = featureCoveragePath(cfg, record.featureFile);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    JSON.stringify({ ...record, audit, auditedAt: new Date().toISOString() }, null, 2) + '\n',
    'utf8',
  );
}

function coverageView(record: FeatureCoverageRecord | null) {
  if (!record) return null;
  const missingIds = new Set(record.audit.missingRequirementIds);
  const missing = record.requirements
    .filter((requirement) => missingIds.has(requirement.id))
    .map((requirement) => ({
      id: requirement.id,
      priority: requirement.priority,
      rule: requirement.rule,
      sourceQuote: requirement.sourceQuote,
    }));
  return {
    decision: record.audit.decision,
    total: record.requirements.length,
    covered: record.requirements.length - missing.length,
    missing,
    auditedAt: record.auditedAt ?? record.generatedAt,
  };
}

/**
 * Tìm một kịch bản theo id, trả về kèm tên file và hash nội dung hiện tại.
 *
 * Id là khoá duy nhất đi xuyên toàn hệ thống — report, registry, POM đều dùng
 * nó — nên đây là chỗ duy nhất cần biết id nằm trong file nào.
 */
async function findScenarioById(
  cfg: TestPilotConfig,
  scenarioId: string,
): Promise<{ filename: string; name: string; contentHash: string } | null> {
  if (!existsSync(cfg.paths.features)) return null;
  const files = (await readdir(cfg.paths.features)).filter((f) => f.endsWith('.feature')).sort();
  const registry = await Registry.load(cfg.paths.registry);
  for (const filename of files) {
    const uri = path.join(cfg.paths.features, filename);
    const content = await readFile(uri, 'utf8');
    try {
      const spec = parseFeature(uri, content, registry);
      const scenario = spec.scenarios.find((item) => item.id === scenarioId);
      if (!scenario) continue;
      const block = scenarioBlocks(content).find((b) => b.name === scenario.name);
      if (!block) return null;
      return { filename, name: scenario.name, contentHash: block.contentHash };
    } catch {
      // File không parse được thì bỏ qua: nó đã hiện lỗi ở chỗ khác rồi.
    }
  }
  return null;
}

async function listFeatures(cfg: TestPilotConfig) {
  if (!existsSync(cfg.paths.features)) return [];
  const files = (await readdir(cfg.paths.features)).filter((f) => f.endsWith('.feature')).sort();
  const registry = await Registry.load(cfg.paths.registry);
  const reviews = await ScenarioReviewStore.load(cfg.paths.scenarioReviewDb);
  const known = await KnownIssueStore.load(cfg.paths.knownIssuesDb);
  const result = await Promise.all(
    files.map(async (name) => {
      const uri = path.join(cfg.paths.features, name);
      const content = await readFile(uri, 'utf8');
      const coverage = coverageView(await readFeatureCoverage(cfg, name));
      try {
        const spec = parseFeature(uri, content, registry);
        // One-time backwards-compatible migration: scenarios that predate the
        // review store stay approved. All subsequent edits change their hash
        // and therefore become pending.
        const review = reviews.syncFile(name, content, {
          defaultStatus: 'approved',
          source: 'legacy',
        });
        const byName = new Map(review.map((item) => [item.scenarioName, item]));
        // Hash của từng khối, để biết nhãn Known issue còn hiệu lực hay đã cũ.
        const hashes = new Map(scenarioBlocks(content).map((b) => [b.name, b.contentHash]));
        return {
          name,
          content,
          revision: featureRevision(content),
          feature: spec.name,
          background: spec.background.map((s) => `${s.keyword} ${s.text}`),
          scenarios: spec.scenarios.map((s) => ({
            id: s.id,
            name: s.name,
            tags: s.tags,
            platforms: s.platforms,
            steps: s.steps.length,
            review: byName.get(s.name) ?? null,
            // Nhãn chỉ được coi là còn hiệu lực khi nội dung chưa đổi; nếu đã
            // đổi thì trả về `stale` để màn hình mời người ta xem lại thay vì
            // lặng lẽ bỏ nhãn.
            knownIssue: known.active(s.id, hashes.get(s.name) ?? '') ?? null,
            knownIssueStale: Boolean(known.stale(s.id, hashes.get(s.name) ?? '')),
          })),
          coverage,
          error: null as string | null,
        };
      } catch (err) {
        // Show the file anyway — a binding error is exactly what needs fixing.
        return {
          name,
          content,
          revision: featureRevision(content),
          feature: name,
          scenarios: [],
          coverage,
          error: (err as Error).message,
        };
      }
    }),
  );
  await reviews.save();
  return result;
}

function featureRevision(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

async function countElements(cfg: TestPilotConfig): Promise<number> {
  const registry = await Registry.load(cfg.paths.registry);
  return Object.keys(registry.raw.elements).length;
}

/**
 * Every run, newest first — not one report per platform.
 *
 * The old version listed `reports/<platform>/index.html`, which could only ever
 * describe the most recent run of each platform because that path is fixed.
 * With hundreds of runs the interesting question is "what happened on the run
 * that failed", so the list is the runs themselves.
 */
/**
 * Số lượt chạy trả về cho màn hình.
 *
 * Bằng MAX_RUNS của lịch sử workflow, vì cùng một lý do: danh sách này chỉ dài
 * thêm chứ không bao giờ ngắn đi, và nó được gửi lại sau MỖI thao tác trên
 * trang. Ai cần xa hơn thì mở thư mục runs/.
 */
const MAX_REPORTS = 50;

async function listReports(cfg: TestPilotConfig) {
  const runs = await listRuns(cfg.paths.runs);
  return Promise.all(
    runs
      .filter((r) => existsSync(path.join(cfg.paths.runs, r.id, 'index.html')))
      .slice(0, MAX_REPORTS)
      .map(async (r) => {
        const runDir = path.join(cfg.paths.runs, r.id);

        // Chỉ nói CÓ log hay không, không gửi kèm nội dung.
        //
        // Log của một lượt chạy farm dài hàng nghìn dòng, và trước đây mọi lượt
        // chạy đều mang trọn log của mình trong mỗi lần gọi /api/state — tức là
        // sau mỗi thao tác trên trang, cho một thứ mà người dùng chỉ mở ra xem
        // khi có chuyện. Nội dung lấy riêng qua /api/run/log khi bung ra.
        const hasLog = existsSync(path.join(runDir, 'log.txt'));

        const videoDir = path.join(runDir, 'artifacts', 'video');
        const videoFiles = existsSync(videoDir)
          ? (await readdir(videoDir)).filter((f) => /\.(mp4|webm)$/i.test(f))
          : [];
        const videoUrls = videoFiles.map(
          (f) => `/${cfg.paths.runs}/${r.id}/artifacts/video/${f}`,
        );
        // Every screenshot the run produced, whichever way it was produced.
        // The rendered report only ever shows the one attached to a failed
        // step, so a passing run's `take a screenshot` output existed on disk
        // and appeared nowhere at all.
        const shotDir = path.join(runDir, 'artifacts');
        const shotUrls = existsSync(shotDir)
          ? (await readdir(shotDir))
              .filter((f) => /\.png$/i.test(f))
              .sort()
              .map((f) => ({
                name: f.replace(/\.png$/i, ''),
                url: `/${cfg.paths.runs}/${r.id}/artifacts/${f}`,
                // A failure shot is named by the executor, not by a step.
                onFailure: /-a\d+-l\d+-fail$/.test(f.replace(/\.png$/i, '')),
              }))
          : [];

        // The same two numbers the generated report uses to open a recording at
        // the moment the test starts and to list where each scenario sits in
        // it. Sent alongside the urls so the UI's players behave like the
        // report's instead of dropping the reader at second zero of an install.
        // Only a whole-job recording has an install phase to skip and several
        // scenarios to index; a per-scenario clip starts at its own beginning.
        const wholeVideoUrls = videoUrls.filter(isWholeRunRecording);
        const [chapters, testSeconds] = wholeVideoUrls.length > 0
          ? await Promise.all([chaptersOf(runDir), testWindowSeconds(runDir)])
          : [[], undefined];

        // Served rather than inlined: a busy scenario writes hundreds of lines,
        // and /api/state is fetched on every refresh by every open tab.
        const networkLog = path.join(runDir, 'artifacts', 'network.log');
        const networkLogUrl = existsSync(networkLog)
          ? `/${cfg.paths.runs}/${r.id}/artifacts/network.log`
          : null;

        return {
          id: r.id,
          networkLogUrl,
          ...(shotUrls.length > 0 ? { shotUrls } : {}),
          platform: r.platform,
          status: r.status,
          kind: r.kind,
          startedAt: r.startedAt,
          ...(r.finishedAt ? { finishedAt: r.finishedAt } : {}),
          ...(r.device ? { device: r.device } : {}),
          ...(r.tag ? { tag: r.tag } : {}),
          ...(r.counters ? { counters: r.counters } : {}),
          url: `/${[cfg.paths.runs, r.id, 'index.html'].join('/')}`,
          hasLog,
          ...(videoUrls.length > 0 ? { videoUrls } : {}),
          ...(wholeVideoUrls.length > 0 ? { wholeVideoUrls } : {}),
          ...(chapters.length > 0 ? { chapters } : {}),
          ...(testSeconds !== undefined ? { testSeconds } : {}),
        };
      }),
  );
}

async function mcpTools(cfg: unknown) {
  const bridge = await McpBridge.connect(cfg as Parameters<typeof McpBridge.connect>[0]);
  try {
    const tools = await bridge.listTools();
    return { tools, guess: guessToolNames(tools) };
  } finally {
    await bridge.close().catch(() => {});
  }
}

async function models() {
  const result = await listModels();
  // The browser shows what "auto" resolves to, which depends on the keys this
  // server has, not on a constant the page could hardcode.
  const auto = pickModel('auto');
  if (result.models.length > 0) return { ...result, auto };
  // A key exists but the list did not arrive: guessing is better than nothing,
  // because those models are the ones the key can actually run.
  if (llmAvailable()) return { ...result, auto, models: FALLBACK_MODELS };
  return { ...result, auto, reason: result.reason ?? missingKeyHint() };
}

/**
 * Worked examples for the normalizer prompt.
 *
 * The rules alone leave too much room: a model happily answers
 * `I tap "Đăng nhập" button`, which reads fine and matches no executable form.
 * Showing the shape is what stops that, so each example is a full request and
 * the exact reply it should produce — including the ones where the right answer
 * is to propose a macro, or to return nothing at all.
 */
const NORMALIZE_EXAMPLES: Array<{
  in: { unresolved: Array<{ line: number; text: string }>; registry: Array<{ id: string; label: string }> };
  out: unknown;
}> = [
  {
    // The label is copied verbatim — no "button" appended, nothing translated.
    in: {
      unresolved: [{ line: 4, text: 'bấm vào nút Đăng nhập' }],
      registry: [{ id: 'login.submit', label: 'Nút đăng nhập' }],
    },
    out: {
      replacements: [{
        line: 4,
        step: 'I tap "Nút đăng nhập"',
        reason: 'Bấm nút = tap',
      }],
      actionProposals: [],
    },
  },
  {
    // Values stay exactly as written, placeholders included.
    in: {
      unresolved: [{ line: 5, text: 'gõ {{account.tcbs.username}} vào ô tài khoản' }],
      registry: [{ id: 'login.usernameField', label: 'Ô tên đăng nhập' }],
    },
    out: {
      replacements: [{
        line: 5,
        step: 'I enter "{{account.tcbs.username}}" into "Ô tên đăng nhập"',
        reason: 'Gõ vào ô nhập = enter into',
      }],
      actionProposals: [],
    },
  },
  {
    in: {
      unresolved: [{ line: 6, text: 'chọn Ký quỹ ở dropdown Tiểu khoản' }],
      registry: [{ id: 'home.tieuKhoan', label: 'Tiểu khoản' }],
    },
    out: {
      replacements: [{
        line: 6,
        step: 'I select "Ký quỹ" from "Tiểu khoản"',
        reason: 'Chọn giá trị trong dropdown = select from',
      }],
      actionProposals: [],
    },
  },
  {
    in: {
      unresolved: [{ line: 7, text: 'màn hình phải hiện Tổng tài sản' }],
      registry: [{ id: 'home.tongTaiSan', label: 'Tổng tài sản' }],
    },
    out: {
      replacements: [{
        line: 7,
        step: '"Tổng tài sản" is visible',
        reason: 'Kiểm tra hiển thị',
      }],
      actionProposals: [],
    },
  },
  {
    // No element in the registry carries this meaning, so nothing is invented:
    // the line comes back untouched and stays visible to the reviewer.
    in: {
      unresolved: [{ line: 8, text: 'kiểm tra số dư đúng như trong core banking' }],
      registry: [{ id: 'home.tongTaiSan', label: 'Tổng tài sản' }],
    },
    out: { replacements: [], actionProposals: [] },
  },
  {
    // Several operations in one sentence: a macro, never a lossy single step.
    in: {
      unresolved: [{ line: 9, text: 'tìm kiếm "Tài sản của tôi"' }],
      registry: [
        { id: 'home.searchButton', label: 'Nút tìm kiếm' },
        { id: 'home.searchInput', label: 'Ô tìm kiếm' },
        { id: 'home.firstResult', label: 'Kết quả tìm kiếm đầu tiên' },
      ],
    },
    out: {
      replacements: [],
      actionProposals: [{
        line: 9,
        label: 'Tìm kiếm',
        kind: 'macro',
        phraseTemplate: 'I search for "{{keyword}}"',
        parameters: [{ name: 'keyword', example: 'Tài sản của tôi' }],
        expansion: [
          'I tap "Nút tìm kiếm"',
          'I enter "{{keyword}}" into "Ô tìm kiếm"',
          'I wait for "Kết quả tìm kiếm đầu tiên"',
        ],
        postcondition: '"Kết quả tìm kiếm đầu tiên" is visible',
        reason: 'Một câu gộp ba thao tác',
      }],
    },
  },
];

/**
 * Kết quả chuẩn hoá, đúng hình dạng mà trình duyệt nhận.
 *
 * Lấy thẳng từ contracts thay vì khai lại: hai bản khai song song là cách một
 * field bị đổi ở đây mà giao diện vẫn tưởng nó còn nguyên.
 */
type DraftNormalization = FeatureNormalizeResponse & { scenarioPlan: ScenarioPlan }

/**
 * Converts editor-friendly wording into the small executable language. The
 * deterministic rules still handle common phrasing locally, but the semantic
 * planner reads the whole scenario first. Any unresolved syntax is then
 * normalized and re-bound against the actual registry before it is returned.
 */
async function normalizeFeatureDraft(
  content: string,
  registry: Registry,
  actions: ActionRegistry,
  model: string,
): Promise<DraftNormalization> {
  const scenarioPlan = await compileScenarioPlan(content, model);
  const planned = applyScenarioPlan(content, scenarioPlan);
  const learned = expandApprovedActions(planned.content, actions);
  let result = normalizeNaturalSteps(learned.content);
  const changes = [...planned.changes, ...learned.changes, ...result.changes];
  let usedAi = scenarioPlan.source === 'ai';
  const actionProposals: LearnedActionDef[] = [];
  const aiAvailable = llmAvailable();

  // Never send a password/token-bearing step to an external model. Those lines
  // remain visible to the reviewer as unresolved and can be edited locally.
  const aiCandidates = result.unresolved.filter((item) => !isSensitiveStep(item.text));
  if (aiCandidates.length > 0 && aiAvailable) {
    const candidates = Object.values(registry.raw.elements).map((el) => ({ id: el.id, label: el.label }));
    const text = await completeJson({
      model,
      maxTokens: 1_200,
      system: [
        'You normalize human-authored Gherkin steps for a test runner.',
        'Return JSON only with this shape: {"replacements":[{"line":number,"step":string,"reason":string}],"actionProposals":[{"line":number,"label":string,"kind":"alias"|"macro"|"primitive","phraseTemplate":string,"parameters":[{"name":string,"example":string}],"expansion":string[],"postcondition":string,"reason":string}]}.',
        'Replace only the supplied unresolved lines. Keep values and quoted element references intact.',
        'Use replacements only when one existing action expresses the exact meaning.',
        'When the meaning requires several operations, propose a reusable macro instead of silently dropping behavior.',
        'A macro phraseTemplate replaces variable values with {{camelCaseParameter}} and expansion reuses those placeholders.',
        'Every macro needs a postcondition that proves its result. All expansion and postcondition lines must use the executable forms below.',
        'Executable forms, one per line — a step must match one of them exactly:',
        vocabularyDoc(),
        'Never add a word that no form contains, such as "button", "field", "icon" or "screen".',
        'Never translate: the input is Vietnamese, the step keywords stay English and the quoted element stays exactly as the registry spells it, diacritics and capitalisation included.',
        'Prefer an exact element id or label from the registry below when one expresses the same business target.',
        'If the source clearly names a UI target that is not in the registry, preserve only that user-visible business phrase as the quoted <element>. Do not invent a button type, selector, test id, screen hierarchy, position, or implementation detail. The runtime Playwright discovery will resolve this selector-less logical element from the live DOM.',
        'If the source does not identify even a semantic target or a safe postcondition, omit that line — unresolved is better than guessing.',
        'Use kind=primitive only when the requested interaction cannot be composed from the executable forms. Primitive proposals cannot be approved until a driver adapter exists.',
        'Worked examples. Each pair is a full request and the exact reply it must produce:',
        ...NORMALIZE_EXAMPLES.map(
          (example) => `IN ${JSON.stringify(example.in)}\nOUT ${JSON.stringify(example.out)}`,
        ),
      ].join('\n'),
      user: JSON.stringify({
        unresolved: aiCandidates,
        registry: candidates,
      }),
    });
    const parsed = safeJson<{
      replacements?: Array<{ line?: number; step?: string; reason?: string }>;
      actionProposals?: Array<{
        line?: number;
        label?: string;
        kind?: LearnedActionKind;
        phraseTemplate?: string;
        parameters?: Array<{ name?: string; example?: string }>;
        expansion?: string[];
        postcondition?: string;
        reason?: string;
      }>;
    }>(text);
    const replacements = parsed?.replacements ?? [];
    if (replacements.length > 0) {
      const lines = result.content.split('\n');
      for (const replacement of replacements) {
        const index = Number(replacement.line) - 1;
        const oldLine = lines[index];
        if (!oldLine || !replacement.step) continue;
        const match = oldLine.match(/^(\s*(?:Given|When|Then|And|But)\s+).+$/i);
        if (!match) continue;
        lines[index] = `${match[1]}${replacement.step.trim()}`;
        changes.push({
          line: replacement.line!,
          from: oldLine.trim(),
          to: lines[index]!.trim(),
          reason: replacement.reason?.trim() || 'AI chuẩn hoá câu tự nhiên',
        });
      }
      result = normalizeNaturalSteps(lines.join('\n'));
      changes.push(...result.changes);
      usedAi = true;
    }
    for (const proposal of parsed?.actionProposals ?? []) {
      const source = result.unresolved.find((item) => item.line === proposal.line)?.text;
      if (!source || !proposal.label || !proposal.phraseTemplate || !proposal.kind) continue;
      const candidate = actions.propose({
        label: proposal.label.trim(),
        kind: proposal.kind,
        phraseTemplate: proposal.phraseTemplate.trim(),
        parameters: (proposal.parameters ?? [])
          .filter((param) => param.name && param.example !== undefined)
          .map((param) => ({ name: param.name!.trim(), example: param.example!.trim() })),
        expansion: (proposal.expansion ?? []).map((step) => step.trim()).filter(Boolean),
        ...(proposal.postcondition?.trim() ? { postcondition: proposal.postcondition.trim() } : {}),
        ...(proposal.reason?.trim() ? { reason: proposal.reason.trim() } : {}),
        sourceExample: source,
      });
      if (candidate.status === 'proposed') actionProposals.push(candidate);
    }
    if (actionProposals.length > 0) {
      usedAi = true;
      await actions.save();
    }
  }

  // A semantic sentence may be split into “focus this region” + action while
  // the preceding natural sentence normalizes to the same focus. Keep one
  // anchor only; duplicate anchors add no execution value and make the editor
  // look as if AI invented an extra business step.
  const compacted = collapseDuplicateFocusRegions(result.content);
  if (compacted !== result.content) result = normalizeNaturalSteps(compacted);

  // Missing logical elements are accepted here without inventing selectors.
  // Playwright/CDP discovers and verifies the real locator when this step is
  // reached on the live screen, then the run persists it for later reuse.
  let pending = registerMissingElementIntents(result.content, registry);
  if (pending.length > 0) await registry.save();

  let validation = validateScenarioDraft(result.content, registry);
  // The editor and workflow now share the same last-mile compiler. Users may
  // write business language; parser/binding repair remains an internal task.
  if (validation) {
    try {
      const prepared = await prepareExecutableDraft(result.content, registry, {
        model,
        uri: 'scenario-editor.feature',
        maxRepairs: 2,
      });
      if (prepared.content !== result.content) {
        changes.push({
          line: 0,
          from: 'Bản nháp nghiệp vụ',
          to: 'Bản có thể thực thi',
          reason: 'AI tự sửa lỗi cú pháp/binding trước khi lưu',
        });
      }
      result = normalizeNaturalSteps(prepared.content);
      usedAi ||= prepared.repaired;
      pending = prepared.pendingElements.map((item) => registry.element(item.id));
      await registry.save();
      validation = validateScenarioDraft(result.content, registry);
    } catch {
      // Keep the richer existing editor diagnosis when last-mile repair cannot
      // prove executability; never replace it with raw parser/registry details.
    }
  }
  return {
    content: result.content,
    changes,
    unresolved: result.unresolved,
    valid: !validation,
    ...(validation ? { error: validation } : {}),
    usedAi,
    discoveredLater: pending.map(({ id, label, screen }) => ({ id, label, screen })),
    actionProposals,
    appliedActions: learned.applied,
    actionAnalysis: {
      available: aiAvailable,
      attempted: aiCandidates.length > 0 && aiAvailable,
      ...(!aiAvailable && aiCandidates.length > 0
        ? { reason: `${missingKeyHint()} Không thể phân tích action mới.` }
        : {}),
    },
    scenarioPlan,
  };
}

function collapseDuplicateFocusRegions(content: string): string {
  const output: string[] = [];
  let previousRegion = '';
  for (const line of content.split('\n')) {
    const match = line.match(/^\s*(?:Given|When|Then|And|But)\s+I inspect section "([^"]+)"\s*$/iu);
    const region = match?.[1]?.trim().toLocaleLowerCase('vi-VN') ?? '';
    if (region && region === previousRegion) continue;
    output.push(line);
    previousRegion = region;
  }
  return output.join('\n');
}

/**
 * AI reads the complete business flow, not only syntax failures. Its result is
 * an untrusted semantic plan: validation rejects invented targets/selectors,
 * and applyScenarioPlan can only emit controlled structural intents.
 */
async function compileScenarioPlan(content: string, model: string): Promise<ScenarioPlan> {
  const fallback = deterministicScenarioPlan(content);
  if (!llmAvailable()) return fallback;
  try {
    const text = await completeJson({
      model,
      maxTokens: 1_800,
      system: [
        'You are a senior QA analyst compiling a natural-language scenario into a semantic test plan.',
        'Return JSON only: {"goal":string,"screen":string,"preconditions":string[],"reusableFlows":string[],"steps":[{"line":number,"kind":"precondition"|"navigation"|"focusRegion"|"action"|"assertion","target":string,"scope":string,"action":string,"expectedResult":string,"confidence":number,"reason":string}],"warnings":string[]}.',
        'Do not return Gherkin, CSS, XPath, test ids, code, coordinates or implementation details.',
        'Targets and scopes must be exact business phrases occurring in the supplied scenario. Never invent a UI name.',
        'Return exactly one steps[] item for every supplied step line, in the same order. Do not omit assertions.',
        'A phrase meaning “inspect/check a section, area, table or business block” is focusRegion, not merely a visibility assertion. That region remains scope for following actions until navigation or another focusRegion.',
        'A sentence explicitly saying visible/appears/not visible or comparing a value is an assertion, not a scope.',
        'If one sentence contains both a region and an action target, keep target and scope separately.',
        'Identify reusable preconditions/flows such as login and opening a feature from Homepage search.',
        'expectedResult states the observable business outcome; do not fabricate one when the ticket gives none.',
        'Use confidence below 0.8 whenever the wording is ambiguous. The framework will not compile low-confidence structure automatically.',
        'Write reason and warnings in Vietnamese so a non-technical end user can review them.',
        'Credential-bearing lines may be redacted. Treat them only as a local login precondition; never request or infer secret values.',
      ].join('\n'),
      user: JSON.stringify(planningInput(content)),
    });
    const parsed = safeJson<RawScenarioPlan>(text);
    return validateScenarioPlan(parsed, content) ?? fallback;
  } catch (err) {
    console.warn(`[scenario-plan] AI planning failed; using deterministic plan: ${(err as Error).message}`);
    return {
      ...fallback,
      warnings: [...fallback.warnings, 'AI chưa phân tích được; đang dùng kế hoạch cục bộ an toàn.'],
    };
  }
}

function expandApprovedActions(
  content: string,
  actions: ActionRegistry,
): {
  content: string;
  changes: DraftNormalization['changes'];
  applied: DraftNormalization['appliedActions'];
} {
  const changes: DraftNormalization['changes'] = [];
  const applied: DraftNormalization['appliedActions'] = [];
  const output: string[] = [];
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const match = line.match(/^(\s*)(Given|When|Then|And|But)\s+(.+)$/i);
    if (!match) {
      output.push(line);
      continue;
    }
    const expanded = actions.expand(match[3]!.trim());
    if (!expanded) {
      output.push(line);
      continue;
    }
    const indent = match[1] ?? '';
    const keyword = match[2] ?? 'And';
    expanded.steps.forEach((step, stepIndex) => {
      output.push(`${indent}${stepIndex === 0 ? keyword : 'And'} ${step}`);
    });
    changes.push({
      line: index + 1,
      from: match[3]!.trim(),
      to: expanded.steps.join(' → '),
      reason: `Áp dụng action đã duyệt: ${expanded.action.label}`,
    });
    applied.push({ id: expanded.action.id, label: expanded.action.label, line: index + 1 });
  }
  return { content: output.join('\n'), changes, applied };
}

function isSensitiveStep(text: string): boolean {
  return /password|mật\s*khẩu|secret|token|api[_ -]?key/i.test(text);
}

/**
 * Turns a write failure into something the reader can act on.
 *
 * The raw errno text is accurate and useless: "ENOSPC: no space left on device,
 * write" names a condition, not the thing to do about it, and a build is large
 * enough that a full disk is the failure to expect rather than a surprise.
 */
function uploadError(err: unknown): string {
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === 'ENOSPC') return 'ổ đĩa đã đầy, không còn chỗ để lưu build. Dọn bớt dung lượng rồi thử lại.';
  if (code === 'EACCES' || code === 'EPERM') return 'không có quyền ghi vào thư mục build/.';
  if (code === 'EROFS') return 'thư mục build/ đang ở chế độ chỉ đọc.';
  return (err as Error).message;
}

/**
 * The name an uploaded build is stored under.
 *
 * Only ever a bare filename with the right extension: the value arrives from a
 * browser and is about to become a path this server writes to, so anything
 * carrying a directory — "../../etc/x.apk" included — is reduced to its last
 * segment before it can point outside `build/`.
 */
function safeBuildName(raw: string, platform: 'android' | 'ios'): string | undefined {
  const base = path.basename(raw.replace(/\\/g, '/')).trim();
  const wanted = platform === 'android' ? '.apk' : '.ipa';
  if (!base.toLowerCase().endsWith(wanted)) return undefined;
  const cleaned = base.replace(/[^\w.\- ]+/g, '_');
  return cleaned === wanted ? undefined : cleaned;
}

/**
 * Why a file was not accepted, per format.
 *
 * "Chỉ nhận .apk" is true and useless: the person holding an .aab did not
 * choose it by accident — it is what the build pipeline produced, and what they
 * need is the one command that turns it into something installable. Each of
 * these is a mistake worth its own sentence.
 */
function rejectedBuildReason(raw: string, platform: 'android' | 'ios'): string {
  const ext = path.extname(path.basename(raw.replace(/\\/g, '/'))).toLowerCase();
  const why: Record<string, string> = {
    '.aab':
      'AAB là Android App Bundle, không cài trực tiếp được. '
      + 'Dựng universal APK: bundletool build-apks --mode=universal.',
    '.apks': 'File .apks của bundletool là bộ split APK — cần một .apk đơn.',
    '.zip': 'Zip không phải app build. Nếu đây là XAPK đổi tên, giải nén lấy .apk bên trong.',
    '.app': '.app là thư mục build cho simulator; cần .ipa đã đóng gói và ký.',
  };
  return why[ext]
    ?? (platform === 'android'
      ? 'Android chỉ nhận .apk, tên không có ký tự lạ.'
      : 'iOS chỉ nhận .ipa, tên không có ký tự lạ.');
}

/**
 * One directory name for an environment, or undefined when there is none.
 *
 * Same reasoning as safeBuildName: the value comes from a browser and becomes
 * part of a path this server writes to, so a separator has no business in it.
 */
function safeEnvSegment(raw: string): string | undefined {
  const cleaned = raw.trim().replace(/[^\w.\-]+/g, '_').replace(/^\.+/, '');
  return cleaned.length > 0 ? cleaned : undefined;
}

function validateScenarioDraft(block: string, registry: Registry): string | undefined {
  try {
    parseFeature('scenario-editor.feature', `Feature: Scenario editor\n\n${block.trim()}\n`, registry);
    return undefined;
  } catch (err) {
    return (err as Error).message;
  }
}

function safeJson<T>(value: string): T | undefined {
  try {
    return JSON.parse(value) as T;
  } catch {
    // Cùng bộ tách với genspec: lấy từ `{` đầu tới `}` cuối là ôm luôn cả hai
    // đối tượng khi có hai, rồi hỏng đúng lúc lẽ ra vẫn cứu được.
    try { return JSON.parse(firstJsonObject(value)) as T; } catch { return undefined; }
  }
}

/* ------------------------------------------------------------------ */
/* Scenario Studio                                                     */
/* ------------------------------------------------------------------ */

/** Exactly the fields on the Scenario Studio card. */
interface StudioForm {
  sources?: string[];
  baseUrl?: string;
  targetFeature?: string;
  accounts?: Array<{
    label: string;
    username: string;
    password?: string;
    /** Label this row had when the form loaded, so a rename can carry its secret. */
    previousLabel?: string;
  }>;
  model?: string;
  note?: string;
  /** Which environment a run targets when the picker is left alone. */
  defaultEnv?: string;
  /**
   * SIT / UAT / prod. Sent whole rather than patched key by key: the editor
   * owns the block, and a deleted environment has to be able to disappear.
   */
  environments?: Record<
    string,
    {
      accounts?: Record<string, string>;
      ios?: { app?: string };
      android?: { app?: string };
      web?: { baseUrl?: string };
    }
  >;
  workflowPlatforms?: Array<'web' | 'android' | 'ios'>;
  workflowEnv?: string;
  workflowHeaded?: boolean;
  /**
   * `null` is the unticked box, and is not the same as the field being absent:
   * absent means this form never carried the setting and the stored one stands.
   */
  workflowDeviceFarm?: { platform: 'android' | 'ios' } | null;
  /**
   * Chosen device per platform, by config id. Only ever sent when the preflight
   * found more than one attached, since that is the only time there is a choice.
   */
  workflowDevices?: { android?: string; ios?: string } | null;
}

/**
 * Folds the form into testpilot.config.json, and the passwords into the
 * separate secrets file. A password submitted as an empty string means "leave
 * the stored one alone" — the UI never receives the value back, so it cannot
 * echo it, and a plain save must not therefore wipe it.
 */
async function applyForm(form: StudioForm): Promise<TestPilotConfig> {
  const current = await loadConfig(CONFIG_FILE).catch(() =>
    ConfigSchema.parse({ web: { baseUrl: 'https://example.com' } }),
  );

  const accounts = (form.accounts ?? [])
    .filter((a) => a.label?.trim())
    .map((a) => ({ label: a.label.trim(), username: a.username ?? '' }));

  const draft = {
    ...current,
    sources: (form.sources ?? current.sources).filter((s) => s.trim()),
    targetFeature: form.targetFeature?.trim() ?? current.targetFeature,
    accounts,
    ...(form.defaultEnv?.trim() ? { defaultEnv: form.defaultEnv.trim() } : {}),
    // Empty objects are dropped so an environment that overrides nothing does
    // not write `"ios": {}` into the config on every save.
    ...(form.environments
      ? {
          environments: Object.fromEntries(
            Object.entries(form.environments).map(([name, e]) => [
              name,
              {
                accounts: e.accounts ?? {},
                ...(e.ios?.app?.trim() ? { ios: { app: e.ios.app.trim() } } : {}),
                ...(e.android?.app?.trim() ? { android: { app: e.android.app.trim() } } : {}),
                ...(e.web?.baseUrl?.trim() ? { web: { baseUrl: e.web.baseUrl.trim() } } : {}),
              },
            ]),
          ),
        }
      : {}),
    web: { ...current.web, baseUrl: form.baseUrl?.trim() || current.web.baseUrl },
    llm: {
      ...current.llm,
      model: form.model ?? current.llm.model,
      note: form.note ?? current.llm.note,
    },
    workflow: {
      ...current.workflow,
      // Taken verbatim when the form carried it: an empty list is now a real
      // answer ("run on the farm only"), not a form that forgot to say.
      platforms: form.workflowPlatforms ?? current.workflow.platforms,
      env: form.workflowEnv?.trim() || current.workflow.env || current.defaultEnv,
      headed: form.workflowHeaded ?? current.workflow.headed,
      ...(form.workflowDeviceFarm !== undefined
        ? { deviceFarm: form.workflowDeviceFarm ?? undefined }
        : {}),
      ...(form.workflowDevices !== undefined
        ? { devices: form.workflowDevices ?? undefined }
        : {}),
    },
  };

  const parsed = ConfigSchema.safeParse(draft);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  await saveConfig(parsed.data, CONFIG_FILE);

  const secrets = await Secrets.load();
  for (const a of form.accounts ?? []) {
    const label = a.label?.trim();
    if (!label) continue;

    if (a.password) {
      secrets.set(label, a.password);
      continue;
    }
    // An empty password field means "leave it alone" — the value was never
    // sent to the browser, so it cannot be echoed back. When the label also
    // changed, "alone" has to follow the rename or the password is dropped on
    // the floor and the account silently stops working.
    const from = a.previousLabel?.trim();
    if (from && from !== label) {
      const carried = secrets.get(from);
      if (carried !== undefined) secrets.set(label, carried);
    }
  }
  secrets.keepOnly(accounts.map((a) => a.label));
  await secrets.save();

  return parsed.data;
}

/** The generation pipeline, streamed to the browser and recorded in history. */
async function runWorkflow(
  cfg: TestPilotConfig,
  log: (line: string) => void,
  stage: (run: WorkflowRun) => void,
): Promise<void> {
  const history = await History.load();
  // Chỗ giữ chỗ nói rõ nó là chỗ giữ chỗ. "generated" trông y hệt một tên
  // feature, nên năm lượt chết sớm nằm cạnh nhau trong history đều mang đúng
  // chữ đó và không phân biệt được với nhau.
  const run = history.start(cfg.targetFeature || '(chưa đọc được tài liệu)', 'workflow', WORKFLOW_STAGES);
  run.execution = {
    platforms: cfg.workflow.platforms,
    ...(cfg.workflow.deviceFarm ? { deviceFarm: cfg.workflow.deviceFarm } : {}),
    env: cfg.workflow.env || cfg.defaultEnv,
    headed: cfg.workflow.headed,
    locatorRetries: cfg.workflow.locatorRetries,
  };
  await history.save();
  stage(run);

  const record = (line: string) => {
    run.log.push(line);
    log(line);
  };

  try {
    const result = await runGenPipeline(cfg, {
      log: record,
      // Tên tạm ngay khi đọc xong tài liệu, thay vì đợi tới lúc sinh xong
      // Gherkin. Lượt chết ở bước "AI phân tích" vẫn nói được nó đang làm gì.
      documentTitle: (title) => {
        if (cfg.targetFeature) return;
        run.feature = title;
        stage(run);
        void history.save();
      },
      stage: (index, status) => {
        // runGenPipeline has seven implementation stages; the end-to-end
        // workflow combines file-write + bind into one user-facing task.
        const mapped = index <= 3 ? index : index <= 5 ? 4 : 4;
        const s = run.stages[mapped];
        if (s) {
          if (index === 4 && status === 'done') s.status = 'running';
          else s.status = status;
        }
        stage(run);
        void history.save();
      },
    });
    run.generatedFile = path.basename(result.file);
    // The field is optional for end users. Once AI has produced the Gherkin,
    // use its real `Feature:` name in history instead of the placeholder.
    run.feature = result.featureName;
    run.generated = {
      scenarios: result.scenarios,
      steps: result.steps,
      screens: result.screens,
      elements: result.elements,
      visuals: result.visuals,
      coverageRequirements: result.coverageRequirements,
      coverageCovered: result.coverageCovered,
      coverageMissing: result.coverageMissing,
      coverageRepaired: result.coverageRepaired,
    };
    run.stages[4]!.status = 'done';
    run.stages[5]!.status = 'running';
    run.status = 'waiting_review';
    record(
      `Workflow tạm dừng để review ${result.scenarios} testcase. ` +
      'Duyệt/không duyệt/chỉnh sửa rồi bấm “Hoàn thành kịch bản”.',
    );
  } catch (err) {
    run.status = 'failed';
    run.error = (err as Error).message;
    run.finishedAt = new Date().toISOString();
    throw err;
  } finally {
    stage(run);
    await history.save();
  }
}

/** Resume the same durable workflow after the only human gate: testcase review. */
async function continueWorkflow(
  runId: string,
  log: (line: string) => void,
  stage: (run: WorkflowRun) => void,
): Promise<void> {
  const history = await History.load();
  const run = history.find(runId);
  if (!run || run.kind !== 'workflow') throw new Error('Không tìm thấy workflow cần tiếp tục.');
  if (run.status !== 'waiting_review') {
    throw new Error(`Workflow đang ở trạng thái “${run.status}”, không thể hoàn thành review lần nữa.`);
  }
  if (!run.generatedFile) throw new Error('Workflow chưa ghi nhận feature file đã sinh.');

  const record = (line: string) => {
    run.log.push(line);
    log(line);
  };

  const cfg = await loadConfig(CONFIG_FILE);
  const featurePath = path.join(cfg.paths.features, path.basename(run.generatedFile));
  if (!existsSync(featurePath)) throw new Error(`Không tìm thấy ${run.generatedFile}.`);
  const content = await readFile(featurePath, 'utf8');
  const blocks = scenarioBlocks(content);
  const reviews = await ScenarioReviewStore.load(cfg.paths.scenarioReviewDb);
  const pending = blocks.filter((block) => reviews.entry(run.generatedFile!, block.name)?.status === 'pending');
  const approved = blocks.filter((block) => reviews.isApproved(run.generatedFile!, block.name, block.contentHash));
  if (pending.length > 0) {
    throw new Error(`Còn ${pending.length} testcase chờ duyệt. Hãy duyệt hoặc không duyệt tất cả trước khi tiếp tục.`);
  }
  if (approved.length === 0) throw new Error('Không có testcase nào được duyệt để chạy automation.');

  // Re-audit after edits for traceability, but do not create a second hidden
  // approval gate. The business user has explicitly approved/rejected every
  // scenario; missing coverage remains visible as a warning in the report.
  const coverageRecord = await readFeatureCoverage(cfg, run.generatedFile);
  if (coverageRecord && coverageRecord.requirements.length > 0) {
    record('Đang kiểm tra lại coverage P0/P1 trên nội dung đã duyệt/chỉnh sửa…');
    const approvedFeature = featureWithApprovedScenarios(content, blocks, approved);
    const audit = await auditFeatureCoverage(approvedFeature, coverageRecord.requirements, {
      model: resolveModel(cfg.llm.model),
    });
    await saveFeatureCoverageAudit(cfg, coverageRecord, audit);
    const missing = coverageRecord.requirements
      .filter((requirement) => audit.missingRequirementIds.includes(requirement.id))
      .map((requirement) => ({
        id: requirement.id,
        priority: requirement.priority,
        rule: requirement.rule,
      }));
    if (run.generated) {
      run.generated.coverageRequirements = coverageRecord.requirements.length;
      run.generated.coverageCovered = coverageRecord.requirements.length - missing.length;
      run.generated.coverageMissing = missing;
    }
    if (missing.length > 0) {
      record(
        `Cảnh báo coverage: còn ${missing.length} quy tắc P0/P1 chưa có testcase được duyệt. ` +
          'Workflow vẫn tiếp tục theo quyết định review của người dùng.',
      );
    } else {
      record(`Coverage PASS — ${coverageRecord.requirements.length}/${coverageRecord.requirements.length} quy tắc P0/P1.`);
    }
    delete run.error;
  }

  const set = async (index: number, status: WorkflowRun['stages'][number]['status']) => {
    const item = run.stages[index];
    if (item) item.status = status;
    stage(run);
    await history.save();
  };

  run.status = 'running';
  delete run.error;
  await set(5, 'done');
  await set(6, 'running');
  record(`${approved.length}/${blocks.length} testcase đã được duyệt; bắt đầu automation.`);

  const execution = run.execution ?? {
    platforms: cfg.workflow.platforms,
    ...(cfg.workflow.deviceFarm ? { deviceFarm: cfg.workflow.deviceFarm } : {}),
    env: cfg.workflow.env || cfg.defaultEnv,
    headed: cfg.workflow.headed,
    locatorRetries: cfg.workflow.locatorRetries,
  };
  // The environment is checked here, before the first driver opens, because
  // everything expensive already happened: two model calls, a generated suite,
  // and a human sitting down to review it. A missing phone found at this point
  // costs one clear sentence; found at the first step it costs all of that and
  // arrives as a WebDriver connection error.
  const failedPreflight: string[] = [];
  // Which device each platform settled on. A workflow has no device picker, so
  // when the config lists several the choice is made by what is plugged in —
  // and it has to be carried into the run, or the preflight passes and the run
  // itself refuses for want of `--device`.
  const chosenDevice = new Map<string, string>();
  for (const platform of execution.platforms) {
    const result = await preflight(platform, cfg);
    record(preflightSummary(result));
    if (!result.ok) failedPreflight.push(platform);
    if (result.device) chosenDevice.set(platform, result.device);
  }
  if (failedPreflight.length > 0) {
    await set(6, 'failed');
    run.status = 'failed';
    run.error = `Môi trường chưa sẵn sàng cho: ${failedPreflight.join(', ')}.`;
    run.finishedAt = new Date().toISOString();
    record(
      `\n✗ Dừng trước khi chạy: ${run.error} `
      + 'Bộ testcase đã sinh và đã duyệt vẫn còn — sửa môi trường rồi bấm chạy lại, không phải sinh lại.',
    );
    await history.save();
    stage(run);
    return;
  }
  await set(6, 'done');

  const outcomes: RunSuiteOutcome[] = [];
  await set(7, 'running');
  for (const platform of execution.platforms) {
    // Checked again, immediately before this platform's own run. The gate above
    // gives the complete picture before anything starts, but it can be minutes
    // or hours stale by the time the third platform's turn comes round — Appium
    // gets closed, a phone gets unplugged, a cable gets borrowed. Re-probing
    // costs a moment and turns a WebDriver stack trace into a sentence.
    if (platform !== 'web') {
      const recheck = await preflight(platform, cfg);
      if (!recheck.ok) {
        record(`\n✗ Bỏ qua ${platform}: môi trường đã đổi kể từ lúc kiểm tra.`);
        record(preflightSummary(recheck));
        outcomes.push({ code: 1, stopped: false, reportPaths: [] });
        continue;
      }
      if (recheck.device) chosenDevice.set(platform, recheck.device);
    }
    const device = chosenDevice.get(platform);
    record(`\n▶ Chạy ${run.generatedFile} trên ${platform}${device ? ` (${device})` : ''}…`);
    outcomes.push(await runSuite(
      platform,
      undefined,
      platform === 'web' && Boolean(execution.headed),
      true,
      record,
      device,
      execution.env,
      run.generatedFile,
      execution.locatorRetries ?? 1,
    ));
  }

  // Device Farm last, and only if the local run gave it a reason to happen.
  //
  // Farm minutes are billed and a run takes tens of minutes, so sending a suite
  // there while it is already failing on a laptop spends money to learn what is
  // known. When the farm is the only target there is nothing to learn from
  // first, and it runs immediately.
  if (execution.deviceFarm) {
    const localFailed = outcomes.some((outcome) => outcome.code !== 0);
    if (localFailed) {
      record(
        '\n⊘ Bỏ qua Device Farm: bộ testcase còn fail ở local. '
        + 'Sửa cho xanh ở local rồi chạy lại — phút thiết bị trên farm là tiền thật.',
      );
    } else {
      record(`\n▶ Bàn giao ${run.generatedFile} cho Device Farm (${execution.deviceFarm.platform})…`);
      try {
        const farm = await handOffToFarm(
          execution.deviceFarm.platform,
          run.generatedFile,
          record,
          stage,
        );
        run.farmRunId = farm.id;
        await history.save();
        // Counted like any other platform. A farm run that came back red is a
        // red workflow; leaving it out meant four platforms could run, one
        // could fail, and the workflow would still call itself passed.
        outcomes.push({ code: farm.passed ? 0 : 1, stopped: false, reportPaths: [] });
        record(
          farm.passed
            ? `✓ Device Farm pass. Chi tiết ở lượt chạy ${farm.id}, tab Device Farm.`
            : `✗ Device Farm fail. Chi tiết ở lượt chạy ${farm.id}, tab Device Farm.`,
        );
      } catch (err) {
        record(`✗ Không bàn giao được cho Device Farm: ${(err as Error).message}`);
        outcomes.push({ code: 1, stopped: false, reportPaths: [] });
      }
    }
  }

  const allPassed = outcomes.every((outcome) => outcome.code === 0);
  // Exit 2 is "nothing failed, but not everything ran". Marking that `done`
  // would tell the workflow its generated scenarios were validated when some
  // were never executed; marking it `failed` would claim a break that did not
  // happen. `skipped` is the one that describes what actually occurred.
  const incomplete = !allPassed && outcomes.every((outcome) => outcome.code === 0 || outcome.code === 2);
  if (incomplete) {
    log('⚠ Một số kịch bản chưa được duyệt nên chưa chạy — giai đoạn kiểm thử chưa hoàn tất.');
  }
  await set(7, allPassed ? 'done' : incomplete ? 'skipped' : 'failed');
  // Healing is performed inside each scenario attempt. Assertion failures do
  // not enter that retry path; the report keeps them red.
  await set(8, 'running');
  const recovery = await summarizeWorkflowRecovery(outcomes.flatMap((outcome) => outcome.reportPaths));
  if (recovery.healedSteps > 0 || recovery.retriedScenarios > 0) {
    record(
      `Healing: ${recovery.healedSteps} step dùng locator thay thế; ` +
        `${recovery.retriedScenarios} scenario được chạy lại theo policy.`,
    );
    await set(8, 'done');
  } else {
    record('Healing không áp dụng: không có locator nào được thay thế hoặc chạy lại.');
    await set(8, 'skipped');
  }

  await set(9, 'running');
  const reportPaths = outcomes.flatMap((outcome) => outcome.reportPaths);
  run.runDirs = reportPaths.map((report) => path.basename(path.dirname(report)));
  if (reportPaths.length > 0) {
    record(`Đã sinh ${reportPaths.length} report với screenshot/video tương ứng.`);
    await set(9, 'done');
  } else {
    await set(9, 'failed');
  }

  run.status = allPassed ? 'passed' : 'failed';
  run.finishedAt = new Date().toISOString();
  if (!allPassed) {
    run.error = recovery.environmentFailures > 0
      ? 'Automation dừng vì lỗi setup/môi trường. Locator healing không áp dụng cho lỗi này.'
      : recovery.assertionFailures > 0
        ? 'Automation có assertion fail. Kết quả nghiệp vụ được giữ nguyên và không retry.'
        : 'Automation có testcase fail sau khi áp dụng locator healing/retry theo policy.';
  }
  await set(10, 'done');
}

function featureWithApprovedScenarios(
  content: string,
  all: ReturnType<typeof scenarioBlocks>,
  approved: ReturnType<typeof scenarioBlocks>,
): string {
  const first = all[0];
  if (!first) return content;
  const start = content.indexOf(first.content);
  const prefix = start >= 0 ? content.slice(0, start).trimEnd() : '';
  return [prefix, ...approved.map((block) => block.content)].filter(Boolean).join('\n\n');
}

interface WorkflowRecoverySummary {
  healedSteps: number;
  retriedScenarios: number;
  environmentFailures: number;
  assertionFailures: number;
}

async function summarizeWorkflowRecovery(reportPaths: string[]): Promise<WorkflowRecoverySummary> {
  const summary: WorkflowRecoverySummary = {
    healedSteps: 0,
    retriedScenarios: 0,
    environmentFailures: 0,
    assertionFailures: 0,
  };
  for (const reportPath of reportPaths) {
    try {
      const raw = JSON.parse(
        await readFile(path.join(path.dirname(reportPath), 'report.json'), 'utf8'),
      ) as {
        report?: {
          results?: Array<{
            runs?: Array<{
              steps?: Array<{ status?: string; failureKind?: string }>;
            }>;
          }>;
        };
      };
      for (const result of raw.report?.results ?? []) {
        const runs = result.runs ?? [];
        if (runs.length > 1) summary.retriedScenarios += 1;
        for (const runAttempt of runs) {
          for (const stepResult of runAttempt.steps ?? []) {
            if (stepResult.status === 'healed') summary.healedSteps += 1;
          }
        }
        const failed = runs.at(-1)?.steps?.find((step) => step.status === 'failed');
        if (failed?.failureKind === 'environment') summary.environmentFailures += 1;
        if (failed?.failureKind === 'assertion') summary.assertionFailures += 1;
      }
    } catch {
      // Report collection is best-effort here; the execution result remains authoritative.
    }
  }
  return summary;
}

/**
 * Passwords for the device, taken from the local secrets file so nobody has to
 * type them a second time into a config that gets committed.
 *
 * Gated on `farm.sendSecrets` because the testspec these end up in is uploaded
 * to S3 in plain text and kept with the run history. The log says which
 * accounts were sent — never the values — so the exposure is at least visible
 * in the run's own record.
 */

async function recentRuns(): Promise<RunHistoryEntry[]> {
  const history = await History.load();
  return history.list().map((r) => ({ ...r, stagesDone: stagesDone(r) }));
}

/* ------------------------------------------------------------------ */
/* AWS Device Farm                                                     */
/* ------------------------------------------------------------------ */

function region(url: URL): string {
  return url.searchParams.get('region') || 'us-west-2';
}

/**
 * Every Device Farm call fails the same three ways — no credentials, wrong
 * region, missing IAM permission — and the raw SDK message is unhelpful for all
 * three. Returning a result object rather than throwing lets the page render
 * the fix inline instead of showing a 500.
 */
async function guarded<T>(fn: () => Promise<T>) {
  try {
    return { ok: true as const, data: await fn() };
  } catch (err) {
    const message = (err as Error).message;
    return { ok: false as const, error: message, hint: awsHint(message) };
  }
}

function awsHint(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('token') && (m.includes('expired') || m.includes('refresh'))) {
    // A new client is built per call, so a fresh SSO token is picked up without
    // restarting — unlike AWS_PROFILE, which is read from the process env.
    return 'Phiên đăng nhập AWS đã hết hạn — bấm nút Đăng nhập AWS ở phần Kết nối phía trên rồi thử lại.';
  }
  if (m.includes('could not load credentials') || m.includes('credential')) {
    return 'Chưa đăng nhập AWS — bấm nút Đăng nhập AWS ở phần Kết nối phía trên rồi thử lại.';
  }
  if (m.includes('not authorized') || m.includes('accessdenied')) {
    return 'Tài khoản AWS không có quyền dùng Device Farm.\nLiên hệ admin AWS để được cấp quyền devicefarm:* cho tài khoản này.';
  }
  if (m.includes('region')) {
    return 'Device Farm chỉ hoạt động ở region us-west-2 (Oregon).\nChuyển region về us-west-2 rồi bấm Tải project lại.';
  }
  return '';
}

/** APK/IPA uploaded from the browser, parked next to the built test package. */
function findAapt(): string | null {
  const sdkRoot =
    process.env.ANDROID_HOME ??
    process.env.ANDROID_SDK_ROOT ??
    path.join(os.homedir(), 'Library', 'Android', 'sdk');
  const btRoot = path.join(sdkRoot, 'build-tools');
  if (!existsSync(btRoot)) return null;
  const versions = readdirSync(btRoot).sort().reverse();
  for (const v of versions) {
    const p = path.join(btRoot, v, 'aapt');
    if (existsSync(p)) return p;
  }
  return null;
}

async function readAppVersion(file: string): Promise<{ versionName?: string; versionCode?: string; appLabel?: string }> {
  const isIpa = file.toLowerCase().endsWith('.ipa');
  if (isIpa) {
    return new Promise((resolve) => {
      let out = '';
      const child = spawn('bash', [
        '-c',
        `unzip -p "${file}" "Payload/*.app/Info.plist" | plutil -convert json -o - -`,
      ], { stdio: ['ignore', 'pipe', 'ignore'] });
      child.stdout?.on('data', (b: Buffer) => { out += b.toString(); });
      child.on('close', () => {
        try {
          const info = JSON.parse(out);
          resolve({
            versionName: info.CFBundleShortVersionString,
            versionCode: info.CFBundleVersion,
            appLabel: info.CFBundleDisplayName ?? info.CFBundleName,
          });
        } catch { resolve({}); }
      });
      child.on('error', () => resolve({}));
    });
  }

  const aapt = findAapt();
  if (!aapt) return {};
  return new Promise((resolve) => {
    let out = '';
    const child = spawn(aapt, ['dump', 'badging', file], { stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout?.on('data', (b: Buffer) => { out += b.toString(); });
    child.on('close', () => {
      const pkg = out.match(/^package:.*?versionCode='(\d+)'.*?versionName='([^']+)'/m);
      const label = out.match(/^application-label:'([^']+)'/m);
      resolve({
        versionCode: pkg?.[1],
        versionName: pkg?.[2],
        appLabel: label?.[1],
      });
    });
    child.on('error', () => resolve({}));
  });
}

/** The Device Farm form. Mirrors the config's `farm` block one-to-one. */
interface FarmForm {
  region?: string;
  projectArn?: string;
  devicePoolArn?: string;
  platform?: 'android' | 'ios';
  appPath?: string;
  testPackagePath?: string;
  testSpecPath?: string;
  runName?: string;
  jobTimeoutMinutes?: number;
  videoCapture?: boolean;
  sendSecrets?: boolean;
  env?: Record<string, string>;
  /** Rebuild the Appium zip before scheduling. */
  bundle?: boolean;
}

async function applyFarmForm(form: FarmForm): Promise<TestPilotConfig> {
  const current = await loadConfig(CONFIG_FILE).catch(() =>
    ConfigSchema.parse({ web: { baseUrl: 'https://example.com' } }),
  );

  const draft = {
    ...current,
    farm: {
      ...current.farm,
      ...Object.fromEntries(
        Object.entries(form).filter(([k, v]) => k !== 'bundle' && v !== undefined),
      ),
      // Remembered against its platform as well as in `devicePoolArn`. That
      // field is only ever the last pool used, and a workflow choosing the
      // other platform would otherwise inherit a pool full of the wrong
      // handsets.
      devicePools: {
        ...current.farm.devicePools,
        ...(form.platform && form.devicePoolArn
          ? { [form.platform]: form.devicePoolArn }
          : {}),
      },
    },
  };

  const parsed = ConfigSchema.safeParse(draft);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  await saveConfig(parsed.data, CONFIG_FILE);
  return parsed.data;
}

/**
 * Send the freshly approved feature to Device Farm.
 *
 * The farm keeps its own history record and its own four stages; this returns
 * that record's id so the workflow can point at it. Scoped by the feature's own
 * tag, because the farm selects scenarios by tag and the workflow has no
 * business re-running the rest of the suite on billed hardware.
 */
/** What a farm run left behind: its history record, and whether it passed. */
interface FarmHandoff {
  id: string;
  passed: boolean;
}

async function handOffToFarm(
  platform: 'android' | 'ios',
  generatedFile: string | undefined,
  record: (line: string) => void,
  stage: (run: WorkflowRun) => void,
): Promise<FarmHandoff> {
  const cfg = await loadConfig(CONFIG_FILE);
  const tag = generatedFile
    ? await featureTag(path.join(cfg.paths.features, path.basename(generatedFile)))
    : undefined;
  if (!tag) {
    throw new Error(
      'Feature vừa sinh không có tag cấp Feature, nên không giới hạn được phạm vi chạy trên farm.',
    );
  }
  // Both the build and the pool are re-derived for the platform actually asked
  // for; see resolveFarmTarget for why inheriting them would be wrong. It
  // throws before the bundle and the upload, so a mismatch costs a sentence.
  const { appPath, devicePoolArn } = resolveFarmTarget(cfg, platform);
  const farmCfg: TestPilotConfig = {
    ...cfg,
    farm: {
      ...cfg.farm,
      platform,
      appPath,
      devicePoolArn,
      env: { ...cfg.farm.env, TESTPILOT_TAG: tag },
    },
  };
  assertFarmReady(farmCfg.farm);
  record(`Bộ cài gửi lên farm: ${farmCfg.farm.appPath} · pool ${devicePoolArn.split('/').pop()}`);
  record(`Phạm vi trên farm: ${tag}`);
  // Always rebuilt: the package is what the device will execute, and shipping a
  // stale zip would test code the workflow did not just generate.
  return runOnFarm(farmCfg, true, record, stage);
}

/** The feature-level tag on the first line, e.g. `@feature-chuyen-tien-noi-bo`. */
async function featureTag(file: string): Promise<string | undefined> {
  const content = await readFile(file, 'utf8').catch(() => '');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('@')) return trimmed.split(/\s+/)[0];
    return undefined;
  }
  return undefined;
}

async function runOnFarm(
  cfg: TestPilotConfig,
  bundle: boolean,
  log: (line: string) => void,
  stage: (run: WorkflowRun) => void,
): Promise<FarmHandoff> {
  const history = await History.load();
  const run = history.start(
    cfg.farm.runName || `${cfg.farm.platform}-farm`,
    'farm',
    FARM_STAGES,
  );
  run.platform = cfg.farm.platform;
  await history.save();
  stage(run);

  const record = (line: string) => {
    run.log.push(line);
    log(line);
  };
  /** Device Farm's stages are sequential, so entering one closes the previous. */
  const enter = (index: number) => {
    for (let i = 0; i < index; i++) {
      if (run.stages[i]!.status === 'running') run.stages[i]!.status = 'done';
    }
    if (run.stages[index]) run.stages[index]!.status = 'running';
    stage(run);
    // Persist on every transition. A farm run takes many minutes, and saving
    // only at the end left the history table reading "running 0/4" throughout —
    // indistinguishable from a job that never started.
    void history.save();
  };

  try {
    enter(0);
    if (bundle) {
      await spawnStep('npm', ['run', 'farm:bundle'], record);
    } else {
      record('Bỏ qua bước đóng gói — dùng lại zip có sẵn.');
    }

    const result = await scheduleFarmRun(
      // runs/ and not runs/<platform>/: the tree coming back from the device
      // already contains its own run directory, whose name carries the
      // platform. Joining a platform on here would nest it a second time.
      {
        ...cfg.farm,
        env: { ...cfg.farm.env, ...(await farmSecretEnv(cfg, record)) },
        runsDir: cfg.paths.runs,
        flakeDb: cfg.paths.flakeDb,
        healingDb: cfg.paths.healingDb,
        reportsDir: cfg.paths.reports,
        retention: cfg.retention,
      },
      { log: record, stage: enter },
    );

    for (const s of run.stages) if (s.status === 'running') s.status = 'done';
    record(`status=${result.status} result=${result.result}`);
    record(`counters ${JSON.stringify(result.counters)}`);

    // Include the URL, not just the name. Device Farm keeps the video and the
    // logs on its side, and a name alone means digging through the AWS console
    // to find the one artifact that explains the failure. These are presigned
    // and expire in a few hours, which is why the log says so.
    const interesting = new Set(['VIDEO', 'TESTSPEC_OUTPUT', 'DEVICE_LOG', 'CUSTOMER_ARTIFACT']);
    const linked = result.artifacts.filter((a) => interesting.has(a.type));
    for (const a of linked.slice(0, 12)) record(`${a.type.padEnd(18)} ${a.name} → ${a.url}`);
    if (linked.length > 0) record('(link Device Farm là presigned, hết hạn sau vài giờ)');
    for (const a of result.artifacts.filter((a) => !interesting.has(a.type)).slice(0, 20)) {
      record(`${a.type.padEnd(18)} ${a.name}`);
    }

    run.status = result.result === 'PASSED' ? 'passed' : 'failed';
    if (result.result !== 'PASSED') run.error = `Device Farm trả về ${result.result}.`;

    // Persist the full orchestration log next to each run directory so E2E
    // History can show it without requiring history.json cross-referencing.
    for (const dir of result.runDirs) {
      await writeFile(path.join(dir, 'log.txt'), run.log.join('\n'), 'utf8').catch(() => {});
    }
    // Link workflow run → device run directories so the UI can show videos and
    // report links without relying on fragile time-window matching.
    run.runDirs = result.runDirs.map((d) => path.basename(d));
  } catch (err) {
    for (const s of run.stages) if (s.status === 'running') s.status = 'failed';
    run.status = 'failed';
    run.error = (err as Error).message;
    throw err;
  } finally {
    run.finishedAt = new Date().toISOString();
    stage(run);
    await history.save();
  }
  // The id, so a workflow that handed off can link to this record instead of
  // duplicating its stages — and the verdict, because a farm run that finishes
  // with failing tests does not throw. Returning only the id let a workflow
  // call this, see no exception, and report itself green while the farm record
  // beside it said failed.
  return { id: run.id, passed: run.status === 'passed' };
}

function spawnStep(bin: string, args: string[], log: (l: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    log(`$ ${bin} ${args.join(' ')}`);
    const child = spawn(bin, args, { env: process.env });
    const pipe = (chunk: Buffer) => chunk.toString().split('\n').filter(Boolean).forEach(log);
    child.stdout.on('data', pipe);
    child.stderr.on('data', pipe);
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${bin} ${args.join(' ')} thoát với mã ${code}.`)),
    );
  });
}

/**
 * Every test process this server started and has not seen exit.
 *
 * A single handle used to be enough, and was quietly wrong even before parallel
 * runs existed: starting a second run overwrote the reference, so Stop could
 * only reach the newest one and the earlier process kept driving a device with
 * nobody able to stop it. A set reaches all of them.
 */

/**
 * Theo dõi một tiến trình con cho tới lúc nó chết.
 *
 * Set trong RAM đủ để nút Dừng làm việc khi server còn sống. Tệp PID là cho
 * trường hợp server KHÔNG còn sống — lúc đó Set biến mất còn tiến trình con
 * thì không, vì giết cha không giết con.
 */
function track(child: ReturnType<typeof spawn>, signature: string, label: string): void {
  runChildren.add(child);
  if (child.pid !== undefined) orphans.add(child.pid, signature, label);
  const forget = () => {
    runChildren.delete(child);
    if (child.pid !== undefined) orphans.remove(child.pid);
  };
  child.on('close', forget);
  child.on('error', forget);
}

/** Delegates to the CLI so the UI and a terminal run exactly the same code. */
interface RunSuiteOutcome {
  code: number | null;
  stopped: boolean;
  reportPaths: string[];
}

function runSuite(
  platform: string,
  tag: string | undefined,
  headed: boolean,
  includeQuarantined: boolean,
  log: (l: string) => void,
  /** One named device, when the picker chose exactly one. Otherwise the default. */
  device?: string,
  /**
   * SIT / UAT / prod. Local runs only — Device Farm has no route to those
   * servers, so the farm card deliberately offers no such choice.
   */
  env?: string,
  /** Limit a Studio workflow to the feature generated by that workflow. */
  feature?: string,
  /** Extra scenario attempts, used only after a locator-classified failure. */
  locatorRetries?: number,
): Promise<RunSuiteOutcome> {
  return new Promise<RunSuiteOutcome>((resolve, reject) => {
    const bin = path.resolve('node_modules/.bin/tsx');
    const args = [
      'src/cli/run.ts',
      '--platform',
      platform,
      ...(device ? ['--device', device] : []),
      ...(env ? ['--env', env] : []),
      ...(feature ? ['--feature', feature] : []),
      ...(locatorRetries !== undefined ? ['--locator-retries', String(locatorRetries)] : []),
      ...(tag ? ['--tag', tag] : []),
      ...(headed ? ['--headed'] : []),
      ...(includeQuarantined ? ['--include-quarantined'] : []),
    ];
    log(`$ tsx ${args.join(' ')}`);

    const child = spawn(bin, args, { env: process.env });
    track(child, 'src/cli/run.ts', `run ${platform}${tag ? ` @${tag}` : ''}`);
    const reportPaths: string[] = [];
    const pipe = (chunk: Buffer) => chunk.toString().split('\n').filter(Boolean).map(cleanLog).forEach((line) => {
      const report = /^\[run\] report -> (.+)$/.exec(line)?.[1]?.trim();
      if (report && !reportPaths.includes(report)) reportPaths.push(report);
      log(line);
    });
    child.stdout.on('data', pipe);
    child.stderr.on('data', pipe);
    child.on('error', (err) => { runChildren.delete(child); reject(err); });
    child.on('close', (code) => {
      runChildren.delete(child);
      const stopped = code === null || code === 130 || code === 143;
      log(
        code === 0
          ? '\n✓ Tất cả test đã pass.'
          // Exit 2 means nothing failed but not everything ran. Saying "tất cả
          // test đã pass" here would be false: the scenarios that were skipped
          // are precisely the ones somebody just edited.
          : code === 2
            ? '\n✎ Test đã chạy không có lỗi, nhưng có kịch bản chưa duyệt nên chưa được chạy — xem danh sách bên trên.'
            : stopped
              ? '\n⊘ Test đã bị dừng.'
              : `\n✗ Test kết thúc với lỗi (mã ${code}) — xem log bên trên để biết chi tiết.`,
      );
      resolve({ code, stopped, reportPaths });
    });
  });
}

interface PickedDevice { platform: 'android' | 'ios'; id: string; }

/** `android:pixel` -> {platform, id}. Anything malformed is dropped, not guessed at. */
function parseDeviceToken(token: string): PickedDevice | null {
  const [platform, ...rest] = token.split(':');
  const id = rest.join(':');
  if (!id || (platform !== 'android' && platform !== 'ios')) return null;
  return { platform, id };
}

/** Whether the config lists this device, as opposed to synthesising it. */
async function isNamedDevice(picked: PickedDevice): Promise<boolean> {
  try {
    const cfg = await loadConfig(CONFIG_FILE);
    const listed = picked.platform === 'android' ? cfg.android.devices : cfg.ios.devices;
    return Boolean(listed?.some((d) => d.id === picked.id));
  } catch {
    return false;
  }
}

/**
 * Runs the suite on several devices, by handing the job to the parallel CLI.
 *
 * Deliberately not reimplemented here. Port validation, per-device log
 * prefixes, and the single sequential merge that keeps three devices from
 * erasing each other's learnings all live in run-parallel.ts; a second copy
 * inside the server is a second copy to get wrong.
 */
function runSuiteParallel(
  platform: string,
  devices: string[],
  tag: string | undefined,
  includeQuarantined: boolean,
  log: (l: string) => void,
  env?: string,
) {
  return new Promise<void>((resolve, reject) => {
    const bin = path.resolve('node_modules/.bin/tsx');
    const args = [
      'src/cli/run-parallel.ts',
      '--platform', platform,
      '--devices', devices.join(','),
      ...(env ? ['--env', env] : []),
      ...(tag ? ['--tag', tag] : []),
      ...(includeQuarantined ? ['--include-quarantined'] : []),
    ];
    log(`$ tsx ${args.join(' ')}`);

    const child = spawn(bin, args, { env: process.env });
    track(child, 'src/cli/run-parallel.ts', `run song song ${platform}`);
    const pipe = (chunk: Buffer) =>
      chunk.toString().split('\n').filter(Boolean).map(cleanLog).forEach(log);
    child.stdout.on('data', pipe);
    child.stderr.on('data', pipe);
    child.on('error', (err) => { runChildren.delete(child); reject(err); });
    child.on('close', (code) => {
      runChildren.delete(child);
      const stopped = code === null || code === 130 || code === 143;
      log(
        code === 0
          ? `\n✓ Tất cả ${devices.length} thiết bị đã pass.`
          : stopped
            ? '\n⊘ Test đã bị dừng.'
            : `\n✗ Có thiết bị fail (mã ${code}) — xem log theo tiền tố [tên máy] ở trên.`,
      );
      resolve();
    });
  });
}

/**
 * Kills every test suite this server started, and the WebDriverAgent runner
 * with it.
 *
 * Killing only the suite leaves the `xcodebuild` running WDA orphaned to init,
 * which keeps the XCUITest alive on the phone: iOS goes on showing its
 * "Automation running — hold both volume buttons to stop" banner, and the next
 * iOS session inherits a runner nobody is talking to. Stopping the run has to
 * mean stopping what the run left on the device.
 */
async function stopSuite(): Promise<{ stopped: boolean; wda: boolean }> {
  let stopped = 0;
  for (const child of runChildren) {
    if (child.exitCode !== null) continue;
    // SIGTERM first; the tsx/node process should clean up and exit. A parallel
    // run passes it on to its own per-device children before merging what they
    // managed to learn, so stopping is not the same as discarding.
    child.kill('SIGTERM');
    stopped += 1;
  }
  const wda = await stopWebDriverAgent();
  return { stopped: stopped > 0, wda };
}

/* ------------------------------------------------------------------ */
/* Plumbing                                                            */
/* ------------------------------------------------------------------ */

/**
 * Server-sent events over a POST, read by the client with a stream reader.
 * Two channels: `log` for console lines, `run` for the stage tracker that draws
 * the progress list and the "3/7" cell.
 */
async function stream(
  res: ServerResponse,
  job: (log: (l: string) => void, stage: (run: WorkflowRun) => void) => Promise<void>,
) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  const send = (event: string, data: unknown) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    await job(
      (line) => send('log', line),
      // The log array would double every frame; the client already has the lines.
      (run) => send('run', { ...run, log: undefined, stagesDone: stagesDone(run) }),
    );
    send('done', { ok: true });
  } catch (err) {
    send('error', (err as Error).message);
    send('done', { ok: false });
  }
  res.end();
}

/**
 * Serves a file, honouring HTTP Range.
 *
 * Range is what makes a video seekable. Without it the browser gets one opaque
 * 200 and the scrubber does nothing — which is how a two-minute recording of a
 * test run became something you had to watch from the beginning, every time,
 * including the ten seconds of Appium starting up.
 */
async function serveFile(res: ServerResponse, file: string, range?: string): Promise<void> {
  if (!existsSync(file)) return json(res, 404, { error: `Not found: ${file}` });
  const body = await readFile(file);
  const headers: Record<string, string> = {
    'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'accept-ranges': 'bytes',
    // Vite hash tên asset. Cache dài cho asset là an toàn; index.html luôn
    // no-store để lần mở sau nhận được manifest asset mới nhất.
    'cache-control': path.basename(file) === 'index.html'
      ? 'no-store'
      : file.includes(`${path.sep}assets${path.sep}`)
        ? 'public, max-age=31536000, immutable'
        : 'no-store',
  };

  const match = /^bytes=(\d*)-(\d*)$/.exec(range ?? '');
  if (match) {
    const [, rawStart, rawEnd] = match;
    const start = rawStart ? Number(rawStart) : undefined;
    const end = rawEnd ? Number(rawEnd) : undefined;
    // `bytes=-500` means the last 500 bytes, not "from 0 to 500".
    const from = start !== undefined ? start : Math.max(0, body.length - (end ?? 0));
    const to = start !== undefined ? Math.min(end ?? body.length - 1, body.length - 1) : body.length - 1;
    if (from > to || from >= body.length) {
      res.writeHead(416, { 'content-range': `bytes */${body.length}` });
      res.end();
      return;
    }
    const slice = body.subarray(from, to + 1);
    res.writeHead(206, {
      ...headers,
      'content-range': `bytes ${from}-${to}/${body.length}`,
      'content-length': String(slice.length),
    });
    res.end(slice);
    return;
  }

  res.writeHead(200, { ...headers, 'content-length': String(body.length) });
  res.end(body);
}

/* ------------------------------------------------------------------ */
/* Prereq helpers                                                      */
/* ------------------------------------------------------------------ */

// Strip ANSI escape sequences and replace home dir with ~ before logging.
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const HOME = os.homedir();
const cleanLog = (s: string) =>
  s.replace(ANSI_RE, '').replace(new RegExp(HOME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '~');

function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: '127.0.0.1', port });
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => { sock.destroy(); resolve(false); });
  });
}

async function appiumHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:4723/status`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

let appiumProc: ReturnType<typeof spawn> | null = null;
let lastAppiumExit: { code: number | null; signal: NodeJS.Signals | null; at: string } | undefined;
const APPIUM_LOG_FILE = path.join(os.tmpdir(), 'testpilot-appium.log');

async function prereqAppiumStatus(): Promise<{
  running: boolean;
  managed: boolean;
  pid?: number;
  lastExit?: typeof lastAppiumExit;
}> {
  const running = await appiumHealthy();
  return {
    running,
    managed: Boolean(running && appiumProc?.exitCode === null),
    ...(running && appiumProc?.pid ? { pid: appiumProc.pid } : {}),
    ...(lastAppiumExit ? { lastExit: lastAppiumExit } : {}),
  };
}

/**
 * Builds the ENOENT error message for when `appium` is not on PATH.
 * Checks common install locations to distinguish "not installed" from
 * "installed but PATH not set up".
 */
function appiumNotFoundMessage(): string {
  const candidates: string[] = [];

  const isWin = process.platform === 'win32';

  if (isWin) {
    const appdata = process.env.APPDATA ?? '';
    if (appdata) candidates.push(path.join(appdata, 'npm', 'appium.cmd'));
  } else {
    candidates.push(
      '/opt/homebrew/bin/appium',   // Homebrew Apple Silicon
      '/usr/local/bin/appium',       // Homebrew Intel / pkg
      '/usr/bin/appium',             // Linux system
    );
  }

  // Unix nvm: ~/.nvm/versions/node/<ver>/bin/appium
  const nvmBins: string[] = [];
  if (!isWin) {
    const nvmRoot = path.join(HOME, '.nvm', 'versions', 'node');
    if (existsSync(nvmRoot)) {
      try {
        for (const ver of readdirSync(nvmRoot)) {
          const p = path.join(nvmRoot, ver, 'bin', 'appium');
          if (existsSync(p)) nvmBins.push(p);
        }
      } catch { /* ignore */ }
    }
  }

  // nvm-windows: %APPDATA%\nvm\<ver>\appium.cmd
  const nvmWinBins: string[] = [];
  if (isWin) {
    const appdata = process.env.APPDATA ?? '';
    const nvmWinRoot = appdata ? path.join(appdata, 'nvm') : '';
    if (nvmWinRoot && existsSync(nvmWinRoot)) {
      try {
        for (const ver of readdirSync(nvmWinRoot)) {
          const p = path.join(nvmWinRoot, ver, 'appium.cmd');
          if (existsSync(p)) nvmWinBins.push(p);
        }
      } catch { /* ignore */ }
    }
  }

  const found = [
    ...candidates.filter((p) => existsSync(p)),
    ...nvmBins,
    ...nvmWinBins,
  ];

  const lines: string[] = [];

  if (found.length > 0) {
    lines.push('Appium được tìm thấy nhưng không có trong PATH của shell hiện tại:');
    for (const p of found) lines.push(`  ${p}`);
    lines.push('');
    lines.push('Thêm thư mục chứa Appium vào PATH.');
    const dir = path.dirname(found[0]!);
    if (isWin) {
      lines.push('Cách 1 — Command Prompt (cần mở lại terminal sau):');
      lines.push(`  setx PATH "%PATH%;${dir}"`);
      lines.push('');
      lines.push('Cách 2 — PowerShell (cần mở lại terminal sau):');
      lines.push(`  [System.Environment]::SetEnvironmentVariable('PATH', $env:PATH + ';${dir}', 'User')`);
      lines.push('');
      lines.push('Cách 3 — Vào System Properties → Environment Variables → User variables → PATH → Edit.');
      lines.push('');
      lines.push('Sau khi chỉnh PATH, khởi động lại máy để Windows nhận PATH mới,');
      lines.push('rồi mở lại Horus và bấm ▶ Thử lại.');
    } else {
      lines.push(`  export PATH="${dir}:$PATH"`);
      lines.push('');
      lines.push('Thêm dòng này vào ~/.zshrc hoặc ~/.bashrc để giữ sau khi khởi động lại.');
      lines.push('Sau đó khởi động lại máy, mở lại Horus và bấm ▶ Thử lại.');
    }
  } else {
    lines.push('Appium chưa được cài trên máy này.');
    lines.push('');
    lines.push('Yêu cầu: Node.js 18+ (đi kèm npm).');
    lines.push('Tải tại https://nodejs.org nếu chưa có.');
    lines.push('');
    lines.push('Sau khi có Node.js, chạy:');
    lines.push('');
    lines.push('  npm install -g appium');
    lines.push('');
    if (isWin) {
      lines.push('Nếu báo lỗi quyền trên Windows, chạy Command Prompt với quyền Administrator.');
    } else {
      lines.push('Nếu báo lỗi quyền trên macOS/Linux, dùng nvm thay vì cài Node trực tiếp.');
    }
    lines.push('Sau khi cài xong, bấm ▶ Thử lại.');
  }

  return lines.join('\n');
}

/**
 * Stops whatever Appium is listening on 4723, then starts a fresh one.
 *
 * Starting was the only thing offered here, and "already running" was treated
 * as success — which is right until the server itself is the problem. An Appium
 * that has wedged mid-download of a chromedriver still answers /status, still
 * holds its session, and still hangs every getContexts() call; the only way out
 * was a terminal. A stuck server is a normal thing to hit, so ending it is a
 * normal thing to offer.
 */
async function restartAppium(log: (l: string) => void): Promise<void> {
  // Before the server: the runner outlives it either way, and an Appium that
  // comes back up while a stale WDA still holds the device is worse than one
  // that comes back to a clean phone.
  await stopWebDriverAgent(log);
  const pids = await listeningPids(4723);
  if (pids.length === 0) {
    log('Không có tiến trình nào giữ port 4723.');
  } else {
    // Kills by port rather than only the child this server spawned: the wedged
    // server is often one started from a terminal, and that is exactly the case
    // where someone reaches for this button.
    log(`Dừng Appium (pid ${pids.join(', ')})…`);
    for (const pid of pids) {
      try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
    }
    for (let i = 0; i < 20 && (await appiumHealthy()); i++) {
      await new Promise((r) => setTimeout(r, 500));
    }
    if (await appiumHealthy()) {
      log('Vẫn còn trả lời sau 10s — gửi SIGKILL.');
      for (const pid of pids) {
        try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    log('Đã dừng.');
  }
  appiumProc = null;
  await prereqAppium(log);
}

/**
 * PIDs *listening* on a TCP port. Empty when nothing holds it.
 *
 * `-sTCP:LISTEN` is the whole point, and leaving it out was a bug that killed
 * this server: plain `lsof -ti :4723` also lists every process holding an open
 * connection *to* that port, and this server holds one — `appiumHealthy()`
 * fetches /status through it. Restarting Appium therefore terminated the UI
 * that asked for the restart, which reads to the user as "Failed to fetch".
 */
function listeningPids(port: number): Promise<number[]> {
  return new Promise((resolve) => {
    const child = spawn('lsof', ['-ti', `:${port}`, '-sTCP:LISTEN'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (c: Buffer) => { out += c.toString(); });
    child.on('error', () => resolve([]));
    child.on('close', () => resolve(
      [...new Set(out.split('\n').map((l) => Number(l.trim())).filter((n) => Number.isInteger(n) && n > 0))]
        // Belt and braces after the above: never sign this server's own death
        // warrant, whatever lsof decides to report.
        .filter((pid) => pid !== process.pid && pid !== process.ppid),
    ));
  });
}

/** PIDs whose command line mentions `pattern`, via pgrep -f. */
function pgrepFull(pattern: string): Promise<Set<number>> {
  return new Promise((resolve) => {
    const child = spawn('pgrep', ['-f', pattern], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (c: Buffer) => { out += c.toString(); });
    // pgrep exits 1 with no output when nothing matches; that is not an error.
    child.on('error', () => resolve(new Set()));
    child.on('close', () => resolve(new Set(
      out.split('\n').map((l) => Number(l.trim())).filter((n) => Number.isInteger(n) && n > 0),
    )));
  });
}

/** PIDs whose executable's basename is `name`, via ps. */
function pidsRunning(name: string): Promise<Set<number>> {
  return new Promise((resolve) => {
    const child = spawn('ps', ['-Ao', 'pid=,comm='], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (c: Buffer) => { out += c.toString(); });
    child.on('error', () => resolve(new Set()));
    child.on('close', () => {
      const pids = new Set<number>();
      for (const line of out.split('\n')) {
        // pid, then the executable path — which may itself contain spaces, so
        // everything after the first field is the path.
        const m = /^\s*(\d+)\s+(.*)$/.exec(line);
        if (m && path.basename(m[2]!.trim()) === name) pids.add(Number(m[1]));
      }
      resolve(pids);
    });
  });
}

/**
 * PIDs of the WebDriverAgent test runner — the `xcodebuild … -scheme
 * WebDriverAgentRunner` the iOS driver starts to drive the device.
 *
 * Matched by command line rather than tracked as a child, because it is not
 * one of ours: appium-xcuitest-driver spawns it detached, so by the time
 * anything here wants it gone its parent is init.
 *
 * The command line alone is not enough to justify a SIGKILL, though. `pgrep -f`
 * reads whole command lines, so a shell, an editor or a test script that merely
 * *names* the runner matches too — a stop button that kills the terminal
 * someone typed `pkill -f WebDriverAgentRunner` into is not a stop button. So
 * the name has to appear on a process that really is xcodebuild.
 */
async function webDriverAgentPids(): Promise<number[]> {
  const [named, xcodebuilds] = await Promise.all([
    pgrepFull('WebDriverAgentRunner'),
    pidsRunning('xcodebuild'),
  ]);
  return [...named]
    .filter((pid) => xcodebuilds.has(pid))
    // Belt and braces: never sign this server's own death warrant.
    .filter((pid) => pid !== process.pid && pid !== process.ppid);
}

/**
 * Ends the WebDriverAgent runner. Resolves true when there was one to end.
 *
 * SIGTERM lets xcodebuild tear the test down cleanly, which is what actually
 * clears the banner on the phone; SIGKILL is the fallback for a runner already
 * wedged enough to ignore it.
 */
async function stopWebDriverAgent(log: (l: string) => void = () => {}): Promise<boolean> {
  const pids = await webDriverAgentPids();
  if (pids.length === 0) return false;
  log(`Dừng WebDriverAgent (pid ${pids.join(', ')})…`);
  for (const pid of pids) {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
  }
  for (let i = 0; i < 20 && (await webDriverAgentPids()).length > 0; i++) {
    await new Promise((r) => setTimeout(r, 500));
  }
  const left = await webDriverAgentPids();
  if (left.length > 0) {
    log('Vẫn còn sau 10s — gửi SIGKILL.');
    for (const pid of left) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  log('Đã dừng WebDriverAgent — banner "Automation running" trên máy iOS sẽ tắt.');
  return true;
}

async function prereqAppium(log: (l: string) => void): Promise<void> {
  // If our own process is still alive AND responding, no need to start another.
  if (appiumProc && appiumProc.exitCode === null && await appiumHealthy()) {
    log('✓ Appium server đang chạy rồi (pid ' + appiumProc.pid + ')');
    return;
  }
  appiumProc = null;
  // If something else is already listening on 4723 and responding to WebDriver, don't fight it.
  if (await appiumHealthy()) {
    log('✓ Đã có Appium đang lắng nghe trên port 4723 — sẵn sàng.');
    return;
  }
  return new Promise((resolve, reject) => {
    // Redirect output to a real file descriptor rather than a pipe. This keeps
    // Appium independent from UI-server hot reloads while preserving the only
    // evidence capable of explaining a later process exit.
    const sdkDefault = `${process.env.HOME ?? process.env.USERPROFILE ?? ''}/Library/Android/sdk`;
    const logFd = openSync(APPIUM_LOG_FILE, 'a');
    let child: ReturnType<typeof spawn>;
    try {
      // `*:` is the destination driver, and Appium 3 requires it: a bare
      // `adb_shell` is rejected at startup with "The full feature name must
      // include both the destination automation name or the '*' wildcard".
      // The server then exits before it ever listens, so the UI's only symptom
      // was a start button that did nothing.
      child = spawn('appium', ['--allow-insecure=*:adb_shell,*:chromedriver_autodownload'], {
        stdio: ['ignore', logFd, logFd],
        detached: true,
        env: {
          ...process.env,
          ANDROID_HOME: process.env.ANDROID_HOME ?? sdkDefault,
          ANDROID_SDK_ROOT: process.env.ANDROID_SDK_ROOT ?? sdkDefault,
        },
        // On Windows, spawn needs shell:true to resolve 'appium.cmd' in PATH.
        ...(process.platform === 'win32' ? { shell: true } : {}),
      });
    } finally {
      closeSync(logFd);
    }
    appiumProc = child;
    lastAppiumExit = undefined;
    // Unref immediately so Node doesn't wait on the child.
    child.unref();
    child.on('error', (err: NodeJS.ErrnoException) => {
      appiumProc = null;
      if (err.code === 'ENOENT') {
        reject(new Error(appiumNotFoundMessage()));
      } else {
        reject(err);
      }
    });
    child.on('close', (code, signal) => {
      appiumProc = null;
      lastAppiumExit = { code, signal, at: new Date().toISOString() };
    });

    // Poll /status until Appium is ready (max 30 s).
    log('Đang khởi động Appium…');
    const deadline = Date.now() + 30_000;
    const poll = () => {
      if (Date.now() > deadline) {
        reject(new Error('Appium không phản hồi sau 30 giây.'));
        return;
      }
      fetch('http://127.0.0.1:4723/status', { signal: AbortSignal.timeout(1000) })
        .then((r) => {
          if (r.ok) { log('✓ Appium sẵn sàng trên port 4723.'); resolve(); }
          else setTimeout(poll, 600);
        })
        .catch(() => setTimeout(poll, 600));
    };
    setTimeout(poll, 1000);
  });
}

interface PrereqAndroidDevice {
  id: string;
  state: string;
  manufacturer?: string;
  model?: string;
  androidVersion?: string;
  kind: 'physical' | 'emulator';
}

function captureStdout(bin: string, args: string[], timeoutMs = 8_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout?.on('data', (buffer: Buffer) => { stdout += buffer.toString(); });
    child.stderr?.on('data', (buffer: Buffer) => { stderr += buffer.toString(); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(cleanLog(stderr || stdout).trim() || `${bin} kết thúc với mã ${code}`));
    });
  });
}

async function prereqAdb(): Promise<{ devices: PrereqAndroidDevice[] }> {
  const output = await captureStdout('adb', ['devices', '-l']);
  const base = output.split('\n').slice(1)
    .map((line) => line.trim()).filter(Boolean)
    .map((line) => {
      const [id = '', state = ''] = line.split(/\s+/);
      return { id, state };
    });

  const devices = await Promise.all(base.map(async ({ id, state }): Promise<PrereqAndroidDevice> => {
    const fallbackKind = id.startsWith('emulator-') ? 'emulator' : 'physical';
    if (state !== 'device') return { id, state, kind: fallbackKind };
    try {
      const propsOutput = await captureStdout('adb', ['-s', id, 'shell', 'getprop'], 5_000);
      const props = new Map<string, string>();
      for (const match of propsOutput.matchAll(/^\[([^\]]+)\]: \[(.*)\]$/gm)) {
        props.set(match[1]!, match[2] ?? '');
      }
      const manufacturer = props.get('ro.product.manufacturer')?.trim();
      const model = props.get('ro.product.model')?.trim();
      const androidVersion = props.get('ro.build.version.release')?.trim();
      const emulator = fallbackKind === 'emulator' || props.get('ro.kernel.qemu') === '1';
      return {
        id,
        state,
        ...(manufacturer ? { manufacturer } : {}),
        ...(model ? { model } : {}),
        ...(androidVersion ? { androidVersion } : {}),
        kind: emulator ? 'emulator' : 'physical',
      };
    } catch {
      return { id, state, kind: fallbackKind };
    }
  }));
  return { devices };
}

/**
 * The udids of iOS devices actually plugged in, out of xctrace's full listing.
 *
 * `xctrace list devices` prints three sections and this machine's own name:
 *
 *   == Devices ==
 *   MacBook Air của Tuoi (B652B524-…)      <- the host, not a phone
 *   == Devices Offline ==
 *   iPhone của Anh (26.5) (00008101-…)     <- known, but NOT connected
 *   == Simulators ==
 *   iPhone 17 Simulator (26.5) (20E1F4AE-…)
 *
 * Reading every line as "attached" reported an unplugged iPhone as connected
 * and counted twelve simulators as unknown handsets. Only the first section
 * means plugged in, and within it only entries carrying an OS version are
 * devices — the host has a udid but no version.
 */
function attachedIosUdids(lines: string[]): string[] {
  const udids: string[] = [];
  let inDevices = false;
  for (const line of lines) {
    const header = /^==\s*(.+?)\s*==$/.exec(line);
    if (header) {
      inDevices = header[1] === 'Devices';
      continue;
    }
    if (!inDevices || /simulator/i.test(line)) continue;
    const m = /\([\d.]+\)\s*\(([0-9A-Fa-f-]{8,})\)\s*$/.exec(line);
    if (m?.[1]) udids.push(m[1]);
  }
  return udids;
}

async function prereqIosDevices(): Promise<{ devices: string[]; attached: string[] }> {
  return new Promise((resolve, reject) => {
    let out = '';
    const child = spawn('xcrun', ['xctrace', 'list', 'devices'], { stdio: ['ignore', 'pipe', 'ignore'] });
    // xctrace has been seen to never exit on some Xcode installs. Without a cap
    // the request simply never answers and the button spins forever, which
    // looks like "no devices" rather than like a broken tool.
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({
        attached: [],
        devices: [
          'xcrun xctrace không phản hồi sau 15s.',
          'Thường do bản Xcode đang cài; thử: sudo xcode-select -s /Applications/Xcode.app',
          'rồi mở Xcode một lần để nó hoàn tất cài đặt thành phần.',
        ],
      });
    }, 15_000);
    timer.unref?.();
    child.stdout?.on('data', (b: Buffer) => { out += b.toString(); });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', () => {
      clearTimeout(timer);
      const devices = out.split('\n').map((l) => l.trim()).filter(Boolean);
      resolve({ devices, attached: attachedIosUdids(devices) });
    });
  });
}

/**
 * Whether this machine can build for iOS at all, and how far.
 *
 * Three separate failures look identical from the Appium error alone: no Xcode,
 * Command Line Tools only, or an Xcode too old for the phone's iOS version.
 * The last one is the quiet trap — everything installs, WebDriverAgent simply
 * refuses to deploy onto a device newer than the SDK.
 */
async function prereqXcode(): Promise<{
  ok: boolean; version?: string; path?: string; sdk?: string; reason?: string;
}> {
  const run = async (cmd: string): Promise<string | undefined> => {
    try {
      const { stdout } = await execFileAsync('/bin/sh', ['-c', cmd], { timeout: 20_000 });
      return stdout.trim();
    } catch {
      return undefined;
    }
  };

  const selected = await run('xcode-select -p');
  if (!selected) return { ok: false, reason: 'Chưa cài Xcode, hoặc xcode-select chưa trỏ tới đâu cả.' };
  if (!selected.includes('.app')) {
    return {
      ok: false,
      path: selected,
      reason: 'Đang trỏ tới Command Line Tools, không phải Xcode đầy đủ. '
        + 'Cài Xcode rồi chạy: sudo xcode-select -s /Applications/Xcode.app',
    };
  }

  const version = (await run('xcodebuild -version'))?.split('\n')[0];
  if (!version) {
    return { ok: false, path: selected, reason: 'xcodebuild không chạy được — mở Xcode một lần để nó hoàn tất cài đặt.' };
  }
  const sdk = (await run("xcodebuild -showsdks | grep -o 'iphoneos[0-9.]*' | tail -1"));
  return { ok: true, version, path: selected, ...(sdk ? { sdk } : {}) };
}

async function prereqInstallDriver(driver: string, log: (l: string) => void): Promise<void> {
  const safe = /^[a-z0-9-]+$/.test(driver) ? driver : '';
  if (!safe) throw new Error('Tên driver không hợp lệ');
  return new Promise((resolve, reject) => {
    let output = '';
    const child = spawn('appium', ['driver', 'install', safe], { stdio: ['ignore', 'pipe', 'pipe'] });
    const onData = (b: Buffer) => {
      // Buffer until the command exits. Appium reports an already-installed
      // driver as an Error on stderr with a non-zero exit code, even though the
      // machine is fully ready. Streaming that line cannot be retracted and
      // makes a successful prerequisite look like a failure in the UI.
      output += b.toString();
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', reject);
    child.on('close', (code) => {
      const cleaned = cleanLog(output).trim();
      // "already installed" is not an error — driver is ready to use.
      if (/already installed/i.test(cleaned)) {
        log(`✓ Driver ${safe} đã được cài và sẵn sàng sử dụng.`);
        return resolve();
      }
      if (code === 0) {
        log(`✓ Driver ${safe} đã được cài đặt thành công.`);
        return resolve();
      }
      if (cleaned) log(cleaned);
      reject(new Error(`Cài driver thất bại (mã ${code}) — xem log bên trên.`));
    });
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return (raw ? JSON.parse(raw) : {}) as T;
}
