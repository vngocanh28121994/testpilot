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
import { loadConfig, type TestPilotConfig } from '../config.js';
import { prepareJobWorkspace, type JobApp, type JobWorkspace } from './jobWorkspace.js';
import type { BuildFetcher } from './appBuild.js';
import { resolveDevices, runnerPlatforms, type AttachedDevice } from '../server/scheduler/match.js';
import { measurePrereq, refuseReason, type PrereqByPlatform } from './prereqReport.js';
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
  /**
   * Nền tảng chạy được. Bỏ trống thì worker TỰ ĐO từ máy đang cắm.
   *
   * Khai tay chỉ dùng cho test: khai điều mình mong thay vì điều mình đo được
   * nghĩa là job iOS rơi vào một máy không có iPhone nào.
   */
  platforms?: string[];
  /** Một người được chạy tối đa bao nhiêu job cùng lúc. Bỏ trống là không hạn. */
  maxPerUser?: number;
  /**
   * Runner TỰ QUẢN thiết bị của nó — không phân giải udid, không giữ chỗ.
   *
   * Đúng với AWS Device Farm: không có gì để `adb devices` nhìn thấy, không có
   * udid để khoá, và việc xếp hàng đợi thiết bị xảy ra bên trong AWS. Giữ chỗ
   * ở phía ta cho một chiếc máy ta không sở hữu là khoá một thứ không tồn tại.
   */
  managesOwnDevices?: boolean;
  configFile: string;
  /**
   * Đọc config. Bỏ trống thì đọc từ `configFile`.
   *
   * Tiêm được để test không phải dựng một file thật trên đĩa — và quan trọng
   * hơn: để test mô tả được những config khác với config của chính dự án này.
   */
  config?: () => Promise<TestPilotConfig>;
  /** Nhịp hỏi hàng đợi. Nhỏ thì job chạy nhanh hơn, to thì đỡ tốn CPU khi rỗi. */
  pollMs?: number;
  /** Nhịp gia hạn lease. Phải nhỏ hơn TTL 60 giây, và có lề cho một nhịp lỡ. */
  renewMs?: number;
  /** Chờ bao lâu trước khi thử lại một job có máy đang bận. */
  deferMs?: number;
  /**
   * Bỏ qua phép đo môi trường.
   *
   * Runner farm không có Appium tại chỗ và không cần: máy nằm ở AWS. Đo ở đây
   * sẽ từ chối mọi job vì một lý do không đúng với nó.
   */
  skipPrereq?: boolean;
  /**
   * Registry dùng chung nằm ở CHỖ KHÁC, nên lượt chạy không được ghi vào file
   * registry trên máy này.
   *
   * Đúng với runner đứng riêng (`npm run runner`): ở đó nguồn sự thật là
   * Postgres của control plane, còn `registry/elements.json` trên máy runner
   * chỉ là bản sao để chạy. Lượt chạy gửi phần nó học được lên qua
   * `JobResult.registryProposal`, và control plane quyết định gộp hay treo lại
   * chờ duyệt — xem `server/proposals/policy.ts`.
   *
   * Ở chế độ embedded thì ngược lại: file ấy CHÍNH LÀ nguồn sự thật, nên ghi
   * thẳng là đúng và gửi đề xuất cho chính mình là thừa.
   */
  deferSharedWrites?: boolean;
  /**
   * Đẩy bằng chứng của lượt chạy lên kho dùng chung.
   *
   * Bỏ trống thì không đẩy, và đó là đúng ở chế độ embedded: file đã nằm trên
   * chính chiếc máy đang phục vụ trang web, nên đẩy lên một kho ở localhost để
   * đọc lại từ đó là chép dữ liệu qua lại không vì gì cả.
   */
  artifacts?: (jobId: string, runDirs: string[], log: (line: string) => void) => Promise<void>;
  /** Tiêm bản giả trong test. Mặc định là runner thật của máy này. */
  runner?: Runner;
  /** Nơi dựng thư mục cho job mang snapshot. Mặc định `.testpilot/jobs`. */
  jobsRoot?: string;
  /**
   * Lấy bản build máy chủ đã chọn về máy này. Xem [appBuild.ts](./appBuild.ts).
   *
   * CHỈ runner đứng riêng có nó. Worker nhúng trong máy chủ thì không cần: nó
   * dùng CHÍNH config và CHÍNH đĩa của máy chủ, nên bản build trong config của
   * nó là đúng bản máy chủ vừa chọn — tải lại từ chính mình là chép 215 MB qua
   * lại không vì gì, và thêm một đường có thể hỏng vào lượt chạy dùng hằng ngày.
   */
  fetchBuild?: BuildFetcher;
}

