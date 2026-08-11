import type { NormalizedFailure, FailureCategory } from './ExecutionTypes.js';
import { ElementNotFoundError } from '../runtime/resolver.js';

export interface NormalizationContext {
  stepId?: string;
  screen?: string;
  elementId?: string;
  evidenceRefs?: string[];
}

/**
 * Maps raw errors from any layer (driver, resolver, assertion, network) into a
 * uniform NormalizedFailure.
 *
 * Rule order matters: more specific patterns must appear before generic ones.
 * AI is never called here — deterministic rules handle everything; the AI
 * diagnosis agent handles residual UNKNOWN failures upstream.
 */
export class FailureNormalizer {
  normalize(err: unknown, ctx: NormalizationContext = {}): NormalizedFailure {
    const error = toError(err);
    const { category, code, transient } = classify(error);
    const signature = buildSignature(category, ctx);

    return {
      category,
      code,
      message: error.message,
      stepId: ctx.stepId,
      evidenceRefs: ctx.evidenceRefs ?? [],
      signature,
      ...(transient !== undefined ? { transient } : {}),
      confidence: classificationConfidence(category, error),
    };
  }
}

// ── classification ────────────────────────────────────────────────────────────

interface Classification {
  category: FailureCategory;
  code: string;
  transient?: boolean;
}

function classify(err: Error): Classification {
  const msg = err.message.toLowerCase();

  // ElementNotFoundError from resolver — highest specificity
  if (err instanceof ElementNotFoundError || err.name === 'ElementNotFoundError') {
    return { category: 'LOCATOR_FAILURE', code: 'ELEMENT_NOT_FOUND' };
  }

  // App crash (check before timeout — some crash messages contain "wait")
  if (
    msg.includes('app not running') ||
    msg.includes('process died') ||
    msg.includes(' anr') ||
    msg.includes('application crash') ||
    (msg.includes('crash') && !msg.includes('crashlytics'))
  ) {
    return { category: 'APP_CRASH', code: 'APP_CRASH' };
  }

  // Driver / session unavailable
  if (
    msg.includes('driver offline') ||
    msg.includes('session not created') ||
    msg.includes('no such session') ||
    msg.includes('invalid session id') ||
    msg.includes('session deleted')
  ) {
    return { category: 'ENVIRONMENT_UNAVAILABLE', code: 'DRIVER_OFFLINE' };
  }

  // Network errors (check before timeout — connection refused is not a timeout)
  if (
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('fetch failed') ||
    (msg.includes('network') && msg.includes('error')) ||
    msg.includes('connection refused') ||
    msg.includes('socket hang up')
  ) {
    return { category: 'NETWORK', code: 'NETWORK_ERROR', transient: true };
  }

  // Timeout — transient only when it is not a navigation/page-load timeout
  if (
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    (msg.includes('wait') && msg.includes('exceed'))
  ) {
    const transient = !msg.includes('navigation') && !msg.includes('page load');
    return { category: 'TIMEOUT', code: 'TIMEOUT', transient };
  }

  // Assertion mismatch — comes from AssertionError or our assertText step
  if (
    err.name === 'AssertionError' ||
    msg.includes('assertion failed') ||
    msg.includes('text assertion') ||
    // "expected … got …" pattern from executor.ts
    (msg.includes('expected') && msg.includes('got '))
  ) {
    return { category: 'ASSERTION_MISMATCH', code: 'ASSERTION_FAILED' };
  }

  // Input verification failure from executor.ts verifyInput()
  if (msg.includes('ô nhập không nhận đúng giá trị') || msg.includes('field did not accept')) {
    return { category: 'ASSERTION_MISMATCH', code: 'INPUT_VERIFY_FAILED' };
  }

  return { category: 'UNKNOWN', code: 'UNKNOWN_ERROR' };
}

// ── signature ─────────────────────────────────────────────────────────────────

/**
 * Builds a stable signature that survives across builds and stack depths.
 * Hash of a full stack trace would differ per build; this is intentionally
 * structural: same failure type + same location = same signature.
 */
function buildSignature(category: FailureCategory, ctx: NormalizationContext): string {
  const parts: string[] = [category];
  if (ctx.screen) parts.push(`screen=${ctx.screen}`);
  if (ctx.elementId) parts.push(`intent=${ctx.elementId}`);
  return parts.join(':');
}

// ── helpers ───────────────────────────────────────────────────────────────────

function classificationConfidence(category: FailureCategory, err: Error): number {
  if (err instanceof ElementNotFoundError) return 1.0;
  if (err.name === 'AssertionError') return 0.95;
  if (category === 'UNKNOWN') return 0.3;
  if (category === 'ENVIRONMENT_UNAVAILABLE') return 0.9;
  return 0.8;
}

function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(String(err));
}
