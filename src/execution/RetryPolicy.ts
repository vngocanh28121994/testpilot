import type { NormalizedFailure, FailureCategory } from './ExecutionTypes.js';

export interface RetryDecision {
  shouldRetry: boolean;
  /** Human-readable justification logged with the retry event. */
  reason: string;
  /** Maximum total attempts this category allows (including the first). */
  maxAttempts: number;
}

export interface PolicyConfig {
  /** Locator failures: discovery runs inside the resolver, so one retry is enough. */
  maxLocatorAttempts: number;
  /** Transient timeouts / waits. */
  maxTransientAttempts: number;
  /** Network-level errors. */
  maxNetworkAttempts: number;
}

export const DEFAULT_POLICY: PolicyConfig = {
  maxLocatorAttempts: 2,   // 1 original + 1 retry
  maxTransientAttempts: 3, // 1 original + 2 retries
  maxNetworkAttempts: 3,
};

/**
 * Decides whether a failed step should be retried.
 *
 * Key invariant: categories that indicate a real product defect or data
 * problem are NEVER retried — retrying would mask real failures and make
 * the suite less reliable, not more.
 *
 * The `attemptsSoFar` parameter counts all attempts already made (including
 * the one that just failed), so `attemptsSoFar === 1` means the first
 * attempt just failed.
 */
export class RetryPolicy {
  constructor(private readonly config: PolicyConfig = DEFAULT_POLICY) {}

  decide(failure: NormalizedFailure, attemptsSoFar: number): RetryDecision {
    switch (failure.category) {
      case 'LOCATOR_FAILURE':
        // The resolver's ElementDiscovery already fires once inside resolve();
        // this outer retry gives it a second chance after the full poll timeout.
        return this.maybeRetry(
          attemptsSoFar,
          this.config.maxLocatorAttempts,
          'Locator failure — element discovery will observe live UI on the next attempt',
        );

      case 'TIMEOUT':
        if (!failure.transient) {
          return NO_RETRY(
            'Non-transient timeout (navigation / page-load) — retrying is unlikely to help',
          );
        }
        return this.maybeRetry(
          attemptsSoFar,
          this.config.maxTransientAttempts,
          'Transient timeout — retrying after the UI has had time to settle',
        );

      case 'NETWORK':
        return this.maybeRetry(
          attemptsSoFar,
          this.config.maxNetworkAttempts,
          'Network error — classified transient; retrying per network policy',
        );

      case 'ASSERTION_MISMATCH':
        return NO_RETRY(
          'Assertion mismatch — the application returned wrong data; retrying would mask a real defect',
        );

      case 'PRODUCT_DEFECT':
        return NO_RETRY(
          'Product defect — do not retry; create a defect ticket instead',
        );

      case 'TEST_DATA':
        return NO_RETRY(
          'Test data issue — fix the data or the test; retrying the same data produces the same failure',
        );

      case 'APP_CRASH':
        return NO_RETRY(
          'App crash — retrying without diagnosis risks hiding a stability regression',
        );

      case 'ENVIRONMENT_UNAVAILABLE':
        return NO_RETRY(
          'Environment unavailable — the driver session is gone; retry would also fail',
        );

      case 'UNKNOWN':
        return NO_RETRY(
          'Unknown failure — collect and review evidence before deciding whether to retry',
        );
    }
  }

  private maybeRetry(
    attemptsSoFar: number,
    maxAttempts: number,
    reason: string,
  ): RetryDecision {
    return {
      shouldRetry: attemptsSoFar < maxAttempts,
      reason,
      maxAttempts,
    };
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function NO_RETRY(reason: string): RetryDecision {
  return { shouldRetry: false, reason, maxAttempts: 1 };
}

// Export for tests that need to inspect per-category limits.
export { DEFAULT_POLICY as DEFAULT_RETRY_POLICY };

// Re-export the category type so callers that only need retry logic don't
// also have to import ExecutionTypes.
export type { FailureCategory };
