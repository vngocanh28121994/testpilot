/**
 * Session identity — G03 (review v5).
 *
 * Proves that the MCP observation and the driver interaction belong to the
 * SAME device/Appium session. Without this, the system could observe one
 * device and act on another — making the agent appear to work while actually
 * clicking a completely different UI.
 *
 * Required proof for every production run:
 *   AWS run ARN + device identity + Appium session + MCP session
 *   → all must match before an action is executed.
 *
 * Identity is captured at session start and attached to UiObservation.context.
 */

// ── identity types ────────────────────────────────────────────────────────────

export type SessionProvider = 'appium-mcp' | 'appium' | 'playwright' | 'local';

export interface SessionIdentity {
  provider: SessionProvider;
  /** Appium WebDriver session ID (UUID). */
  appiumSessionId?: string;
  /** Device UDID / serial / ARN as reported by the provider. */
  deviceId?: string;
  /** MCP connection session or client ID. */
  mcpSessionId?: string;
  /** AWS Device Farm run ARN — binds this session to a specific AWS run. */
  awsRunArn?: string;
  /** When this identity snapshot was captured. */
  capturedAt: string;
}

// ── validator ─────────────────────────────────────────────────────────────────

export type SessionValidationOutcome = 'VALID' | 'MISMATCH' | 'UNVERIFIABLE';

export interface SessionValidationResult {
  outcome: SessionValidationOutcome;
  reason: string;
  /** Which fields were compared. */
  checkedFields: string[];
  /** Which fields had mismatches (empty when VALID). */
  mismatchedFields: string[];
}

/**
 * Validate that an observation's session identity matches the executor's
 * session identity.
 *
 * Rules:
 *   - If both have appiumSessionId → they must match.
 *   - If both have deviceId        → they must match.
 *   - If both have awsRunArn       → they must match.
 *   - If no comparable fields exist → UNVERIFIABLE (warn, do not block).
 */
export function validateSessionIdentity(
  observation: Partial<SessionIdentity>,
  executor: Partial<SessionIdentity>,
): SessionValidationResult {
  const checked: string[] = [];
  const mismatched: string[] = [];

  function check(field: keyof SessionIdentity): void {
    const obsVal = observation[field];
    const exeVal = executor[field];
    if (obsVal == null || exeVal == null) return;
    checked.push(field);
    if (obsVal !== exeVal) mismatched.push(field);
  }

  check('appiumSessionId');
  check('deviceId');
  check('awsRunArn');
  check('mcpSessionId');

  if (checked.length === 0) {
    return {
      outcome: 'UNVERIFIABLE',
      reason:
        'No common identity fields available — cannot prove observation and execution ' +
        'share the same device/session. Attach appiumSessionId or deviceId to enable verification.',
      checkedFields: [],
      mismatchedFields: [],
    };
  }

  if (mismatched.length > 0) {
    return {
      outcome: 'MISMATCH',
      reason:
        `Session identity mismatch on field(s): ${mismatched.join(', ')}. ` +
        `Observation may belong to a different device or Appium session than the executor.`,
      checkedFields: checked,
      mismatchedFields: mismatched,
    };
  }

  return {
    outcome: 'VALID',
    reason: `Session identity verified on: ${checked.join(', ')}`,
    checkedFields: checked,
    mismatchedFields: [],
  };
}

/**
 * Build a session identity record from the information available at startup.
 * Attach to the MCP adapter and the executor so they can be compared later.
 */
export function makeSessionIdentity(
  opts: Omit<SessionIdentity, 'capturedAt'>,
): SessionIdentity {
  return { ...opts, capturedAt: new Date().toISOString() };
}
