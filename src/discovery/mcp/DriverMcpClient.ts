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
import type { Observed } from '../../crawl/observe.js';
import type { UiDriver } from '../../drivers/driver.js';
import type { McpClient } from '../ai/AiDiscoveryTypes.js';
import { NotImplementedError } from './AppiumMcpErrors.js';
import { mergeAccessibilityObservations } from './PlaywrightMcpObserver.js';

export class DriverMcpClient implements McpClient {
  private screenshotIndex = 0;
  private accessibilityInFlight?: Promise<Observed[]>;

  constructor(private readonly driver: UiDriver) {}

  async inspect(): Promise<unknown> {
    const dom = this.driver.observe ? await this.driver.observe() : [];
    let observed = dom;
    if (this.driver.platform === 'web' && this.driver.observeAccessibility) {
      try {
        // DOM is authoritative for WebView/browser interaction and normally
        // answers in milliseconds. MCP accessibility is supporting evidence;
        // it must never make the resolver miss its 2-second discovery budget.
        // Reuse an unfinished snapshot rather than piling concurrent MCP calls
        // onto the same page when the first one is slow.
        const accessibility = await this.accessibilityWithin(700);
        if (!accessibility) return this.inspectionResult(dom);
        observed = mergeAccessibilityObservations(
          dom,
          accessibility,
        );
      } catch (err) {
        // Optional enrichment only: direct DOM/native discovery must continue.
        console.warn(`[discovery:mcp] snapshot skipped: ${(err as Error).message}`);
      }
    }
    return this.inspectionResult(observed);
  }

  private inspectionResult(observed: Observed[]): unknown {
    return {
      platform: this.driver.platform,
      elements: observed.map((o) => ({
        type: o.role,
        text: o.text,
        name: o.name,
        placeholder: o.placeholder,
        testId: o.testId,
        resourceId: o.resourceId,
        css: o.css,
        attributes: o.context?.length ? { region: o.context.join(' > ') } : undefined,
        // Observed[] only contains visible elements (driver filters them).
        visible: true,
        enabled: true,
        interactable: o.interactive,
      })),
    };
  }

  private async accessibilityWithin(ms: number): Promise<Observed[] | undefined> {
    const observe = this.driver.observeAccessibility;
    if (!observe) return undefined;
    let work = this.accessibilityInFlight;
    if (!work) {
      work = observe.call(this.driver);
      this.accessibilityInFlight = work;
      void work.finally(() => {
        if (this.accessibilityInFlight === work) this.accessibilityInFlight = undefined;
      }).catch(() => {});
    }
    const TIMEOUT = Symbol('accessibility-timeout');
    const result = await Promise.race([
      work,
      new Promise<typeof TIMEOUT>((resolve) => setTimeout(() => resolve(TIMEOUT), ms)),
    ]);
    return result === TIMEOUT ? undefined : result;
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
