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
import { localDevices } from '../server/devices/memoryRegistry.js';
import { startReaper } from '../server/runners/reaper.js';
import { localRunner } from '../runner/index.js';
import { orphans, runChildren } from '../runner/execute.js';
import { listen, PORT, serverMode } from '../server/http.js';
import { mayAdoptIntoEnv } from '../server/auth/secrets.js';
import { dispatch } from '../server/dispatch.js';
// Cùng MỘT kho phiên mà route đăng nhập ghi vào. Hai bản riêng sẽ cho ra một
// hệ thống đăng nhập xong vẫn báo chưa đăng nhập — và đó đúng là thứ đã xảy ra
// khi `dispatch` được gọi mà quên truyền kho này vào.
import { sessions } from '../server/auth/state.js';
import { dbOptionsFromEnv } from '../server/db/connect.js';
import { repoFactory } from '../server/db/wiring.js';

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

const REPOS = repoFactory({
  mode: MODE,
  db: dbOptionsFromEnv(),
  paths: async () => (await loadConfig(CONFIG_FILE)).paths,
});

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  return dispatch(req, res, url, {
    mode: MODE,
    sessions,
    devices: localDevices,
    // Sổ runner: cửa của đường runner tra ở đây. Ở chế độ embedded nó là sổ
    // trong bộ nhớ, đã nạp sẵn token dùng chung nếu có.
    runners: localRunners,
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
  const reportDevices = async (): Promise<void> => {
    const devices = await localRunner.control.devices().catch(() => []);
    await localDevices.report(
      { id: 'runner:local', orgId: 'local', visibility: 'shared' },
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
  startWorker({
    queue: localQueue,
    // CÙNG kho lease mà màn Điều khiển dùng. Hai kho riêng nghĩa là job chạy
    // đè lên tay người đang cầm máy — xem FARM-ARCHITECTURE mục 6b.
    leases: localLeases,
    runnerId: 'local',
    configFile: CONFIG_FILE,
  });
}

/**
 * Vòng dọn máy đã tắt, chạy ở CẢ HAI chế độ.
 *
 * Ở embedded nó gần như không có việc gì — máy chạy server cũng là máy có
 * thiết bị. Nhưng một runner cá nhân nối vào bản local là chuyện P4 cho phép,
 * và lúc ấy nó tắt đúng như mọi laptop khác.
 */
startReaper({
  runners: localRunners,
  devices: localDevices,
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
