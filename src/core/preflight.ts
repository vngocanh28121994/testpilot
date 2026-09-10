import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { TestPilotConfig } from '../config.js';
import { devicesOf } from '../config.js';
import type { Platform } from './types.js';

/**
 * Whether a platform can actually be driven right now, asked before the
 * expensive work rather than during it.
 *
 * A workflow spends minutes reading documents and two model calls before it
 * ever opens a driver, and then waits for a human to review what it generated.
 * Discovering at that point that no phone is plugged in wastes all of it, and
 * the failure arrives as a WebDriver connection error that names none of the
 * three or four things that are actually worth checking.
 *
 * So the checks live here, each one reporting what it found rather than just a
 * verdict: "máy đã cắm nhưng chưa cho phép USB debugging" is a different
 * afternoon from "chưa cắm máy nào".
 */

/**
 * Việc mà giao diện tự làm được để chữa một mục kiểm tra hỏng.
 *
 * Là một mã, không phải câu chữ: câu chữ đã nằm ở `detail`, còn cái này để giao
 * diện gắn đúng cái nút. Bảo người dùng "chạy `appium` ở một terminal khác"
 * trong khi chính công cụ bật được Appium là đẩy việc của mình sang cho họ.
 */
export type PreflightFix = 'appium' | 'ios-tunnel';

export interface PreflightCheck {
  /** What was checked, in the operator's language. */
  name: string;
  ok: boolean;
  /** Có mặt khi giao diện tự chữa được mục này. */
  fix?: PreflightFix;
  /**
   * What was found, and when it is wrong, what to do about it. Written for
   * someone who is not going to read the source to find out what failed.
   */
  detail: string;
}

export interface PreflightResult {
  platform: Platform;
  ok: boolean;
  checks: PreflightCheck[];
  /**
   * The config `id` of the device a run should be pinned to, when the config
   * lists several and exactly one of them is attached.
   *
   * A workflow has no device picker, so without this it runs whatever
   * `--device` defaults to — which, with more than one device configured, is
   * a refusal. Resolving it here means the ambiguity is settled by what is
   * actually plugged in rather than by a flag nobody can pass.
   */
  device?: string;
  /**
   * The devices worth offering a choice between. Present only when more than
   * one configured device is attached, which is the only case where anyone has
   * to decide anything.
   */
  candidates?: DeviceCandidate[];
}

/** A device the run could be pinned to, as offered to whoever must choose. */
export interface DeviceCandidate {
  /** The config `id`, which is what `--device` takes. */
  id: string;
  /** id plus serial, so the list on screen matches what `adb` shows. */
  label: string;
}

interface DeviceResolution {
  check: PreflightCheck;
  device?: string;
  /**
   * Present only when more than one configured device is attached — that is,
   * only when there is a choice worth putting on screen.
   */
  candidates?: DeviceCandidate[];
}

/** What one platform's probes found, plus the device they settled on. */
interface PlatformChecks {
  checks: PreflightCheck[];
  device?: string;
  candidates?: DeviceCandidate[];
}

const exec = promisify(execFile);

/** Long enough for a cold `adb` to start its daemon, short enough to not hang a page load. */
const PROBE_TIMEOUT_MS = 8000;

/**
 * Runs a command and never throws. A missing binary and a non-zero exit are
 * both just "this did not work", and every caller here wants to carry on and
 * report the other checks rather than abort the whole preflight.
 */
async function tryRun(
  file: string,
  args: string[],
): Promise<{ ok: boolean; stdout: string; error?: string }> {
  try {
    const { stdout } = await exec(file, args, { timeout: PROBE_TIMEOUT_MS, encoding: 'utf8' });
    return { ok: true, stdout };
  } catch (err) {
    return { ok: false, stdout: '', error: (err as Error).message.split('\n')[0]!.trim() };
  }
}

interface AdbDevice {
  serial: string;
  /** `device` is usable; `unauthorized` and `offline` are plugged in but not ready. */
  state: string;
}

/**
 * Every state `adb` reports for a line that is really a device.
 *
 * Matching on the state rather than on the shape of the line is what keeps
 * daemon chatter out: "* daemon not running; starting now at tcp:5037" also
 * splits into a first and second word, and reading it as a device called "*"
 * would put it on screen as a phone that is plugged in but unusable.
 */
