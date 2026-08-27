import { spawn } from 'node:child_process';
import path from 'node:path';
import { attachedDevices } from '../core/attachedDevices.js';
import { devicesOf, loadConfig, type DeviceSpec, type TestPilotConfig } from '../config.js';
import { mergeRunLearnings } from '../core/learned.js';
import type { Platform } from '../core/types.js';

/**
 * Runs the suite on several devices at once, across one or both mobile platforms.
 *
 * One child process per device, rather than several drivers inside this one.
 * `run.ts` is built around a single driver and four stores it rewrites whole at
 * the end; teaching it to hold three of everything would mean rewriting the
 * part of it that already works. Separate processes get that isolation for
 * free, and leave exactly one thing to coordinate — the shared files — which
 * the children skip (`--defer-shared-writes`) and this process folds in once,
 * in sequence, after they have all stopped.
 *
 * That single merge is also why `--platform android,ios` exists rather than
 * telling anyone to run two commands at the same time. Two commands each merge
 * their own results, and since merging is read-modify-write over the same four
 * files, the one that finishes second erases what the first just folded in —
 * the very race this file was written to remove, reintroduced one level up.
 * Running both platforms sequentially is safe; running them concurrently is
 * only safe when one process owns the merge, so that process is this one.
 */

interface Args {
  platforms: Platform[];
  config?: string;
  tag?: string;
  includeQuarantined: boolean;
  /** Which environment every device runs against; see config.environments. */
  env?: string;
  /** Reinstall the app on every device even when already on this environment. */
  reinstall: boolean;
  /** Subset of device ids, as `id` or `platform:id`; all of them when omitted. */
  only?: string[];
}

/** One device to drive, and the platform it belongs to. */
interface Target {
  platform: Platform;
  device: DeviceSpec;
  /**
   * Whether the config names this device in a `devices` list.
   *
   * False means the platform declares only a `deviceName`, so `devicesOf`
   * synthesised this entry. Such a run is passed no `--device` at all: it takes
   * the ordinary single-device path, and its run directory keeps the ordinary
   * unsuffixed name. Nothing can collide with it, because the only other run
   * sharing that second is on the other platform and the platform is in the name.
   */
  named: boolean;
}

interface DeviceOutcome {
  target: Target;
  code: number | null;
  runDir?: string;
}

/**
 * Children currently running, so a stop signal reaches all of them.
 *
 * Without this, killing this process leaves one Appium session per device still
 * driving a phone, with nothing left listening for their output. The UI's stop
 * button sends SIGTERM here and expects the devices to actually stop.
 */
const children = new Set<ReturnType<typeof spawn>>();
let stopping = false;

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopping = true;
    console.log(`[parallel] ${signal} — đang dừng ${children.size} thiết bị…`);
    for (const child of children) child.kill('SIGTERM');
    // No exit() here: the children's close handlers still have to run so the
    // merge below can keep whatever they learned before they were interrupted.
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cfg = await loadConfig(args.config ?? 'testpilot.config.json');
  const chosen = pickTargets(cfg, args);
  const targets = await onlyAttached(chosen, labeller(chosen));
  const label = labeller(targets);

  console.log(
    `[parallel] ${targets.length} thiết bị: ` +
    targets.map((t) => label(t)).join(', '),
  );
  assertPortsAreUnique(targets);

  const started = Date.now();
  const outcomes = await Promise.all(targets.map((target) => runOne(target, args, label)));

  const failed = outcomes.filter((o) => o.code !== 0);
  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(
    `\n[parallel] ${outcomes.length - failed.length}/${outcomes.length} thiết bị pass ` +
    `trong ${seconds}s.`,
  );
  for (const o of failed) {
    console.log(`[parallel]   ✗ ${label(o.target)} thoát với mã ${o.code}`);
  }

  // Merge whatever came back, including from devices whose run failed: a failed
  // run still saw the app, and the locators it verified along the way are worth
  // as much as a passing run's.
  const runDirs = outcomes.map((o) => o.runDir).filter((d): d is string => Boolean(d));
  if (runDirs.length === 0) {
    console.log('[parallel] Không thiết bị nào tạo được thư mục run — không có gì để gộp.');
    process.exit(1);
  }

  const summary = await mergeRunLearnings({
    runDirs,
    runsRoot: cfg.paths.runs,
    registryPath: cfg.paths.registry,
    runtimeRegistryPath: 'registry/runtime-registry.json',
    flakeDbPath: cfg.paths.flakeDb,
    healingDbPath: cfg.paths.healingDb,
    flakePolicy: cfg.flake,
  });

  console.log(
    `[parallel] Đã gộp ${summary.runIds.length} run: ` +
    `${summary.elementsMerged} element, ${summary.runtimeEntriesMerged} runtime locator, ` +
    `${summary.healingEventsIngested} healing event.`,
  );
  // Never silent: a device that contributed nothing is the failure mode this
  // whole arrangement exists to prevent, so it is said out loud.
  for (const skip of summary.skipped) {
    console.log(`[parallel]   ⚠ ${skip.runId}: ${skip.reason}`);
  }

  process.exit(failed.length > 0 || stopping ? 1 : 0);
}

