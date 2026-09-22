/**
 * Worker: đòi job từ hàng đợi, chạy, báo kết quả.
 *
 * Ở chế độ `embedded` nó chạy trong chính tiến trình server, nên "runner
 * online" là một sự thật hiển nhiên — và đó chính là điều cần nói rõ: hàng đợi
 * KHÔNG biết điều ấy. Job nằm `queued` cho tới khi có worker đòi, kể cả khi
 * worker ấy ở cách đó ba dòng code. Nhờ vậy cùng một vòng lặp chạy được ở máy
 * có thiết bị cắm vào, cách server một mạng LAN, mà không đổi một dòng nào.
 *
 * Vòng lặp cố tình ngu: đòi một job, chạy xong mới đòi tiếp. Chạy song song
 * nhiều job trên một máy là việc của lease (P3.2) — ở đây mà làm thì hai job
 * sẽ tranh cùng một chiếc điện thoại, và không ai phân xử.
 */
import type { JobRecord, JobQueue } from '../server/queue/queue.js';
import { LeaseTakenError, type Lease, type LeaseHolder, type LeaseRepo } from '../server/db/repo.js';
import type { JobResult } from '../protocol/messages.js';
import { localRunner, type Runner } from './index.js';

export interface WorkerDeps {
  queue: JobQueue;
  /**
   * Kho giữ chỗ thiết bị.
   *
   * Cùng kho mà màn Điều khiển dùng, và đó là toàn bộ điểm: một con người đang
   * cầm chiếc điện thoại qua trình duyệt phải chặn được job, và ngược lại. Hai
   * cơ chế giữ chỗ riêng nghĩa là hai câu trả lời cho "máy này có rảnh không",
   * và job sẽ chạy đè lên tay người đang bấm — không đỏ, chỉ sai.
   */
  leases: LeaseRepo;
  /** Tên runner này trong sổ. Ở embedded là `local`. */
  runnerId: string;
  /** Nền tảng chạy được; `undefined` nghĩa là nhận tất. */
  platforms?: string[];
  configFile: string;
  /** Nhịp hỏi hàng đợi. Nhỏ thì job chạy nhanh hơn, to thì đỡ tốn CPU khi rỗi. */
  pollMs?: number;
  /** Nhịp gia hạn lease. Phải nhỏ hơn TTL 60 giây, và có lề cho một nhịp lỡ. */
  renewMs?: number;
  /** Chờ bao lâu trước khi thử lại một job có máy đang bận. */
  deferMs?: number;
  /** Tiêm bản giả trong test. Mặc định là runner thật của máy này. */
  runner?: Runner;
}

export interface WorkerHandle {
  stop(): void;
  /** Job đang chạy, để test và để `/api/jobs` nói được ai đang làm gì. */
  current(): string | undefined;
}

export function startWorker(deps: WorkerDeps): WorkerHandle {
  const runner = deps.runner ?? localRunner;
  let stopped = false;
  let busy = false;
  let current: string | undefined;

  const tick = async (): Promise<void> => {
    if (stopped || busy) return;
    busy = true;
    try {
      const job = await deps.queue.claim({
        runnerId: deps.runnerId,
        ...(deps.platforms ? { platforms: deps.platforms } : {}),
      });
      if (!job) return;
      current = job.id;
      await run(job, deps, runner);
    } catch (err) {
      // Vòng lặp KHÔNG được chết vì một job hỏng: nó còn phải phục vụ job sau.
      // Nhưng im lặng thì cũng không được — một worker đã chết và một worker
      // đang rỗi trông giống hệt nhau từ ngoài.
      console.error('[worker] vòng lặp hỏng:', (err as Error).message);
    } finally {
      current = undefined;
      busy = false;
    }
  };

  const timer = setInterval(() => void tick(), deps.pollMs ?? 250);
  // Không giữ tiến trình sống chỉ vì vòng lặp này: một server đang rỗi phải
  // tắt được bằng Ctrl-C ngay, không phải chờ hết nhịp.
  timer.unref?.();

  return {
    stop: () => { stopped = true; clearInterval(timer); },
    current: () => current,
  };
}