const ADB_STATES = new Set([
  'device', 'offline', 'unauthorized', 'authorizing',
  'bootloader', 'recovery', 'sideload', 'connecting', 'host',
]);

export function parseAdbDevices(stdout: string): AdbDevice[] {
  return stdout
    .split('\n')
    .slice(1) // "List of devices attached"
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/))
    .filter((parts): parts is [string, string, ...string[]] => parts.length >= 2)
    .map(([serial, state]) => ({ serial, state }))
    .filter((d) => ADB_STATES.has(d.state));
}

/** Simulators only — `simctl` knows nothing about physical iPhones. */
export function parseBootedSimulators(stdout: string): string[] {
  try {
    const parsed = JSON.parse(stdout) as { devices?: Record<string, Array<{ name?: string; state?: string }>> };
    return Object.values(parsed.devices ?? {})
      .flat()
      .filter((d) => d.state === 'Booted' && d.name)
      .map((d) => d.name!);
  } catch {
    return [];
  }
}

/**
 * Appium is a separate process someone has to have started, and it is the
 * single most common thing missing — the phone is plugged in, everything looks
 * fine, and nothing can talk to it.
 */
async function checkAppium(): Promise<PreflightCheck> {
  const host = process.env.TESTPILOT_APPIUM_HOST ?? '127.0.0.1';
  const port = Number(process.env.TESTPILOT_APPIUM_PORT ?? 4723);
  const base = (process.env.TESTPILOT_APPIUM_PATH ?? '/').replace(/\/+$/, '');
  const url = `http://${host}:${port}${base}/status`;
  const name = 'Appium server';
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (!res.ok) {
      return {
        name,
        ok: false,
        fix: 'appium',
        detail: `${url} trả về HTTP ${res.status}. Appium đang chạy nhưng không khoẻ.`,
      };
    }
    const body = (await res.json()) as { value?: { build?: { version?: string } } };
    const version = body.value?.build?.version;
    return { name, ok: true, detail: `Đang chạy ở ${host}:${port}${version ? ` (bản ${version})` : ''}.` };
  } catch {
    return {
      name,
      ok: false,
      fix: 'appium',
      detail: `Chưa chạy ở ${host}:${port}. Đặt TESTPILOT_APPIUM_HOST/PORT nếu nó đang ở chỗ khác.`,
    };
  }
}

/**
 * The build under test. Checked as a path, not as an installed app: whether the
 * right build is *on* the device is something only the device can answer, and
 * `noReset` means an existing install is never replaced anyway.
 */
function checkAppPath(appPath: string | undefined, alsoIdentified: boolean, label: string): PreflightCheck {
  const name = 'Bản build';
  if (!appPath) {
    return alsoIdentified
      ? { name, ok: true, detail: `Không khai báo ${label}; sẽ dùng app đã cài sẵn trên máy.` }
      : {
          name,
          ok: false,
          detail: `Chưa khai báo ${label}, cũng chưa khai báo app đang cài sẵn — không biết mở app nào.`,
        };
  }
  const abs = path.resolve(appPath);
  return existsSync(abs)
    ? { name, ok: true, detail: appPath }
    : { name, ok: false, detail: `Không thấy file ${appPath} (tìm ở ${abs}).` };
}

/**
 * Which of the devices the config knows about is actually here, and whether
 * that leaves one unambiguous choice.
 *
 * The `devices` array is a roster of machines this suite may run on, not a set
 * that must all be present — demanding every one of them be attached reports a
 * failure for the perfectly normal case of having unplugged the other phone.
 * The question worth asking is narrower: can a run be pointed at exactly one
 * device without guessing?
 */
