/**
 * Các route hỏi máy đang chạy: Appium, adb, Xcode, thiết bị iOS.
 *
 * Mỗi handler ở đây mỏng đúng một dòng gọi — phần thật nằm trong
 * `src/runner/`. Đó không phải vì gọn, mà vì ở chế độ `server` cái dòng gọi ấy
 * là chỗ lời gọi hàm biến thành thông điệp đi tới máy khác. Giữ nó mỏng nghĩa
 * là khi thay `localRunner` bằng bản chạy qua mạng, không có logic nào bị bỏ
 * lại nhầm ở phía server.
 *
 * `ios-tunnel` và `ios-trust` chỉ có nghĩa ở chế độ embedded — chúng mở Terminal
 * và app Cài đặt trên chính chiếc máy đang chạy. Ở chế độ `server` chúng phải
 * biến mất; FARM-ROUTE-MAP.md xếp chúng vào nhóm LOCAL.
 */
import os from 'node:os';
import { applyEnv, devicesOf, loadConfig, saveConfig, type TestPilotConfig } from '../../config.js';
import { PREP_OPS, type PrepOp } from '../../protocol/messages.js';
import { waitForClose } from './run.js';
import { attachedDevices } from '../../core/attachedDevices.js';
import { registerDevices } from '../../core/deviceSync.js';
import { preflight } from '../../core/preflight.js';
import { localRunner } from '../../runner/index.js';
import { json, readJson, stream } from '../http.js';
import { remotePreflight, remoteRunsFor } from '../remoteRuns.js';
import { describeBuild } from '../appBuilds.js';
import type { RouteTable } from './types.js';

