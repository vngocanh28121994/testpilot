/**
 * Workflow: tài liệu → testcase → chạy, và những chặng hỏi lại con người ở giữa.
 *
 * Chặng cuối của P1.2, và là chặng khó nhất — không phải vì code khó, mà vì nó
 * gọi gần như mọi thứ đã chuyển trước đó: sinh spec, chạy suite local, bàn giao
 * sang Device Farm, ghi lịch sử, đọc coverage. Chuyển nó cuối cùng là có chủ ý:
 * mọi thứ nó gọi đã yên chỗ rồi.
 *
 * Chạy ở đâu thì tuỳ chiếc máy đã chọn:
 *
 * - Máy cắm vào CHÍNH máy chủ → `runSuite` tại chỗ, như từ trước tới nay.
 * - Máy cắm ở runner KHÁC — laptop của một người, hay một máy chủ phòng máy
 *   khác — → một job `run_suite` trong hàng đợi, mang theo file feature và
 *   registry trong snapshot, vì cả hai đều nằm ở đây chứ không nằm ở đó. Xem
 *   [remoteRuns.ts](../remoteRuns.ts) và [jobWorkspace.ts](../../runner/jobWorkspace.ts).
 *
 * Trước khi có nhánh thứ hai, workflow chỉ chạm được máy cắm vào máy chủ —
 * trong khi Local Runner đã chạy được trên mọi máy qua hàng đợi. Cùng một
 * chiếc điện thoại chạy được từ màn này mà không chạy được từ màn kia.
 */
import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applyEnv, assertEnvPackage, devicesOf, loadConfig, resolveModel, type TestPilotConfig } from '../../config.js';
import { preflight, preflightSummary } from '../../core/preflight.js';
import {
  remotePreflight,
  remoteRunsFor,
  type RemoteDevice,
  type RemoteRunResult,
  type RemoteRuns,
} from '../remoteRuns.js';
import { runSuite, type RunSuiteOutcome } from '../../runner/execute.js';
import { runOnFarm, spawnStep, type FarmHandoff } from '../../runner/farm.js';
import { resolveFarmTarget } from '../../farm/target.js';
import { assertFarmReady } from '../../farm/devicefarm.js';
import {
  pendingQuestions,
  submitAnswers,
  QuestionError,
  type AnswerSubmission,
} from '../../core/questions.js';
import {
  FARM_STAGES,
  History,
  WORKFLOW_STAGES,
  stagesDone,
  type WorkflowQuestion,
  type WorkflowRun,
} from '../../core/history.js';
import { ScenarioReviewStore, scenarioBlocks } from '../../core/scenarioReview.js';
import { KnownIssueStore } from '../../core/knownIssues.js';
import { runGenPipeline } from '../../genspec/pipeline.js';
import { tryAuditFeatureCoverage } from '../../genspec/coverage.js';
import { parseFeature } from '../../steps/binding.js';
import { mergeRunLearnings } from '../../core/learned.js';
import { syncPomProject } from '../../pom/sync.js';
import { localRunner } from '../../runner/index.js';
import { beginActiveRun, endActiveRun } from '../../ui/activeRuns.js';
import { applyForm } from './studio.js';
import { readFeatureCoverage, saveFeatureCoverageAudit } from './state.js';
import { json, readJson, stream } from '../http.js';
import type { RouteTable } from './types.js';

