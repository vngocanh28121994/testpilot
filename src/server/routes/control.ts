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
import { checkAction } from '../../protocol/control.js';
import { localRunner } from '../../runner/index.js';
import type { Lease } from '../db/repo.js';
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

export const controlRoutes: RouteTable = {
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
    if (!deviceId || !leaseId) {
      return json(res, 400, { error: 'Thiếu deviceId hoặc leaseId.' });
    }
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
      const handle = await localRunner.control.startScreenStream(deviceId, {
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
      stop = handle.stop;
      send('meta', {
        deviceId,
        screen: await localRunner.control.screenSize(deviceId),
        frame: handle.frame,
      });
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
    const body = await readJson<{ deviceId?: string; leaseId?: string; action?: unknown }>(req);
    const deviceId = body.deviceId?.trim();
    const leaseId = body.leaseId?.trim();
    if (!deviceId || !leaseId || !body.action) {
      return json(res, 400, { error: 'Thiếu deviceId, leaseId hoặc action.' });
    }

    const held = await heldBy(ctx, deviceId, leaseId);
    if (!held.ok) return json(res, held.status, { error: held.error });

    // Kích thước màn hình hỏi TRƯỚC khi kiểm toạ độ, vì biên phụ thuộc vào nó
    // — và hỏi runner, vì chỉ máy có thiết bị mới biết.
    const screen = await localRunner.control.screenSize(deviceId);
    const checked = checkAction(body.action, screen);
    if (!checked.ok) return json(res, 400, { error: checked.error });
    const action = checked.action;

    try {
      switch (action.kind) {
        case 'tap':
          await localRunner.control.tap(deviceId, action.x, action.y);
          break;
        case 'swipe':
          await localRunner.control.swipe(
            deviceId,
            { x: action.x, y: action.y },
            { x: action.toX, y: action.toY },
            action.durationMs,
          );
          break;
        case 'text':
          await localRunner.control.typeText(deviceId, action.text);
          break;
        case 'key':
          await localRunner.control.pressKey(deviceId, action.key);
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
