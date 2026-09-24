/**
 * Xem màn hình và chạm vào một chiếc máy, qua control plane.
 *
 * Hai route, và cả hai đều đứng trên cùng một câu hỏi: **người gọi có đang giữ
 * chiếc máy này không.** Vai không trả lời được câu đó — `maintainer` có vai
 * cao hơn `runner_user` nhưng không vì thế mà được chạm vào chiếc điện thoại
 * người khác đang cầm. Nên cửa quyền ở `policy.ts` chỉ chặn người ngoài, còn
 * quyết định thật nằm ở `heldBy()` dưới đây.
 *
 * Luồng video đi bằng SSE, không WebSocket, và đó là một lựa chọn có lý do đo
 * được: `screenrecord` ở 720x1600 cho ra **6 KB/s** trên emulator API 36 (đo
 * 22/09/2026), nên base64 làm nó thành 8 KB/s — một con số mà SSE tải thoải
 * mái. Đổi lấy: không thêm phụ thuộc `ws`, và đi qua đúng cấu hình nginx đã
 * kiểm cho SSE ở P2.6. Khi nào đổi sang scrcpy để hạ độ trễ thì lúc ấy mới cần
 * kênh nhị phân, và lúc ấy nginx đã có sẵn `Upgrade`.
 */
import { checkAction, type ControlPlatform, type ControlTarget, type IosSigning } from '../../protocol/control.js';
import { loadConfig } from '../../config.js';
import { allows } from '../auth/roles.js';
import { codecFor } from '../../runner/control.js';
import { localRunner } from '../../runner/index.js';
import type { Lease } from '../db/repo.js';
import type { ControlTargetsResponse } from '../../ui/contracts.js';
import { json, readJson, sse } from '../http.js';
import type { RouteContext, RouteTable } from './types.js';

/** Lease còn hiệu lực của chính người gọi, cho đúng chiếc máy này. */
async function heldBy(
  ctx: RouteContext,
  deviceId: string,
  leaseId: string,
): Promise<{ ok: true; lease: Lease } | { ok: false; status: 403 | 409; error: string }> {
  const lease = await ctx.repos.leases.find(deviceId);
  if (!lease) {
    return { ok: false, status: 409, error: 'Chưa giữ chỗ thiết bị này. Bấm "Giữ máy" trước.' };
  }
  // So cả `leaseId` chứ không chỉ người giữ: nếu máy đã đổi tay rồi quay lại,
  // client vẫn đang dựa trên một lượt giữ CŨ — và cái nó tưởng mình thấy trên
  // màn hình có thể là việc của người khác.
  if (lease.id !== leaseId) {
    return { ok: false, status: 409, error: 'Lượt giữ chỗ đã đổi. Tải lại rồi giữ máy lần nữa.' };
  }
  if (lease.holder.kind !== 'human' || lease.holder.userId !== ctx.identity.userId) {
    const who = lease.holder.kind === 'human' ? lease.holder.userId : `job ${lease.holder.jobId}`;
    return { ok: false, status: 403, error: `Thiết bị đang do ${who} giữ.` };
  }
  return { ok: true, lease };
}

/** Bao lâu kiểm lại lease trong lúc đang chảy video. */
const LEASE_RECHECK_MS = 5_000;

/**
 * Nền tảng do NGƯỜI GỌI nói, và server chỉ kiểm nó có hợp lệ không.
 *
 * Đoán từ hình dạng `udid` thì sai: udid của simulator là một UUID, của máy
 * iOS thật là 25 hoặc 40 ký tự, còn Android thì tuỳ nhà sản xuất —
 * `emulator-5554` chỉ tình cờ nhận ra được. Client vừa chọn máy từ một danh
 * sách CÓ nền tảng, nên nó biết chắc; bắt server đoán lại là thay một sự thật
 * bằng một phỏng đoán.
 */
