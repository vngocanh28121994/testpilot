import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { applyEnv, deviceById, loadConfig } from '../config.js';
import { Secrets, accountVariables } from '../core/secrets.js';
import type { Platform } from '../core/types.js';
import type { DeviceSpec } from '../config.js';
import type { UiDriver } from '../drivers/driver.js';
import { Registry } from '../core/registry.js';
import { Resolver, DEFAULT_RESOLVE } from '../runtime/resolver.js';
import { RuntimeRegistry } from '../discovery/RuntimeRegistry.js';
import { ElementDiscovery } from '../discovery/ElementDiscovery.js';
import { AppiumMcpElementDiscovery } from '../discovery/mcp/AppiumMcpElementDiscovery.js';
import { DriverMcpClient } from '../discovery/mcp/DriverMcpClient.js';
import { BasePage } from './BasePage.js';

export interface PomContextOptions {
  configPath?: string;
  defaultPlatform?: Platform;
  headed?: boolean;
}

/**
 * Creates the same resolver + discovery stack used by the CLI runner. Generated
 * POM tests therefore retain Playwright/CDP healing instead of becoming a
 * second, weaker execution path.
 */
export async function createPomPageContext(opts: PomContextOptions = {}): Promise<BasePage> {
  const baseCfg = await loadConfig(opts.configPath ?? 'testpilot.config.json');
  // Same precedence as the CLI runner, so a generated spec and `npm run run:*`
  // cannot end up on different environments or different accounts.
  const envName = process.env.TESTPILOT_ENV ?? baseCfg.defaultEnv;
  const { config: cfg, alias } = applyEnv(baseCfg, envName);
  const variables = accountVariables(cfg.accounts, await Secrets.load(), alias);
  const platform = (process.env.TESTPILOT_PLATFORM ?? opts.defaultPlatform ?? 'web') as Platform;
  const registry = await Registry.load(cfg.paths.registry);
  const runtimePath = path.join(path.dirname(cfg.paths.registry), 'runtime-registry.json');
  const runtimeRegistry = await RuntimeRegistry.load(runtimePath);
  const artifactsDir = process.env.TESTPILOT_ARTIFACTS ?? path.join(
    cfg.paths.artifacts,
    'pom',
    randomUUID().slice(0, 8),
  );
  await mkdir(artifactsDir, { recursive: true });

  // Named the same way the runner names it, and refused the same way when the
  // config has several handsets. Letting Appium pick silently meant a generated
  // spec ran on whichever phone `adb devices` happened to list first — passing
  // on one device while the one under test sat untouched.
  const device =
    platform === 'web'
      ? undefined
      : deviceById(cfg, platform, process.env.TESTPILOT_DEVICE, 'TESTPILOT_DEVICE');

  const driver = await createDriver(platform, cfg, artifactsDir, Boolean(opts.headed), device);
  await driver.start();

  const observation = new AppiumMcpElementDiscovery(new DriverMcpClient(driver));
  const discovery = new ElementDiscovery(observation, runtimeRegistry);
  const resolver = new Resolver(driver, registry, {
    ...DEFAULT_RESOLVE,
    timeoutMs: cfg.resolve.timeoutMs,
    pollMs: cfg.resolve.pollMs,
    verifyHealedMatch: cfg.resolve.verifyHealedMatch,
  }, discovery);

  return new BasePage(driver, resolver, registry, async () => {
    await driver.stop().catch(() => {});
    await runtimeRegistry.save();
    await registry.save();
  }, variables);
}

async function createDriver(
  platform: Platform,
  cfg: Awaited<ReturnType<typeof loadConfig>>,
  artifactsDir: string,
  headed: boolean,
  device?: DeviceSpec,
): Promise<UiDriver> {
  if (platform === 'web') {
    const { WebUiDriver } = await import('../drivers/web.js');
    const headless = headed ? false : cfg.web.headless;
    return new WebUiDriver({
      baseUrl: cfg.web.baseUrl,
      headless,
      ...(headless ? {} : { slowMoMs: cfg.web.slowMoMs }),
      device: cfg.web.device,
      record: cfg.web.record,
      ...(cfg.web.network ? { network: cfg.web.network } : {}),
      ...(cfg.web.popups ? { popups: cfg.web.popups } : {}),
      artifactsDir,
    });
  }

  const { NativeUiDriver } = await import('../drivers/native.js');
  const hostname = process.env.TESTPILOT_APPIUM_HOST ?? '127.0.0.1';
  const port = Number(process.env.TESTPILOT_APPIUM_PORT ?? 4723);
  const wdPath = process.env.TESTPILOT_APPIUM_PATH ?? '/';
  const onFarm = process.env.TESTPILOT_ON_FARM === '1';

  if (platform === 'android') {
    return new NativeUiDriver({
      platform,
      hostname,
      port,
      path: wdPath,
      deviceName: device?.deviceName ?? cfg.android.deviceName,
      ...(device?.udid ? { udid: device.udid, deviceSerial: device.udid } : {}),
      ...(device?.systemPort ? { systemPort: device.systemPort } : {}),
      ...(onFarm ? {} : cfg.android.app ? { app: cfg.android.app } : {}),
      ...(cfg.android.appPackage ? { appPackage: cfg.android.appPackage } : {}),
      ...(cfg.android.appActivity ? { appActivity: cfg.android.appActivity } : {}),
      hybrid: cfg.android.hybrid,
      isolation: cfg.android.isolation,
      ...(cfg.web.popups ? { popupRules: cfg.web.popups } : {}),
      artifactsDir,
    });
  }

  return new NativeUiDriver({
    platform: 'ios',
    hostname,
    port,
    path: wdPath,
    deviceName: device?.deviceName ?? cfg.ios.deviceName,
    ...(device?.udid ? { udid: device.udid } : {}),
    ...(device?.wdaLocalPort ? { wdaLocalPort: device.wdaLocalPort } : {}),
    ...(onFarm ? {} : cfg.ios.app ? { app: cfg.ios.app } : {}),
    ...(cfg.ios.bundleId ? { bundleId: cfg.ios.bundleId } : {}),
    hybrid: cfg.ios.hybrid,
    ...(cfg.web.popups ? { popupRules: cfg.web.popups } : {}),
    artifactsDir,
  });
}
