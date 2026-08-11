/**
 * McpClient implementation backed by a live UiDriver.
 *
 * Converts UiDriver.observe() (Observed[]) into the McpInspectionResult shape
 * that AppiumMcpElementDiscovery.inspect() expects.  This bridges the runtime
 * path: Resolver → ElementDiscovery → AppiumMcpElementDiscovery → DriverMcpClient
 * → UiDriver → device/browser.
 *
 * findElement() intentionally returns an empty object — the deterministic
 * matching pipeline in ElementDiscovery handles element selection; the AI-powered
 * findElement() path in AiAugmentedDiscovery is separate and not wired here.
 *
 * screenshot() reads the file produced by UiDriver.screenshot() and encodes it
 * to base64, which is what McpClient callers expect.
 */

import { readFile } from 'node:fs/promises';
import type { UiDriver } from '../../drivers/driver.js';
import type { McpClient } from '../ai/AiDiscoveryTypes.js';
import { NotImplementedError } from './AppiumMcpErrors.js';

export class DriverMcpClient implements McpClient {
  private screenshotIndex = 0;

  constructor(private readonly driver: UiDriver) {}

  async inspect(): Promise<unknown> {
    const observed = this.driver.observe ? await this.driver.observe() : [];
    return {
      platform: this.driver.platform,
      elements: observed.map((o) => ({
        type: o.role,
        text: o.text,
        name: o.name,
        testId: o.testId,
        resourceId: o.resourceId,
        // Observed[] only contains visible elements (driver filters them).
        visible: true,
        enabled: true,
        interactable: o.interactive,
      })),
    };
  }

  findElement(_description: string): never {
    throw new NotImplementedError('DriverMcpClient.findElement');
  }

  async screenshot(): Promise<string> {
    const filePath = await this.driver.screenshot(
      `mcp-discovery-${++this.screenshotIndex}`,
    );
    const buf = await readFile(filePath);
    return buf.toString('base64');
  }
}