export interface WorkerHandle {
  stop(): void;
  /** Job đang chạy, để test và để `/api/jobs` nói được ai đang làm gì. */
  current(): string | undefined;
  /**
   * Phép đo môi trường gần nhất — thứ worker vẫn dùng để TỪ CHỐI job.
   *
   * Lộ ra đây thay vì để `main.ts` tự đo lần nữa: hai phép đo song song sẽ
   * lệch nhau, và lúc ấy màn hình nói "Appium đang chạy" trong khi worker vừa
   * từ chối một job vì Appium không chạy. Một phép đo, hai nơi đọc.
   */
  environment(): PrereqByPlatform;
}

export function startWorker(deps: WorkerDeps): WorkerHandle {
  const runner = deps.runner ?? localRunner;
  let stopped = false;
  let busy = false;
  let current: string | undefined;

  /**
   * Ảnh chụp máy đang cắm, làm mới nhiều nhất mười giây một lần.
   *
   * Hỏi `adb` và `simctl` thật mất 200-500ms. Nhịp đòi job là một phần tư
   * giây, nên hỏi mỗi nhịp sẽ tốn nhiều thời gian máy hơn cả việc chạy test.
   * Mười giây cũ là chấp nhận được vì đây chỉ là bộ LỌC: lease và lần chạy
   * thật mới là chỗ sai được bắt chắc chắn.
   */
  let snapshot: { at: number; devices: AttachedDevice[] } = { at: 0, devices: [] };
  /**
   * Môi trường đo lại mỗi ba mươi giây.
   *
   * Không đo mỗi lần đòi job: `xcode-select` và lời gọi Appium mất vài trăm
   * mili giây, mà nhịp đòi job là một phần tư giây. Ba mươi giây đủ nhanh để
   * bắt được lúc ai đó vừa bật Appium lên.
   */
  let prereq: { at: number; report: PrereqByPlatform } = { at: 0, report: {} };
  // Đo NGAY lúc dựng worker, không đợi job đầu tiên: màn hình phải nói được
  // tình trạng của máy trước khi ai đó đặt job, chứ không phải sau.
  if (!deps.skipPrereq) {
    void measurePrereq(runner)
      .then((report) => { prereq = { at: Date.now(), report }; })
      .catch(() => undefined);
  }
  const environment = async (): Promise<PrereqByPlatform> => {
    if (deps.skipPrereq) return {};
    if (Date.now() - prereq.at < 30_000) return prereq.report;
    prereq = { at: Date.now(), report: await measurePrereq(runner).catch(() => ({})) };
    return prereq.report;
  };
  const attached = async (): Promise<AttachedDevice[]> => {
    if (Date.now() - snapshot.at < 10_000) return snapshot.devices;
    let devices: Array<{ platform: string; udid: string }> = [];
    try {
      devices = await runner.control.devices();
    } catch {
      // `try` chứ không phải `.catch()` trên lời hứa: một runner không có nhóm
      // `control` làm lời gọi này ném ĐỒNG BỘ, trước khi có lời hứa nào để bắt
      // — và cú ném ấy đi thẳng ra vòng lặp, làm worker không đòi job nữa mà
      // không ai thấy. Một bài test treo mười phút vì đúng chuyện này.
      //
      // Không đọc được danh sách máy thì coi như KHÔNG có máy nào: job cần
      // thiết bị sẽ nằm chờ, thay vì được nhận rồi hỏng sâu bên trong driver.
      devices = [];
    }
    snapshot = {
      at: Date.now(),
      devices: devices
        .filter((device) => device.platform === 'android' || device.platform === 'ios')
        .map((device) => ({ platform: device.platform as 'android' | 'ios', udid: device.udid })),
    };
    return snapshot.devices;
  };

  const tick = async (): Promise<void> => {
    if (stopped || busy) return;
    busy = true;
    try {
      const devices = await attached();
      await environment();
      const job = await deps.queue.claim({
        runnerId: deps.runnerId,
        platforms: deps.platforms ?? runnerPlatforms(devices),
        ...(deps.maxPerUser !== undefined ? { maxPerUser: deps.maxPerUser } : {}),
      });
      if (!job) return;
      current = job.id;
      await run(job, deps, runner, devices, prereq.report);
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
    environment: () => prereq.report,
  };
}

/** Chạy một job và đóng nó lại. Mọi đường ra đều phải gọi `finish` hoặc `release`. */
async function run(
  job: JobRecord,
  deps: WorkerDeps,
  runner: Runner,
  attached: AttachedDevice[],
  prereq: PrereqByPlatform,
): Promise<void> {
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

  /**
   * Chiếc máy này tên là gì — và đó là chỗ P3.3 sửa một lỗi im lặng.
   *
   * Cùng một điện thoại có `id` trong config (`sm-s918b`) và `udid` mà adb trả
   * về (`R5CW525G35Y`). Màn Điều khiển giữ chỗ theo udid; job trước P3.3 giữ
   * theo id. Hai cái tên khác nhau nghĩa là hai bên khoá hai thứ khác nhau, và
   * lá chắn dựng ở P3.2 chỉ hoạt động với config tình cờ đặt id trùng udid.
   */
  /**
   * Runner tự quản thiết bị thì KHÔNG phân giải và KHÔNG giữ chỗ.
   *
   * Danh sách rỗng đi tiếp qua đúng đường cũ: `hold([])` thành công mà không
   * giữ gì, vòng gia hạn không có gì để gia hạn, và `finally` không có gì để
   * nhả. Một nhánh `if` riêng cho cả phần còn lại sẽ là bản sao thứ hai của
   * cùng đoạn mã, và hai bản sao thì lệch nhau.
   */
  const resolved = deps.managesOwnDevices
    ? ({ ok: true, udids: [] as string[] } as const)
    : resolveDevices(job.spec, await (deps.config?.() ?? loadConfig(deps.configFile)), attached);
  // Máy KHÔNG cắm ở đây thì hoãn — TRƯỚC khi xét môi trường của máy này.
  //
  // Thứ tự ngược lại từng là một lỗi thật trong mô hình nhiều runner: máy chủ
  // không có Xcode nhận được một job iOS nhắm chiếc iPhone cắm ở laptop người
  // khác, và nó ĐÁNH HỎNG job ấy vì "thiếu Xcode" — một câu đúng về máy chủ
  // nhưng không liên quan gì tới chiếc máy job cần. Job không phải của mình
  // thì trả về hàng đợi cho runner đúng nhận, không phán xét gì thêm.
  if (!resolved.ok && resolved.wait) {
    if (job.error !== resolved.reason) log(`[job] ${resolved.reason} Job chờ tới lượt.`);
    await deps.queue.defer(job.id, resolved.reason, deps.deferMs ?? 5_000);
    return;
  }

  /**
   * Môi trường thiếu thì TỪ CHỐI NGAY, không nhận rồi hỏng ở phút thứ ba.
   *
   * `failed` chứ không `defer`: thiếu driver hay thiếu Xcode không tự khỏi,
   * nên trả job về hàng đợi chỉ tạo một vòng lặp bận rộn — và ở một phòng máy
   * một runner thì nó là vòng lặp vô tận. Câu lỗi nói VIỆC CẦN LÀM, vì người
   * đọc nó là người sẽ đi sửa chiếc máy ấy.
   */
  const refused = refuseReason(prereq, params.platform);
  if (refused) {
    log(`[job] ${refused}`);
    await close(deps, job, {
      type: 'job.result', jobId: job.id, state: 'failed', error: refused,
    });
    return;
  }

  if (!resolved.ok) {
    await close(deps, job, {
      type: 'job.result', jobId: job.id, state: 'failed', error: resolved.reason,
    });
    return;
  }

  const holder: LeaseHolder = { kind: 'job', jobId: job.id };
  const held = await hold(resolved.udids, deps, holder, log);
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

  // Job mang snapshot thì chạy trên đúng snapshot ấy, trong thư mục riêng —
  // xem [jobWorkspace.ts](./jobWorkspace.ts). Dựng TRONG `try` để `finally`
  // vẫn nhả máy khi dựng hỏng.
  let workspace: JobWorkspace | undefined;
  try {
    if (job.spec.snapshot && picked.length > 1) {
      // Nói thẳng thay vì lặng lẽ chạy song song trên `features/` của máy
      // này: đó sẽ là một lượt chạy TRÔNG bình thường mà chạy sai bộ kịch bản.
      throw new Error('Job mang snapshot chưa chạy song song được — gửi mỗi máy một job.');
    }
    // "Bản đã tải lên" trên một runner đứng riêng: lấy ĐÚNG bản máy chủ chọn,
    // không phải bản đang nằm trên đĩa máy này — cho TỪNG nền tảng của job.
    // Một lượt song song bắc cả Android lẫn iOS cần hai bản.
    const nativePlatforms = [...new Set(
      (picked.length > 0 ? picked.map((device) => device.platform) : [params.platform])
        .filter((platform): platform is 'android' | 'ios' => platform === 'android' || platform === 'ios'),
    )];
    const apps: JobApp[] = [];
    if (deps.fetchBuild && params.appSource === 'upload') {
      for (const platform of nativePlatforms) {
        const build = params.appBuilds?.[platform];
        // Chốt cuối, ở phía runner: runner đứng riêng KHÔNG BAO GIỜ tự cài bản
        // build trên đĩa của nó cho một job "bản đã tải lên". Thiếu bản của
        // MỘT nền tảng cũng dừng cả job: chạy nửa lượt song song trên bản
        // không ai chọn là một report nửa đúng nửa sai, trông hoàn toàn bình
        // thường.
        if (!build) {
          throw new Error(
            `Job chọn "bản đã tải lên" nhưng máy chủ không gửi kèm bản build ${platform}, nên máy `
            + 'này không cài bản đang nằm trên đĩa của nó. Chạy lại với "Bản có sẵn trên thiết bị", '
            + 'hoặc tải bản build lên máy chủ.',
          );
        }
        apps.push({ platform, path: await deps.fetchBuild(job.id, platform, build, log) });
      }
    }

    if (job.spec.snapshot || apps.length > 0) {
      workspace = await prepareJobWorkspace({
        jobId: job.id,
        configFile: deps.configFile,
        ...(job.spec.snapshot ? { snapshot: job.spec.snapshot } : {}),
        ...(apps.length > 0 ? { apps } : {}),
        ...(deps.jobsRoot ? { root: deps.jobsRoot } : {}),
      });
      if (workspace.features.length > 0) {
        log(`[job] Chạy trên bản sao gửi kèm job: ${workspace.features.join(', ')}.`);
      }
    }

    if (picked.length > 1) {
      // Nhiều máy: cùng đường mà nút "chạy" vẫn đi, không phải một đường thứ hai.
      const platforms = [...new Set(picked.map((device) => device.platform))].join(',');
      const tokens = picked.map((device) => `${device.platform}:${device.id}`);
      await runner.run.startParallel(
        platforms, tokens, params.tag, Boolean(params.includeQuarantined), log,
        params.env, params.appSource, workspace?.configFile,
      );
      await close(deps, job, lost
        ? { type: 'job.result', jobId: job.id, state: 'interrupted', error: lost }
        : { type: 'job.result', jobId: job.id, state: 'succeeded' });
      return;
    }

    const one = picked[0];
    // `id` trong config của chiếc máy job nhắm tới — job có thể gọi tên nó
    // bằng `id` hoặc bằng udid, và chỉ `id` mới truyền được cho `--device`.
    const pinned = one ? await runner.run.configIdFor(one, deps.configFile) : undefined;

    // Job có nêu tên máy mà KHÔNG ghim được, trong khi còn máy khác cùng nền
    // tảng đang cắm: dừng lại. Chạy tiếp nghĩa là để Appium tự chọn một chiếc
    // trong số ấy — người dùng chọn emulator, lượt chạy diễn ra trên chiếc
    // điện thoại thật bên cạnh, và report trả về trông hoàn toàn bình thường.
    // Đây đúng là kiểu hỏng không ai bắt được từ kết quả.
    const sharing = attached.filter((device) => device.platform === one?.platform).length;
    if (one && !pinned && sharing > 1) {
      await close(deps, job, {
        type: 'job.result', jobId: job.id, state: 'failed',
        error: `Máy "${one.id}" chưa có trong cấu hình của máy chạy này, mà đang có nhiều `
          + 'máy cùng cắm — không ghim được thì lượt chạy có thể rơi vào nhầm máy. '
          + 'Thêm nó vào cấu hình rồi chạy lại.',
      });
      return;
    }
    const outcome = await runner.run.startSuite(
      one?.platform ?? params.platform,
      params.tag,
      Boolean(params.headed),
      Boolean(params.includeQuarantined),
      log,
      pinned,
      params.env,
      params.feature,
      undefined,
      params.appSource,
      // Snapshot thì LUÔN hoãn ghi: registry của lượt này là bản chép trong
      // thư mục job, và nó bị xoá khi job xong. Ghi thẳng vào đó là học xong
      // rồi vứt. Hoãn thì phần học được nằm ở thư mục lượt chạy và đi về máy
      // chủ qua `registryProposal`, như mọi runner đứng riêng.
      deps.deferSharedWrites || Boolean(job.spec.snapshot),
      workspace?.configFile,
    );

    const learned = await harvest(
      { ...deps, deferSharedWrites: deps.deferSharedWrites || Boolean(job.spec.snapshot) },
      runner, outcome.runDirs, log,
    );
    // TRƯỚC khi đóng job: người mở kết quả ngay lúc nó chuyển sang "xong" phải
    // thấy được report. Đẩy sau khi đóng nghĩa là có một khoảng thời gian màn
    // hình nói đã xong mà bấm vào thì chưa có gì.
    await deps.artifacts?.(job.id, outcome.runDirs, log);

    await close(deps, job, lost
      // Mất lease rồi mới kết thúc: lượt chạy ấy đã bị dừng giữa chừng, nên
      // kết quả của nó không nói được gì. `interrupted` là câu đúng, không
      // phải `cancelled` — không ai bấm dừng cả.
      ? { type: 'job.result', jobId: job.id, state: 'interrupted', error: lost }
      : { ...outcomeToResult(job.id, outcome), ...(learned ? { registryProposal: learned } : {}) });
  } catch (err) {
    await close(deps, job, {
      type: 'job.result', jobId: job.id, state: 'failed', error: (err as Error).message,
    });
  } finally {
    await workspace?.cleanup();
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
 * Danh sách vào đây đã là UDID, do `resolveDevices` phân giải — không phải id
 * của config. Đó là cái tên mà màn Điều khiển cũng khoá, và trùng tên là điều
 * kiện để hai bên chặn được nhau.
 */
async function hold(
  deviceIds: string[],
  deps: WorkerDeps,
  holder: LeaseHolder,
  log: (line: string) => void,
): Promise<{ ok: true; leases: Lease[] } | { ok: false; reason: string }> {
  // Rỗng chỉ còn đúng một nghĩa: job web, không cần thiết bị nào. Mọi đường
  // "không biết máy nào" đã bị `resolveDevices` chặn trước đó.
  if (deviceIds.length === 0) return { ok: true, leases: [] };

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
/**
 * Đọc phần lượt chạy vừa học được, để gửi kèm kết quả.
 *
 * Chỉ khi `deferSharedWrites`: nếu lượt chạy đã tự ghi vào registry trên máy
 * này thì `learned.json` không tồn tại, và gửi đề xuất cho chính mình là một
 * vòng thừa.
 *
 * Hỏng ở đây KHÔNG được làm hỏng job. Lượt chạy đã xong, kết quả đã có; mất
 * phần học được là đáng tiếc, còn đánh hỏng một lượt chạy thành công vì một
 * file JSON không đọc được thì tệ hơn nhiều.
 */
async function harvest(
  deps: WorkerDeps,
  runner: Runner,
  runDirs: string[],
  log: (line: string) => void,
): Promise<unknown | undefined> {
  if (!deps.deferSharedWrites || runDirs.length === 0) return undefined;
  try {
    const learned = await runner.run.learnings(runDirs);
    if (!learned) return undefined;
    const count = Object.keys(learned.registry.elements ?? {}).length;
    if (count > 0) log(`[job] Gửi ${count} element học được lên server để xét.`);
    return learned.registry;
  } catch (err) {
    log(`[job] ⚠ Không đọc được phần lượt chạy học được: ${(err as Error).message}`);
    return undefined;
  }
}

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
