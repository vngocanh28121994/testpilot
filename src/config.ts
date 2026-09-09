import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Platform } from './core/types.js';

/**
 * One JSON config for every surface. It has to be JSON rather than TypeScript
 * because the same file is read from inside the AWS Device Farm container,
 * where only the compiled `dist/` output exists.
 */

const Web = z.object({
  baseUrl: z.string().url(),
  headless: z.boolean().default(true),
  device: z.string().default('chromium-desktop'),
  record: z.boolean().default(true),
  /** Pause between actions, so a headed run is watchable rather than a blur. */
  slowMoMs: z.number().default(300),
  /**
   * Where the page under test is allowed to send traffic. Omit it and there is
   * no interception at all. Set it when the build has its backend compiled in
   * and you need production to be unreachable rather than merely unused —
   * see NetworkPolicy in drivers/web.ts.
   */
  network: z
    .object({
      rewrite: z.array(z.object({ from: z.string(), to: z.string() })).default([]),
      allow: z.array(z.string()).default([]),
      fallback: z.enum(['block', 'allow']).default('block'),
    })
    .optional(),
  /** Popups auto-dismissed via page.addLocatorHandler() before each Playwright action. */
  popups: z
    .array(z.object({ detect: z.string(), dismiss: z.string() }))
    .optional(),
});

/**
 * One physical or emulated device the suite may run on.
 *
 * Optional, and absent from every existing config: without it a platform still
 * describes exactly one device through `deviceName`, which is what Appium has
 * always been given. Listing devices is what makes a parallel run addressable —
 * `deviceName` alone cannot say *which* of three plugged-in phones to drive.
 *
 * `systemPort` (Android, UiAutomator2) and `wdaLocalPort` (iOS, WebDriverAgent)
 * must be unique per concurrent session. Two sessions left on the defaults
 * fight over the same port and one of them dies, so parallel runs require them
 * even though a single-device run never needs either.
 */
const Device = z.object({
  /** Short label. Used in log prefixes and in the run directory name. */
  id: z.string(),
  deviceName: z.string(),
  /**
   * Tên hiển thị trên màn hình chọn máy. Không ảnh hưởng gì tới lượt chạy.
   *
   * Cần một trường RIÊNG vì hai nguồn kia đều không dùng được. `deviceName` là
   * capability của Appium, không phải nhãn cho người đọc. Còn tên máy tự đặt —
   * `settings global device_name`, cũng là tên hiện trên Bluetooth — thì là bất
   * cứ thứ gì người cầm máy đã gõ vào; một phòng lab đặt tên lung tung là danh
   * sách chọn máy vô dụng.
   *
   * Không phải máy nào cũng khai tên thương mại: một Galaxy S25 Ultra thật chỉ
   * có `ro.product.model` = "SM-S938B". Trường này là chỗ đội tự ghi tên mình
   * muốn thấy, và nó nằm trong repo nên cả đội thấy giống nhau.
   */
  label: z.string().optional(),
  udid: z.string().optional(),
  systemPort: z.number().optional(),
  wdaLocalPort: z.number().optional(),
});

/**
 * `hybrid` marks a Capacitor/Cordova/Ionic app. Its UI is a web page inside a
 * WebView, so native locators match nothing and the driver has to switch
 * context and resolve against the DOM instead. See drivers/native.ts.
 */
