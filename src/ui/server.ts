/**
 * Điểm khởi động của bản chạy trên máy (chế độ `embedded`).
 *
 * File này từng là 5.246 dòng: bảng route, mọi handler, phần sinh tiến trình,
 * phần hỏi Appium và adb — tất cả một chỗ. P1 chia nó ra: `src/server/` cho
 * phần phục vụ HTTP, `src/runner/` cho phần chạm tới máy. Cái còn lại đúng là
 * thứ không thuộc về bên nào — vòng đời của chính tiến trình này.
 *
 * Ba việc, không hơn:
 *  1. chọn hồ sơ cấu hình của người đang chạy, và cho mọi tiến trình con thấy nó;
 *  2. dọn những gì lần chạy trước để lại;
 *  3. mở cổng, và nối request vào bảng route.
 *
 * Ở chế độ `server`, cùng bảng route ấy chạy sau đăng nhập và hàng đợi, còn
 * `src/runner/` sống ở máy khác. Xem [FARM-ARCHITECTURE.md](../../FARM-ARCHITECTURE.md).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import os from 'node:os';
import { loadConfig } from '../config.js';
import { History } from '../core/history.js';
import { recoverInterruptedRunReports } from '../core/interruptedReport.js';
import { ensurePersonalConfig, personalConfigProfile } from '../core/personalConfig.js';
import { closeInterruptedRuns, reindex } from '../core/runstore.js';
import { adoptStoredApiKeys } from '../core/secrets.js';
import { stopAllScreenStreams } from '../runner/control.js';
import { startWorker } from '../runner/worker.js';
import { localQueue } from '../server/queue/memoryQueue.js';
import { localLeases } from '../server/db/leaseRepo.js';
import { localRunners } from '../server/runners/memoryRegistry.js';
import { storesFor } from '../server/stores.js';
import { startReaper } from '../server/runners/reaper.js';
import { localRunner } from '../runner/index.js';
import { orphans, runChildren } from '../runner/execute.js';
import { listen, PORT, serverMode } from '../server/http.js';
import { mayAdoptIntoEnv } from '../server/auth/secrets.js';
import { dispatch } from '../server/dispatch.js';
// Cùng MỘT kho phiên mà route đăng nhập ghi vào. Hai bản riêng sẽ cho ra một
// hệ thống đăng nhập xong vẫn báo chưa đăng nhập — và đó đúng là thứ đã xảy ra
// khi `dispatch` được gọi mà quên truyền kho này vào.
import { sessionStore } from '../server/auth/state.js';
import { bootstrapUser } from '../server/auth/bootstrapUser.js';
import { dbOptionsFromEnv } from '../server/db/connect.js';
import { repoFactory } from '../server/db/wiring.js';
import { poolProvider } from '../server/db/pool.js';
import { s3OptionsFromEnv, S3ArtifactStore } from '../server/storage/artifacts.js';
import { PgArtifactRepo } from '../server/storage/artifactRepo.js';
import { sweepArtifacts } from '../server/storage/retention.js';
import { LOCAL_HOST_RUNNER } from '../server/remoteRuns.js';

const CONFIG_PROFILE = await ensurePersonalConfig(personalConfigProfile());
const CONFIG_FILE = CONFIG_PROFILE.file;
// Every CLI child spawned by the UI must read the same user's profile.
process.env.TESTPILOT_CONFIG = CONFIG_FILE;

/**
 * Nạp khoá đã lưu vào `process.env` — chỉ ở chế độ embedded.
 *
 * Ở chế độ server, khoá đi tới job qua `secret.grant` theo từng tổ chức; nạp
 * vào môi trường của tiến trình ở đây sẽ làm mọi tiến trình con thừa hưởng
 * khoá của tổ chức khác. Xem `src/server/auth/secrets.ts`.
 */
if (mayAdoptIntoEnv(serverMode())) await adoptStoredApiKeys();

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
    // Luồng video của màn điều khiển là tiến trình `adb` con, và nó không nằm
    // trong `runChildren`. Bỏ dòng này thì mỗi lần mở màn điều khiển để lại
    // một `screenrecord` sống sau khi server đã tắt.
    stopAllScreenStreams();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  });
}

/**
 * Chế độ chạy của tiến trình này.
 *
 * `embedded` là mặc định và là thứ `npm run ui` dùng: một người, một máy,
 * không đăng nhập. Chỉ khi `TESTPILOT_MODE=server` thì cửa quyền mới đòi phiên
 * — xem `src/server/auth/guard.ts` để biết vì sao bản local không dựng hàng rào.
 */
const MODE = serverMode();

/**
 * Kho dữ liệu, chọn MỘT LẦN lúc khởi động.
 *
 * Dựng ở đây chứ không trong `handle()`: chế độ server thiếu
 * `TESTPILOT_DATABASE_URL` thì `repoFactory` ném, và cú ném ấy phải xảy ra lúc
 * tiến trình lên — với người deploy — chứ không phải ở request đầu tiên của
 * một người dùng.
 */