export function resolveDevice(
  cfg: TestPilotConfig,
  platform: Platform,
  attached: string[],
  /** How the operator would recognise what is attached, for the message. */
  attachedLabel: string,
  /**
   * A choice made on screen but not yet saved. The panel re-probes the moment a
   * device is picked, and reading only the stored preference would keep
   * answering "chưa chọn" until someone thought to press Save.
   */
  override?: string,
): DeviceResolution {
  const name = 'Máy để chạy';
  const roster = devicesOf(cfg, platform);

  // One entry is every config that never opted into a device list. There is
  // nothing to choose between, so any attached device is the right one and the
  // run needs no `--device` at all.
  if (roster.length <= 1) {
    return attached.length > 0
      ? { check: { name, ok: true, detail: `Sẽ chạy trên ${attachedLabel}.` } }
      : { check: { name, ok: false, detail: 'Không có máy nào để chạy.' } };
  }

  const here = roster.filter((d) =>
    attached.some((a) => a === d.udid || a === d.deviceName),
  );
  const rosterLabel = roster.map((d) => `${d.id} (${d.udid ?? d.deviceName})`).join(', ');
  const label = (d: (typeof roster)[number]) => `${d.id} — ${d.udid ?? d.deviceName}`;

  if (here.length === 0) {
    return {
      check: {
        name,
        ok: false,
        detail: `Đang cắm ${attachedLabel}, không khớp máy nào trong config. Config có: ${rosterLabel}.`,
      },
    };
  }
  if (here.length === 1) {
    return { device: here[0]!.id, check: { name, ok: true, detail: `${label(here[0]!)}.` } };
  }

  // Several rostered devices are present, so someone has to say which. The
  // candidates travel back with the result so the choice can be offered where
  // it is discovered, rather than as a flag on a command nobody is running.
  const candidates = here.map((d) => ({ id: d.id, label: label(d) }));
  const picked = override ?? (platform === 'web' ? undefined : cfg.workflow.devices?.[platform]);

  if (!picked) {
    return {
      candidates,
      check: {
        name,
        ok: false,
        detail: `Có ${here.length} máy trong config cùng đang cắm (${here.map((d) => d.id).join(', ')}) — chọn một máy để chạy.`,
      },
    };
  }
  // A stored choice is a preference, not a command: honouring it when the
  // device is absent would mean silently running somewhere else, and running on
  // the wrong phone is the failure nobody catches.
  const chosen = here.find((d) => d.id === picked);
  return chosen
    ? { device: chosen.id, candidates, check: { name, ok: true, detail: `${label(chosen)}.` } }
    : {
        candidates,
        check: {
          name,
          ok: false,
          detail: `Đã chọn ${picked} nhưng máy đó không nằm trong số đang cắm (${here.map((d) => d.id).join(', ')}).`,
        },
      };
}

async function androidPreflight(cfg: TestPilotConfig, override?: string): Promise<PlatformChecks> {
  const checks: PreflightCheck[] = [];
  let device: string | undefined;
  let candidates: DeviceCandidate[] | undefined;

  const adb = await tryRun('adb', ['devices']);
  if (!adb.ok) {
    checks.push({
      name: 'Thiết bị Android',
      ok: false,
      detail: `Không chạy được \`adb devices\` (${adb.error ?? 'không rõ'}). Cài Android platform-tools và thêm vào PATH.`,
    });
  } else {
    const devices = parseAdbDevices(adb.stdout);
    const usable = devices.filter((d) => d.state === 'device');
    // Plugged in but not ready is its own answer, and by far the most common
    // one: the phone is sitting right there and the dialog was never accepted.
    const blocked = devices.filter((d) => d.state !== 'device');
    if (usable.length > 0) {
      checks.push({
        name: 'Thiết bị Android',
        ok: true,
        detail: `${usable.length} máy sẵn sàng: ${usable.map((d) => d.serial).join(', ')}.`
          + (blocked.length ? ` (${blocked.map((d) => `${d.serial}: ${d.state}`).join(', ')})` : ''),
      });
    } else if (blocked.length > 0) {
      checks.push({
        name: 'Thiết bị Android',
        ok: false,
        detail: `Máy đã cắm nhưng chưa dùng được: ${blocked.map((d) => `${d.serial} (${d.state})`).join(', ')}. `
          + '`unauthorized` nghĩa là chưa bấm đồng ý USB debugging trên màn hình máy.',
      });
    } else {
      checks.push({
        name: 'Thiết bị Android',
        ok: false,
        detail: 'Chưa có máy nào kết nối. Cắm máy và bật USB debugging, hoặc khởi động một emulator.',
      });
    }
    // Only worth asking once something is attached: with nothing plugged in,
    // "which of them do we run on" adds a second red line saying the same thing.
    if (usable.length > 0) {
      const serials = usable.map((d) => d.serial);
      const resolved = resolveDevice(cfg, 'android', serials, serials.join(', '), override);
      checks.push(resolved.check);
      device = resolved.device;
      candidates = resolved.candidates;
    }
  }

  checks.push(await checkAppium());
  checks.push(checkAppPath(cfg.android.app, Boolean(cfg.android.appPackage), 'android.app'));
  return { checks, device, candidates };
}

