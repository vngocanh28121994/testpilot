import type { IncomingMessage, ServerResponse } from 'node:http';
import { activeRuns, beginActiveRun, endActiveRun, findActiveRun } from './activeRuns.js';
import { closeInterruptedRuns, reindex } from '../core/runstore.js';
import { mergeRunLearnings } from '../core/learned.js';
import { recoverInterruptedRunReports } from '../core/interruptedReport.js';
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
import { createHash } from 'node:crypto';
import { completeJson, listModels, llmAvailable, missingKeyHint, pickModel } from '../llm/client.js';
import { ConfigSchema, applyEnv, devicesOf, loadConfig, resolveModel, saveConfig, type TestPilotConfig } from '../config.js';
// Hợp đồng dùng chung với app React ở ui/. Chỉ có type — không kéo theo gì
// lúc chạy. Gắn kiểu trả về cho handler ở đây chính là chỗ TypeScript bắt
// được lệch hợp đồng, thay vì để nó nổ ở trình duyệt. Xem contracts.ts.
import type {
  Build,
  DuplicateElementView,
  DuplicateReviewRequest,
  HealingResponse,
  HistoryResponse,
  RunHistoryEntry,
  StateResponse,
  FeatureNormalizeResponse,
} from './contracts.js';
import { Registry } from '../core/registry.js';
import type { ElementDef, LocatorCandidate, Platform } from '../core/types.js';
import { findDuplicateElements } from '../core/duplicateElements.js';
import { DuplicateReviewStore } from '../core/duplicateReview.js';
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
import { IOS_TUNNEL_COMMAND, preflight, preflightSummary } from '../core/preflight.js';
import { poolPlatformMismatch, resolveFarmTarget } from '../farm/target.js';
import { buildInventory } from '../core/builds.js';
import { attachedFromDevicectl } from '../core/iosDevices.js';
import { expandApprovedActions } from '../actions/expandActions.js';
import { normalizeFeatureTags, tagTaxonomyView } from '../core/tagTaxonomy.js';
import {
  assertFarmReady,
  awsLogin,
  awsStatus,
  createDevicePool,
  listDevicePools,
  listDevices,
  listProjects,
  collectFarmRun,
  scheduleFarmRun,
} from '../farm/devicefarm.js';
import { runGenPipeline } from '../genspec/pipeline.js';
import { prepareExecutableDraft } from '../genspec/draft.js';
import {
  tryAuditFeatureCoverage,
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
import { refreshHtmlReportIfStale } from '../report/refresh.js';
import { reportShotContexts } from './reportEvidence.js';
import { syncPomProject } from '../pom/sync.js';
import { HealingStore } from '../healing/HealingStore.js';
import { assessLocatorQuality } from '../core/locatorQuality.js';
import { ensurePersonalConfig, personalConfigProfile } from '../core/personalConfig.js';
import {
  json,
  listen,
  PORT,
  readJson,
  serveStaticRequest,
  stream,
} from '../server/http.js';
import type { RouteContext } from '../server/routes/types.js';
import { allRoutes } from '../server/routes/index.js';
// Hai thứ còn lại của phần prereq mà `POST /api/run` và `POST /api/run/stop`
// vẫn dùng. Chúng đi theo hai route ấy sang runner ở nhóm 6; tới lúc đó import
// này biến mất.
import { cleanLog } from '../runner/prereq.js';
// `runWorkflow` còn ở đây (nhóm 8) và nó chạy suite ở chặng cuối; `runChildren`
// để đường thoát SIGINT dừng được tiến trình con. Cả hai đi theo workflow sang
// runner ở nhóm 8 — tới lúc đó import này biến mất.
import { orphans, runChildren, runSuite, type RunSuiteOutcome } from '../runner/execute.js';
import { runOnFarm, spawnStep, type FarmHandoff } from '../runner/farm.js';
import { applyForm } from '../server/routes/studio.js';
import { configRevision } from '../server/routes/config.js';
import { featureRevision } from '../server/routes/feature.js';
import { recentRuns } from '../server/routes/history.js';
import {
  ActionRegistry,
  validateExecutableAction,
  type LearnedActionDef,
  type LearnedActionKind,
} from '../actions/ActionRegistry.js';

/**
 * Local control panel. Single user, single machine — so it is a plain node:http
 * server phục vụ bundle React đã build. Nó đọc và ghi cùng
 * `testpilot.config.json` the CLI reads, which keeps the UI a convenience
 * rather than a second source of truth.
 */

const execFileAsync = promisify(execFile);
const CONFIG_PROFILE = await ensurePersonalConfig(personalConfigProfile());
const CONFIG_FILE = CONFIG_PROFILE.file;
// Every CLI child spawned by the UI must read the same user's profile.
process.env.TESTPILOT_CONFIG = CONFIG_FILE;

await adoptStoredApiKeys();


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
      const reports = await recoverInterruptedRunReports(cfgForCleanup.paths.runs, runs);
      if (reports.length > 0) {
        console.log(`[cleanup] tạo ${reports.length} báo cáo gián đoạn: ${reports.join(', ')}`);
      }
      // listRuns normally trusts its cached index. Refresh it now so the
      // recovered run appears in Local Runner on the first request.
      await reindex(cfgForCleanup.paths.runs);
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

listen(handle);

/**
 * Route đã tách khỏi `switch`. Tra bảng trước, không thấy thì rơi xuống dưới.
 *
 * Hai chỗ so khớp cùng một lúc là tạm thời và có chủ ý: nó cho phép chuyển vài
 * route mỗi commit mà bản đang chạy không gián đoạn. Khi `switch` rỗng thì bảng
 * là chỗ duy nhất — đó là điều kiện hoàn thành P1.2.
 */
const ROUTES = allRoutes;

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const route = `${req.method} ${url.pathname}`;

  const ctx: RouteContext = { configFile: CONFIG_FILE };
  const moved = ROUTES[route];
  if (moved) return moved(req, res, url, ctx);

  switch (route) {
    case 'GET /api/state':
      return json(res, 200, await state());

    case 'POST /api/mcp/tools':
      return json(res, 200, await mcpTools(await readJson(req)));

    case 'POST /api/feature/normalize': {
      const { content } = await readJson<{ content: string }>(req);
      const cfg = await loadConfig(CONFIG_FILE);
      const registry = await Registry.load(cfg.paths.registry);
      const actions = await ActionRegistry.load(cfg.paths.actionsDb);
      return json(res, 200, await normalizeFeatureDraft(content, registry, actions, pickModel(cfg.llm.model)));
    }

    case 'POST /api/gen': {
      const form = await readJson<StudioForm>(req);
      // Persist before streaming: the form is the config, and a run whose inputs
      // were never saved could not be reproduced from a terminal.
      const cfg = await applyForm(form, CONFIG_FILE);
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
      const { runId, appSource, retry } = await readJson<{
        runId: string;
        appSource?: 'device' | 'upload';
        retry?: boolean;
      }>(req);
      if (!runId) return json(res, 400, { error: 'Thiếu workflow ID.' });
      if (appSource && appSource !== 'device' && appSource !== 'upload') {
        return json(res, 400, { error: 'Nguồn app không hợp lệ.' });
      }
      const effectiveRunId = retry ? await retryFailedWorkflow(runId, appSource) : runId;
      return stream(
        res,
        (log, stage) => continueWorkflow(effectiveRunId, log, stage, appSource),
        (err) => failRunningWorkflow(effectiveRunId, err),
      );
    }

    /**
     * Bỏ một workflow đang chờ duyệt.
     *
     * Không có đường này thì một lượt chạy bỏ dở nằm lại vĩnh viễn: màn Kịch
     * bản hiện banner "Workflow đang chờ bạn" ở MỌI lần vào, kể cả khi lượt đó
     * đã hai ngày tuổi và người ta đã sinh bộ testcase khác từ lâu. Banner nói
     * đúng sự thật, chỉ là không có cách nào làm cho nó thôi đúng.
     *
     * Kịch bản đã sinh vẫn nằm nguyên trong danh sách duyệt — bỏ workflow là bỏ
     * cái cổng, không phải bỏ việc đã làm.
     */
    case 'POST /api/workflow/abandon': {
      const { runId } = await readJson<{ runId: string }>(req);
      if (!runId) return json(res, 400, { error: 'Thiếu workflow ID.' });
      const history = await History.load();
      const run = history.find(runId);
      if (!run) return json(res, 404, { error: 'Không tìm thấy workflow.' });
      if (run.status !== 'waiting_review' && run.status !== 'waiting_input') {
        return json(res, 409, { error: `Workflow đang ở trạng thái “${run.status}”, không phải đang chờ.` });
      }
      run.status = 'failed';
      run.error = 'Người dùng bỏ workflow đang chờ duyệt.';
      run.finishedAt = new Date().toISOString();
      await history.save();
      return json(res, 200, { ok: true });
    }

      return json(res, 200, await buildInventory(await loadConfig(CONFIG_FILE)));

  }

  if (await serveStaticRequest(req, res, url)) return;

  json(res, 404, { error: `No route for ${route}` });
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
        phraseTemplate: 'tìm kiếm "{{keyword}}"',
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
  let result = normalizeNaturalSteps(learned.content, registry);
  const changes = [...planned.changes, ...learned.changes, ...result.changes];
  let usedAi = scenarioPlan.source === 'ai';
  const actionProposals: LearnedActionDef[] = [];
  const aiAvailable = llmAvailable();

  // Never send a password/token-bearing step to an external model. Those lines
  // remain visible to the reviewer as unresolved and can be edited locally.
  const aiCandidates = result.unresolved.filter((item) => !isSensitiveStep(item.text));
  if (aiCandidates.length > 0 && aiAvailable) {
    const normalizedLines = result.content.split('\n');
    const contextualCandidates = aiCandidates.map((item) => {
      const neighboringStep = (direction: -1 | 1): string | undefined => {
        for (let index = item.line - 1 + direction; index >= 0 && index < normalizedLines.length; index += direction) {
          const match = normalizedLines[index]?.match(/^\s*(?:Given|When|Then|And|But)\s+(.+)$/iu);
          if (match) return match[1]!.trim();
        }
        return undefined;
      };
      return {
        ...item,
        ...(neighboringStep(-1) ? { previousStep: neighboringStep(-1) } : {}),
        ...(neighboringStep(1) ? { nextStep: neighboringStep(1) } : {}),
      };
    });
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
        'The phraseTemplate must keep the source language and sentence shape so it matches sourceExample after substituting parameters.',
        'Each unresolved item may include previousStep and nextStep. Do not repeat setup already performed by previousStep or consume behavior belonging to nextStep.',
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
        unresolved: contextualCandidates,
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
      result = normalizeNaturalSteps(lines.join('\n'), registry);
      changes.push(...result.changes);
      usedAi = true;
    }
    for (const proposal of parsed?.actionProposals ?? []) {
      const source = result.unresolved.find((item) => item.line === proposal.line)?.text;
      if (!source || !proposal.label || !proposal.phraseTemplate || !proposal.kind) continue;
      const proposalInput = {
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
      };
      if (proposalInput.kind !== 'primitive') {
        const validationError = validateExecutableAction({
          ...proposalInput,
          id: 'proposal-validation',
          status: 'proposed',
          createdAt: new Date(0).toISOString(),
        });
        if (validationError) continue;
      }
      const candidate = actions.propose(proposalInput);
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
  if (compacted !== result.content) result = normalizeNaturalSteps(compacted, registry);

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
      result = normalizeNaturalSteps(prepared.content, registry);
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
  const runs = await recentRuns();
  // A history detail must be able to resolve every report it explicitly
  // references. The general report list is capped for payload size, but a
  // burst of newer local runs must not make an older farm detail lose its
  // screenshots and videos while the files are still on disk.
  const referencedReportIds = new Set(runs.flatMap((run) => run.runDirs ?? []));
  const reports = await listReports(config, referencedReportIds);
  const secrets = await Secrets.load();

  return {
    config,
    configError,
    configRevision: await configRevision(CONFIG_FILE),
    configProfile: {
      owner: CONFIG_PROFILE.owner,
      source: CONFIG_PROFILE.source,
    },
    features,
    elements,
    reports,
    runs,
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

async function listReports(cfg: TestPilotConfig, referencedIds: ReadonlySet<string> = new Set()) {
  const runs = await listRuns(cfg.paths.runs);
  const knownIssues = await KnownIssueStore.load(cfg.paths.knownIssuesDb);
  const visibleRuns = runs.filter(
    (run, index) => index < MAX_REPORTS || referencedIds.has(run.id),
  );
  return Promise.all(
    visibleRuns
      .filter((r) => existsSync(path.join(cfg.paths.runs, r.id, 'index.html')))
      .map(async (r) => {
        const runDir = path.join(cfg.paths.runs, r.id);

        // `index.html` is a static snapshot. Without this versioned backfill,
        // opening two history rows can show two generations of the report UI
        // even though both are served by the same screen. Never touch an active
        // run; completed reports are rebuilt once from their immutable JSON.
        if (r.status !== 'running') {
          await refreshHtmlReportIfStale(runDir, knownIssues).catch((err) => {
            console.warn(`[report] không nâng được ${r.id}: ${(err as Error).message}`);
          });
        }

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
        const shotContexts = await reportShotContexts(runDir, knownIssues);
        const shotUrls = existsSync(shotDir)
          ? (await readdir(shotDir))
              .filter((f) => /\.png$/i.test(f))
              .sort()
              .map((f) => {
                const name = f.replace(/\.png$/i, '');
                const context = shotContexts.get(f);
                return {
                  name,
                  url: `/${cfg.paths.runs}/${r.id}/artifacts/${f}`,
                  // `tap-declined` is also a failure shot even though its name
                  // cannot carry the scenario slug.
                  onFailure: Boolean(context?.error)
                    || /-a\d+-l\d+-fail$/.test(name)
                    || name.startsWith('tap-declined-'),
                  ...(context ?? {}),
                };
              })
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

/**
 * Kết quả chuẩn hoá, đúng hình dạng mà trình duyệt nhận.
 *
 * Lấy thẳng từ contracts thay vì khai lại: hai bản khai song song là cách một
 * field bị đổi ở đây mà giao diện vẫn tưởng nó còn nguyên.
 */
type DraftNormalization = FeatureNormalizeResponse & { scenarioPlan: ScenarioPlan }

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

function isSensitiveStep(text: string): boolean {
  return /password|mật\s*khẩu|secret|token|api[_ -]?key/i.test(text);
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
  /** Bản đã cài sẵn trên máy, hay bản đã tải lên. */
  workflowAppSource?: 'device' | 'upload';
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
  // Lượt chờ cũ được thay chỗ ngay tại đây, trước khi lượt mới có mặt trong sổ:
  // xem chú thích ở supersedeWaiting().
  const superseded = history.supersedeWaiting('workflow');
  const run = history.start(cfg.targetFeature || '(chưa đọc được tài liệu)', 'workflow', WORKFLOW_STAGES);
  run.execution = {
    platforms: cfg.workflow.platforms,
    ...(cfg.workflow.deviceFarm ? { deviceFarm: cfg.workflow.deviceFarm } : {}),
    env: cfg.workflow.env || cfg.defaultEnv,
    headed: cfg.workflow.headed,
    locatorRetries: cfg.workflow.locatorRetries,
    appSource: cfg.workflow.appSource,
  };
  await history.save();
  stage(run);
  if (superseded > 0) {
    log(`${superseded} workflow đang chờ duyệt trước đó đã được thay chỗ bởi lượt này.`);
  }

  // Workflow cùng bệnh với lượt chạy local: log chỉ tồn tại trên đường dây SSE
  // của tab đã bấm nút. Đưa nó vào sổ lượt chạy đang sống để một trang khác nối
  // lại được sau khi reload.
  const live = beginActiveRun(cfg.targetFeature || 'workflow', 'workflow');
  const record = (line: string) => {
    run.log.push(line);
    live.push(line);
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
    endActiveRun(live);
    stage(run);
    await history.save();
  }
}

/** Resume the same durable workflow after the only human gate: testcase review. */
async function continueWorkflow(
  runId: string,
  log: (line: string) => void,
  stage: (run: WorkflowRun) => void,
  appSource?: 'device' | 'upload',
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

  const execution = run.execution ?? {
    platforms: cfg.workflow.platforms,
    ...(cfg.workflow.deviceFarm ? { deviceFarm: cfg.workflow.deviceFarm } : {}),
    env: cfg.workflow.env || cfg.defaultEnv,
    headed: cfg.workflow.headed,
    locatorRetries: cfg.workflow.locatorRetries,
    appSource: cfg.workflow.appSource,
  };
  if (appSource) execution.appSource = appSource;
  run.execution = execution;

  const set = async (index: number, status: WorkflowRun['stages'][number]['status']) => {
    const item = run.stages[index];
    if (item) item.status = status;
    stage(run);
    await history.save();
  };

  // Persist the hand-off before the optional model call. If the tab disconnects
  // or the server stops here, history must no longer claim that review is still
  // waiting for the user.
  run.status = 'running';
  delete run.error;
  await set(5, 'done');
  await set(6, 'running');

  // Re-audit after edits for traceability, but do not create a second hidden
  // approval gate. The business user has explicitly approved/rejected every
  // scenario; missing coverage remains visible as a warning in the report.
  const coverageRecord = await readFeatureCoverage(cfg, run.generatedFile);
  if (coverageRecord && coverageRecord.requirements.length > 0) {
    record('Đang đối chiếu testcase đã duyệt với các yêu cầu nghiệp vụ quan trọng…');
    await history.save();
    const approvedFeature = featureWithApprovedScenarios(content, blocks, approved);
    const attempt = await tryAuditFeatureCoverage(approvedFeature, coverageRecord.requirements, {
      model: resolveModel(cfg.llm.model),
    });
    if (!attempt.ok) {
      record(
        `⚠ Không thể đối chiếu lại yêu cầu nghiệp vụ lúc này: ${attempt.error}. `
        + 'Đây là bước bổ trợ nên workflow vẫn tiếp tục chạy automation.',
      );
      await history.save();
    } else {
      const audit = attempt.audit;
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
      await history.save();
    }
  }
  record(`${approved.length}/${blocks.length} testcase đã được duyệt; bắt đầu automation.`);

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
  const preflightResults = await Promise.all(
    execution.platforms.map(async (platform) => ({ platform, result: await preflight(platform, cfg) })),
  );
  for (const { platform, result } of preflightResults) {
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
  // Mỗi tiến trình run.ts bình thường tự ghi lại toàn bộ registry/healing/flake.
  // Hai tiến trình kết thúc gần nhau sẽ gây last-writer-wins và làm mất dữ liệu
  // của nhánh còn lại. Khi có nhiều nền tảng, từng nhánh chỉ ghi learnings vào
  // run directory riêng; coordinator này gộp tất cả đúng một lần sau Promise.all.
  const deferSharedWrites = execution.platforms.length > 1;
  const localOutcomes = await Promise.all(execution.platforms.map(async (platform) => {
    // Checked again, immediately before this platform's own run. The gate above
    // gives the complete picture before anything starts, but the environment
    // can still change while the other parallel branches are being prepared —
    // Appium gets closed, a phone gets unplugged, a cable gets borrowed.
    // Re-probing costs a moment and turns a WebDriver stack trace into a sentence.
    if (platform !== 'web') {
      const recheck = await preflight(platform, cfg);
      if (!recheck.ok) {
        record(`\n✗ Bỏ qua ${platform}: môi trường đã đổi kể từ lúc kiểm tra.`);
        record(preflightSummary(recheck));
        return { code: 1, stopped: false, reportPaths: [], runDirs: [] } satisfies RunSuiteOutcome;
      }
      if (recheck.device) chosenDevice.set(platform, recheck.device);
    }
    const device = chosenDevice.get(platform);
    record(`\n▶ Chạy ${run.generatedFile} trên ${platform}${device ? ` (${device})` : ''}…`);
    return runSuite(
      platform,
      undefined,
      platform === 'web' && Boolean(execution.headed),
      true,
      (line) => record(`[${platform}] ${line}`),
      device,
      execution.env,
      run.generatedFile,
      execution.locatorRetries ?? 1,
      execution.appSource,
      deferSharedWrites,
    );
  }));
  outcomes.push(...localOutcomes);

  if (deferSharedWrites) {
    const runDirs = localOutcomes.flatMap((outcome) => outcome.runDirs);
    if (runDirs.length > 0) {
      const merged = await mergeRunLearnings({
        runDirs,
        runsRoot: cfg.paths.runs,
        registryPath: cfg.paths.registry,
        runtimeRegistryPath: 'registry/runtime-registry.json',
        flakeDbPath: cfg.paths.flakeDb,
        healingDbPath: cfg.paths.healingDb,
        flakePolicy: cfg.flake,
      });
      record(
        `Đã gộp dữ liệu từ ${merged.runIds.length}/${execution.platforms.length} nền tảng: `
          + `${merged.elementsMerged} element, ${merged.runtimeEntriesMerged} runtime locator, `
          + `${merged.healingEventsIngested} healing event.`,
      );
      for (const skipped of merged.skipped) {
        record(`⚠ ${skipped.runId}: ${skipped.reason}.`);
      }
    } else {
      record('⚠ Không nền tảng nào tạo được thư mục kết quả để gộp dữ liệu runtime.');
    }
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
        outcomes.push({ code: farm.passed ? 0 : 1, stopped: false, reportPaths: [], runDirs: [] });
        record(
          farm.passed
            ? `✓ Device Farm pass. Chi tiết ở lượt chạy ${farm.id}, tab Device Farm.`
            : `✗ Device Farm fail. Chi tiết ở lượt chạy ${farm.id}, tab Device Farm.`,
        );
      } catch (err) {
        record(`✗ Không bàn giao được cho Device Farm: ${(err as Error).message}`);
        outcomes.push({ code: 1, stopped: false, reportPaths: [], runDirs: [] });
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

/** Persist unexpected continuation errors before the SSE response disappears. */
async function failRunningWorkflow(runId: string, err: unknown): Promise<WorkflowRun | undefined> {
  const history = await History.load();
  const run = history.find(runId);
  // Validation errors raised while review is still incomplete must leave the
  // durable human gate intact. Only a continuation that actually started owns
  // a running stage and may be closed as failed here.
  if (!run || run.kind !== 'workflow' || run.status !== 'running') return undefined;

  const message = err instanceof Error ? err.message : String(err);
  run.status = 'failed';
  run.error = message;
  run.finishedAt = new Date().toISOString();
  for (const item of run.stages) {
    if (item.status === 'running') item.status = 'failed';
  }
  run.log.push(`✗ Workflow dừng: ${message}`);
  await history.save();
  return run;
}

/** Create a fresh history record while reusing the already-reviewed suite. */
async function retryFailedWorkflow(
  runId: string,
  appSource?: 'device' | 'upload',
): Promise<string> {
  const history = await History.load();
  const previous = history.find(runId);
  if (!previous || previous.kind !== 'workflow') throw new Error('Không tìm thấy workflow cần chạy lại.');
  if (previous.status !== 'failed') {
    throw new Error(`Workflow đang ở trạng thái “${previous.status}”, không thể tạo lượt chạy lại.`);
  }
  if (!previous.generatedFile) throw new Error('Workflow cũ không có feature file để chạy lại.');

  const retry = history.start(previous.feature, 'workflow', WORKFLOW_STAGES);
  retry.status = 'waiting_review';
  retry.generatedFile = previous.generatedFile;
  retry.generated = previous.generated
    ? {
        ...previous.generated,
        coverageMissing: previous.generated.coverageMissing?.map((item) => ({ ...item })),
      }
    : undefined;
  retry.execution = previous.execution
    ? { ...previous.execution, platforms: [...previous.execution.platforms] }
    : undefined;
  if (appSource && retry.execution) retry.execution.appSource = appSource;
  for (let index = 0; index <= 4; index += 1) retry.stages[index]!.status = 'done';
  retry.stages[5]!.status = 'running';
  retry.log.push(`Chạy lại từ workflow ${previous.id}; giữ nguyên bộ testcase đã duyệt.`);
  await history.save();
  return retry.id;
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

/* ------------------------------------------------------------------ */
/* AWS Device Farm                                                     */
/* ------------------------------------------------------------------ */

/** APK/IPA uploaded from the browser, parked next to the built test package. */

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

/**
 * Send the freshly approved feature to Device Farm.
 *
 * The farm keeps its own history record and its own four stages; this returns
 * that record's id so the workflow can point at it. Scoped by the feature's own
 * tag, because the farm selects scenarios by tag and the workflow has no
 * business re-running the rest of the suite on billed hardware.
 */
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

/**
 * Every test process this server started and has not seen exit.
 *
 * A single handle used to be enough, and was quietly wrong even before parallel
 * runs existed: starting a second run overwrote the reference, so Stop could
 * only reach the newest one and the earlier process kept driving a device with
 * nobody able to stop it. A set reaches all of them.
 */

/** Delegates to the CLI so the UI and a terminal run exactly the same code. */

/** `android:pixel` -> {platform, id}. Anything malformed is dropped, not guessed at. */

/** Whether the config lists this device, as opposed to synthesising it. */

/* ------------------------------------------------------------------ */
/* Plumbing                                                            */
/* ------------------------------------------------------------------ */

/**
 * Server-sent events over a POST, read by the client with a stream reader.
 * Two channels: `log` for console lines, `run` for the stage tracker that draws
 * the progress list and the "3/7" cell.
 */
