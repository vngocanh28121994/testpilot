/**
 * Máy chủ cũng là máy cắm thiết bị: nó tự làm runner cho chính nó.
 *
 * Ở chế độ embedded đây luôn đúng — một người, một máy. Ở chế độ server thì
 * TUỲ CHỌN (`TESTPILOT_HOST_DEVICES=1`), cho đúng trường hợp của một device
 * farm nhỏ: một chiếc máy vừa phục vụ trang web vừa cắm điện thoại, và cả nhóm
 * vào web để dùng những chiếc điện thoại ấy.
 *
 * Trước file này, chế độ server KHÔNG có đường ấy: điện thoại cắm vào máy chủ
 * không hiện với ai, và muốn nó hiện thì phải tạo token, chạy một runner riêng
 * trên chính máy chủ và nối ngược về — kể cả khi cả hai nằm trên cùng một
 * chiếc laptop. Người dùng hỏi, đúng: "tại sao phải khai báo máy tính làm gì,
 * trong khi mục đích là dùng máy cắm vào máy chủ như một device farm?"
 *
 * Ba việc, cùng một nhịp với runner ở xa:
 * 1. Giữ một dòng trong sổ runner cho chính máy này — dùng chung, không token.
 * 2. Báo danh sách thiết bị đang cắm vào sổ thiết bị.
 * 3. Nhận job nhắm vào những thiết bị ấy, qua đúng hàng đợi và kho giữ chỗ mà
 *    mọi runner khác dùng.
 */
import type { JobQueue } from './queue/queue.js';
import type { LeaseRepo } from './db/repo.js';
import type { DeviceRegistry } from './devices/registry.js';
import type { RunnerRegistry } from './runners/registry.js';
import { LOCAL_HOST_RUNNER } from './remoteRuns.js';
import { localRunner } from '../runner/index.js';
import { startWorker } from '../runner/worker.js';

/** Cùng nhịp với runner ở xa: đủ nhanh để cắm máy vào là thấy. */
export const DEVICE_REPORT_MS = 10_000;

export interface HostDeviceDeps {
  runners: RunnerRegistry;
  devices: DeviceRegistry;
  queue: JobQueue;
  leases: LeaseRepo;
  orgId: string;
  configFile: string;
  /** Tên hiện trong danh sách máy. */
  name: string;
  /**
   * Mã runner mà worker khai khi nhận job. Ở server nó PHẢI là mã có dòng
   * trong bảng `runner` (`job.runner_id` là khoá ngoại). Embedded giữ mã cũ.
   */
  workerRunnerId?: string;
}

export function startHostDevices(deps: HostDeviceDeps): { stop(): void } {
  const name = deps.name;

  const reportDevices = async (): Promise<void> => {
    const devices = await localRunner.control.devices().catch(() => []);
    // Ghi lại mỗi nhịp: đó cũng là "tôi còn sống" — thiếu nó thì vòng dọn máy
    // tắt coi máy chủ là im lặng và đánh dấu mọi thiết bị của nó "đang tắt".
    await Promise.resolve(deps.runners.seedLocalHost(LOCAL_HOST_RUNNER, name)).catch((err: Error) => {
      console.error('[host] không ghi được máy chủ vào sổ runner:', err.message);
    });
    await deps.devices.report(
      { id: LOCAL_HOST_RUNNER, orgId: deps.orgId, visibility: 'shared' },
      devices
        .filter((device) => device.platform === 'android' || device.platform === 'ios')
        .map((device) => ({ platform: device.platform, udid: device.udid, label: device.label })),
    ).catch((err: Error) => {
      console.error('[host] không báo được danh sách thiết bị:', err.message);
    });
  };
  void reportDevices();
  const deviceTimer = setInterval(() => void reportDevices(), DEVICE_REPORT_MS);
  deviceTimer.unref?.();

  // Dọn job treo TRƯỚC khi nhận job mới: một job còn `running` sau khi tiến
  // trình chết là một dòng nói dối, và nó nằm đó mãi.
  void deps.queue.interruptStale();
  const worker = startWorker({
    queue: deps.queue,
    // CÙNG kho lease mà màn Điều khiển dùng. Hai kho riêng nghĩa là job chạy
    // đè lên tay người đang cầm máy — xem FARM-ARCHITECTURE mục 6b.
    leases: deps.leases,
    runnerId: deps.workerRunnerId ?? LOCAL_HOST_RUNNER,
    configFile: deps.configFile,
  });

  // MỘT phép đo, hai nơi đọc: chính phép đo mà worker dùng để từ chối job.
  const reportPrereq = (): void => {
    void deps.runners.reportPrereq(LOCAL_HOST_RUNNER, worker.environment()).catch(() => undefined);
  };
  reportPrereq();
  const prereqTimer = setInterval(reportPrereq, DEVICE_REPORT_MS);
  prereqTimer.unref?.();

  return {
    stop() {
      clearInterval(deviceTimer);
      clearInterval(prereqTimer);
    },
  };
}