/** Chạy một job và đóng nó lại. Mọi đường ra đều phải gọi `finish` hoặc `release`. */
async function run(job: JobRecord, deps: WorkerDeps, runner: Runner): Promise<void> {
  const log = (line: string): void => { void deps.queue.appendLog(job.id, line); };

  if (job.kind !== 'run_suite') {
    // Nói rõ chưa làm, thay vì nhận rồi im lặng không chạy gì. `gen`,
    // `workflow` và phần còn lại thành job ở các bước sau của P3.
    await close(deps, job, {
      type: 'job.result', jobId: job.id, state: 'failed',
      error: `Worker chưa chạy được job loại "${job.kind}".`,
    });
    return;
  }

  const params = job.spec.run;
  if (!params) {
    await close(deps, job, {
      type: 'job.result', jobId: job.id, state: 'failed',
      error: 'Job run_suite thiếu phần `run` trong spec.',
    });
    return;
  }

  const picked = job.spec.deviceTokens
    .map((token) => runner.run.parseDeviceToken(token))
    .filter((device): device is NonNullable<typeof device> => device !== null);

  const holder: LeaseHolder = { kind: 'job', jobId: job.id };
  const held = await hold(picked.map((device) => device.id), deps, holder, log);
  if (!held.ok) {
    // HOÃN, không đánh hỏng và cũng không tính là một lần thử: máy đang bận là
    // chuyện tạm thời, và đánh hỏng ở đây nghĩa là người dùng phải bấm lại —
    // đúng thứ hàng đợi sinh ra để khỏi phải làm.
    //
    // Nói MỘT LẦN cho mỗi lý do. Bản đầu in lại câu ấy sau mỗi lần thử, và
    // lần chạy thật đầu tiên cho ra ba mươi ba dòng giống hệt nhau trong tám
    // giây — người đọc không học thêm được gì sau dòng thứ nhất.
    if (job.error !== held.reason) log(`[job] ${held.reason} Job chờ tới lượt.`);
    await deps.queue.defer(job.id, held.reason, deps.deferMs ?? 5_000);
    return;
  }

  // Nhịp gia hạn. Lease sống 60 giây; ngừng nhịp là mất máy giữa chừng, nên
  // mất nhịp phải DỪNG lượt chạy chứ không chạy tiếp trên một chiếc máy mà
  // người khác đã được cấp.
  let lost: string | undefined;
  const renew = setInterval(() => {
    void (async () => {
      for (const lease of held.leases) {
        const still = await deps.leases.renew(lease.id, holder).catch(() => undefined);
        if (still) continue;
        lost ??= `Mất chỗ giữ thiết bị ${lease.deviceId}.`;
        log(`[job] ${lost} Đang dừng lượt chạy.`);
        await runner.run.stop().catch(() => undefined);
        return;
      }
    })();
  }, deps.renewMs ?? 30_000);
  renew.unref?.();

  try {
    if (picked.length > 1) {
      // Nhiều máy: cùng đường mà nút "chạy" vẫn đi, không phải một đường thứ hai.
      const platforms = [...new Set(picked.map((device) => device.platform))].join(',');
      const tokens = picked.map((device) => `${device.platform}:${device.id}`);
      await runner.run.startParallel(
        platforms, tokens, params.tag, Boolean(params.includeQuarantined), log,
        params.env, params.appSource,
      );
      await close(deps, job, lost
        ? { type: 'job.result', jobId: job.id, state: 'interrupted', error: lost }
        : { type: 'job.result', jobId: job.id, state: 'succeeded' });
      return;
    }

    const one = picked[0];
    const named = one ? await runner.run.isNamedDevice(one, deps.configFile) : false;
    const outcome = await runner.run.startSuite(
      one?.platform ?? params.platform,
      params.tag,
      Boolean(params.headed),
      Boolean(params.includeQuarantined),
      log,
      named && one ? one.id : undefined,
      params.env,
      undefined,
      undefined,
      params.appSource,
    );

    await close(deps, job, lost
      // Mất lease rồi mới kết thúc: lượt chạy ấy đã bị dừng giữa chừng, nên
      // kết quả của nó không nói được gì. `interrupted` là câu đúng, không
      // phải `cancelled` — không ai bấm dừng cả.
      ? { type: 'job.result', jobId: job.id, state: 'interrupted', error: lost }
      : outcomeToResult(job.id, outcome));
  } catch (err) {
    await close(deps, job, {
      type: 'job.result', jobId: job.id, state: 'failed', error: (err as Error).message,
    });
  } finally {
    clearInterval(renew);
    // Nhả trong `finally`: một job ném mà không nhả máy là một chiếc điện thoại
    // bị khoá 60 giây cho mỗi lần hỏng, và người tiếp theo không biết vì sao.
    for (const lease of held.leases) {
      await deps.leases.release(lease.id, holder).catch(() => undefined);
    }
  }
}

