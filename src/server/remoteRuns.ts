/**
 * Chạy một file feature trên chiếc máy cắm ở RUNNER KHÁC, qua hàng đợi job.
 *
 * Workflow của App Automation Studio từng chỉ chạy được trên máy cắm vào chính
 * máy chủ: nó sinh file feature ở máy chủ rồi gọi `runSuite` tại chỗ. Từ lúc
 * điện thoại có thể cắm ở laptop từng người, đó là một nửa số máy mà workflow
 * không bao giờ chạm tới được — trong khi màn Local Runner đã chạy được trên
 * chúng qua hàng đợi từ P3.
 *
 * File này là cây cầu: đặt một job `run_suite` nhắm đúng chiếc máy ấy, mang
 * theo file feature và registry trong `snapshot` — vì cả hai đều nằm ở máy
 * chủ, không nằm trên laptop — rồi chờ job đóng lại, log chảy về workflow.
 *
 * Nó là một interface, không phải lời gọi thẳng vào hàng đợi, để workflow test
 * được mà không cần dựng hàng đợi, sổ máy và sổ runner.
 */
import type { AppBuildRef, JobState } from '../protocol/messages.js';
import type { PreflightResult } from '../core/preflight.js';
import { loadConfig } from '../config.js';
import { describeBuild, type BuildLookup } from './appBuilds.js';
import { allows } from './auth/roles.js';
import { waitForClose } from './routes/run.js';
import type { RouteContext } from './routes/types.js';

/**
 * Runner của CHÍNH tiến trình này, ở chế độ embedded.
 *
 * Máy của nó chạy tại chỗ như trước — không qua hàng đợi — vì đó là đường đã
 * được đo và dùng hằng ngày. Ở chế độ server không có runner nào mang tên này,
 * nên mọi máy đều đi đường hàng đợi, và đó là đúng: máy chủ web ở chế độ ấy
 * không cắm thiết bị nào.
 */
export const LOCAL_HOST_RUNNER = 'runner:local';

/** Chiếc máy ở runner khác, và máy tính giữ nó đang thế nào. */
export interface RemoteDevice {
  udid: string;
  label: string;
  runnerId: string;
  runnerName?: string;
  /** Máy tắt, hoặc máy tính giữ nó mất liên lạc. */
  offline: boolean;
  /** Máy tính ấy chạy được nền tảng này không. `undefined` là CHƯA ĐO. */
  ready?: boolean;
  reason?: string;
}

export interface RemoteRunRequest {
  platform: 'android' | 'ios';
  udid: string;
  /** Tên file và nội dung CHỈ gồm kịch bản đã được duyệt. */
  feature: { name: string; content: string };
  env?: string;
  appSource?: 'device' | 'upload';
}

export interface RemoteRunResult {
  jobId: string;
  state: JobState | 'unknown';
  error?: string;
}

export interface RemoteRuns {
  /**
   * Chiếc máy này nằm ở runner KHÁC không. `undefined` nghĩa là không — hoặc nó
   * ở chính máy chủ, hoặc người này không được thấy nó — và workflow đi đường
   * chạy tại chỗ như cũ.
   */
  locate(udid: string): Promise<RemoteDevice | undefined>;
  run(request: RemoteRunRequest, log: (line: string) => void): Promise<RemoteRunResult>;
}

/**
 * Dựng từ ngữ cảnh của request, để mọi phép tra đi qua đúng luật quyền của
 * người đang gọi — cùng `maySee` mà `GET /api/device/targets` và
 * `POST /api/run` dùng. Workflow không được thấy chiếc máy mà màn hình không
 * cho người ấy thấy.
 */
