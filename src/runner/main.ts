/**
 * Runner chạy độc lập: một tiến trình trên máy có thiết bị cắm vào.
 *
 * Nó KHÔNG phục vụ HTTP, không có giao diện, và không biết gì về Postgres. Nó
 * chỉ làm ba việc: chào server, đòi job, chạy job. Mọi hành vi khác — giữ chỗ
 * thiết bị, ghép theo udid, hoãn khi máy bận — đến từ chính `startWorker` mà
 * chế độ embedded đang dùng, vì `RemoteJobQueue` đội đúng hình dạng `JobQueue`.
 *
 * Chạy:
 *
 *   TESTPILOT_SERVER=https://testpilot.example.com \
 *   TESTPILOT_RUNNER_TOKEN=... \
 *   npm run runner
 *
 * Tắt bằng Ctrl-C: nó đẩy nốt log đang chờ rồi mới thoát, vì những dòng ấy là
 * thứ duy nhất nói vì sao lượt chạy cuối cùng đỏ.
 */
import os from 'node:os';
import { loadConfig } from '../config.js';
import { localLeases } from '../server/db/leaseRepo.js';
import { runnerPlatforms } from '../server/scheduler/match.js';
import { farmReadiness, farmRunner } from './farmRunner.js';
import { localRunner } from './index.js';
import { ProtocolMismatchError, RemoteJobQueue } from './remote.js';
import { applyUpdate, EXIT_UPDATED, planUpdate } from './update.js';
import { startWorker } from './worker.js';

/** Đẩy log đi mỗi nửa giây. Đủ nhanh để người xem thấy gần như tức thì. */
const FLUSH_MS = 500;

/** Báo danh sách máy mỗi mười giây — cùng nhịp với bản embedded. */
const DEVICE_REPORT_MS = 10_000;

/**
 * Server đã nâng major: cài bản mới rồi thoát cho bộ giám sát dựng lại.
 *
 * Luôn thoát — bằng một trong ba mã, và ba mã ấy nói ba chuyện khác nhau với
 * người đang đọc log từ xa:
 *
 *   75  đã cài xong, dựng tôi dậy (bộ giám sát hiểu đây không phải lỗi)
 *   2   máy này không được cấu hình để tự cập nhật, cần người vào
 *   3   đã thử cập nhật và hỏng
 *
 * Chạy tiếp với giao thức lệch major thì tệ hơn cả ba: runner nhận job rồi
 * hỏng ở giữa, với một câu lỗi nói về một trường bị thiếu chứ không nói rằng
 * nó đã quá cũ.
 */
async function selfUpdate(err: ProtocolMismatchError): Promise<never> {
  console.error(`[runner] ${err.message}`);
  const plan = planUpdate();
  if (!plan) {
    console.error(
      '[runner] Máy này không tự cập nhật được: chưa đặt TESTPILOT_RUNNER_PACKAGE. '
      + 'Cài bản runner mới rồi khởi động lại dịch vụ — xem packaging/README.md.',
    );
    process.exit(2);
  }

  console.log(`[runner] Đang cài ${plan.packageName}@${plan.tag}…`);
  const outcome = await applyUpdate(plan);
  console[outcome.ok ? 'log' : 'error'](`[runner] ${outcome.message}`);
  process.exit(outcome.ok ? EXIT_UPDATED : 3);
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(
      `Thiếu ${name}. Runner cần biết nối vào đâu và bằng token nào — `
      + 'xem infra/README.md.',
    );
    process.exit(2);
  }
  return value;
}