/**
 * Giữ TẤT CẢ máy job cần, hoặc không giữ gì cả.
 *
 * Giữ được một nửa rồi chờ nửa còn lại là cách hai job khoá chéo nhau: mỗi bên
 * cầm một chiếc máy bên kia cần, và cả hai chờ mãi. Nên hỏng ở chiếc thứ hai
 * thì nhả luôn chiếc thứ nhất.
 *
 * Job không nêu máy nào thì KHÔNG giữ gì, và nói ra. Biết chiếc máy thật mà
 * một lượt chạy sẽ dùng khi người dùng không chọn là việc của P3.3 — ở đó danh
 * tính thiết bị được phân giải đàng hoàng. Khoá một cái tên đoán được ở đây sẽ
 * TRÔNG như bảo vệ mà không bảo vệ gì, và đó tệ hơn là không khoá.
 */
async function hold(
  deviceIds: string[],
  deps: WorkerDeps,
  holder: LeaseHolder,
  log: (line: string) => void,
): Promise<{ ok: true; leases: Lease[] } | { ok: false; reason: string }> {
  if (deviceIds.length === 0) {
    log('[job] Job không nêu máy cụ thể, nên không giữ chỗ thiết bị (xem P3.3).');
    return { ok: true, leases: [] };
  }

  const leases: Lease[] = [];
  for (const deviceId of deviceIds) {
    try {
      leases.push(await deps.leases.acquire(deviceId, holder));
    } catch (err) {
      for (const lease of leases) {
        await deps.leases.release(lease.id, holder).catch(() => undefined);
      }
      const reason = err instanceof LeaseTakenError
        ? err.message
        : `Không giữ được thiết bị ${deviceId}: ${(err as Error).message}`;
      return { ok: false, reason };
    }
  }
  log(`[job] Đã giữ chỗ: ${deviceIds.join(', ')}.`);
  return { ok: true, leases };
}

/**
 * Mã thoát của tiến trình chạy → trạng thái job.
 *
 * Mã 2 là "không có gì hỏng, nhưng có kịch bản chưa duyệt nên chưa chạy". Nó
 * là `succeeded` với hàng đợi — không lượt nào fail — nhưng dòng log đã nói rõ
 * phần bị bỏ, và đó là chỗ người dùng đọc. Coi nó là `failed` sẽ làm một job
 * hoàn toàn bình thường hiện lên màu đỏ.
 */
function outcomeToResult(
  jobId: string,
  outcome: { code: number | null; stopped: boolean },
): JobResult {
  if (outcome.stopped) {
    return { type: 'job.result', jobId, state: 'cancelled', error: 'Lượt chạy đã bị dừng.' };
  }
  if (outcome.code === 0 || outcome.code === 2) {
    return { type: 'job.result', jobId, state: 'succeeded' };
  }
  return {
    type: 'job.result', jobId, state: 'failed',
    error: `Test kết thúc với lỗi (mã ${outcome.code}).`,
  };
}

async function close(deps: WorkerDeps, job: JobRecord, result: JobResult): Promise<void> {
  await deps.queue.finish(job.id, result);
}
