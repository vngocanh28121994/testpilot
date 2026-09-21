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
import { orphans, runChildren } from '../runner/execute.js';
import { listen, PORT, serverMode } from '../server/http.js';
import { mayAdoptIntoEnv } from '../server/auth/secrets.js';
import { dispatch } from '../server/dispatch.js';
// Cùng MỘT kho phiên mà route đăng nhập ghi vào. Hai bản riêng sẽ cho ra một
// hệ thống đăng nhập xong vẫn báo chưa đăng nhập — và đó đúng là thứ đã xảy ra
// khi `dispatch` được gọi mà quên truyền kho này vào.
import { sessions } from '../server/auth/state.js';
import { fileRepos } from '../server/db/fileRepo.js';

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

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  return dispatch(req, res, url, {
    mode: MODE,
    sessions,
    // Chế độ embedded: kho là chính các file JSON trong `registry/`, đọc theo
    // cấu hình của người đang chạy. Chế độ server dựng `pgRepos` theo `orgId`
    // — sẽ nối khi host cho chế độ ấy có mặt (P2.6).
    repos: async () => fileRepos((await loadConfig(CONFIG_FILE)).paths),
    configFile: CONFIG_FILE,
    configProfile: { owner: CONFIG_PROFILE.owner, source: CONFIG_PROFILE.source },
  });
}

listen(handle);