/**
 * Bảng `xcrun devicectl list devices` thành danh sách máy kèm trạng thái.
 *
 * Trước đây chỉ lọc dòng có chữ `connected` rồi vứt phần còn lại. Nhưng một
 * iPhone đã ghép đôi mà đang khoá hoặc chưa bật Developer Mode nằm ở trạng thái
 * `unavailable` — và bị vứt đi hoàn toàn, nên preflight nói "không thấy máy
 * thật nào" trong khi máy đang cắm ngay đó. Đó là đúng tình huống mà nhánh
 * Android đã xử lý cho `unauthorized`, chỉ là iOS chưa có.
 */
export function parseDevicectl(
  stdout: string,
): Array<{ name: string; label: string; state: string; usable: boolean }> {
  const out: Array<{ name: string; label: string; state: string; usable: boolean }> = [];
  for (const line of stdout.split('\n')) {
    // Bỏ tiêu đề và đường kẻ; cột cách nhau bằng nhiều khoảng trắng.
    if (!line.trim() || /^-+\s/.test(line.trim()) || /^Name\s{2,}/.test(line)) continue;
    const cols = line.trim().split(/\s{2,}/).filter(Boolean);
    if (cols.length < 4) continue;
    const name = cols[0]!;
    // Trạng thái là cột áp chót trong bảng của devicectl (sau nó là Model).
    const state = (cols[cols.length - 2] ?? '').trim().toLowerCase();
    if (!state) continue;
    // `connected` KHÔNG phải trạng thái dùng được duy nhất.
    //
    // Một iPhone nối qua tunnel CoreDevice (Xcode 15+/iOS 17+) báo là
    // `available (paired)`, và `xctrace` còn xếp nó vào "Devices Offline" —
    // nhưng nó dùng được thật. Đo trên máy người dùng:
    //
    //   devicectl device info lockState → Acquired tunnel connection to device.
    //   developerModeStatus: enabled · unlockedSinceBoot: true
    //
    // Bắt đúng chữ `connected` khiến tool báo "chưa dùng được" cho một máy đã
    // mở khoá, đã tin cậy, đã bật Developer Mode — và người dùng đi sửa một
    // thứ vốn không hỏng.
    // Cột Model là "iPhone 12 Pro Max (iPhone13,4)". Phần trong ngoặc là mã
    // phần cứng, không ai gọi máy bằng cái tên đó.
    // Chỉ đọc khi bảng đủ năm cột (Name, Hostname, Identifier, State, Model);
    // thiếu cột thì cột cuối chính là State, và lấy nó làm tên máy thì vô nghĩa.
    const model = cols.length >= 5
      ? (cols[cols.length - 1] ?? '').replace(/\s*\([^)]*\)\s*$/, '').trim()
      : '';
    // `name` là tên chủ máy tự đặt, dùng để KHỚP với cấu hình. `label` là thứ
    // hiện lên màn hình, và phải giống hệt chip chọn máy — chip lấy
    // `marketingName` từ devicectl, tức cùng một chuỗi với cột Model.
    out.push({ name, label: model || name, state, usable: /^(connected|available)/.test(state) });
  }
  return out;
}

