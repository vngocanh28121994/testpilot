import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, type TestPilotConfig } from '../config.js';
import { Registry } from '../core/registry.js';
import type { ElementDef, Platform } from '../core/types.js';
import type { UiDriver } from '../drivers/driver.js';
import { FRAGILE_BELOW, toElementDef, type Observed } from '../crawl/observe.js';

/**
 * Builds the element registry from the running app instead of from prose.
 *
 * Everything the registry held until now came from either an LLM reading a
 * document or a person typing a selector. Both guess. This looks at what is
 * actually on screen, ranks the handles the app really exposes, and says out
 * loud when the best available handle is a position — which is the difference
 * between a suite that survives a refactor and one that silently taps the
 * wrong thing.
 *
 *   npx tsx src/cli/crawl.ts --platform web
 *   npx tsx src/cli/crawl.ts --platform web --screen login --dry-run
 *
 * It merges rather than overwrites: hand-authored candidates are kept and the
 * crawled ones are added alongside, so a human correction is never lost to the
 * next crawl.
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cfg = await loadConfig(args.config ?? 'testpilot.config.json');

  const driver = await makeDriver(args.platform, cfg);
  if (!driver.observe) {
    throw new Error(`Driver ${args.platform} chưa hỗ trợ observe().`);
  }

  console.log(`[crawl] mở ${args.platform}…`);
  await driver.start();
  let observed: Observed[];
  try {
    await driver.launch();
    // The resolver normally owns waiting, but there is nothing to wait *for*
    // here — no locator to poll — so settle explicitly before looking.
    await settle(driver, args.settleMs);
    observed = await driver.observe();
  } finally {
    await driver.stop();
  }

  const useful = observed.filter((o) => o.interactive || o.text || o.testId);
  const defs = dedupe(useful.map((o) => toElementDef(args.screen, o, args.platform)));

  console.log(`[crawl] thấy ${observed.length} node, giữ lại ${defs.length} element.\n`);
  report(defs, args.platform);

  await writeTestIdRequests(defs, args, cfg);

  if (args.dryRun) {
    // A dry run that only prints totals cannot be checked against the screen,
    // which is the one thing you want to do before writing to the registry.
    console.log('\n  element sẽ được ghi:');
    for (const d of defs) {
      const top = d.candidates[args.platform]?.[0];
      console.log(
        `    ${d.id.padEnd(30)} ${(top?.weight ?? 0).toFixed(2)} ` +
          `${top?.strategy ?? '—'}=${(top?.name ?? top?.value ?? '').slice(0, 40)}`,
      );
    }
    console.log('\n[crawl] --dry-run: không ghi gì.');
    return;
  }

  const registry = await Registry.load(cfg.paths.registry);
  registry.raw.screens[args.screen] ??= { id: args.screen, title: args.screen };
  let added = 0;
  let merged = 0;
  for (const def of defs) {
    const existing = registry.raw.elements[def.id];
    if (!existing) {
      registry.raw.elements[def.id] = def;
      added++;
      continue;
    }
    mergeCandidates(existing, def, args.platform);
    merged++;
  }
  await mkdir(path.dirname(cfg.paths.registry), { recursive: true });
  await registry.save();
  console.log(`\n[crawl] ${cfg.paths.registry}: thêm ${added}, gộp vào ${merged}.`);
}

/**
 * Writes the fragile elements out as a request the app team can act on.
 *
 * "Please add test ids" is easy to ignore; a list naming each element, where it
 * sits, and the exact attribute to add is a task. The suggested name comes from
 * the element's own id, so the registry and the app end up agreeing without a
 * second conversation.
 */
async function writeTestIdRequests(
  defs: ElementDef[],
  args: Args,
  cfg: TestPilotConfig,
): Promise<void> {
  const fragile = defs
    .map((d) => ({ d, top: d.candidates[args.platform]?.[0] }))
    .filter((r) => (r.top?.weight ?? 0) < FRAGILE_BELOW);
  if (fragile.length === 0) return;

  const attr = args.platform === 'web' ? 'data-testid' : 'android:id';
  const rows = fragile
    .map(({ d, top }) => {
      const suggested = d.id.replace('.', '-');
      return `| \`${d.label}\` | \`${suggested}\` | \`${top?.value ?? ''}\` |`;
    })
    .join('\n');

  const body = `# Đề nghị thêm \`${attr}\` — màn hình \`${args.screen}\`

Sinh tự động bởi \`npm run crawl\` lúc ${new Date().toISOString()}, từ ${args.platform === 'web' ? cfg.web.baseUrl : 'app trên thiết bị'}.

${fragile.length}/${defs.length} element trên màn hình này không có handle nào bền để test tự động bám vào.
Locator tốt nhất hiện tại của chúng là đường dẫn theo cấu trúc DOM — nó vỡ ngay khi
có ai bọc thêm một thẻ, kể cả khi giao diện nhìn không đổi gì.

Thêm \`${attr}\` vào các phần tử dưới đây thì test bám được ổn định, và **dùng chung
cho cả bản web lẫn WebView trong app** vì cùng một codebase.

| Phần tử | \`${attr}\` đề nghị | Đang phải bám vào |
|---|---|---|
${rows}

Tên đề nghị chỉ là gợi ý cho thống nhất — đặt khác cũng được, miễn là ổn định và
không đổi theo nội dung hiển thị hay ngôn ngữ.
`;

  const file = path.join(cfg.paths.reports, `testid-requests-${args.screen}.md`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body, 'utf8');
  console.log(`\n  → đề nghị gửi team app: ${file}`);
}

