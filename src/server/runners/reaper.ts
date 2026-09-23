/**
 * Máy cá nhân TẮT LÚC NÀO CŨNG ĐƯỢC — và hệ thống phải nói đúng điều đó.
 *
 * Đây là sự thật của P4, không phải lỗi: laptop của một người đóng nắp lúc
 * 18h, mất wifi khi đi thang máy, hết pin. Cái sai không phải chuyện máy tắt,
 * mà là hệ thống VỜ NHƯ nó còn sống — job nằm chờ một chiếc máy đã đi về từ
 * lâu, và người đặt job không có cách nào biết.
 *
 * Nên vòng này làm ba việc, theo đúng thứ tự ấy:
 *
 *  1. Runner im lặng quá lâu → `offline` trong sổ.
 *  2. Máy của nó → `offline`, KHÔNG biến mất: "không có máy nào" và "máy của
 *     bạn đang tắt" là hai câu khác nhau, và người dùng cần câu thứ hai.
 *  3. Job mà runner ấy đang chạy → `interrupted`, và lease của nó được nhả.
 *     Job treo `running` mãi mãi là dòng nói dối đắt nhất: nó khoá cả thiết bị
 *     lẫn chỗ trong hàng đợi.
 */
import type { JobQueue } from '../queue/queue.js';
import type { LeaseRepo } from '../db/repo.js';
import type { DeviceRegistry } from '../devices/registry.js';
import type { RunnerRegistry } from '../runners/registry.js';
import type { SessionStore } from '../auth/session.js';

export interface ReaperDeps {
  runners: RunnerRegistry;
  devices: DeviceRegistry;
  queue: JobQueue;
  leases: LeaseRepo;
  /**
   * Im lặng bao lâu thì coi là đã tắt.
   *
   * 90 giây, cùng con số với điều kiện hoàn thành của P4.6 — và nó phải LỚN
   * HƠN nhịp hỏi job của runner (một phần tư giây) cộng với một lần mạng chập
   * dài. Quá ngắn thì một runner đang bận tải bundle bị coi là chết.
   */
  silentMs?: number;
  /**
   * Dọn phiên đăng nhập đã hết hạn.
   *
   * Không bắt buộc: ở chế độ embedded không có phiên nào, và bản RAM tự quên
   * khi tiến trình chết. Ở chế độ server thì bảng `session` chỉ lớn lên —
   * `find()` xoá dòng hết hạn khi có ai hỏi tới nó, nhưng phiên bị BỎ QUÊN thì
   * không ai hỏi tới bao giờ, và đó đúng là loại chiếm phần lớn số dòng.
   */
  sessions?: Pick<SessionStore, 'reapExpired'>;
}

export const DEFAULT_SILENT_MS = 90_000;

export interface ReaperResult {
  runners: number;
  jobs: number;
}

/**
 * Chạy một vòng dọn. Gọi lại nhiều lần là an toàn.
 *
 * Tách khỏi `setInterval` để test gọi thẳng được: một vòng dọn phụ thuộc đồng
 * hồ thật là một bài test đo sự kiên nhẫn của người chạy nó.
 */
export async function reapOnce(deps: ReaperDeps, now = new Date()): Promise<ReaperResult> {
  const silentMs = deps.silentMs ?? DEFAULT_SILENT_MS;
  const before = await deps.runners.list();
  const online = new Set(
    before.filter((runner) => runner.state === 'online').map((runner) => runner.id),
  );

  // Dọn phiên TRƯỚC khi thoát sớm ở dưới: nó không liên quan gì tới runner,
  // và đặt nó sau câu `return` nghĩa là nó chỉ chạy vào những vòng tình cờ có
  // một chiếc máy vừa tắt.
  if (deps.sessions?.reapExpired) {
    await deps.sessions.reapExpired(now.getTime()).catch(() => 0);
  }

  const changed = await deps.runners.reapSilent(silentMs, now);
  if (changed === 0) return { runners: 0, jobs: 0 };

  const after = await deps.runners.list();
  const fallen = after.filter((runner) => runner.state === 'offline' && online.has(runner.id));

  let jobs = 0;
  for (const runner of fallen) {
    await deps.devices.markRunnerOffline(runner.id, now);

    // Job mà chính runner ấy đang giữ. Job của runner KHÁC không đụng tới —
    // một máy tắt không được kéo theo việc của máy đang chạy tốt.
    const running = await deps.queue.list({ state: ['assigned', 'running'] });
    for (const job of running) {
      if (job.runnerId !== runner.id) continue;
      await deps.queue.finish(job.id, {
        type: 'job.result',
        jobId: job.id,
        state: 'interrupted',
        error: `Runner "${runner.name}" đã ngừng trả lời; job bị bỏ dở.`,
      });
      jobs += 1;

      // Nhả thiết bị: lease có TTL nên nó tự hết hạn sau 60 giây, nhưng chờ
      // hết hạn nghĩa là chiếc máy ấy bị khoá thêm một phút sau khi ai cũng đã
      // biết nó không còn chạy gì.
      for (const lease of await deps.leases.list(now)) {
        if (lease.holder.kind === 'job' && lease.holder.jobId === job.id) {
          await deps.leases.release(lease.id);
        }
      }
    }
  }

  return { runners: fallen.length, jobs };
}

export interface ReaperHandle {
  stop(): void;
}

/** Vòng lặp nền. Nhịp bằng một phần ba hạn im lặng, để phát hiện không lệch quá xa. */
export function startReaper(deps: ReaperDeps): ReaperHandle {
  const silentMs = deps.silentMs ?? DEFAULT_SILENT_MS;
  const timer = setInterval(() => {
    void reapOnce(deps).catch((err: Error) => {
      // Vòng dọn chết lặng lẽ nghĩa là mọi máy tắt từ đó về sau đều được coi
      // là còn sống — đúng kiểu hỏng mà file này sinh ra để tránh.
      console.error('[reaper] vòng dọn hỏng:', err.message);
    });
  }, Math.max(5_000, Math.round(silentMs / 3)));
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}