const Android = z.object({
  deviceName: z.string().default('Android Device'),
  /** Absent = single-device mode driven by `deviceName`. See `devicesOf()`. */
  devices: z.array(Device).optional(),
  app: z.string().optional(),
  appPackage: z.string().optional(),
  appActivity: z.string().optional(),
  hybrid: z.boolean().default(false),
  /**
   * How long to wait at launch for the app's WebView to attach.
   *
   * A device that is cold-starting a just-installed build needs longer than one
   * that has had the app open all morning — Device Farm is the first case and a
   * developer's desk is the second. Missing the window is not merely slow: a
   * hybrid app then runs in native context, where its UI does not exist.
   */
  webviewTimeoutMs: z.number().optional(),
  /**
   * How much state a scenario inherits from the one before it.
   *
   * `restart` deliberately keeps the app process alive: it sends
   * `dontStopAppOnReset` and `noReset`, and brings the app forward with
   * FLAG_ACTIVITY_REORDER_TO_FRONT instead of cold-starting it. Killing the
   * process is what a name like "restart" suggests and is exactly what must not
   * happen here — a cold start makes a banking app with a saved session demand
   * biometrics, which no scenario can answer.
   *
   * The isolation happens one layer up. In a hybrid app the WebView's
   * localStorage, sessionStorage, cookies and IndexedDB are cleared and the SPA
   * is sent back to its root, so it redirects to login just as a fresh launch
   * would. See launch() and resetWebView() in drivers/native.ts.
   *
   * That wipe reaches Android hybrid apps only. A native app, or anything on
   * iOS, is merely re-activated under either setting: whatever was on screen
   * stays there, a value typed in scenario 2 is still in the field in scenario
   * 6, and run order silently becomes an input.
   *
   * `noReset` has a second consequence worth knowing: an app already installed
   * on the device is never reinstalled, so a newer build in `app` is ignored
   * until someone installs it by hand.
   *
   * `none` drops both capabilities and the storage wipe, for a suite that
   * deliberately chains scenarios or an app that dislikes being reset.
   */
  isolation: z.enum(['restart', 'none']).default('restart'),
});

const Ios = z.object({
  deviceName: z.string().default('iPhone'),
  /** Absent = single-device mode driven by `deviceName`. See `devicesOf()`. */
  devices: z.array(Device).optional(),
  app: z.string().optional(),
  bundleId: z.string().optional(),
  /**
   * Apple Developer Team ID, ten characters, e.g. "A1B2C3D4E5".
   *
   * Required for a real device and for nothing else. Appium builds
   * WebDriverAgent from source and installs it before the first command, and
   * iOS refuses to install an unsigned app — so without this the session dies
   * at `xcodebuild failed with code 65` before a single step runs. A simulator
   * needs no signature at all.
   */
  teamId: z.string().optional(),
  /** Signing certificate name; the default suits a free or paid Apple ID. */
  signingId: z.string().default('Apple Development'),
  /**
   * Bundle id given to WebDriverAgent.
   *
   * The stock `com.facebook.WebDriverAgentRunner` is already claimed on Apple's
   * side, so a free account cannot register it. Anything unique works, and it
   * has nothing to do with the app under test.
   */
  wdaBundleId: z.string().optional(),
  /**
   * Dùng lại WebDriverAgent đã cài trên máy, thay vì build và cài lại mỗi lượt.
   *
   * Bật cờ này thì Appium bỏ qua hẳn xcodebuild và chỉ khởi chạy bản đã nằm sẵn
   * bằng devicectl. Cần `wdaBundleId` trỏ đúng bản đã cài, và nhớ profile của
   * Apple ID miễn phí chỉ sống 7 ngày.
   *
   * ĐÃ THỬ VÀ KHÔNG CHẠY ĐƯỢC trên iPhone 12 Pro Max / iOS 26.5 ở đây: devicectl
   * báo khởi chạy thành công nhưng runner tắt ngay, cổng 8100 không bao giờ mở.
   * Bản runner cài sẵn không tự dựng được phiên XCTest ngoài xcodebuild.
   *
   * Nếu bật cờ này vì máy hỏi mật mã mỗi lượt chạy thì đó là nhầm chỗ: công tắc
   * quyết định chuyện đó nằm trên điện thoại — Cài đặt › Nhà phát triển › Tự
   * động hoá giao diện. Bật lên là hết hỏi, một lần cho mỗi máy.
   */
  usePreinstalledWDA: z.boolean().default(false),
  hybrid: z.boolean().default(false),
  /**
   * How long to wait at launch for the app's WebView to attach.
   *
   * A device that is cold-starting a just-installed build needs longer than one
   * that has had the app open all morning — Device Farm is the first case and a
   * developer's desk is the second. Missing the window is not merely slow: a
   * hybrid app then runs in native context, where its UI does not exist.
   */
  webviewTimeoutMs: z.number().optional(),
});