async function main(): Promise<void> {
  const serverUrl = required('TESTPILOT_SERVER').replace(/\/+$/, '');
  const token = required('TESTPILOT_RUNNER_TOKEN');
  const name = process.env.TESTPILOT_RUNNER_NAME?.trim() || os.hostname();
  const configFile = process.env.TESTPILOT_CONFIG?.trim() || 'testpilot.config.json';

  const queue = new RemoteJobQueue({ serverUrl, token, name });
  const mode = process.env.TESTPILOT_RUNNER_MODE?.trim() === 'farm' ? 'farm' : 'lab';

  /**
   * Nền tảng khai ra phải là điều ĐO ĐƯỢC.
   *
   * Runner lab đo bằng máy đang cắm; runner farm đo bằng việc AWS có dùng được
   * không và device pool đang cấu hình cho nền tảng nào. Khai điều mình mong
   * nghĩa là job rơi vào một runner không chạy được nó, và với Device Farm thì
   * điều đó còn tốn tiền: bundle được tải lên, thiết bị khởi động, rồi hỏng.
   */
  let platforms: string[];
  let runner = localRunner;
  if (mode === 'farm') {
    const ready = await farmReadiness(await loadConfig(configFile));
    if (!ready.ok) {
      console.error(`[runner] Device Farm chưa dùng được: ${ready.reason}`);
      process.exit(2);
    }
    platforms = ready.platforms;
    runner = farmRunner({ configFile });
  } else {
    const devices = await localRunner.control.devices().catch(() => []);
    platforms = runnerPlatforms(
      devices
        .filter((device) => device.platform === 'android' || device.platform === 'ios')
        .map((device) => ({ platform: device.platform, udid: device.udid })),
    );
  }

  // Chào TRƯỚC khi đòi job: nếu hai bên khác major thì dừng ngay, thay vì nhận
  // một job rồi hỏng ở giữa với một câu lỗi nói về trường nào đó bị thiếu.
  const hello = await queue.hello({ platforms, mode }).catch(async (err: Error) => {
    if (!(err instanceof ProtocolMismatchError)) throw err;
    await selfUpdate(err);
    // `selfUpdate` luôn thoát. Dòng này chỉ để TypeScript biết thế.
    throw err;
  });
  console.log(
    `[runner] ${name} (${mode}) đã nối ${serverUrl} (giao thức ${hello.protocolVersion}, `
    + `tổ chức ${hello.orgId}). Nền tảng: ${platforms.join(', ')}.`,
  );

  const worker = startWorker({
    queue,
    // Lease của runner này là lease CỦA MÁY NÀY: thiết bị cắm ở đây, và không
    // ai khác nhìn thấy chúng. Lease dùng chung theo tổ chức là việc của P4,
    // khi cùng một chiếc máy có thể xuất hiện ở hai nơi.
    leases: localLeases,
    runnerId: name,
    configFile,
    runner,
    // Device Farm tự quản thiết bị của nó: không udid để giữ chỗ, và việc xếp
    // hàng đợi máy xảy ra bên trong AWS.
    managesOwnDevices: mode === 'farm',
    // Runner farm không có Appium tại chỗ và không cần: máy nằm ở AWS.
    skipPrereq: mode === 'farm',
    // Nguồn sự thật của registry là control plane, không phải file trên máy
    // này. Lượt chạy gửi phần nó học được lên qua `JobResult.registryProposal`
    // và server quyết định gộp hay treo lại chờ duyệt — runner không ghi thẳng
    // vào dữ liệu dùng chung. Xem mục 4b của tài liệu kiến trúc.
    deferSharedWrites: true,
    // Nền tảng KHAI TAY cho farm, vì `control.devices()` của nó rỗng theo đúng
    // nghĩa đen — máy nằm ở AWS. Không truyền thì worker tự đo và ra `['web']`,
    // rồi không bao giờ nhận job Android: nó nằm chờ mãi mà không ai hiểu vì
    // sao. Runner lab thì để worker tự đo, vì máy cắm vào và rút ra liên tục.
    ...(mode === 'farm' ? { platforms } : {}),
  });

  const flusher = setInterval(() => { void queue.flush(); }, FLUSH_MS);

  /**
   * Báo danh sách máy theo nhịp, không chỉ một lần lúc chào.
   *
   * Máy cắm vào và rút ra giữa ca làm là chuyện thường của một chiếc laptop.
   * Báo một lần nghĩa là server giữ mãi một danh sách cũ, và job rơi vào một
   * chiếc máy đã nằm trong cặp từ sáng.
   */
  const report = async (): Promise<void> => {
    const seen = await runner.control.devices().catch(() => []);
    await queue.reportDevices(
      seen
        .filter((device) => device.platform === 'android' || device.platform === 'ios')
        .map((device) => ({ platform: device.platform, udid: device.udid, label: device.label })),
    ).catch(() => undefined);
  };
  void report();
  const reporter = setInterval(() => void report(), DEVICE_REPORT_MS);

  const stop = (signal: string) => {
    void (async () => {
      console.log(`[runner] ${signal} — đang đẩy nốt log rồi thoát.`);
      worker.stop();
      clearInterval(flusher);
      clearInterval(reporter);
      const left = await queue.flush();
      if (left > 0) console.error(`[runner] còn ${left} dòng log chưa gửi được.`);
      process.exit(0);
    })();
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => stop(signal));
  }

  console.log('[runner] đang chờ job. Ctrl-C để dừng.');
}

void main().catch((err: Error) => {
  console.error(`[runner] không khởi động được: ${err.message}`);
  process.exit(1);
});
