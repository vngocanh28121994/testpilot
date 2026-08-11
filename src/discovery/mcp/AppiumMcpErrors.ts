/**
 * Typed errors for the appium-mcp interaction layer.
 *
 * StaleElementError: a previously-resolved elementUUID is no longer valid.
 * NotImplementedError: a disabled code path was invoked.
 *
 * For "locator cannot resolve to an element" (appium_find_element fails),
 * use TestPilotError(PROVIDER_ELEMENT_NOT_FOUND) from core/ErrorCodes.ts.
 */

/**
 * Thrown when an elementUUID obtained from findByLocator() has become invalid
 * because the UI mutated between resolution and interaction.
 *
 * The UUID must be discarded.  The executor's retry cycle will re-resolve
 * and obtain a fresh UUID.
 */
export class StaleElementError extends Error {
  override readonly name = 'StaleElementError';

  constructor(
    readonly elementUUID: string,
    readonly strategy?: string,
    readonly value?: string,
  ) {
    super(
      `Stale element: UUID "${elementUUID}" is no longer valid after a UI mutation.` +
        (strategy && value ? ` Locator: ${strategy}="${value}".` : ''),
    );
  }
}

/**
 * Thrown by methods that are architecturally disabled.
 *
 * The AI/semantic findElement() path is disabled for appium-mcp.
 * All element discovery must go through observe() → DeterministicMatcher.
 */
export class NotImplementedError extends Error {
  override readonly name = 'NotImplementedError';

  constructor(methodName: string) {
    super(
      `${methodName} is not implemented — use the observe() path for element discovery.`,
    );
  }
}