const Paths = z.object({
  registry: z.string().default('registry/elements.json'),
  features: z.string().default('features'),
  artifacts: z.string().default('artifacts'),
  reports: z.string().default('reports'),
  /**
   * One self-contained directory per run. `reports` now holds only the
   * `latest-<platform>` pointers into this tree.
   */
  runs: z.string().default('runs'),
  flakeDb: z.string().default('registry/flake.json'),
  healingDb: z.string().default('registry/healing.json'),
  /** Human-reviewed natural-language action macros. */
  actionsDb: z.string().default('registry/actions.json'),
  /** Approval is bound to the exact hash of each generated/edited scenario. */
  scenarioReviewDb: z.string().default('registry/scenario-review.json'),
  /** Kịch bản đỏ vì sản phẩm chưa đáp ứng — đếm riêng, không tính là fail. */
  knownIssuesDb: z.string().default('registry/known-issues.json'),
  /** Which environment's build is installed on each handset. */
  deviceEnvDb: z.string().default('registry/device-env.json'),
  docs: z.string().default('docs'),
});

/**
 * Every ARN and path defaults to empty rather than being required: the UI has to
 * be able to save a half-filled farm block while you are still picking a device
 * pool. What is actually mandatory is checked at schedule time, where the error
 * can name the one missing field.
 */
const Farm = z
  .object({
    region: z.string().default('us-west-2'),
    projectArn: z.string().default(''),
    devicePoolArn: z.string().default(''),
    /**
     * Device pool per platform, remembered from the Device Farm tab.
     *
     * `devicePoolArn` above is the last one used, and a pool holds devices of
     * exactly one platform — so a workflow that picks the other platform has
     * nothing to run on. Recording both means choosing Android in a workflow
     * does not send an Android build to a pool of iPhones.
     */
    devicePools: z
      .object({ android: z.string().optional(), ios: z.string().optional() })
      .default({}),
    platform: z.enum(['android', 'ios']).default('android'),
    appPath: z.string().default(''),
    appVersionName: z.string().default(''),
    appVersionCode: z.string().default(''),
    appLabel: z.string().default(''),
    testPackagePath: z.string().default('build/testpilot-appium.zip'),
    testSpecPath: z.string().default('farm/testspec.yml'),
    runName: z.string().default(''),
    /** Per-job cap. Device Farm bills metered minutes, so this is a cost control. */
    jobTimeoutMinutes: z.number().default(30),
    /** Video is what makes a flaky native failure diagnosable at all. */
    videoCapture: z.boolean().default(true),
    /** How long to wait for the whole run before giving up. */
    timeoutMs: z.number().default(60 * 60_000),
    /**
     * Environment variables exported into the `test` phase of the generated
     * testspec — API endpoints, feature flags, anything the app under test needs.
     * Secrets do not belong here; the file is uploaded to AWS in plain text.
     */
    env: z.record(z.string()).default({}),
    /**
     * Copy test-account passwords from the local secrets file into the
     * generated testspec so `{{account.*.password}}` resolves on the device.
     *
     * Off by default and it should stay that way unless someone decides
     * otherwise: the testspec is uploaded to S3 in plain text and kept with the
     * run history, so anyone with access to the AWS account can read it. Rotate
     * the password afterwards.
     */
    sendSecrets: z.boolean().default(false),
  })
  .default({});