// Token dùng chung của P3.4 trở thành MỘT DÒNG trong sổ, để cửa quyền chỉ có
// một đường tra. Không đặt biến ấy thì sổ rỗng và đường runner đóng.
localRunners.seedFromEnv();


// MỘT pool cho cả tiến trình: kho dữ liệu và kho phiên cùng dùng. Hai bên mỗi
// bên một pool là nhân đôi số kết nối tới Postgres mà không ai quyết định.
const DB = dbOptionsFromEnv();
const POOL = DB ? poolProvider(DB) : undefined;

const REPOS = repoFactory({
  mode: MODE,
  db: DB,
  ...(POOL ? { pool: POOL } : {}),
  paths: async () => (await loadConfig(CONFIG_FILE)).paths,
});

/**
 * Kho phiên: Postgres ở chế độ server, RAM ở embedded.
 *
 * Dựng ở đây chứ không phải một singleton trong `auth/state.ts`: "kho nào" là
 * một quyết định của bản triển khai, và để nó nằm trong một module mà không ai
 * nhìn tới nghĩa là nó im lặng dùng RAM kể cả khi chạy nhiều instance.
 */
const SESSIONS = sessionStore({ mode: MODE, ...(POOL ? { pool: POOL } : {}) });
/**
 * Ba sổ của P3–P4: runner, thiết bị, quyền mượn máy.
 *
 * Trước đây `server.ts` nối thẳng vào bản BỘ NHỚ ở cả hai chế độ, kể cả khi
 * bản Postgres đã có và đã có test. Hậu quả chỉ lộ ra khi chạy thật: một
 * runner sống trong RAM làm mọi lệnh nhận job chết bằng `job_runner_id_fkey`,
 * vì `job.runner_id` trỏ vào một bảng mà runner ấy không có mặt.
 */
const STORES = storesFor({ mode: MODE, ...(POOL ? { pool: POOL } : {}) });

/**
 * Kho artifact: chỉ dựng khi có CẢ bucket lẫn DB.
 *
 * Sổ artifact là một bảng, nên một bucket không có DB thì không ghi nổi dòng
 * nào — và một hệ thống đẩy file lên S3 rồi quên mất nó ở đâu còn tệ hơn là
 * không đẩy. Ở chế độ embedded thì không dựng: file đã nằm trên chính chiếc
 * máy đang phục vụ trang web.
 */
const S3 = MODE === 'server' ? s3OptionsFromEnv() : undefined;
const ARTIFACTS = S3 && POOL
  ? {
    store: new S3ArtifactStore(S3),
    repo: new PgArtifactRepo(POOL),
  }
  : undefined;
if (MODE === 'server' && !S3) {
  // Nói ra chứ đừng im lặng chạy tiếp: thiếu bucket nghĩa là report của mọi
  // lượt chạy nằm trên đĩa của runner và không ai khác mở được.
  console.warn(
    '[server] Chưa đặt TESTPILOT_S3_BUCKET. Artifact sẽ không rời khỏi máy runner, '
    + 'nên người khác không xem được report của lượt chạy. Xem infra/README.md.',
  );
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  return dispatch(req, res, url, {
    mode: MODE,
    sessions: SESSIONS,
    ...(ARTIFACTS ? { artifacts: ARTIFACTS } : {}),
    ...(POOL ? { bootstrapUser: (identity) => bootstrapUser(POOL, identity) } : {}),
    devices: STORES.devices,
    // Bảng quyền mượn máy. Ở embedded nó nằm trong bộ nhớ như mọi thứ khác;
    // ở chế độ server nó phải là Postgres, vì một quyết định cho mượn không
    // dựng lại được từ báo cáo của runner như danh sách máy.
    grants: STORES.grants,
    // Sổ runner: cửa của đường runner tra ở đây. Ở chế độ embedded nó là sổ
    // trong bộ nhớ, đã nạp sẵn token dùng chung nếu có.
    runners: STORES.runners,
    // Embedded: file JSON trong `registry/`. Server: Postgres của ĐÚNG tổ chức
    // người gọi. Quyết định nằm trong `repoFactory` để đo được — xem wiring.ts.
    repos: REPOS,
    configFile: CONFIG_FILE,
    configProfile: { owner: CONFIG_PROFILE.owner, source: CONFIG_PROFILE.source },
  });
}

/**
 * Worker chỉ chạy ở chế độ `embedded`, và đó là một ranh giới chứ không phải
 * một tối ưu.
 *
 * Worker sinh tiến trình con để chạy test. Bật nó trong control plane ở chế độ
 * server nghĩa là máy chủ web chạy Appium và adb — đúng thứ mà cả kiến trúc
 * này dựng lên để tránh (xem FARM-ARCHITECTURE mục 12). Ở chế độ server,
 * worker sống trên máy có thiết bị và nối vào qua transport của P3.4.
 */
/**
 * Ở chế độ embedded, chính tiến trình này là runner — nên nó BÁO CÁO máy của
 * mình vào sổ, y như một runner ở xa làm.
 *
 * Vì sao không để route hỏi thẳng `adb`: danh sách máy phải được lọc theo
 * người đang nhìn, và phép lọc ấy chỉ đúng nếu mọi đường đọc đi qua cùng một
 * chỗ. Hai đường — một hỏi sổ, một hỏi adb — sẽ lệch nhau ở đúng phần quyền.
 */
