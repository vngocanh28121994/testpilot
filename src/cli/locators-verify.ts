/**
 * Ask the running application whether the registry's locators actually find
 * anything.
 *
 * A suite run answers this only for the elements its scenarios happen to touch.
 * After importing a locator library for a whole screen, that was 1 element out
 * of 22 — the other 21 were not wrong, they were simply never exercised, and a
 * green run said nothing about them. This walks the screen instead of the
 * scenarios.
 *
 * It uses `isVisibleNow`, which tries the registry's candidates and stops
 * there: no discovery, no healing, no AI. That is deliberate. The question is
 * whether the stored locator works, not whether the system can paper over it —
 * and healing succeeding would hide exactly the answer being asked for.
 *
 * Read-only by design. It reports; deciding what to do about a miss stays with
 * a person.
 *
 *   npm run locators:verify -- --reach "Bảng giá cổ phiếu" --screen priceBoard
 */

import { loadConfig, applyEnv } from '../config.js';
import { adoptStoredApiKeys, Secrets, accountVariables } from '../core/secrets.js';
import { Registry } from '../core/registry.js';
import { parseFeature } from '../steps/binding.js';
import { Resolver } from '../runtime/resolver.js';
import { DEFAULT_RESOLVE } from '../runtime/resolver.js';
import { Executor } from '../runtime/executor.js';
import type { ElementDef, Platform } from '../core/types.js';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

interface Args {
  reach: string;
  account: string;
  screen?: string;
  provenance?: ElementDef['provenance'];
  headed: boolean;
}

/** A parameterised element cannot be checked without the row it refers to. */
function isTemplate(element: ElementDef): boolean {
  if (element.label.includes('{{')) return true;
  return Object.values(element.candidates)
    .flat()
    .some((candidate) => candidate?.value.includes('{{'));
}

export async function verifyLocators(args: Args): Promise<number> {
  await adoptStoredApiKeys();
  const base = await loadConfig();
  const { config: cfg, alias } = applyEnv(base, base.defaultEnv);
  const registry = await Registry.load(cfg.paths.registry);

  const wanted = Object.values(registry.raw.elements).filter((element) => {
    if (args.screen && element.screen !== args.screen) return false;
    if (args.provenance && element.provenance !== args.provenance) return false;
    return !isTemplate(element);
  });
  if (wanted.length === 0) {
    console.log('[verify] không có element nào khớp bộ lọc.');
    return 0;
  }

  const artifactsDir = path.join(cfg.paths.runs, 'verify-artifacts');
  await mkdir(artifactsDir, { recursive: true });
  const { WebUiDriver } = await import('../drivers/web.js');
  const driver = new WebUiDriver({
    baseUrl: cfg.web.baseUrl,
    headless: !args.headed,
    device: cfg.web.device,
    record: false,
    ...(cfg.web.popups ? { popups: cfg.web.popups } : {}),
    ...(cfg.web.network ? { network: cfg.web.network } : {}),
    // Reuse the verified local session so this does not re-authenticate for a
    // read-only check.
    persistAuthSessions: true,
    artifactsDir,
  } as never);

  const resolver = new Resolver(driver, registry, {
    ...DEFAULT_RESOLVE,
    timeoutMs: cfg.resolve.timeoutMs,
    pollMs: cfg.resolve.pollMs,
  });
  const secrets = await Secrets.load();
  const executor = new Executor(driver, resolver, {
    retries: 0,
    verifyInput: false,
    screenshotOnFailure: false,
    variables: accountVariables(cfg.accounts, secrets, alias),
  });

  await driver.start();
  try {
    // Getting to the screen is setup, and it should not depend on somebody
    // else's scenario. Borrowing one first meant running its whole body —
    // adding a ticker, opening a row menu — and the check died on an overlay
    // that had nothing to do with any locator. A Background alone is no better:
    // the one tried before stops at the login page, so every price-board
    // locator was measured against the wrong screen and reported 0/32.
    //
    // So the navigation is written here, in the same vocabulary a feature uses,
    // and nothing else runs.
    const gherkin = [
      'Feature: verify',
      '',
      '  Scenario: reach',
      '    Given I open the app',
      `    And I am logged in as "${args.account}"`,
      `    And I open feature "${args.reach}" from search`,
      '',
    ].join('\n');
    const feature = parseFeature('verify.feature', gherkin, registry);
    console.log(`[verify] mở "${args.reach}" bằng tài khoản "${args.account}"…`);
    // beginScenario creates the page; endScenario would close it, so it is
    // deliberately never called here.
    await driver.beginScenario?.('verify');
    const steps = [...feature.background, ...feature.scenarios[0]!.steps];
    const results = await executor.runStepsWithoutTeardown(steps, 'verify');
    const failed = results.find((step) => step.status === 'failed');
    if (failed) {
      console.error(`[verify] không tới được màn hình: ${failed.error?.message ?? '?'}`);
      return 1;
    }

    // Where the check actually happened. Two earlier versions of this command
    // reported a confident 0/32 while sitting on the wrong page, so the page it
    // measured is part of the result, not a debug aside.
    const where = await driver.currentUrl?.().catch(() => undefined);
    console.log(`[verify] đang ở: ${where ?? '(driver không báo URL)'}`);

    let hit = 0;
    const misses: ElementDef[] = [];
    for (const element of wanted) {
      const found = await resolver
        .isVisibleNow(element.id, { timeoutMs: 1_500 })
        .catch(() => false);
      if (found) hit += 1; else misses.push(element);
      const tried = registry.candidates(element.id, 'web')
        .map((candidate) => `${candidate.strategy}=${candidate.value}`)
        .join(' | ') || '(không có ứng viên nào)';
      console.log(`  ${found ? '✓' : '✗'} ${String(element.label).slice(0, 30).padEnd(31)}`
        + `${(element.provenance ?? '—').padEnd(11)} ${tried.slice(0, 70)}`);
    }

    console.log(`\n[verify] ${hit}/${wanted.length} locator tìm được trên UI thật.`);
    if (misses.length > 0) {
      console.log('[verify] không tìm được — có thể do element chỉ xuất hiện sau một thao tác, '
        + 'hoặc locator sai:');
      for (const element of misses.slice(0, 20)) {
        console.log(`  · ${element.label} (${element.id})`);
      }
    }
    console.log('[verify] chỉ đọc — registry không bị thay đổi.');
    return 0;
  } finally {
    await driver.stop().catch(() => {});
  }
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const reach = get('--reach');
  if (!reach) throw new Error('Thiếu --reach "<tên chức năng>", ví dụ --reach "Bảng giá cổ phiếu"');
  return {
    reach,
    account: get('--account') ?? 'tcbs',
    ...(get('--screen') ? { screen: get('--screen')! } : {}),
    ...(get('--provenance') ? { provenance: get('--provenance') as ElementDef['provenance'] } : {}),
    headed: argv.includes('--headed'),
  };
}

const invokedDirectly = process.argv[1]?.endsWith('locators-verify.ts')
  || process.argv[1]?.endsWith('locators-verify.js');
if (invokedDirectly) {
  verifyLocators(parseArgs(process.argv.slice(2)))
    .then((code) => process.exit(code))
    .catch((err: Error) => {
      console.error(`[verify] ${err.message}`);
      process.exit(1);
    });
}
