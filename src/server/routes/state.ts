/**
 * `GET /api/state` — payload lớn nhất, và là thứ mọi màn hình dựa vào.
 *
 * Nó trả lời một câu duy nhất: lúc này hệ thống đang ở đâu. Feature nào có,
 * bao nhiêu element, lượt chạy gần đây, build nào nằm ở đâu, khoá nào đã cấu
 * hình. Giao diện gọi nó khi mở mọi trang, nên mỗi thứ thêm vào đây là thứ ai
 * mở trang nào cũng phải trả tiền.
 *
 * Ở P2.4 nó đọc DB thay vì quét đĩa. Chỗ cần sửa lúc ấy là file này, và chỉ
 * file này — đó là lý do cụm hàm đi cùng route thay vì ở lại `server.ts`.
 *
 * `POST /api/mcp/tools` đi kèm vì nó cũng chỉ là dò trạng thái: kết nối MCP,
 * hỏi danh sách tool, đóng lại. Không chạm thiết bị, không ghi gì.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applyEnv, ConfigSchema, loadConfig, type TestPilotConfig } from '../../config.js';
import { DeviceEnvLog } from '../../core/deviceEnv.js';
import { Registry } from '../../core/registry.js';
import { KnownIssueStore } from '../../core/knownIssues.js';
import { ScenarioReviewStore, scenarioBlocks } from '../../core/scenarioReview.js';
import { Secrets } from '../../core/secrets.js';
import { buildInventory } from '../../core/builds.js';
import { listRuns } from '../../core/runstore.js';
import { llmAvailable } from '../../llm/client.js';
import { McpBridge, guessToolNames } from '../../ingest/mcp.js';
import { refreshHtmlReportIfStale } from '../../report/refresh.js';
import { chaptersOf, isWholeRunRecording, testWindowSeconds } from '../../report/videoIndex.js';
import { reportShotContexts } from '../../ui/reportEvidence.js';
import { parseFeature } from '../../steps/binding.js';
import { tagTaxonomyView } from '../../core/tagTaxonomy.js';
import type { Build, CoverageView, StateResponse } from '../../ui/contracts.js';
import type { CoverageAudit, CoverageRequirement } from '../../genspec/coverage.js';
import { configRevision } from './config.js';
import { featureRevision } from './feature.js';
import { recentRuns } from './history.js';
import type { Repos } from '../db/repo.js';
import { json, readJson } from '../http.js';
import type { RouteTable } from './types.js';

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

/**
 * Số lượt chạy trả về cho màn hình.
 *
 * Bằng MAX_RUNS của lịch sử workflow, vì cùng một lý do: danh sách này chỉ dài
 * thêm chứ không bao giờ ngắn đi, và nó được gửi lại sau MỖI thao tác trên
 * trang. Ai cần xa hơn thì mở thư mục runs/.
 */
const MAX_REPORTS = 50;

const withOwn = (build: Build, own: boolean): Build => (build ? { ...build, own } : build);

export async function state(
  configFile: string,
  profile: StateResponse['configProfile'],
  repos: Repos,
): Promise<StateResponse> {
  let config: TestPilotConfig;
  let configError: string | null = null;
  try {
    config = await loadConfig(configFile);
  } catch (err) {
    configError = (err as Error).message;
    // An unconfigured install should still render the UI, with defaults filled in.
    config = ConfigSchema.parse({ web: { baseUrl: 'https://example.com' } });
  }

  // Registry đọc MỘT LẦN cho cả hai việc bên dưới. Trước đây `listFeatures` và
  // `countElements` mỗi bên tự đọc — hai lần đọc cùng một thứ trong cùng một
  // request, và với Postgres thì đó là hai lượt đi mạng thay vì một.
  const registry = Registry.fromData((await repos.registry.read()).data);
  const features = await listFeatures(config, registry);
  const elements = Object.keys(registry.raw.elements).length;
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
    configRevision: await configRevision(configFile),
    configProfile: profile,
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

async function describeBuild(rel: string | undefined): Promise<Build> {
  if (!rel) return null;
  try {
    const info = await stat(path.resolve(rel));
    return { path: rel, exists: true, sizeMb: Math.round(info.size / 1024 / 1024) };
  } catch {
    return { path: rel, exists: false };
  }
}

function featureCoveragePath(cfg: TestPilotConfig, filename: string): string {
  return path.join(path.dirname(cfg.paths.scenarioReviewDb), 'coverage', `${path.basename(filename)}.json`);
}

export async function readFeatureCoverage(
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

export async function saveFeatureCoverageAudit(
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

export async function listFeatures(cfg: TestPilotConfig, registry: Registry) {
  if (!existsSync(cfg.paths.features)) return [];
  const files = (await readdir(cfg.paths.features)).filter((f) => f.endsWith('.feature')).sort();
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

export const stateRoutes: RouteTable = {
  'GET /api/state': async (_req, res, _url, ctx) =>
    json(res, 200, await state(ctx.configFile, ctx.configProfile, ctx.repos)),

  'POST /api/mcp/tools': async (req, res) =>
    json(res, 200, await mcpTools(await readJson(req))),
};
