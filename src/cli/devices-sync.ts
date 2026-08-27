/**
 * Adds attached phones to the config's device roster.
 *
 * Writing a `devices` entry by hand means finding a serial, inventing an id and
 * picking a port nobody else uses — three chances to make a run drive the wrong
 * handset. This does that once per new phone.
 *
 * It only ever adds. An existing entry is left exactly as written, because its
 * `id` is load-bearing: run directories are named after it and HealingStore
 * dedupes on it, so rewriting one would orphan every run recorded under the old
 * name. A phone that is merely unplugged is likewise never removed — the run
 * skips it at launch instead.
 *
 *   npm run devices:sync -- [--platform android,ios] [--dry-run]
 */
import { attachedDevices, type AttachedDevice } from '../core/attachedDevices.js';
import { loadConfig, saveConfig, type DeviceSpec, type TestPilotConfig } from '../config.js';

/** First port of each range. Appium's own defaults, offset to leave them free. */
const FIRST_PORT: Record<'android' | 'ios', number> = { android: 8200, ios: 8100 };

interface Args {
  platforms: Array<'android' | 'ios'>;
  config: string;
  dryRun: boolean;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cfg = await loadConfig(args.config);
  let added = 0;
  let renamed = 0;

  for (const platform of args.platforms) {
    const probe = await attachedDevices(platform);
    if (!probe.ok) {
      console.log(`[devices] ${platform}: không dò được máy đang cắm — ${probe.reason}`);
      continue;
    }
    if (probe.devices.length === 0) {
      console.log(`[devices] ${platform}: không có máy nào đang cắm.`);
      continue;
    }
    const result = syncPlatform(cfg, platform, probe.devices);
    added += result.added;
    renamed += result.renamed;
  }

  if (added === 0 && renamed === 0) {
    console.log('[devices] Config đã có đủ mọi máy đang cắm — không thay đổi gì.');
    return;
  }
  if (args.dryRun) {
    console.log(`[devices] --dry-run: chưa ghi gì vào ${args.config}.`);
    return;
  }
  await saveConfig(cfg, args.config);
  const what = [added > 0 ? `thêm ${added} thiết bị` : '', renamed > 0 ? `đổi tên ${renamed}` : '']
    .filter(Boolean).join(', ');
  console.log(`[devices] Đã ${what} trong ${args.config}.`);
}

function syncPlatform(
  cfg: TestPilotConfig,
  platform: 'android' | 'ios',
  attached: AttachedDevice[],
): { added: number; renamed: number } {
  const section = platform === 'android' ? cfg.android : cfg.ios;
  // A platform with no list has been running through `deviceName` alone, which
  // names no particular handset — there is no identity there worth preserving,
  // so the list starts from the phones actually found rather than from a
  // placeholder that would need a udid and a port it can never be given.
  section.devices ??= [];
  const devices = section.devices;

  let added = 0;
  let renamed = 0;
  for (const found of attached) {
    const existing = devices.find((d) => d.udid === found.udid);
    if (existing) {
      console.log(`[devices] ${platform}: ${found.udid} đã có (id "${existing.id}").`);
      continue;
    }
    const device: DeviceSpec = {
      id: uniqueId(found, devices),
      deviceName: found.model ?? (platform === 'android' ? 'Android Device' : 'iPhone'),
      udid: found.udid,
    };
    assignPort(platform, device, devices);
    devices.push(device);
    console.log(
      `[devices] ${platform}: + "${device.id}" (${found.udid}` +
      `${found.model ? `, ${found.model}` : ''}).`,
    );
    added += 1;
  }
  return { added, renamed };
}

/** Ports must be unique per platform; concurrent sessions collide otherwise. */
function assignPort(platform: 'android' | 'ios', device: DeviceSpec, all: DeviceSpec[]): void {
  const field = platform === 'android' ? 'systemPort' : 'wdaLocalPort';
  if (device[field] !== undefined) return;
  const taken = new Set(all.map((d) => d[field]).filter((p): p is number => p !== undefined));
  let port = FIRST_PORT[platform];
  while (taken.has(port)) port += 1;
  device[field] = port;
}

/**
 * A readable id derived from the model, since that is how anyone reading a run
 * directory name will recognise the phone. Falls back to the serial's tail when
 * the platform gave no model, and always ends up unique.
 */
function uniqueId(found: AttachedDevice, existing: DeviceSpec[]): string {
  const base = (found.model ?? found.udid.slice(-6))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'device';
  const taken = new Set(existing.map((d) => d.id));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function parseArgs(argv: string[]): Args {
  const value = (flag: string): string | undefined => {
    const at = argv.indexOf(flag);
    return at >= 0 ? argv[at + 1] : undefined;
  };
  const raw = value('--platform') ?? 'android,ios';
  const platforms = raw.split(',').map((p) => p.trim()).filter(Boolean);
  for (const platform of platforms) {
    if (platform !== 'android' && platform !== 'ios') {
      throw new Error(`--platform chỉ nhận android và/hoặc ios, không nhận "${platform}".`);
    }
  }
  return {
    platforms: platforms as Array<'android' | 'ios'>,
    config: value('--config') ?? 'testpilot.config.json',
    dryRun: argv.includes('--dry-run'),
  };
}

main().catch((err: Error) => {
  console.error(`[devices] ${err.message}`);
  process.exit(1);
});