async function iosPreflight(cfg: TestPilotConfig, override?: string): Promise<PlatformChecks> {
  const checks: PreflightCheck[] = [];

  // Chạy iOS tại chỗ cần Xcode, tức cần macOS. Trên Windows/Linux, mọi dòng
  // bên dưới đều hỏng vì cùng một lý do, và bản trước để người dùng đọc năm câu
  // "không chạy được xcrun" rồi tự suy ra điều đó. Nói thẳng một câu, và chỉ
  // sang đường thật sự đi được.
  if (process.platform !== 'darwin') {
    return {
      checks: [{
        name: 'Hệ điều hành',
        ok: false,
        detail: `Chạy iOS tại chỗ cần máy macOS có Xcode; máy đang chạy tool là ${process.platform}. `
          + 'Với máy Windows/Linux, iOS chỉ chạy được qua Device Farm.',
      }],
    };
  }

  const sim = await tryRun('xcrun', ['simctl', 'list', 'devices', 'booted', '-j']);
  const booted = sim.ok ? parseBootedSimulators(sim.stdout) : [];
  // Physical iPhones are invisible to simctl, so a separate probe — and if it
  // is unavailable the report says only simulators were checked rather than
  // claiming there is no device.
  const physical = await tryRun('xcrun', ['devicectl', 'list', 'devices']);
  const listed = physical.ok ? parseDevicectl(physical.stdout) : [];
  const usablePhones = listed.filter((d) => d.usable);
  // Tên để KHỚP với `devices` trong config, không phải để hiện.
  const physicalNames = usablePhones.map((d) => d.name);
  const physicalLabels = usablePhones.map((d) => d.label);
  // Cắm rồi nhưng chưa dùng được là một câu trả lời RIÊNG, và với iPhone thì
  // nó phổ biến y như `unauthorized` bên Android: máy nằm ngay đó, chỉ là đang
  // khoá, chưa bật Developer Mode, hoặc chưa tin tưởng máy tính này.
  const blockedPhones = listed.filter((d) => !d.usable);

  if (!sim.ok && !physical.ok) {
    checks.push({
      name: 'Thiết bị iOS',
      ok: false,
      detail: `Không chạy được \`xcrun\` (${sim.error ?? 'không rõ'}). Cần Xcode command line tools trên máy macOS.`,
    });
  } else if (booted.length === 0 && physicalNames.length === 0 && blockedPhones.length > 0) {
    checks.push({
      name: 'Thiết bị iOS',
      ok: false,
      // Một câu, có hành động. Bản trước giải nghĩa từ `unavailable` rồi đoán ba
      // nguyên nhân — dài, và ba nguyên nhân đoán mò thì không phải hướng dẫn.
      detail: `${blockedPhones.map((d) => `${d.label} (${d.state})`).join(', ')} — máy đã nhận `
        + 'nhưng chưa dùng được. Mở khoá máy và giữ cáp, hoặc bật một simulator.',
    });
  } else if (booted.length === 0 && physicalNames.length === 0) {
    checks.push({
      name: 'Thiết bị iOS',
      ok: false,
      detail: 'Không có simulator nào đang bật và không thấy máy thật nào. Mở Simulator, hoặc cắm iPhone và tin tưởng máy tính này.',
    });
  } else {
    checks.push({
      name: 'Thiết bị iOS',
      ok: true,
      detail: [
        booted.length ? `Simulator đang bật: ${booted.join(', ')}` : '',
        physicalLabels.length ? `Máy thật: ${physicalLabels.join(', ')}` : '',
        blockedPhones.length
          ? `(chưa dùng được: ${blockedPhones.map((d) => `${d.label} — ${d.state}`).join(', ')})`
          : '',
      ].filter(Boolean).join(' · '),
    });
  }

  const present = [...booted, ...physicalNames];
  let device: string | undefined;
  let candidates: DeviceCandidate[] | undefined;
  if (present.length > 0) {
    // Khớp bằng `present` (tên/udid thật), nhưng câu hiện ra dùng nhãn giống chip.
    const resolved = resolveDevice(cfg, 'ios', present, [...booted, ...physicalLabels].join(', '), override);
    checks.push(resolved.check);
    device = resolved.device;
    candidates = resolved.candidates;
  }

  checks.push(await checkAppium());
  checks.push(checkAppPath(cfg.ios.app, Boolean(cfg.ios.bundleId), 'ios.app'));

  // A real iPhone refuses to install the unsigned WebDriverAgent Appium builds
  // for it, and dies at `xcodebuild failed with code 65` before step one. A
  // simulator needs no signature, so this only matters when a physical device
  // is what is there.
  // Hiện cả khi ĐẠT, không chỉ khi thiếu. Một dòng chỉ xuất hiện lúc hỏng thì
  // người đang cấu hình không có cách nào xác nhận mình đã đặt đúng — họ chỉ
  // biết khi một lượt chạy thật đổ ở `xcodebuild failed with code 65`.
  if (physicalNames.length > 0 || blockedPhones.length > 0) {
    checks.push(
      cfg.ios.teamId
        ? { name: 'Chữ ký cho máy thật', ok: true, detail: `ios.teamId = ${cfg.ios.teamId}` }
        : {
            name: 'Chữ ký cho máy thật',
            ok: false,
            detail: 'Chạy trên iPhone thật cần ios.teamId (Apple Developer Team ID, 10 ký tự). Thiếu nó, WebDriverAgent không cài được.',
          },
    );
  }

  // Chỉ hỏi khi có máy thật và app là hybrid: simulator không cần tunnel, và
  // một bộ kịch bản thuần native cũng không.
  if (cfg.ios.hybrid && physicalNames.length > 0) {
    checks.push(await iosTunnelCheck());
  }

  return { checks, device, candidates };
}

