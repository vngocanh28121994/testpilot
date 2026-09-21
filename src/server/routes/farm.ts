/**
 * AWS Device Farm: đăng nhập, trạng thái, danh mục, và chạy.
 *
 * Phần đọc (project, pool, thiết bị) chỉ gọi AWS SDK nên ở lại control plane.
 * Phần chạy gọi `runner.farm.run()` vì nó đóng gói bundle bằng tiến trình con.
 *
 * `POST /api/aws/login` là route LOCAL: `aws login` in ra một URL rồi đứng chờ
 * một con người bấm. Ở chế độ server nó vô nghĩa — máy chủ dùng IAM role.
 */
import path from 'node:path';
import { ConfigSchema, loadConfig, saveConfig, type TestPilotConfig } from '../../config.js';
import { History } from '../../core/history.js';
import {
  assertFarmReady,
  awsLogin,
  awsStatus,
  collectFarmRun,
  createDevicePool,
  listDevicePools,
  listDevices,
  listProjects,
} from '../../farm/devicefarm.js';
import { poolPlatformMismatch, resolveFarmTarget } from '../../farm/target.js';
import { localRunner } from '../../runner/index.js';
import type { FarmForm } from '../../ui/contracts.js';
import { json, readJson, stream } from '../http.js';
import type { RouteTable } from './types.js';

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

async function applyFarmForm(form: FarmForm, configFile: string): Promise<TestPilotConfig> {
  const current = await loadConfig(configFile).catch(() =>
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
  await saveConfig(parsed.data, configFile);
  return parsed.data;
}

/**
 * Hỏi AWS xem pool chứa máy gì, rồi để poolPlatformMismatch() phán.
 *
 * `listDevicePools` vốn đã tính sẵn nền tảng của từng pool (nó phải giải các
 * ARN trong rules ra bảng thiết bị mới biết được). Dữ liệu có sẵn, chỉ là chưa
 * ai hỏi. Hỏi ở đây, mất một lượt gọi API, tiết kiệm vài phút và ba lần upload.
 */
async function assertPoolMatchesPlatform(
  region: string,
  projectArn: string,
  poolArn: string,
  platform: 'android' | 'ios',
): Promise<void> {
  const pools = await listDevicePools(region, projectArn).catch(() => []);
  const problem = poolPlatformMismatch(pools, poolArn, platform);
  if (problem) throw new Error(problem);
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

export const farmRoutes: RouteTable = {
  'POST /api/aws/login': async (_req, res, url) => {
    return stream(res, (log) => awsLogin(region(url), log));
  },

  'GET /api/aws': async (_req, res, url) => {
    return json(res, 200, await awsStatus(region(url)));
  },

  'GET /api/farm/projects': async (_req, res, url) => {
    return json(res, 200, await guarded(() => listProjects(region(url))));
  },

  'GET /api/farm/pools': async (_req, res, url) => {
    return json(
      res,
      200,
      await guarded(() => listDevicePools(region(url), url.searchParams.get('projectArn') ?? '')),
    );
  },

  'GET /api/farm/devices': async (_req, res, url) => {
    const platform = url.searchParams.get('platform') === 'ios' ? 'ios' : 'android';
    return json(res, 200, await guarded(() => listDevices(region(url), platform)));
  },

  'POST /api/farm/pool': async (req, res) => {
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
  },

  'POST /api/farm/run': async (req, res, _url, ctx) => {
    const body = await readJson<FarmForm>(req);
    const saved = await applyFarmForm(body, ctx.configFile);
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
      await assertPoolMatchesPlatform(cfg.farm.region, cfg.farm.projectArn, target.devicePoolArn, cfg.farm.platform);
    } catch (err) {
      return json(res, 400, { error: (err as Error).message });
    }
    // The id is only useful to a workflow that handed off; this endpoint
    // streams the run itself, so it is dropped here.
    return stream(res, async (log, stage) => {
      await localRunner.farm.run(cfg, Boolean(body.bundle), log, stage);
    });
  },

  /**
   * Tải lại report, ảnh và video của một run đã chạy xong trên Device Farm.
   *
   * Cùng việc mà `npm run farm:pull` làm, nhưng gọi được từ màn hình: người
   * dùng TestPilot không mở terminal, và thư mục artifact biến mất là chuyện
   * của chính sách dọn dẹp bên này chứ không phải lỗi họ gây ra. Phút thiết
   * bị đã trả rồi — lấy lại phải rẻ hơn chạy lại.
   */
  'POST /api/farm/pull': async (req, res, url, ctx) => {
    const body = await readJson<{ arn?: string; runId?: string }>(req);
    const arn = body.arn?.trim();
    if (!arn) return json(res, 400, { error: 'Thiếu ARN của run trên Device Farm.' });
    const cfg = await loadConfig(ctx.configFile);
    return stream(res, async (log) => {
      const result = await collectFarmRun(
        {
          ...cfg.farm,
          runsDir: cfg.paths.runs,
          flakeDb: cfg.paths.flakeDb,
          healingDb: cfg.paths.healingDb,
          reportsDir: cfg.paths.reports,
          retention: cfg.retention,
        },
        arn,
        { log },
      );
      // Thư mục lấy về được đặt tên theo thời điểm job chạy trên AWS, nên
      // thường trùng đúng cái tên cũ trong lịch sử. "Thường" không đủ: nếu
      // lệch tên thì màn chi tiết vẫn báo thiếu dù file đã nằm trên đĩa.
      const dirs = result.runDirs.map((dir) => path.basename(dir));
      if (body.runId) {
        const history = await History.load();
        const run = history.find(body.runId);
        if (run) {
          run.runDirs = [...new Set([...(run.runDirs ?? []), ...dirs])];
          await history.save();
        }
      }
      log(`Đã lấy về ${dirs.length} thư mục report: ${dirs.join(', ')}`);
    });
  },
};