export const ConfigSchema = z.object({
  web: Web,
  android: Android.default({}),
  ios: Ios.default({}),
  paths: Paths.default({}),
  resolve: z
    .object({
      timeoutMs: z.number().default(10_000),
      pollMs: z.number().default(250),
      verifyHealedMatch: z.boolean().default(true),
    })
    .default({}),
  executor: z
    .object({
      /** Extra attempts, now restricted by Executor to recoverable locator failures. */
      retries: z.number().int().min(0).max(3).default(1),
      /** Read each field back after typing; see ExecutorOptions.verifyInput. */
      verifyInput: z.boolean().default(true),
    })
    .default({}),
  /**
   * Choices captured before an end-to-end Studio workflow starts. The workflow
   * pauses only for testcase review and resumes with these exact values.
   */
  workflow: z
    .object({
      /**
       * May be empty, but only when Device Farm is chosen — see the refinement
       * below. Farm-only is a real choice: the suite is already green locally
       * and what remains to learn is how it behaves on real devices.
       */
      platforms: z.array(z.enum(['web', 'android', 'ios'])).default(['web']),
      /**
       * Device Farm is a separate choice from the local platforms, not another
       * entry in the list beside them.
       *
       * It runs on somebody else's hardware, costs device minutes, takes tens
       * of minutes, and carries its own four stages. Folding it into
       * `platforms` would make all of that invisible behind one more checkbox.
       */
      deviceFarm: z
        .object({ platform: z.enum(['android', 'ios']) })
        .optional(),
      /**
       * Which configured device to run on, per platform, by its config `id`.
       *
       * Only meaningful when `android.devices` / `ios.devices` list more than
       * one and more than one of them is actually attached. With a single
       * candidate there is nothing to choose and this stays empty; the run is
       * pinned to whatever is plugged in.
       *
       * Kept as a preference rather than a command: if the chosen device is not
       * attached at run time, that is reported instead of silently falling back
       * to another handset. Running on the wrong phone is the failure nobody
       * catches — the report is green and describes a device never under test.
       */
      devices: z
        .object({ android: z.string().optional(), ios: z.string().optional() })
        .optional(),
      env: z.string().optional(),
      headed: z.boolean().default(false),
      locatorRetries: z.number().int().min(0).max(2).default(1),
    })
    // A workflow with nothing to run on would generate a suite and then stop
    // without saying why, so it is rejected at the point the choice is made.
    .refine((w) => w.platforms.length > 0 || w.deviceFarm, {
      message: 'chọn ít nhất một nền tảng chạy local hoặc Device Farm',
      path: ['platforms'],
    })
    .default({}),
  /**
   * What to keep once the suite has been run a few hundred times. Failures are
   * the evidence you came for; passes are a baseline and a handful is plenty.
   */
  retention: z
    .object({
      keepFailedDays: z.number().default(30),
      keepPassedPerPlatform: z.number().default(3),
    })
    .default({}),
  flake: z
    .object({
      window: z.number().default(30),
      minRuns: z.number().default(5),
      quarantineAt: z.number().default(0.15),
      brokenAt: z.number().default(0.95),
    })
    .default({}),
  /**
   * The AI fallback for elements no deterministic candidate can find.
   *
   * Off by default, and deliberately so: a suite whose result depends on a
   * model reachable over the network is a suite whose red no longer means the
   * app changed. Turned on, it does not rescue the run it fires in — it writes
   * what it found into the registry as an unapproved candidate for a human to
   * review, because a model can be fluently wrong (asked for "Lệnh thường" it
   * once chose a control reading "Thường", with confidence 90).
   */
  discovery: z
    .object({
      ai: z
        .object({
          enabled: z.boolean().default(false),
          /** Below this the model's own confidence is not worth acting on. */
          minConfidence: z.number().default(60),
        })
        .default({}),
    })
    .default({}),
  /** Confluence / Figma links the spec generator reads. */
  sources: z.array(z.string()).default([]),
  /**
   * Optional business feature focus. When omitted, AI derives the name from
   * the generated `Feature:` declaration; it also becomes the output filename.
   */
  targetFeature: z.string().default(''),
  /**
   * Test accounts available to generated scenarios. Passwords are NOT here —
   * they live in the gitignored secrets file (see core/secrets.ts) and are
   * substituted into steps at run time as `{{account.<label>.password}}`.
   */
  accounts: z
    .array(z.object({ label: z.string(), username: z.string().default('') }))
    .default([]),
  /**
   * The MCP server that can read those links. Without it, generation falls back
   * to documents exported into `paths.docs`.
   */
  mcp: z
    .object({
      transport: z.enum(['stdio', 'http']).default('stdio'),
      command: z.string().optional(),
      args: z.array(z.string()).default([]),
      env: z.record(z.string()).default({}),
      cwd: z.string().optional(),
      url: z.string().optional(),
      headers: z.record(z.string()).default({}),
      tools: z
        .object({
          confluencePage: z.string().default(''),
          figmaFile: z.string().default(''),
          confluenceAttachments: z.string().default(''),
          figmaImage: z.string().default(''),
        })
        .default({}),
    })
    .optional(),
  llm: z
    .object({
      /** "auto" lets the server pick the current default rather than pinning one. */
      model: z.string().default('auto'),
      effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('high'),
      /** Free-text guidance appended to the generation prompt. */
      note: z.string().default(''),
    })
    .default({}),
  farm: Farm,
  /**
   * Which environment a run targets when nothing says otherwise.
   */
  defaultEnv: z.string().default('prod'),
  /**
   * SIT / UAT / prod, as differences from the config above.
   *
   * A .feature file must never name an environment — it asks for the account
   * *role* `{{account.tcbs.username}}`, and `accounts` here says which real
   * label that role means today. That is what keeps one suite runnable against
   * every environment instead of one copy per environment.
   *
   * The platform blocks are overrides, merged over the base config. For this
   * app they carry `ios.app` / `android.app`: its SIT, UAT and prod builds
   * ship under the SAME bundle id, so the environment is decided by which
   * package is installed and by nothing observable at run time.
   */
  environments: z
    .record(
      z.object({
        /** account role -> label in `accounts`. */
        accounts: z.record(z.string()).default({}),
        web: Web.partial().optional(),
        ios: Ios.partial().optional(),
        android: Android.partial().optional(),
      }),
    )
    .default({}),
});