export const prereqRoutes: RouteTable = {
  'POST /api/prereq/appium': async (_req, res) =>
    stream(res, (log) => localRunner.prereq.startAppium(log)),

  'POST /api/prereq/appium/restart': async (_req, res) =>
    stream(res, (log) => localRunner.prereq.restartAppium(log)),

  'GET /api/prereq/appium/status': async (_req, res) =>
    json(res, 200, await localRunner.prereq.appiumStatus()),

  'GET /api/prereq/adb': async (_req, res) =>
    json(res, 200, await localRunner.prereq.androidDevices()),

  'GET /api/prereq/xcode': async (_req, res) =>
    json(res, 200, await localRunner.prereq.xcode()),

  'GET /api/prereq/ios-devices': async (_req, res) =>
    json(res, 200, await localRunner.prereq.iosDevices()),

  /**
   * Chỉ tên máy, không kèm danh sách đầy đủ.
   *
   * Tách khỏi /ios-devices vì hai thứ đó có giá khác hẳn nhau: `devicectl`
   * mất 0,05 giây, còn `xctrace` mất 1,5 giây và đã từng treo hẳn (vì thế
   * endpoint kia có timeout 15 giây). Màn chọn máy chỉ cần tên, và cần ngay
   * lúc mở — bắt nó chờ `xctrace` là trả giá cho thứ nó không dùng.
   */
  'GET /api/prereq/ios-names': async (_req, res) =>
    json(res, 200, { names: await localRunner.prereq.iosNames() }),

  /**
   * Mở Terminal của máy với lệnh dựng tunnel đã điền sẵn.
   *
   * Cố tình KHÔNG tự chạy `sudo` ở đây, dù về kỹ thuật là làm được bằng cách
   * hỏi mật khẩu trên giao diện rồi đẩy vào stdin. Mật khẩu đó sẽ đi qua
   * trình duyệt, qua HTTP, qua tiến trình này — nơi có sẵn một sổ log 8.000
   * dòng đang ghi dần xuống đĩa — và server này không có xác thực gì cả.
   * Để macOS tự hỏi trong Terminal thì tool không bao giờ chạm vào nó.
   *
   * Tiện thể giải quyết luôn chuyện vòng đời: tunnel chạy trong Terminal
   * không chết theo server, nên restart server không làm hỏng buổi test.
   */
  'POST /api/prereq/ios-tunnel': async (_req, res) =>
    json(res, 200, await localRunner.prereq.openTunnelTerminal()),

  'POST /api/prereq/ios-trust': async (_req, res, _url, ctx) =>
    json(res, 200, await localRunner.prereq.openIosSettings(await loadConfig(ctx.configFile))),

  /**
   * Sửa môi trường cho ĐÚNG chiếc máy cắm thiết bị — không phải máy chủ.
   *
   * Các nút cũ (`/api/prereq/ios-tunnel`, `/appium`…) luôn làm trên tiến trình
   * máy chủ. Ở chế độ server, người ngồi ở laptop có iPhone cắm vào bấm "Mở
   * Terminal" thì Terminal bật lên trên máy chủ, ở phòng khác. Route này hỏi
   * thiết bị nằm ở đâu:
   *
   * - cắm ở chính máy chủ (hoặc không nói máy nào) → làm tại chỗ, như trước;
   * - cắm ở runner khác → đặt một job `prereq` nhắm đúng thiết bị ấy, runner
   *   đang cắm nó nhận và làm trên máy của nó; log chảy về đây.
   */
  'POST /api/prereq/fix': async (req, res, _url, ctx) => {
    const body = await readJson<{ op?: string; platform?: string; device?: string }>(req);
    const op = body.op as PrepOp;
    if (!PREP_OPS.includes(op)) {
      return json(res, 400, { error: `Việc chuẩn bị "${String(body.op)}" không có.` });
    }
    const platform = body.platform === 'android' || body.platform === 'ios' ? body.platform : undefined;
    const cfg = await loadConfig(ctx.configFile);
    const udid = body.device && platform
      ? devicesOf(cfg, platform).find((item) => item.id === body.device)?.udid ?? body.device
      : undefined;
    const there = udid ? await remoteRunsFor(ctx).locate(udid) : undefined;

    if (!there) {
      return stream(res, async (log) => {
        log(`[prep] Làm trên máy chủ (${os.hostname()}).`);
        await localPrep(op, cfg, log);
      });
    }

    return stream(res, async (log) => {
      const where = there.runnerName ?? there.runnerId;
      if (there.offline) {
        throw new Error(`${where} — máy tính đang cắm ${there.label} — đang tắt hoặc mất liên lạc. `
          + 'Mở lại runner trên máy đó rồi thử lại.');
      }
      log(`[prep] Giao cho ${where}: việc này làm trên máy đang cắm ${there.label}.`);
      const job = await ctx.repos.queue.create({
        orgId: ctx.identity.orgId,
        kind: 'prereq',
        createdBy: ctx.identity.userId,
        spec: {
          orgId: ctx.identity.orgId,
          kind: 'prereq',
          createdBy: ctx.identity.userId,
          timeoutMs: 5 * 60_000,
          deviceTokens: [`${platform}:${there.udid}`],
          prep: { op },
        },
      });
      const offLog = await ctx.repos.queue.onLog(job.id, log);
      try {
        const closed = await waitForClose(ctx.repos.queue, job.id, log);
        if (closed?.state !== 'succeeded') {
          // Runner bản cũ (trước job `prereq`) trả đúng câu này. Nói thẳng việc
          // cần làm, thay vì để người dùng đoán vì sao nút không có tác dụng.
          if (/chưa chạy được job loại "prereq"/.test(closed?.error ?? '')) {
            throw new Error(`Runner trên ${where} là bản cũ, chưa làm được việc chuẩn bị từ web. `
              + 'Cài lại runner bản mới trên máy đó (build/runner-handoff/HUONG-DAN.md), '
              + 'hoặc chạy lệnh tunnel ngay trên máy ấy bằng nút "Chép lệnh".');
          }
          throw new Error(closed?.error ?? `${where} không làm được việc này.`);
        }
      } finally {
        offLog();
      }
    });
  },

  'POST /api/prereq/driver': async (req, res) => {
    const { driver } = await readJson<{ driver: string }>(req);
    return stream(res, (log) => localRunner.prereq.installDriver(driver, log));
  },

  'GET /api/preflight': async (req, res, url, ctx) => {
    // Asked from the Studio the moment a platform is ticked, so the answer
    // arrives while the choice is still being made rather than half an hour
    // later when the run reaches its first step.
    const asked = url.searchParams.get('platform');
    const platform = asked === 'android' || asked === 'ios' || asked === 'web' ? asked : 'web';
    // Môi trường phải đi theo câu hỏi.
    //
    // Thiếu nó, preflight luôn trả lời theo config gốc: chọn SIT mà màn hình
    // vẫn báo "Địa chỉ web: https://tcinvest.tcbs.com.vn" của prod. Kết luận
    // "Sẵn sàng chạy" khi ấy nói về một môi trường khác với môi trường sắp
    // chạy — và với một bộ test chuyển tiền thật thì đó là loại nhầm lẫn
    // không được phép có.
    const base = await loadConfig(ctx.configFile);
    const env = url.searchParams.get('env')?.trim();
    const cfg = env ? applyEnv(base, env).config : base;
    const device = url.searchParams.get('device') ?? undefined;

    // Máy đã chọn nằm ở RUNNER KHÁC thì máy chủ không dò được nó — `adb` tại
    // chỗ sẽ luôn nói "không nằm trong số đang cắm", dù lượt chạy qua hàng
    // đợi vẫn tới được nó. Trả lời bằng thứ chính runner ấy đã đo, và bằng
    // ĐÚNG phép kiểm mà cổng chặn của workflow dùng: màn hình nói "sẵn sàng"
    // mà workflow lại dừng là hai câu trả lời cho một câu hỏi.
    if (device && (platform === 'android' || platform === 'ios')) {
      const udid = devicesOf(cfg, platform).find((item) => item.id === device)?.udid ?? device;
      const there = await remoteRunsFor(ctx).locate(udid);
      if (there) {
        const build = url.searchParams.get('appSource') === 'upload'
          ? await describeBuild(base, env, platform)
          : undefined;
        return json(res, 200, remotePreflight(platform, there, build));
      }
    }
    return json(res, 200, {
      ...(await preflight(platform, cfg, device)),
      host: {
        name: process.env.TESTPILOT_MODE === 'server' ? `Máy chủ (${os.hostname()})` : `Máy này (${os.hostname()})`,
        remote: false,
      },
    });
  },

  /**
   * Thêm máy đang cắm vào danh sách máy của config.
   *
   * Việc này vốn chỉ làm được bằng `npm run devices:sync`, và người cắm máy
   * vào rồi mở web lên không có đường nào tới nó: họ thấy màn hình nói "2 máy
   * sẵn sàng" rồi chỉ chạy được một máy, còn cách sửa nằm trong một terminal.
   *
   * Phần quyết định — đặt `id`, chọn cổng — nằm ở `core/deviceSync.ts`, dùng
   * chung với CLI. Hai bản chép tay của cùng một luật đặt tên sẽ lệch, và lúc
   * ấy cùng một chiếc máy có hai `id` khác nhau tuỳ người thêm nó bằng đường
   * nào — mà `id` thì đi vào tên thư mục lượt chạy và khoá gộp của healing.
   */
  'POST /api/devices/register': async (req, res, _url, ctx) => {
    const body = await readJson<{ platform?: string; udids?: string[] }>(req);
    const platform = body.platform === 'ios' ? 'ios' : 'android';
    const wanted = new Set((body.udids ?? []).filter((udid) => typeof udid === 'string'));
    if (wanted.size === 0) return json(res, 400, { error: 'Cần `udids`.' });

    const probe = await attachedDevices(platform);
    if (!probe.ok) {
      return json(res, 409, {
        error: `Không dò được máy đang cắm: ${probe.reason}`,
      });
    }
    // Chỉ thêm máy ĐANG CẮM THẬT, và chỉ những cái người dùng vừa bấm. Nhận
    // thẳng udid từ thân yêu cầu là cho phép ghi một dòng thiết bị không tồn
    // tại vào config — một chiếc máy ma mà mọi lượt chạy sau đó phải bỏ qua.
    const picked = probe.devices.filter((device) => wanted.has(device.udid));
    if (picked.length === 0) {
      return json(res, 404, { error: 'Không có máy nào trong số đó đang cắm.' });
    }

    const cfg = await loadConfig(ctx.configFile);
    const { added } = registerDevices(cfg, platform, picked);
    if (added.length === 0) return json(res, 200, { added: [] });

    await saveConfig(cfg, ctx.configFile);
    return json(res, 200, { added });
  },
};

/** Việc chuẩn bị trên CHÍNH máy chủ — cùng những hàm mà các nút cũ gọi. */
async function localPrep(op: PrepOp, cfg: TestPilotConfig, log: (line: string) => void): Promise<void> {
  if (op === 'start_appium') return localRunner.prereq.startAppium(log);
  if (op === 'restart_appium') return localRunner.prereq.restartAppium(log);
  const opened = op === 'ios_tunnel'
    ? await localRunner.prereq.openTunnelTerminal()
    : await localRunner.prereq.openIosSettings(cfg);
  if (!opened.ok) throw new Error(opened.error ?? 'Không mở được.');
  log(op === 'ios_tunnel'
    ? '[prep] Đã mở Terminal với lệnh tunnel. Nhập mật khẩu máy ở cửa sổ đó.'
    : '[prep] Đã mở Cài đặt trên iPhone. Bấm Tin cậy trên máy.');
}