/** Lệnh duy nhất dựng được tunnel; cần sudo nên tool không tự chạy thay được. */
export const IOS_TUNNEL_COMMAND = 'sudo appium driver run xcuitest tunnel-creation';

/**
 * Cổng của sổ đăng ký tunnel, nếu script tunnel-creation từng chạy.
 *
 * `appium-ios-remotexpc` cất số cổng bằng @appium/strongbox, tức một file phẳng
 * trong thư mục dữ liệu của `appium-xcuitest-driver`. Đọc lại đúng file đó là
 * cách duy nhất biết được cổng mà không phải nạp nội bộ của Appium vào tiến
 * trình này.
 */
async function tunnelRegistryPort(): Promise<number | undefined> {
  // Ba mảnh ghép lại, tất cả đều đọc ra từ chính mã của Appium chứ không đoán:
  //  - env-paths thêm hậu tố "-nodejs" vào tên container;
  //  - strongbox mặc định cất trong thư mục con "strongbox" (DEFAULT_SUFFIX);
  //  - tên file là slugify("tunnelRegistryPort"), mà slugify chỉ đụng tới ký tự
  //    không phải chữ-số, nên camelCase giữ nguyên.
  //
  // Bản đầu tôi bỏ quên mảnh giữa. Hậu quả không phải là báo lỗi mà là luôn
  // luôn nói "chưa chạy lần nào" — kể cả khi tunnel đang chạy ngon lành, tức
  // đẩy người dùng đi dựng lại một thứ vốn đã có. Thử cả hai đường để một bản
  // Appium sau này bỏ hậu tố cũng không làm dòng kiểm tra này nói dối.
  const base = path.join(os.homedir(), 'Library', 'Application Support', 'appium-xcuitest-driver-nodejs');
  for (const file of [
    path.join(base, 'strongbox', 'tunnelRegistryPort'),
    path.join(base, 'tunnelRegistryPort'),
  ]) {
    try {
      const port = Number.parseInt((await readFile(file, 'utf8')).trim(), 10);
      if (Number.isInteger(port) && port > 0 && port < 65536) return port;
    } catch {
      // Không có file này thì thử đường còn lại.
    }
  }
  return undefined;
}

/**
 * Sổ đăng ký có đang giữ máy nào không.
 *
 * Cổng mở KHÔNG có nghĩa là dùng được. Đo trên máy người dùng ngày 2026-09-10:
 * tunnel chạy liên tục 4 giờ 48 phút, cổng trả lời bình thường, mà sổ rỗng —
 *
 *   {"status":"OK","tunnels":{},"metadata":{"totalTunnels":0,"activeTunnels":0}}
 *
 * vì cáp rớt một nhịp và tunnel không nhận lại máy. Từ iOS 18, Appium lấy danh
 * sách máy thật TỪ CHÍNH SỔ NÀY, nên nó báo "Available real devices:" rỗng rồi
 * "Unknown device or simulator UDID" — một câu không nhắc gì tới tunnel. Mất
 * gần một giờ mới lần ra, trong khi một lệnh GET đã trả lời xong.
 */
