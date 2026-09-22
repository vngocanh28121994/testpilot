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
import { localLeases } from '../server/db/leaseRepo.js';
import { runnerPlatforms } from '../server/scheduler/match.js';
import { localRunner } from './index.js';
import { RemoteJobQueue } from './remote.js';
import { startWorker } from './worker.js';

/** Đẩy log đi mỗi nửa giây. Đủ nhanh để người xem thấy gần như tức thì. */
const FLUSH_MS = 500;

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

  // Chào TRƯỚC khi đòi job: nếu hai bên khác major thì dừng ngay, thay vì nhận
  // một job rồi hỏng ở giữa với một câu lỗi nói về trường nào đó bị thiếu.
  const devices = await localRunner.control.devices().catch(() => []);
  const platforms = runnerPlatforms(
    devices
      .filter((device) => device.platform === 'android' || device.platform === 'ios')
      .map((device) => ({ platform: device.platform, udid: device.udid })),
  );
  const hello = await queue.hello({ platforms, mode: 'lab' });
  console.log(
    `[runner] ${name} đã nối ${serverUrl} (giao thức ${hello.protocolVersion}, `
    + `tổ chức ${hello.orgId}). Nền tảng đo được: ${platforms.join(', ')}.`,
  );

  const worker = startWorker({
    queue,
    // Lease của runner này là lease CỦA MÁY NÀY: thiết bị cắm ở đây, và không
    // ai khác nhìn thấy chúng. Lease dùng chung theo tổ chức là việc của P4,
    // khi cùng một chiếc máy có thể xuất hiện ở hai nơi.
    leases: localLeases,
    runnerId: name,
    configFile,
  });

  const flusher = setInterval(() => { void queue.flush(); }, FLUSH_MS);

  const stop = (signal: string) => {
    void (async () => {
      console.log(`[runner] ${signal} — đang đẩy nốt log rồi thoát.`);
      worker.stop();
      clearInterval(flusher);
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
