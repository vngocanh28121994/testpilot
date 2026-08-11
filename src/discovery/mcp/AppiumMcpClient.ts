/**
 * AppiumMcpClient — implements McpClient using AppiumMcpSession.
 *
 * inspect(): calls session.getPageSource() and returns the raw XML/HTML string.
 *            The caller (AppiumMcpElementDiscovery.convertInspection) is responsible
 *            for parsing it via NativeObservationAdapter.
 *
 * findElement(): ALWAYS throws NotImplementedError.
 *               The AI/semantic findElement path is DISABLED for appium-mcp.
 *               All discovery must go through observe() → DeterministicMatcher.
 *               findByLocator() in AppiumMcpSession is the ONLY method allowed
 *               to call appium_find_element, and only for executing an approved locator.
 *
 * screenshot(): delegates to session.screenshot().
 */

import type { McpClient } from '../ai/AiDiscoveryTypes.js';
import type { AppiumMcpSession } from './AppiumMcpSession.js';
import { NotImplementedError } from './AppiumMcpErrors.js';

export class AppiumMcpClient implements McpClient {
  constructor(private readonly session: AppiumMcpSession) {}

  /**
   * Fetches the current page source.
   * Returns a raw XML (NATIVE_APP) or HTML (WEBVIEW) string — NOT a McpInspectionResult.
   * AppiumMcpElementDiscovery.convertInspection() detects the string type and routes
   * it through NativeObservationAdapter.parseNativeObservation().
   */
  async inspect(): Promise<unknown> {
    return this.session.getPageSource();
  }

  /**
   * NOT IMPLEMENTED — AI/semantic findElement is disabled for appium-mcp.
   *
   * Discovery must use the observe() → DeterministicMatcher → G05 → G06 → G04 path.
   * appium_find_element is accessible only via AppiumMcpSession.findByLocator() after
   * a locator has been approved by the discovery pipeline.
   */
  findElement(_description: string): never {
    throw new NotImplementedError('AppiumMcpClient.findElement');
  }

  async screenshot(): Promise<string> {
    return this.session.screenshot();
  }
}
