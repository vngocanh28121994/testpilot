/**
 * AWS Device Farm, đội lốt một runner.
 *
 * Ý tưởng của P3.6 gọn trong một câu: **Device Farm là một runner nữa.** Nó
 * nhận job từ cùng hàng đợi, báo log về cùng đường, và đóng job bằng cùng
 * `JobResult`. Giao diện không cần biết job ấy chạy trên chiếc điện thoại ở
 * bàn bên cạnh hay trên một chiếc máy ở Oregon.
 *
 * Khác biệt thật, và là lý do có `managesOwnDevices`: **Device Farm tự quản
 * thiết bị của nó.** Không có gì để `adb devices` nhìn thấy, không có udid để
 * giữ chỗ, và việc xếp hàng đợi thiết bị xảy ra bên trong AWS. Giữ chỗ ở phía
 * ta cho một chiếc máy ta không sở hữu là khoá một thứ không tồn tại.
 *
 * Chạy:
 *
 *   TESTPILOT_RUNNER_MODE=farm TESTPILOT_SERVER=… TESTPILOT_RUNNER_TOKEN=… npm run runner
 */
import { loadConfig, type TestPilotConfig } from '../config.js';
import { awsStatus } from '../farm/devicefarm.js';
import { runOnFarm } from './farm.js';
import type { Runner } from './index.js';

export interface FarmRunnerOptions {
  configFile: string;
  /** Tiêm trong test: thứ thật gọi AWS và tốn tiền. */
  run?: typeof runOnFarm;
  loadCfg?: (file: string) => Promise<TestPilotConfig>;
}

/**
 * Farm có sẵn sàng nhận job không, và nếu không thì vì sao.
 *
 * Kiểm TRƯỚC khi đòi job, không phải lúc chạy. Bản không kiểm đã có lịch sử:
 * job được nhận, 216 MB bundle được tải lên, thiết bị khởi động, rồi vòng lặp
 * chết với "Could not load credentials" — sau khi tiền đã tiêu.
 */
export async function farmReadiness(cfg: TestPilotConfig): Promise<
  { ok: true; platforms: string[] } | { ok: false; reason: string }
> {
  if (!cfg.farm?.projectArn || !cfg.farm?.devicePoolArn) {
    return {
      ok: false,
      reason: 'Config chưa khai `farm.projectArn` và `farm.devicePoolArn` — '
        + 'chọn project và device pool ở màn Device Farm trước.',
    };
  }
  const status = await awsStatus(cfg.farm.region || 'us-west-2');
  if (!status.ok) {
    return {
      ok: false,
      reason: `AWS chưa dùng được: ${status.reason ?? 'không rõ'} (nguồn: ${status.source}).`,
    };
  }
  // Farm chạy ĐÚNG nền tảng đã cấu hình. Khai cả hai nền tảng rồi nhận job iOS
  // vào một pool Android là tiêu tiền để nhận một lỗi.
  return { ok: true, platforms: [cfg.farm.platform] };
}

/**
 * `Runner` mà mọi lời gọi chạy test đều đi qua Device Farm.
 *
 * Cố tình mỏng, như `localRunner`: nó chỉ dịch giữa hai hình dạng. Logic của
 * Device Farm nằm trong `src/farm/`, và đã có từ lâu — P3.6 không viết lại nó,
 * chỉ cho nó một cái cổng khác để đi vào.
 */
export function farmRunner(options: FarmRunnerOptions): Runner {
  const runFarm = options.run ?? runOnFarm;
  const load = options.loadCfg ?? loadConfig;

  /**
   * Từ chối bằng một lời hứa BỊ TỪ CHỐI, không bằng một cú ném đồng bộ.
   *
   * Đây là lần thứ hai cùng cái bẫy trong dự án: `runner.control.devices()`
   * ném đồng bộ đã làm vòng lặp worker chết lặng lẽ và một bài test treo mười
   * phút. Một hàm khai kiểu `Promise<T>` mà ném trước khi trả lời thì mọi
   * `.catch()` quanh nó đều vô dụng.
   */
  const notHere = (what: string): Promise<never> => Promise.reject(new Error(
    `Runner Device Farm không làm "${what}": thiết bị nằm ở AWS, không cắm vào máy này.`,
  ));

  return {
    run: {
      startSuite: async (platform, tag, _headed, _includeQuarantined, log) => {
        const cfg = await load(options.configFile);
        const ready = await farmReadiness(cfg);
        if (!ready.ok) throw new Error(ready.reason);
        if (platform !== cfg.farm.platform) {
          throw new Error(
            `Job nhắm nền tảng ${platform} nhưng device pool đang cấu hình cho ${cfg.farm.platform}.`,
          );
        }

        const handoff = await runFarm(
          // `runName` mang dấu vết của job sang bảng điều khiển AWS: khi một
          // lượt chạy ở đó trông lạ, người ta cần nối được nó về job nào.
          //
          // `tag` KHÔNG đi qua đây, và đó là sự thật của Device Farm chứ không
          // phải thiếu sót: lệnh chạy nằm trong `farm/testspec.yml` và chạy
          // trên máy của AWS, nên lọc theo tag là việc của file ấy.
          {
            ...cfg,
            farm: {
              ...cfg.farm,
              runName: cfg.farm.runName || `job ${tag ?? cfg.farm.platform}`,
            },
          },
          true,
          log,
          // Không có sổ chặng riêng: dòng đời của job đã đi qua `job_event`.
          () => {},
        );
        return {
          code: handoff.passed ? 0 : 1,
          stopped: false,
          reportPaths: [],
          runDirs: [],
        };
      },

      /**
       * Device Farm tự chạy song song BÊN TRONG một lượt: một device pool nhiều
       * máy nghĩa là cùng bộ test chạy trên tất cả cùng lúc. Chồng thêm một lớp
       * song song ở đây là hai cơ chế cùng chia việc, và không bên nào biết bên
       * kia đã chia thế nào.
       */
      startParallel: () => notHere('chạy song song nhiều máy') as never,
      stop: () => notHere('dừng giữa chừng') as never,
      isNamedDevice: async () => false,
      parseDeviceToken: () => null,
    },
    // Ba nhóm còn lại không có nghĩa ở đây, và ném rõ ràng thay vì trả rỗng:
    // trả rỗng làm nơi gọi tưởng "máy này không có thiết bị nào", một câu khác
    // hẳn với "chỗ này không phải nơi để hỏi".
    prereq: new Proxy({}, {
      get: (_target, key) => () => notHere(`prereq.${String(key)}`),
    }) as Runner['prereq'],
    control: {
      devices: async () => [],
      screenSize: () => notHere('xem màn hình') as never,
      startScreenStream: () => notHere('xem màn hình') as never,
      tap: () => notHere('chạm'),
      swipe: () => notHere('quét'),
      typeText: () => notHere('gõ chữ'),
      pressKey: () => notHere('bấm phím'),
    },
    farm: {
      run: (...args: Parameters<typeof runOnFarm>) => runFarm(...args),
    },
    builds: {
      readAppVersion: () => notHere('đọc phiên bản app'),
    },
  } as Runner;
}