/**
 * Drops configured devices whose phone is not plugged in.
 *
 * The config lists the phones a team owns, not the ones on the desk today, so
 * unplugging one used to turn a parallel run into a guaranteed failure for that
 * device. Skipping it is the useful behaviour — but only ever out loud, since a
 * run that quietly covered fewer devices than asked would be worse than one
 * that failed.
 *
 * Two deliberate non-behaviours: a device with no `udid` cannot be matched
 * against the probe and is always kept, and a probe that could not run keeps
 * everything. Neither absence is evidence.
 */
async function onlyAttached(targets: Target[], label: (t: Target) => string): Promise<Target[]> {
  const platforms = [...new Set(targets.map((t) => t.platform))];
  const probes = new Map(
    await Promise.all(platforms.map(async (p) => [p, await attachedDevices(p)] as const)),
  );

  for (const [platform, probe] of probes) {
    if (!probe.ok) {
      console.log(
        `[parallel] Không kiểm tra được thiết bị ${platform} đang cắm (${probe.reason}); ` +
        `chạy tất cả theo config.`,
      );
    }
  }

  const kept = targets.filter((target) => {
    const probe = probes.get(target.platform);
    if (!probe?.ok || !target.device.udid) return true;
    if (probe.devices.some((d) => d.udid === target.device.udid)) return true;
    console.log(`[parallel] ⊘ bỏ qua ${label(target)} (${target.device.udid}) — không thấy máy đang cắm.`);
    return false;
  });

  if (kept.length === 0) {
    throw new Error(
      'Không có thiết bị nào trong config đang được cắm. ' +
      'Cắm máy vào rồi chạy lại, hoặc chạy `npm run devices:sync` để thêm máy mới vào config.',
    );
  }
  if (kept.length === 1) {
    console.log('[parallel] Chỉ còn 1 thiết bị đang cắm — chạy đơn lẻ, không song song.');
  }
  return kept;
}

/**
 * How a device is named in the log.
 *
 * Bare id while one platform is running, so existing output is unchanged;
 * `platform:id` once both are, where the id alone stops being enough to say
 * which phone a line came from.
 */
function labeller(targets: Target[]): (t: Target) => string {
  const mixed = new Set(targets.map((t) => t.platform)).size > 1;
  return (t) => {
    // An unnamed device's id is synthesised from its platform, so qualifying it
    // would read "android:android". The platform alone already identifies it,
    // since being unnamed means it is the only device that platform has.
    if (!t.named) return t.platform;
    return mixed ? `${t.platform}:${t.device.id}` : t.device.id;
  };
}

/** Spawns one child and prefixes everything it says with the device label. */
function runOne(target: Target, args: Args, label: (t: Target) => string): Promise<DeviceOutcome> {
  return new Promise((resolve) => {
    const bin = path.resolve('node_modules/.bin/tsx');
    const argv = [
      'src/cli/run.ts',
      '--platform', target.platform,
      ...(target.named ? ['--device', target.device.id] : []),
      '--defer-shared-writes',
      ...(args.config ? ['--config', args.config] : []),
      ...(args.tag ? ['--tag', args.tag] : []),
      ...(args.env ? ['--env', args.env] : []),
      ...(args.reinstall ? ['--reinstall'] : []),
      ...(args.includeQuarantined ? ['--include-quarantined'] : []),
    ];

    const child = spawn(bin, argv, { env: process.env });
    children.add(child);
    const name = label(target);
    let runDir: string | undefined;
    let carry = '';

    const pipe = (chunk: Buffer): void => {
      carry += chunk.toString();
      const lines = carry.split('\n');
      // A chunk boundary can land mid-line, so the tail waits for the rest.
      carry = lines.pop() ?? '';
      for (const line of lines) {
        const dir = /^\[run:dir\] (.+)$/.exec(line);
        if (dir) runDir = dir[1];
        console.log(`[${name}] ${line}`);
      }
    };

    child.stdout.on('data', pipe);
    child.stderr.on('data', pipe);
    child.on('error', () => { children.delete(child); resolve({ target, code: null }); });
    child.on('close', (code) => {
      children.delete(child);
      if (carry) console.log(`[${name}] ${carry}`);
      resolve({ target, code, ...(runDir ? { runDir } : {}) });
    });
  });
}

