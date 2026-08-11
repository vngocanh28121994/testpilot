import type { NormalizedFailure } from './ExecutionTypes.js';
import type { HealingDecision } from './HealingTypes.js';

/**
 * Per-failure-category healing policy.
 *
 * Maps a NormalizedFailure to a HealingDecision — what the orchestrator
 * is permitted to do for that failure class.
 *
 * Source: plan section 71 (Healing Policy Matrix):
 *
 * | Failure                | Discover | AI      | Retry | Auto-heal        |
 * |------------------------|----------|---------|-------|------------------|
 * | old locator missing    | Yes      | fallback| 1     | Yes              |
 * | duplicate element      | Yes      | Maybe   | 1     | Yes if verified  |
 * | app crash              | No       | No      | Policy| No               |
 * | assertion mismatch     | No       | diagnosis| No   | No               |
 * | network timeout        | No       | No      | Policy| No               |
 * | product defect         | No       | diagnosis| No   | No               |
 * | environment unavailable| No       | No      | Policy| No               |
 * | unknown                | Yes      | Maybe   | 1     | No               |
 */
export class HealingPolicy {
  decide(failure: NormalizedFailure): HealingDecision {
    switch (failure.category) {
      case 'LOCATOR_FAILURE':
        return {
          shouldDiscover: true,
          shouldTryAi: true,  // AI as fallback after deterministic miss
          canAutoHeal: true,
          maxAttempts: 2,
          reason: 'Locator failure — discovery will observe live UI and attempt to find the element',
        };

      case 'TIMEOUT':
        if (failure.transient) {
          return {
            shouldDiscover: false,
            shouldTryAi: false,
            canAutoHeal: false,
            maxAttempts: 3,
            reason: 'Transient timeout — no healing, but retry is permitted',
          };
        }
        return NO_HEAL(
          'Non-transient timeout (navigation/page-load) — healing would not help; fix the test or the app',
        );

      case 'NETWORK':
        return {
          shouldDiscover: false,
          shouldTryAi: false,
          canAutoHeal: false,
          maxAttempts: 3,
          reason: 'Network error — no healing; retry after a pause per network policy',
        };

      case 'ASSERTION_MISMATCH':
        return NO_HEAL(
          'Assertion mismatch — indicates wrong application data; healing the locator cannot fix this',
        );

      case 'PRODUCT_DEFECT':
        return NO_HEAL(
          'Product defect — healing is not appropriate; create a defect ticket',
        );

      case 'TEST_DATA':
        return NO_HEAL(
          'Test data issue — fix the data or the test; healing cannot resolve data problems',
        );

      case 'APP_CRASH':
        return NO_HEAL(
          'App crash — healing is unsafe without crash diagnosis; investigate root cause first',
        );

      case 'ENVIRONMENT_UNAVAILABLE':
        return NO_HEAL(
          'Environment unavailable — driver/session is gone; healing requires a live session',
        );

      case 'UNKNOWN':
        // Discover to gather evidence, but do NOT auto-heal without known cause
        return {
          shouldDiscover: true,
          shouldTryAi: true,
          canAutoHeal: false,
          maxAttempts: 2,
          reason: 'Unknown failure — discovery for evidence collection; auto-heal blocked pending diagnosis',
        };
    }
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function NO_HEAL(reason: string): HealingDecision {
  return {
    shouldDiscover: false,
    shouldTryAi: false,
    canAutoHeal: false,
    maxAttempts: 1,
    reason,
  };
}