function platformOf(value: unknown): ControlPlatform | undefined {
  return value === 'android' || value === 'ios' ? value : undefined;
}

export const controlRoutes: RouteTable = {
  /**
   * Máy điều khiển được, cả hai nền tảng, trong một danh sách.
   *
   * Không dùng lại `/api/prereq/adb` và `/api/prereq/ios-devices`: hai route
   * ấy trả hai hình dạng khác nhau (một bên object, một bên nguyên văn đầu ra
   * của `xctrace`), và KHÔNG bên nào liệt kê simulator đang bật — thứ mà màn
   * điều khiển dùng nhiều nhất. Gộp ở giao diện nghĩa là giao diện phải biết
   * cách đọc cả hai, và phải biết nền tảng nào dùng cách nào.
   */
  'GET /api/device/targets': async (_req, res, _url, ctx) => {
    /**
     * Đọc từ SỔ, không hỏi thẳng `adb`.
     *
     * Hai lý do, và lý do thứ hai mới là lý do thật. Thứ nhất: ở chế độ server
     * máy chủ web không cắm thiết bị nào. Thứ hai: danh sách máy phải ĐƯỢC LỌC
     * theo người đang nhìn — máy riêng của người khác không hiện — và phép lọc
     * ấy chỉ đúng nếu mọi đường đọc đều đi qua cùng một chỗ.
     */
    const devices = await ctx.devices.list(
      {
        userId: ctx.identity.userId,
        orgId: ctx.identity.orgId,
        isAdmin: allows(ctx.identity.role, 'admin'),
      },
      // Máy được người khác cho mượn cũng phải hiện ra. Tra bảng quyền ở đây
      // rồi truyền vào, để phép lọc trong sổ vẫn là một hàm thuần.
      await ctx.grants.forUser(ctx.identity.orgId, ctx.identity.userId),
    );
    // Sổ runner tra MỘT lần rồi ghép vào: mỗi chiếc máy cần biết nó nằm ở máy
    // tính nào, và máy tính ấy có chạy được nền tảng của nó không. Hỏi từng
    // chiếc là N lời gọi cho một câu trả lời không đổi trong cùng một request.
    const runners = new Map((await ctx.runners.list()).map((runner) => [runner.id, runner]));

    const body: ControlTargetsResponse = {
      devices: devices.map((device) => {
        const owner = runners.get(device.runnerId);
        // Môi trường do CHÍNH máy chạy đo và báo lên. Máy chủ không đo hộ
        // được: ở chế độ server nó không cắm thiết bị nào và không có Appium.
        const prereq = owner?.prereq?.[device.platform];
        return {
          platform: device.platform,
          udid: device.udid,
          // Máy đang tắt vẫn hiện, kèm lý do: biến mất khỏi danh sách và đang
          // tắt là hai câu khác nhau, và người dùng cần câu thứ hai.
          label: device.state === 'offline' ? `${device.label} · đang tắt` : device.label,
          ...(device.ownerUserId === ctx.identity.userId ? { mine: true } : {}),
          ...(owner ? { runnerName: owner.name } : {}),
          offline: device.state === 'offline' || owner?.state !== 'online',
          // `undefined` nghĩa là CHƯA ĐO, khác hẳn với "đo rồi, hỏng". Màn
          // hình phải nói hai chuyện ấy khác nhau, nếu không người ta sẽ đi
          // sửa một chiếc máy hoàn toàn tốt vừa khởi động xong.
          ...(prereq ? { ready: prereq.ok, ...(prereq.reason ? { reason: prereq.reason } : {}) } : {}),
        };
      }),
    };
    return json(res, 200, body);
  },

  /**
   * Luồng H.264 của một chiếc máy, dạng SSE.
   *
   * Sự kiện: `meta` một lần (kích thước màn hình và kích thước khung), rồi
   * `video` mang từng mảnh Annex-B base64, `restart` khi `screenrecord` tự chạy
   * lại sau mốc 180 giây, và `ended` khi dừng kèm lý do.
   *
   * Lease được kiểm LẠI mỗi 5 giây, không chỉ lúc mở. Người giữ phải gia hạn
   * mỗi 30 giây, nên nếu chỉ kiểm lúc mở thì một cái tab bị bỏ quên vẫn xem
   * được màn hình của người tiếp theo — và admin cưỡng chế nhả máy cũng không
   * cắt được hình.
   */
  'GET /api/device/control/stream': async (req, res, url, ctx) => {
    const deviceId = url.searchParams.get('deviceId')?.trim();
    const leaseId = url.searchParams.get('leaseId')?.trim();
    const platform = platformOf(url.searchParams.get('platform'));
    if (!deviceId || !leaseId || !platform) {
      return json(res, 400, { error: 'Thiếu deviceId, leaseId hoặc platform.' });
    }
    const target = await controlTarget(ctx.configFile, platform, deviceId);
    const held = await heldBy(ctx, deviceId, leaseId);
    if (!held.ok) return json(res, held.status, { error: held.error });

    const { send, end } = sse(res);
    let closed = false;
    let stop = (): void => {};
    const finish = (reason: string): void => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      stop();
      send('ended', { reason });
      end();
    };

    const timer = setInterval(() => {
      void heldBy(ctx, deviceId, leaseId).then((again) => {
        if (!again.ok) finish(again.error);
      }).catch((err: unknown) => finish((err as Error).message));
    }, LEASE_RECHECK_MS);

    // Người xem đóng tab là đường kết thúc THƯỜNG GẶP NHẤT, nên nó phải dừng
    // được tiến trình `screenrecord`. Thiếu nhánh này thì mỗi lần mở màn điều
    // khiển để lại một tiến trình adb sống mãi.
    req.on('close', () => finish('Người xem đã đóng.'));

    try {
      const handle = await localRunner.control.startScreenStream(target, {
        chunk: (data) => {
          if (closed) return;
          // `write` trả false khi bộ đệm socket đã đầy — nghĩa là người xem
          // nhận chậm hơn máy phát. Bỏ mảnh thì video hỏng hình, nên cứ gửi:
          // 8 KB/s không làm đầy được bộ đệm của một kết nối còn sống, và một
          // kết nối đã chết thì `close` ở trên đã lo.
          send('video', data.toString('base64'));
        },
        restart: () => { if (!closed) send('restart', { at: new Date().toISOString() }); },
        fail: (message) => finish(message),
      });
      // Người xem có thể đã bỏ đi TRONG lúc mở luồng. Cửa sổ ấy từng gần như
      // bằng không với `screenrecord`; với scrcpy nó là khoảng hai giây rưỡi,
      // vì phải dựng một tiến trình Java trên máy Android.
      //
      // `finish` chạy trong cửa sổ đó gọi `stop` khi nó CÒN LÀ HÀM RỖNG, rồi
      // luồng mở xong và đăng ký một sink không bao giờ được gỡ. Luồng ấy sống
      // mãi không người xem — và lần giữ máy sau dùng lại nó, nhận giữa chừng
      // một luồng H.264 không có khung khoá, nên trắng màn không báo lỗi.
      if (closed) return handle.stop();
      stop = handle.stop;
      send('meta', {
        deviceId,
        platform,
        // Người xem phải biết mình đang nhận kiểu ảnh nào TRƯỚC khung đầu
        // tiên: H.264 cần một bộ giải mã dựng sẵn, còn JPEG thì vẽ thẳng.
        codec: codecFor(platform),
        screen: await localRunner.control.screenSize(target),
        frame: handle.frame,
      });
      // SAU `meta`, không trước: người xem dựng bộ giải mã từ `meta`, nên mọi
      // mảnh tới trước nó đều bị vứt. Đây là phần đầu luồng dành cho người vào
      // giữa chừng — thiếu nó thì họ chỉ nhận khung P và ảnh đứng im.
      if (handle.primer) send('video', handle.primer.toString('base64'));
    } catch (err) {
      finish((err as Error).message);
    }
  },

  /**
   * Một động tác: chạm, quét, gõ chữ, hoặc một phím trong danh sách cho phép.
   *
   * Toạ độ nhận theo hệ của MÀN HÌNH, không theo khung video. Việc quy đổi nằm
   * ở client vì chỉ client biết nó đang vẽ khung to nhỏ thế nào; server thì
   * kiểm lại biên, vì một toạ độ ngoài màn hình là dấu hiệu client tính sai
   * chứ không phải ý muốn của người dùng.
   */
  'POST /api/device/control/input': async (req, res, _url, ctx) => {
    const body = await readJson<{
      deviceId?: string; leaseId?: string; platform?: unknown; action?: unknown;
    }>(req);
    const deviceId = body.deviceId?.trim();
    const leaseId = body.leaseId?.trim();
    const platform = platformOf(body.platform);
    if (!deviceId || !leaseId || !platform || !body.action) {
      return json(res, 400, { error: 'Thiếu deviceId, leaseId, platform hoặc action.' });
    }
    const target = await controlTarget(ctx.configFile, platform, deviceId);

    const held = await heldBy(ctx, deviceId, leaseId);
    if (!held.ok) return json(res, held.status, { error: held.error });

    // Kích thước màn hình hỏi TRƯỚC khi kiểm toạ độ, vì biên phụ thuộc vào nó
    // — và hỏi runner, vì chỉ máy có thiết bị mới biết.
    const screen = await localRunner.control.screenSize(target);
    const checked = checkAction(body.action, screen, platform);
    if (!checked.ok) return json(res, 400, { error: checked.error });
    const action = checked.action;

    try {
      switch (action.kind) {
        case 'tap':
          await localRunner.control.tap(target, action.x, action.y);
          break;
        case 'swipe':
          await localRunner.control.swipe(
            target,
            { x: action.x, y: action.y },
            { x: action.toX, y: action.toY },
            action.durationMs,
          );
          break;
        case 'text':
          await localRunner.control.typeText(target, action.text);
          break;
        case 'key':
          await localRunner.control.pressKey(target, action.key);
          break;
      }
    } catch (err) {
      // Lỗi từ `adb` là lỗi của THIẾT BỊ, không phải của request: máy vừa rút
      // ra, màn hình đang khoá, adb chết. 502 nói đúng chuyện đó.
      return json(res, 502, { error: (err as Error).message });
    }
    return json(res, 200, { ok: true });
  },
};