export type TestPilotConfig = z.infer<typeof ConfigSchema>;

/**
 * Refuses to run an environment that has not said which package it is.
 *
 * The environments of this app ship under one bundle id, so an environment
 * without its own `app` silently inherits the base config's — which is the
 * default environment's build. The run then installs prod's package, records
 * the handset as SIT, and types SIT credentials into a prod app; the failure
 * surfaces at a login screen and looks like a backend problem.
 *
 * The default environment is exempt because the base config *is* its build.
 * Web is exempt because it installs nothing — there, `baseUrl` is the whole
 * difference between environments.
 */
export function assertEnvPackage(
  cfg: TestPilotConfig,
  env: string,
  platform: 'web' | 'android' | 'ios',
): void {
  if (platform === 'web') return;
  const override = cfg.environments[env];
  if (!override || env === cfg.defaultEnv) return;
  const app = platform === 'ios' ? override.ios?.app : override.android?.app;
  if (app) return;

  const key = `${platform}.app`;
  const inherited = platform === 'ios' ? cfg.ios.app : cfg.android.app;
  throw new Error(
    `Environment "${env}" chưa có ${key} riêng.\n` +
      `Nó sẽ dùng "${inherited ?? '(không có)'}" của cấu hình gốc — tức bản build của môi trường ` +
      `mặc định "${cfg.defaultEnv}".\n` +
      'Các môi trường của app này dùng chung bundle id, nên không có gì phân biệt được chúng ' +
      'trên máy:\nchạy tiếp sẽ là đăng nhập account ' + env + ' vào app ' + cfg.defaultEnv + '.\n' +
      'Mở Scenario Studio → Môi trường → Chọn file… để tải bản build của môi trường này lên.',
  );
}

/** An environment's account roles resolved to labels in `accounts`. */
export type AccountAlias = Record<string, string>;

/**
 * The config as the named environment sees it, plus that environment's account
 * aliases.
 *
 * A config with no `environments` at all is not an error — it is every config
 * written before this existed, and it keeps working: any environment name
 * resolves to the base config with no aliases. Naming an environment that the
 * config *does* define environments but does not list, on the other hand, is
 * always a typo worth stopping for.
 */
export function applyEnv(
  cfg: TestPilotConfig,
  env: string,
): { config: TestPilotConfig; alias: AccountAlias } {
  const names = Object.keys(cfg.environments);
  if (names.length === 0) return { config: cfg, alias: {} };
  const override = cfg.environments[env];
  if (!override) {
    throw new Error(
      `Environment "${env}" không có trong config. Đang có: ${names.join(', ')}.`,
    );
  }
  return {
    config: {
      ...cfg,
      web: { ...cfg.web, ...override.web },
      ios: { ...cfg.ios, ...override.ios },
      android: { ...cfg.android, ...override.android },
    },
    alias: override.accounts,
  };
}