const DEVICE_REPORT_MS = 10_000;

if (MODE === 'embedded') {
  // Chính chiếc máy này cũng là một runner trong sổ. Không có dòng ấy thì mọi
  // thiết bị của nó hiện "đang tắt" và không có trạng thái môi trường — cả
  // hai câu đều tra sổ runner. Xem `seedLocalHost`.
  localRunners.seedLocalHost(LOCAL_HOST_RUNNER, `Máy này (${os.hostname()})`);

  const reportDevices = async (): Promise<void> => {
    const devices = await localRunner.control.devices().catch(() => []);
    localRunners.seedLocalHost(LOCAL_HOST_RUNNER, `Máy này (${os.hostname()})`);
    await STORES.devices.report(
      { id: LOCAL_HOST_RUNNER, orgId: 'local', visibility: 'shared' },
      devices
        .filter((device) => device.platform === 'android' || device.platform === 'ios')
        .map((device) => ({
          platform: device.platform, udid: device.udid, label: device.label,
        })),
    );
  };
  void reportDevices();
  const deviceTimer = setInterval(() => void reportDevices(), DEVICE_REPORT_MS);
  deviceTimer.unref?.();
}

if (MODE === 'embedded') {
  // Dọn job treo TRƯỚC khi nhận job mới: một job còn `running` sau khi tiến
  // trình chết là một dòng nói dối, và nó nằm đó mãi.
  void localQueue.interruptStale();
  const worker = startWorker({
    queue: localQueue,
    // CÙNG kho lease mà màn Điều khiển dùng. Hai kho riêng nghĩa là job chạy
    // đè lên tay người đang cầm máy — xem FARM-ARCHITECTURE mục 6b.
    leases: localLeases,
    runnerId: 'local',
    configFile: CONFIG_FILE,
  });

  // Máy chủ cũng báo môi trường của chính nó, y như một runner ở xa. MỘT phép
  // đo, hai nơi đọc: chính phép đo mà worker dùng để từ chối job. Đo lần thứ
  // hai ở đây thì hai bên sẽ lệch, và lúc ấy màn hình nói "sẵn sàng" trong
  // khi worker vừa từ chối một job vì thiếu Appium.
  const reportPrereq = (): void => {
    void localRunners.reportPrereq(LOCAL_HOST_RUNNER, worker.environment());
  };
  reportPrereq();
  const prereqTimer = setInterval(reportPrereq, DEVICE_REPORT_MS);
  prereqTimer.unref?.();
}

/**
 * Vòng dọn máy đã tắt, chạy ở CẢ HAI chế độ.
 *
 * Ở embedded nó gần như không có việc gì — máy chạy server cũng là máy có
 * thiết bị. Nhưng một runner cá nhân nối vào bản local là chuyện P4 cho phép,
 * và lúc ấy nó tắt đúng như mọi laptop khác.
 */
/**
 * Dọn artifact cũ, một lần mỗi giờ.
 *
 * Không nằm trong `startReaper`: vòng ấy chạy mỗi 30 giây để bắt máy vừa tắt,
 * còn dọn kho là việc của hàng giờ. Gộp chung nghĩa là hoặc dọn kho 120 lần
 * mỗi giờ, hoặc máy tắt mất một giờ mới bị phát hiện.
 */
if (ARTIFACTS) {
  const sweep = async (): Promise<void> => {
    const cfg = await loadConfig(CONFIG_FILE).catch(() => undefined);
    const keepDays = cfg?.retention.keepFailedDays ?? 30;
    const swept = await sweepArtifacts({ ...ARTIFACTS, orgId: 'default', keepDays })
      .catch((err: Error) => {
        console.error('[retention] dọn artifact hỏng:', err.message);
        return undefined;
      });
    if (swept && swept.removed > 0) {
      console.log(
        `[retention] đã xoá ${swept.removed} artifact quá ${keepDays} ngày `
        + `(${(swept.bytes / 1024 / 1024).toFixed(1)} MB).`,
      );
    }
  };
  void sweep();
  const sweepTimer = setInterval(() => void sweep(), 60 * 60 * 1000);
  sweepTimer.unref?.();
}

startReaper({
  // Kho phiên: chỉ bản bền mới có gì để dọn. Bản RAM không khai `reapExpired`
  // nên vòng dọn bỏ qua nó — quyết định nằm ở kiểu, không ở một nhánh `if`.
  sessions: SESSIONS,
  runners: STORES.runners,
  devices: STORES.devices,
  queue: localQueue,
  leases: localLeases,
  // Hạn im lặng chỉnh được: một phòng máy có mạng chập cần hạn dài hơn, còn
  // lúc thử nghiệm thì chờ 90 giây cho mỗi lần kiểm là quá lâu để ai đó chịu
  // kiểm.
  ...(process.env.TESTPILOT_RUNNER_SILENT_MS
    ? { silentMs: Number(process.env.TESTPILOT_RUNNER_SILENT_MS) }
    : {}),
});

listen(handle);