function pickTargets(cfg: TestPilotConfig, args: Args): Target[] {
  const available: Target[] = args.platforms.flatMap((platform) => {
    const named = Boolean(
      (platform === 'android' ? cfg.android.devices : cfg.ios.devices)?.length,
    );
    return devicesOf(cfg, platform).map((device) => ({ platform, device, named }));
  });

  if (!args.only) {
    if (available.length < 2) {
      throw new Error(
        `Only ${available.length} device is configured across ${args.platforms.join(', ')}, ` +
        `so there is nothing to parallelise. Add entries to <platform>.devices, ` +
        `name a second platform, or use the single-device run.`,
      );
    }
    return available;
  }

  return args.only.map((token) => {
    // `platform:id` when the same id exists on both platforms; a bare id while
    // it is unambiguous, which it is in every single-platform run.
    const [maybePlatform, maybeId] = token.includes(':') ? token.split(':', 2) : [undefined, token];
    const matches = available.filter((t) =>
      t.device.id === maybeId && (!maybePlatform || t.platform === maybePlatform));

    if (matches.length === 0) {
      throw new Error(
        `--devices names "${token}", which is not configured. ` +
        `Available: ${available.map((t) => `${t.platform}:${t.device.id}`).join(', ')}.`,
      );
    }
    if (matches.length > 1) {
      throw new Error(
        `--devices names "${token}", which exists on ${matches.map((t) => t.platform).join(' and ')}. ` +
        `Qualify it as ${matches.map((t) => `${t.platform}:${t.device.id}`).join(' or ')}.`,
      );
    }
    return matches[0]!;
  });
}

/**
 * Refuses to start when two sessions of the same kind would ask for one port.
 *
 * They fail late and confusingly otherwise: the second session either cannot
 * bind or quietly attaches to the first device's server, and the run that comes
 * back looks real. Cheaper to say so before any device is touched.
 *
 * Checked per platform, and only where a platform runs more than one device.
 * Android sessions contend for `systemPort` and iOS ones for `wdaLocalPort` —
 * different fields, so one phone and one iPhone never collide, and demanding
 * ports of them would turn the most ordinary cross-platform run into a config
 * chore for a conflict that cannot happen.
 */
function assertPortsAreUnique(targets: Target[]): void {
  for (const platform of ['android', 'ios'] as const) {
    const onPlatform = targets.filter((t) => t.platform === platform);
    if (onPlatform.length < 2) continue;

    const field = platform === 'ios' ? 'wdaLocalPort' : 'systemPort';
    const seen = new Map<number, string>();
    const missing: string[] = [];

    for (const { device } of onPlatform) {
      const port = platform === 'ios' ? device.wdaLocalPort : device.systemPort;
      if (port === undefined) {
        missing.push(device.id);
        continue;
      }
      const clash = seen.get(port);
      if (clash) {
        throw new Error(
          `"${device.id}" and "${clash}" both use ${field} ${port}; each session needs its own.`,
        );
      }
      seen.set(port, device.id);
    }

    if (missing.length > 0) {
      throw new Error(
        `${field} is required to run ${onPlatform.length} ${platform} devices at once ` +
        `but is missing on: ${missing.join(', ')}. ` +
        `Concurrent Appium sessions collide on the default port.`,
      );
    }
  }
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const raw = (get('--platform') ?? '').toLowerCase();
  const platforms = raw.split(',').map((p) => p.trim()).filter(Boolean);
  for (const platform of platforms) {
    if (platform !== 'android' && platform !== 'ios') {
      // Web parallelism would shard by browser, not by device, which is a
      // different mechanism than the one this file implements.
      throw new Error(`--platform must be android, ios, or android,ios (got "${platform}").`);
    }
  }
  if (platforms.length === 0) {
    throw new Error('--platform is required: android, ios, or android,ios.');
  }
  if (new Set(platforms).size !== platforms.length) {
    throw new Error(`--platform lists a platform twice: "${raw}".`);
  }

  const only = get('--devices');
  return {
    platforms: platforms as Platform[],
    ...(get('--config') ? { config: get('--config')! } : {}),
    ...(get('--tag') ? { tag: get('--tag')! } : {}),
    ...(get('--env') ? { env: get('--env')! } : {}),
    reinstall: argv.includes('--reinstall'),
    includeQuarantined: argv.includes('--include-quarantined'),
    ...(only ? { only: only.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
  };
}

main().catch((err: Error) => {
  console.error(`[parallel] ${err.message}`);
  process.exit(1);
});
