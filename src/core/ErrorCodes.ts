/**
 * Structured runtime error codes — review v6 §32-33.
 *
 * All recoverable failure modes in the element resolution + execution pipeline
 * are identified by a code. Diagnosis consumes these codes to select a recovery
 * action (re-observe, rediscover, escalate, stop) instead of each component
 * inventing its own retry behaviour.
 *
 * Recovery mapping (§33):
 *   ELEMENT_STALE             → re-observe
 *   ELEMENT_NOT_FOUND         → discovery
 *   ELEMENT_AMBIGUOUS         → semantic/vision escalation
 *   ELEMENT_SAFETY_UNKNOWN    → re-observe
 *   RUNTIME_SESSION_MISMATCH  → stop
 *   ACTION_NOT_SAFE           → stop
 *   PROVIDER_ELEMENT_NOT_FOUND→ re-observe
 */

export const TestPilotErrorCode = {
  // ── element resolution ─────────────────────────────────────────────────────
  ELEMENT_NOT_FOUND: 'ELEMENT_NOT_FOUND',
  ELEMENT_AMBIGUOUS: 'ELEMENT_AMBIGUOUS',
  ELEMENT_LOW_CONFIDENCE: 'ELEMENT_LOW_CONFIDENCE',
  ELEMENT_VERIFICATION_FAILED: 'ELEMENT_VERIFICATION_FAILED',
  ELEMENT_SAFETY_UNKNOWN: 'ELEMENT_SAFETY_UNKNOWN',
  ELEMENT_STALE: 'ELEMENT_STALE',

  // ── provider identity ──────────────────────────────────────────────────────
  PROVIDER_ELEMENT_NOT_FOUND: 'PROVIDER_ELEMENT_NOT_FOUND',
  PROVIDER_ID_MISMATCH: 'PROVIDER_ID_MISMATCH',

  // ── session / context ──────────────────────────────────────────────────────
  RUNTIME_SESSION_MISMATCH: 'RUNTIME_SESSION_MISMATCH',
  RUNTIME_CONTEXT_MISMATCH: 'RUNTIME_CONTEXT_MISMATCH',

  // ── safety ─────────────────────────────────────────────────────────────────
  ACTION_NOT_SAFE: 'ACTION_NOT_SAFE',

  // ── healing ────────────────────────────────────────────────────────────────
  HEALING_REJECTED: 'HEALING_REJECTED',

  // ── budget ────────────────────────────────────────────────────────────────
  DISCOVERY_BUDGET_EXCEEDED: 'DISCOVERY_BUDGET_EXCEEDED',
} as const;

export type TestPilotErrorCode = (typeof TestPilotErrorCode)[keyof typeof TestPilotErrorCode];

/**
 * Typed runtime error. Carries a structured code so Diagnosis can route
 * recovery without string-matching the message.
 */
export class TestPilotError extends Error {
  readonly code: TestPilotErrorCode;
  readonly context?: Record<string, unknown>;

  constructor(
    code: TestPilotErrorCode,
    message: string,
    context?: Record<string, unknown>,
  ) {
    super(`[${code}] ${message}`);
    this.name = 'TestPilotError';
    this.code = code;
    this.context = context;
  }
}

/**
 * Narrow an unknown thrown value to TestPilotError.
 */
export function isTestPilotError(err: unknown): err is TestPilotError {
  return err instanceof TestPilotError;
}

/**
 * Extract a TestPilotErrorCode from any error, or return undefined.
 */
export function extractErrorCode(err: unknown): TestPilotErrorCode | undefined {
  if (isTestPilotError(err)) return err.code;
  return undefined;
}