async function tunnelsRegistered(port: number): Promise<number | undefined> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/remotexpc/tunnels`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { metadata?: { totalTunnels?: number } };
    return body.metadata?.totalTunnels;
  } catch {
    // Bản Appium khác có thể đổi đường dẫn API. Không đọc được thì im lặng bỏ
    // qua: mất khả năng phát hiện còn hơn báo hỏng cho một tunnel đang tốt.
    return undefined;
  }
}

/** Có ai đang lắng nghe ở cổng đó không. Số cất lại không có nghĩa là còn sống. */
function portAccepting(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (ok: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(500, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/**
 * Tunnel CoreDevice — thứ chặn app hybrid trên iOS 17 trở lên.
 *
 * Từ iOS 17, Appium chỉ nói chuyện được với Web Inspector qua một tunnel do
 * script chạy bằng sudo dựng lên. Thiếu nó, `getContexts()` trả về đúng
 * NATIVE_APP sau ~10s và MỌI kịch bản hybrid hỏng ở bước đầu tiên — nhưng log
 * Appium chỉ ghi một dòng "Tunnel registry port not found" nằm lẫn giữa hàng
 * nghìn dòng khác. Đây là chỗ để nói ra trước khi chạy, thay vì sau khi hỏng.
 */
export async function iosTunnelCheck(): Promise<PreflightCheck> {
  const name = 'Tunnel cho WebView (iOS 17+)';
  const port = await tunnelRegistryPort();
  if (port !== undefined && (await portAccepting(port))) {
    const tunnels = await tunnelsRegistered(port);
    if (tunnels === 0) {
      return {
        name,
        ok: false,
        fix: 'ios-tunnel',
        detail: `Tunnel đang chạy ở 127.0.0.1:${port} nhưng chưa nhận máy nào — thường là do cáp `
          + 'rớt một nhịp rồi cắm lại. Từ iOS 18 Appium lấy danh sách máy thật từ sổ này, nên máy '
          + 'sẽ không chạy được dù cáp vẫn cắm. Dừng tunnel cũ (Ctrl-C ở cửa sổ Terminal đó) và '
          + `chạy lại: ${IOS_TUNNEL_COMMAND}`,
      };
    }
    return {
      name,
      ok: true,
      detail: `Đang chạy ở 127.0.0.1:${port}${tunnels === undefined ? '' : `, giữ ${tunnels} máy`}.`,
    };
  }
  return {
    name,
    ok: false,
    // Nút nằm ngay cạnh dòng đỏ, nên nó theo dòng này sang mọi màn hình có
    // hiển thị kết quả kiểm tra — kể cả màn workflow, nơi trước đây người dùng
    // đọc được lý do nhưng không có chỗ nào để chữa.
    fix: 'ios-tunnel',
    detail: port === undefined
      ? `Chưa chạy lần nào. Mở một cửa sổ Terminal riêng, chạy lệnh sau và để nguyên đó: ${IOS_TUNNEL_COMMAND}`
      : `Cổng ${port} không còn ai nghe — tunnel đã tắt. Chạy lại và giữ cửa sổ: ${IOS_TUNNEL_COMMAND}`,
  };
}

/**
 * Web needs no device, but it does need somewhere to point at — and a run with
 * no base URL fails on the first navigation for a reason nobody reads as
 * "config".
 */
function webPreflight(cfg: TestPilotConfig): PreflightCheck[] {
  const url = cfg.web.baseUrl?.trim();
  return [
    url
      ? { name: 'Địa chỉ web', ok: true, detail: url }
      : { name: 'Địa chỉ web', ok: false, detail: 'Chưa có Test Environment URL.' },
  ];
}

export async function preflight(
  platform: Platform,
  cfg: TestPilotConfig,
  /** An unsaved device choice from the Studio; see `resolveDevice`. */
  deviceOverride?: string,
): Promise<PreflightResult> {
  const { checks, device, candidates } =
    platform === 'android'
      ? await androidPreflight(cfg, deviceOverride)
      : platform === 'ios'
        ? await iosPreflight(cfg, deviceOverride)
        : { checks: webPreflight(cfg), device: undefined, candidates: undefined };
  return {
    platform,
    ok: checks.every((c) => c.ok),
    checks,
    ...(device ? { device } : {}),
    ...(candidates ? { candidates } : {}),
  };
}

/** One line per failing check, for a log where a whole table would not fit. */
export function preflightSummary(result: PreflightResult): string {
  const failed = result.checks.filter((c) => !c.ok);
  if (failed.length === 0) return `${result.platform}: môi trường sẵn sàng.`;
  return [`${result.platform}: chưa chạy được.`, ...failed.map((c) => `  ✗ ${c.name}: ${c.detail}`)].join('\n');
}