export function remoteRunsFor(ctx: RouteContext): RemoteRuns {
  const viewer = {
    userId: ctx.identity.userId,
    orgId: ctx.identity.orgId,
    isAdmin: allows(ctx.identity.role, 'admin'),
  };

  return {
    async locate(udid) {
      const granted = await ctx.grants.forUser(ctx.identity.orgId, ctx.identity.userId);
      const device = await ctx.devices.find(udid, viewer, granted);
      if (!device || device.runnerId === LOCAL_HOST_RUNNER) return undefined;
      const runner = await ctx.runners.find(device.runnerId);
      const prereq = runner?.prereq?.[device.platform];
      return {
        udid: device.udid,
        label: device.label,
        runnerId: device.runnerId,
        ...(runner ? { runnerName: runner.name } : {}),
        offline: device.state === 'offline' || runner?.state !== 'online',
        ...(prereq ? { ready: prereq.ok, ...(prereq.reason ? { reason: prereq.reason } : {}) } : {}),
      };
    },

    async run(request, log) {
      // Registry đọc NGAY LÚC ĐẶT JOB, không phải lúc workflow bắt đầu: người
      // duyệt kịch bản có thể đã sửa locator trong lúc chờ, và job phải chạy
      // với đúng thứ người ấy vừa sửa.
      const { data, revision } = await ctx.repos.registry.read();
      // "Bản đã tải lên" là bản trên máy chủ; runner phải tải đúng bản ấy về.
      // Tính NGAY LÚC ĐẶT JOB, cùng lý do với registry ở trên.
      let appBuild: AppBuildRef | undefined;
      if (request.appSource === 'upload') {
        const found = await describeBuild(await loadConfig(ctx.configFile), request.env, request.platform);
        if (!found.ok) throw new Error(found.reason);
        appBuild = found.build;
      }
      const job = await ctx.repos.queue.create({
        orgId: ctx.identity.orgId,
        kind: 'run_suite',
        createdBy: ctx.identity.userId,
        spec: {
          orgId: ctx.identity.orgId,
          kind: 'run_suite',
          createdBy: ctx.identity.userId,
          timeoutMs: 15 * 60_000,
          deviceTokens: [`${request.platform}:${request.udid}`],
          run: {
            platform: request.platform,
            feature: request.feature.name,
            ...(request.env ? { env: request.env } : {}),
            ...(request.appSource ? { appSource: request.appSource } : {}),
            ...(appBuild ? { appBuild } : {}),
          },
          snapshot: {
            registryRevision: revision ?? '',
            registry: data,
            features: [request.feature],
          },
        },
      });

      log(`[job] ${job.id} đã vào hàng đợi.`);
      const offLog = await ctx.repos.queue.onLog(job.id, log);
      try {
        const closed = await waitForClose(ctx.repos.queue, job.id, log);
        return {
          jobId: job.id,
          state: closed?.state ?? 'unknown',
          ...(closed?.error ? { error: closed.error } : {}),
        };
      } finally {
        offLog();
      }
    },
  };
}

/**
 * Phép kiểm môi trường cho chiếc máy cắm ở RUNNER KHÁC.
 *
 * Máy chủ không dò được nó — nó không cắm ở đây, nên `adb devices` tại chỗ sẽ
 * luôn nói "chưa cắm". Thứ đáng tin là cái chính runner ấy đã đo và báo lên
 * sổ: máy còn đó không, và máy tính giữ nó có chạy được nền tảng này không.
 *
 * Cùng hình dạng với kết quả của `preflight()` để phần còn lại của workflow —
 * dòng tóm tắt, cổng dừng — không phải biết có hai loại máy.
 */
export function remotePreflight(
  platform: 'android' | 'ios' | string,
  device: RemoteDevice,
  /**
   * Bản build máy chủ sẽ gửi đi, khi nguồn app là "bản đã tải lên". Người gọi
   * tra bằng `describeBuild` — hàm này giữ thuần để test được không cần đĩa.
   */
  build?: BuildLookup,
): PreflightResult {
  const where = device.runnerName ?? device.runnerId;
  const checks = [
    {
      name: `Thiết bị ${platform === 'ios' ? 'iOS' : 'Android'}`,
      ok: !device.offline,
      detail: device.offline
        ? `${device.label} đang tắt, hoặc máy tính giữ nó (${where}) đã mất liên lạc.`
        : `${device.label} — cắm ở ${where}.`,
    },
    {
      name: 'Máy tính giữ thiết bị',
      // `undefined` là CHƯA ĐO — runner vừa khởi động — chứ không phải hỏng.
      // Chặn ở đây là chặn một chiếc máy hoàn toàn tốt; nếu nó thật sự thiếu
      // gì, runner sẽ tự từ chối job kèm câu nói việc cần làm.
      ok: device.ready !== false,
      detail: device.ready === false
        ? (device.reason ?? `${where} chưa chạy được ${platform}.`)
        : device.ready === undefined
          ? `${where} chưa báo trạng thái môi trường; runner sẽ tự kiểm lúc nhận job.`
          : `${where} sẵn sàng chạy ${platform}.`,
    },
    // Bản build đi sang runner ở xa: nói tên và cỡ, vì lần đầu nó là vài trăm
    // MB qua mạng và người bấm chạy nên biết vì sao bước đầu tiên lâu.
    ...(build ? [build.ok
      ? {
        name: 'Bản build',
        ok: true,
        detail: `${build.build.name} (${Math.round(build.build.size / 1024 / 1024)} MB) — `
          + `${where} sẽ tải về nếu chưa có đúng bản này.`,
      }
      : { name: 'Bản build', ok: false, detail: build.reason }] : []),
  ];
  return {
    platform: platform as PreflightResult['platform'],
    ok: checks.every((check) => check.ok),
    checks,
    device: device.udid,
  };
}
