/**
 * Cost / runtime budget guardrail — item 42 (plan §66).
 *
 * Estimates device-minutes before submission:
 *   devices × expected_duration_minutes × retry_multiplier
 *
 * Actions when over budget:
 *   BLOCK  — hard stop, do not submit
 *   APPROVE — pause and request human approval
 *   ALLOW   — within budget, proceed
 *
 * Prevents agents from silently expanding the device matrix (plan §66).
 */

// ── budget types ──────────────────────────────────────────────────────────────

export interface CostBudget {
  /** Maximum device-minutes allowed per agent run. */
  maxDeviceMinutes: number;
  /**
   * When estimated cost exceeds `warningThreshold × maxDeviceMinutes`,
   * the action is APPROVE instead of ALLOW — human review required.
   */
  warningThreshold: number;
  /** Per-run ceiling regardless of device count (additional guardrail). */
  maxDevicesPerRun: number;
  /** Per-device ceiling on expected test duration. */
  maxMinutesPerDevice: number;
}

export const DEFAULT_COST_BUDGET: CostBudget = {
  maxDeviceMinutes: 150,
  warningThreshold: 0.8,
  maxDevicesPerRun: 6,
  maxMinutesPerDevice: 30,
};

export interface CostEstimate {
  deviceCount: number;
  expectedDurationMinutes: number;
  retryMultiplier: number;
  /** deviceCount × expectedDurationMinutes × retryMultiplier */
  estimatedDeviceMinutes: number;
  /** Fraction of the budget consumed: 0..1+ */
  budgetFraction: number;
}

export type BudgetAction = 'ALLOW' | 'APPROVE' | 'BLOCK';

export interface BudgetCheckResult {
  action: BudgetAction;
  estimate: CostEstimate;
  reason: string;
}

// ── estimator & check ─────────────────────────────────────────────────────────

/**
 * Estimate the cost of a planned run and determine the budget action.
 *
 * @param deviceCount             Number of devices selected.
 * @param expectedDurationMinutes Estimated test duration on a single device.
 * @param retryMultiplier         Factor for retries (e.g. 1.5 = one retry at half cost).
 * @param budget                  Budget config (defaults to DEFAULT_COST_BUDGET).
 */
export function checkBudget(
  deviceCount: number,
  expectedDurationMinutes: number,
  retryMultiplier = 1.0,
  budget: CostBudget = DEFAULT_COST_BUDGET,
): BudgetCheckResult {
  const estimate: CostEstimate = {
    deviceCount,
    expectedDurationMinutes,
    retryMultiplier,
    estimatedDeviceMinutes: deviceCount * expectedDurationMinutes * retryMultiplier,
    budgetFraction: 0,
  };
  estimate.budgetFraction = estimate.estimatedDeviceMinutes / budget.maxDeviceMinutes;

  // Hard cap: too many devices
  if (deviceCount > budget.maxDevicesPerRun) {
    return {
      action: 'BLOCK',
      estimate,
      reason:
        `Device count ${deviceCount} exceeds maxDevicesPerRun=${budget.maxDevicesPerRun}. ` +
        `Reduce device matrix or increase the budget.`,
    };
  }

  // Hard cap: per-device duration
  if (expectedDurationMinutes > budget.maxMinutesPerDevice) {
    return {
      action: 'BLOCK',
      estimate,
      reason:
        `Expected duration ${expectedDurationMinutes}min exceeds maxMinutesPerDevice=${budget.maxMinutesPerDevice}. ` +
        `Split the test or extend the per-device limit.`,
    };
  }

  // Over budget
  if (estimate.estimatedDeviceMinutes > budget.maxDeviceMinutes) {
    return {
      action: 'BLOCK',
      estimate,
      reason:
        `Estimated ${estimate.estimatedDeviceMinutes.toFixed(1)} device-minutes exceeds ` +
        `budget of ${budget.maxDeviceMinutes}. Reduce devices, duration, or retry multiplier.`,
    };
  }

  // Warning zone — request human approval
  if (estimate.budgetFraction >= budget.warningThreshold) {
    return {
      action: 'APPROVE',
      estimate,
      reason:
        `Estimated ${estimate.estimatedDeviceMinutes.toFixed(1)} device-minutes is ` +
        `${Math.round(estimate.budgetFraction * 100)}% of the ${budget.maxDeviceMinutes}-minute budget. ` +
        `Human approval required before submission.`,
    };
  }

  return {
    action: 'ALLOW',
    estimate,
    reason:
      `Estimated ${estimate.estimatedDeviceMinutes.toFixed(1)} device-minutes ` +
      `(${Math.round(estimate.budgetFraction * 100)}% of ${budget.maxDeviceMinutes}-minute budget).`,
  };
}

/**
 * Convenience: check whether adding one more device stays within budget.
 * Use before expanding the device matrix dynamically.
 */
export function canAddDevice(
  currentDeviceCount: number,
  expectedDurationMinutes: number,
  retryMultiplier = 1.0,
  budget: CostBudget = DEFAULT_COST_BUDGET,
): boolean {
  const result = checkBudget(
    currentDeviceCount + 1,
    expectedDurationMinutes,
    retryMultiplier,
    budget,
  );
  return result.action === 'ALLOW';
}

/** Human-readable budget summary for agent event logs. */
export function formatBudgetCheck(result: BudgetCheckResult): string {
  const e = result.estimate;
  return (
    `[${result.action}] ${e.deviceCount} device(s) × ${e.expectedDurationMinutes}min × ` +
    `${e.retryMultiplier}× retry = ${e.estimatedDeviceMinutes.toFixed(1)} device-minutes ` +
    `(${Math.round(e.budgetFraction * 100)}% of budget). ${result.reason}`
  );
}