export type DeviceSpec = z.infer<typeof Device>;

/**
 * The devices a platform may run on, always as a list.
 *
 * A config without a `devices` array still describes one device — the one
 * `deviceName` names — so that case is returned as a single synthesised entry
 * rather than an empty list. Callers can then be written once, against a list,
 * without a second code path for the single-device suite that every existing
 * config still is.
 *
 * `web` has no device list: parallelism there would shard by browser, which is
 * a different mechanism, so it reports its configured device as the only entry.
 */
export function devicesOf(cfg: TestPilotConfig, platform: Platform): DeviceSpec[] {
  if (platform === 'web') return [{ id: 'web', deviceName: cfg.web.device }];
  const section = platform === 'android' ? cfg.android : cfg.ios;
  if (section.devices?.length) return section.devices;
  return [{ id: platform, deviceName: section.deviceName }];
}

/**
 * Picks one device by id, or the only one when there is no choice to make.
 *
 * Never falls back to "the first one". Driving the wrong phone is a mistake
 * that is only noticed after the report has been read and believed, so both
 * ways of reaching it are refused: an id that matches nothing, and an omitted
 * id when the config lists several devices. A suite with no `devices` array —
 * every config that has not opted in — has exactly one candidate and is
 * therefore never ambiguous.
 */
export function deviceById(
  cfg: TestPilotConfig,
  platform: Platform,
  id?: string,
  /**
   * How the caller lets someone name a device. The CLI has a flag; generated
   * POM tests have no argv, so they pass an environment variable name instead —
   * and an error telling those users to add `--device` sends them looking for a
   * flag that does not exist on the command they ran.
   */
  selector = '--device',
): DeviceSpec {
  const devices = devicesOf(cfg, platform);
  if (!id) {
    if (devices.length === 1) return devices[0]!;
    throw new Error(
      `${platform} has ${devices.length} devices configured, so ${selector} is required. ` +
      `Available: ${devices.map((d) => d.id).join(', ')}. ` +
      `To drive all of them at once, run them in parallel instead.`,
    );
  }
  const found = devices.find((d) => d.id === id);
  if (!found) {
    throw new Error(
      `${selector} "${id}" is not configured for ${platform}. ` +
      `Available: ${devices.map((d) => d.id).join(', ')}.`,
    );
  }
  return found;
}

/** The model used when the config says "auto". */
export const DEFAULT_LLM_MODEL = 'claude-opus-5';

/**
 * "auto" is the default the UI shows, so nobody has to pin a model id to get
 * started. Resolving it in one place keeps the CLI and the UI in agreement.
 */
export function resolveModel(model: string): string {
  return !model || model === 'auto' ? DEFAULT_LLM_MODEL : model;
}

export async function loadConfig(file = 'testpilot.config.json'): Promise<TestPilotConfig> {
  const abs = path.resolve(file);
  if (!existsSync(abs)) {
    throw new Error(`No config at ${abs}. Copy testpilot.config.example.json and edit it.`);
  }
  const parsed = ConfigSchema.safeParse(JSON.parse(await readFile(abs, 'utf8')));
  if (!parsed.success) {
    throw new Error(`${abs} is invalid:\n${parsed.error.issues.map(fmt).join('\n')}`);
  }
  return parsed.data;
}

/**
 * The UI writes the same file the CLI reads, so anything configured in the
 * browser is reproducible from a terminal and reviewable in a diff.
 */
export async function saveConfig(
  cfg: TestPilotConfig,
  file = 'testpilot.config.json',
): Promise<void> {
  const parsed = ConfigSchema.safeParse(cfg);
  if (!parsed.success) {
    throw new Error(`Refusing to save an invalid config:\n${parsed.error.issues.map(fmt).join('\n')}`);
  }
  await writeFile(path.resolve(file), JSON.stringify(parsed.data, null, 2) + '\n', 'utf8');
}

function fmt(i: z.ZodIssue): string {
  return `  - ${i.path.join('.') || '(root)'}: ${i.message}`;
}