/**
 * Máy đích, kèm chữ ký WDA khi là iPhone — đọc từ config của NGƯỜI ĐANG XEM,
 * cùng các trường `ios.*` mà lượt chạy test dùng, để hai đường không ký khác
 * nhau. Config hỏng không chặn simulator: nó không cần chữ ký.
 */
async function controlTarget(configFile: string, platform: ControlPlatform, udid: string): Promise<ControlTarget> {
  if (platform !== 'ios') return { platform, udid };
  const cfg = await loadConfig(configFile).catch(() => undefined);
  if (!cfg) return { platform, udid };
  const ios = cfg.ios;
  const signing: IosSigning = {
    ...(ios.teamId ? { teamId: ios.teamId, signingId: ios.signingId ?? 'Apple Development' } : {}),
    ...(ios.wdaBundleId ? { wdaBundleId: ios.wdaBundleId } : {}),
    ...(ios.usePreinstalledWDA ? { usePreinstalledWDA: true } : {}),
    ...(ios.usePrebuiltWDA ? { usePrebuiltWDA: true } : {}),
    ...(ios.derivedDataPath ? { derivedDataPath: ios.derivedDataPath } : {}),
  };
  return { platform, udid, ...(Object.keys(signing).length > 0 ? { iosSigning: signing } : {}) };
}