export interface StudioForm {
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

interface WorkflowRecoverySummary {
  healedSteps: number;
  retriedScenarios: number;
  environmentFailures: number;
  assertionFailures: number;
}

export interface FarmForm {
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

async function runWorkflow(
  configFile: string,
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

export async function continueWorkflow(
  configFile: string,
  runId: string,
  log: (line: string) => void,
  stage: (run: WorkflowRun) => void,
  appSource?: 'device' | 'upload',
  /**
   * Đường chạy trên máy cắm ở RUNNER KHÁC, qua hàng đợi job.
   *
   * Vắng mặt thì mọi nền tảng chạy tại chỗ như trước. Có mặt thì nền tảng nào
   * đã chọn một chiếc máy nằm ở laptop người khác sẽ đi đường hàng đợi — xem
   * [remoteRuns.ts](../remoteRuns.ts).
   */
  remote?: RemoteRuns,
  /** Để test dựng lịch sử trong thư mục tạm. */
  historyFile?: string,
): Promise<void> {
  const history = await History.load(historyFile);
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

  const cfg = await loadConfig(configFile);
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
  // Chỉ những kịch bản ĐÃ DUYỆT. Dùng cho phép đối chiếu coverage bên dưới,
  // và cũng chính là thứ gửi sang runner ở xa: ở đó một file mới được coi là
  // đã duyệt hết, nên gửi nguyên file là chạy luôn cả kịch bản bị từ chối.
  const approvedFeature = featureWithApprovedScenarios(content, blocks, approved);
  const coverageRecord = await readFeatureCoverage(cfg, run.generatedFile);
  if (coverageRecord && coverageRecord.requirements.length > 0) {
    record('Đang đối chiếu testcase đã duyệt với các yêu cầu nghiệp vụ quan trọng…');
    await history.save();
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
  // Máy đã chọn cho từng nền tảng nằm ở đâu. Máy ở runner KHÁC thì máy chủ
  // không dò được — nó không cắm ở đây — nên phép kiểm của nó là thứ chính
  // runner ấy đã đo và báo lên sổ, không phải một lần `adb devices` tại chỗ
  // sẽ luôn trả lời "chưa cắm".
  const away = new Map<string, RemoteDevice>();
  if (remote) {
    for (const platform of execution.platforms) {
      if (platform !== 'android' && platform !== 'ios') continue;
      const choice = cfg.workflow.devices?.[platform];
      if (!choice) continue;
      const udid = devicesOf(cfg, platform).find((device) => device.id === choice)?.udid ?? choice;
      const found = await remote.locate(udid);
      if (found) away.set(platform, found);
    }
  }
  const preflightResults = await Promise.all(
    execution.platforms.map(async (platform) => {
      const there = away.get(platform);
      return {
        platform,
        result: there
          ? remotePreflight(platform, there, execution.appSource)
          : await preflight(platform, cfg),
      };
    }),
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
  /** Job đã gửi sang runner khác — report của chúng nằm ở đó, không ở đây. */
  const remoteJobs: Array<{ platform: string } & RemoteRunResult> = [];
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
    const there = away.get(platform);
    if (there && remote && (platform === 'android' || platform === 'ios')) {
      record(
        `\n▶ Chạy ${run.generatedFile} trên ${platform} (${there.label}) — máy cắm ở `
        + `${there.runnerName ?? there.runnerId}, gửi qua hàng đợi…`,
      );
      const result = await remote.run(
        {
          platform,
          udid: there.udid,
          feature: { name: path.basename(run.generatedFile!), content: approvedFeature },
          ...(execution.env ? { env: execution.env } : {}),
          ...(execution.appSource ? { appSource: execution.appSource } : {}),
        },
        (line) => record(`[${platform}] ${line}`),
      );
      remoteJobs.push({ platform, ...result });
      if (result.error) record(`[${platform}] ${result.error}`);
      return {
        code: result.state === 'succeeded' ? 0 : 1,
        stopped: result.state === 'cancelled',
        reportPaths: [],
        runDirs: [],
      } satisfies RunSuiteOutcome;
    }
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
    // CHÚ Ý cho P3: `mergeRunLearnings` nhận ĐƯỜNG DẪN file, không nhận repo.
    //
    // Đó không phải sót — phép gộp này chạy sau khi các tiến trình con đã ghi
    // learnings vào thư mục lượt chạy của chúng, và ở chế độ server những thư
    // mục ấy nằm trên máy RUNNER, không nằm trên server. Nên đường đúng không
    // phải là "đổi hàm này sang repo" mà là "runner gửi delta lên qua
    // `JobResult.registryProposal`", rồi control plane gọi
    // `repos.registry.merge()`. Đó là P4.4, và `execute.ts` đã có sẵn
    // `changesSinceLoad()` để sinh delta ấy.
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
          configFile,
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
  }
  // Report của lượt chạy ở xa nằm trên CHÍNH runner ấy và được đẩy lên kho
  // artifact; máy chủ không đọc được thư mục của nó. Nói ra nó ở đâu, thay vì
  // đánh dấu giai đoạn này hỏng chỉ vì không có file nào nằm trên đĩa ở đây.
  for (const job of remoteJobs) {
    record(`Report của ${job.platform} nằm ở job ${job.jobId} — xem ở trang Thiết bị & hàng đợi.`);
  }
  await set(9, reportPaths.length > 0 || remoteJobs.length > 0 ? 'done' : 'failed');

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
 * Send the freshly approved feature to Device Farm.
 *
 * The farm keeps its own history record and its own four stages; this returns
 * that record's id so the workflow can point at it. Scoped by the feature's own
 * tag, because the farm selects scenarios by tag and the workflow has no
 * business re-running the rest of the suite on billed hardware.
 */
async function handOffToFarm(
  configFile: string,
  platform: 'android' | 'ios',
  generatedFile: string | undefined,
  record: (line: string) => void,
  stage: (run: WorkflowRun) => void,
): Promise<FarmHandoff> {
  const cfg = await loadConfig(configFile);
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

export const workflowRoutes: RouteTable = {
  'POST /api/gen': async (req, res, url, ctx) => {
    const form = await readJson<StudioForm>(req);
    // Persist before streaming: the form is the config, and a run whose inputs
    // were never saved could not be reproduced from a terminal.
    const cfg = await applyForm(form, ctx.configFile);
    return stream(res, (log, stage) => runWorkflow(ctx.configFile, cfg, log, stage));
  },

  'GET /api/workflow/questions': async (req, res, url, ctx) => {
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
  },

  'POST /api/workflow/answers': async (req, res, url, ctx) => {
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
  },

  'POST /api/workflow/complete': async (req, res, url, ctx) => {
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
      (log, stage) => continueWorkflow(
        ctx.configFile, effectiveRunId, log, stage, appSource, remoteRunsFor(ctx),
      ),
      (err) => failRunningWorkflow(effectiveRunId, err),
    );
  },

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
  'POST /api/workflow/abandon': async (req, res, url, ctx) => {
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
  },
};

export { remotePreflight };
