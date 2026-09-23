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
import { loadConfig, saveConfig, type TestPilotConfig } from '../config.js';
import { registerDevices } from '../core/deviceSync.js';

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
  // Phần quyết định nằm ở `core/deviceSync.ts`, dùng chung với route web —
  // hai bản chép tay của cùng một luật đặt tên sẽ lệch, và lúc ấy cùng một
  // chiếc máy có hai `id` khác nhau tuỳ người thêm nó bằng đường nào.
  const before = new Set(
    ((platform === 'android' ? cfg.android : cfg.ios).devices ?? []).map((d) => d.udid),
  );
  for (const found of attached) {
    if (before.has(found.udid)) {
      const existing = (platform === 'android' ? cfg.android : cfg.ios).devices
        ?.find((d) => d.udid === found.udid);
      console.log(`[devices] ${platform}: ${found.udid} đã có (id "${existing?.id}").`);
    }
  }

  const { added } = registerDevices(cfg, platform, attached);
  for (const device of added) {
    const found = attached.find((a) => a.udid === device.udid);
    console.log(
      `[devices] ${platform}: + "${device.id}" (${device.udid}` +
      `${found?.model ? `, ${found.model}` : ''}).`,
    );
  }
  return { added: added.length, renamed: 0 };
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
    config: value('--config') ?? process.env.TESTPILOT_CONFIG ?? 'testpilot.config.json',
    dryRun: argv.includes('--dry-run'),
  };
}

main().catch((err: Error) => {
  console.error(`[devices] ${err.message}`);
  process.exit(1);
});