/**
 * Adds crawled candidates without displacing authored ones.
 *
 * A person who fixed a locator by hand knows something the crawl does not, so
 * an authored candidate always outranks a crawled one at equal weight.
 */
function mergeCandidates(existing: ElementDef, fresh: ElementDef, platform: Platform): void {
  const current = existing.candidates[platform] ?? [];
  const incoming = (fresh.candidates[platform] ?? []).filter(
    (c) => !current.some((e) => e.strategy === c.strategy && e.value === c.value),
  );
  existing.candidates[platform] = [...current, ...incoming].sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return (a.origin === 'authored' ? 0 : 1) - (b.origin === 'authored' ? 0 : 1);
  });
}

/** Two nodes can produce the same id; keep the one with the stronger handle. */
function dedupe(defs: ElementDef[]): ElementDef[] {
  const best = new Map<string, ElementDef>();
  for (const d of defs) {
    const top = (c?: ElementDef) => Object.values(c?.candidates ?? {})[0]?.[0]?.weight ?? 0;
    if (top(d) > top(best.get(d.id))) best.set(d.id, d);
  }
  return [...best.values()];
}

/**
 * Prints what was found, worst first.
 *
 * Fragile elements go at the top because they are the actionable part: an
 * element whose only handle is a position is a bug report for the app team,
 * not a locator to be satisfied with.
 */
function report(defs: ElementDef[], platform: Platform): void {
  const rows = defs
    .map((d) => ({ d, top: d.candidates[platform]?.[0] }))
    .sort((a, b) => (a.top?.weight ?? 0) - (b.top?.weight ?? 0));

  const fragile = rows.filter((r) => (r.top?.weight ?? 0) < FRAGILE_BELOW);
  if (fragile.length > 0) {
    console.log(`  ${fragile.length} element chỉ bám được vào vị trí — sẽ hỏng khi layout đổi:`);
    for (const { d, top } of fragile.slice(0, 10)) {
      console.log(`    ${d.id.padEnd(34)} ${top?.strategy}=${top?.value.slice(0, 46)}`);
    }
    console.log('    → xin app team thêm data-testid cho những chỗ này.\n');
  }

  const byStrategy = new Map<string, number>();
  for (const { top } of rows) {
    if (top) byStrategy.set(top.strategy, (byStrategy.get(top.strategy) ?? 0) + 1);
  }
  console.log('  locator tốt nhất của mỗi element, theo chiến lược:');
  for (const [s, n] of [...byStrategy].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(3)}  ${s}`);
  }
}

/** Waits for the UI to stop changing, or gives up and looks anyway. */
async function settle(driver: UiDriver, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await driver.isIdle().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 400));
  }
}

async function makeDriver(platform: Platform, cfg: TestPilotConfig): Promise<UiDriver> {
  const artifactsDir = path.join(cfg.paths.artifacts, platform);
  if (platform === 'web') {
    const { WebUiDriver } = await import('../drivers/web.js');
    return new WebUiDriver({
      baseUrl: cfg.web.baseUrl,
      headless: cfg.web.headless,
      device: cfg.web.device,
      record: false, // a crawl is a look, not a run worth filming
      ...(cfg.web.network ? { network: cfg.web.network } : {}),
      artifactsDir,
    });
  }
  const { NativeUiDriver } = await import('../drivers/native.js');
  const isAndroid = platform === 'android';
  return new NativeUiDriver({
    platform: isAndroid ? 'android' : 'ios',
    deviceName: isAndroid ? cfg.android.deviceName : cfg.ios.deviceName,
    ...(isAndroid
      ? {
          ...(cfg.android.app ? { app: cfg.android.app } : {}),
          ...(cfg.android.appPackage ? { appPackage: cfg.android.appPackage } : {}),
          ...(cfg.android.appActivity ? { appActivity: cfg.android.appActivity } : {}),
          hybrid: cfg.android.hybrid,
          isolation: cfg.android.isolation,
        }
      : {
          ...(cfg.ios.app ? { app: cfg.ios.app } : {}),
          ...(cfg.ios.bundleId ? { bundleId: cfg.ios.bundleId } : {}),
          hybrid: cfg.ios.hybrid,
        }),
    artifactsDir,
  });
}

interface Args {
  platform: Platform;
  screen: string;
  config?: string;
  dryRun: boolean;
  settleMs: number;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const raw = (get('--platform') ?? 'web').toLowerCase();
  if (raw !== 'web' && raw !== 'android' && raw !== 'ios') {
    throw new Error(`--platform phải là web | android | ios (nhận "${raw}").`);
  }
  return {
    platform: raw,
    screen: get('--screen') ?? 'main',
    ...(get('--config') ? { config: get('--config')! } : {}),
    dryRun: argv.includes('--dry-run'),
    settleMs: Number(get('--settle') ?? 8000),
  };
}

main().catch((err: Error) => {
  console.error(`[crawl] ${err.message}`);
  process.exit(1);
});
