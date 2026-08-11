/**
 * Ambiguity model and gate — item 31 (plan §54).
 *
 * When the source documents contradict each other, the agent must NOT
 * resolve the conflict autonomously. It creates an Ambiguity record and,
 * if blocking=true, transitions to NEEDS_HUMAN_APPROVAL.
 */

import type { SourceReference } from './SourceReference.js';

// ── type ──────────────────────────────────────────────────────────────────────

export interface Ambiguity {
  id: string;
  /** Human-readable description of the contradiction or gap. */
  description: string;
  /**
   * The source locations that disagree with each other.
   * Requires at least two refs when it is a genuine contradiction.
   */
  sourceRefs: SourceReference[];
  severity: 'low' | 'medium' | 'high';
  /**
   * When true the agent must stop and wait for human input.
   * high severity → blocking by default; low/medium may proceed with caveats.
   */
  blocking: boolean;
  /** Each plausible reading of the ambiguous clause. */
  proposedInterpretations: string[];
  /** Resolution chosen by a human reviewer (populated post-approval). */
  resolution?: string;
  resolvedBy?: string;
  resolvedAt?: string;
}

// ── gate ──────────────────────────────────────────────────────────────────────

export interface AmbiguityGateResult {
  /** True when any ambiguity has blocking=true. */
  blocked: boolean;
  blockingAmbiguities: Ambiguity[];
  nonBlockingAmbiguities: Ambiguity[];
  /** Summary line for the agent event log. */
  summary: string;
}

/**
 * Checks whether a set of ambiguities should stop the pipeline.
 *
 * Rule (plan §54):
 *   blocking ambiguity → NEEDS_HUMAN_APPROVAL
 *
 * Callers should transition the AgentStateMachine to NEEDS_HUMAN_APPROVAL
 * when `result.blocked` is true.
 */
export function runAmbiguityGate(ambiguities: Ambiguity[]): AmbiguityGateResult {
  const blockingAmbiguities = ambiguities.filter((a) => a.blocking);
  const nonBlockingAmbiguities = ambiguities.filter((a) => !a.blocking);
  const blocked = blockingAmbiguities.length > 0;

  const summary = blocked
    ? `BLOCKED — ${blockingAmbiguities.length} blocking ambiguit${blockingAmbiguities.length === 1 ? 'y' : 'ies'} require human resolution`
    : nonBlockingAmbiguities.length > 0
      ? `OK — ${nonBlockingAmbiguities.length} non-blocking ambiguit${nonBlockingAmbiguities.length === 1 ? 'y' : 'ies'} noted`
      : 'OK — no ambiguities detected';

  return { blocked, blockingAmbiguities, nonBlockingAmbiguities, summary };
}

// ── factory helpers ───────────────────────────────────────────────────────────

let _counter = 0;
function nextId(): string {
  return `AMB-${String(++_counter).padStart(3, '0')}`;
}

export function makeAmbiguity(
  description: string,
  sourceRefs: SourceReference[],
  severity: Ambiguity['severity'],
  proposedInterpretations: string[],
  id?: string,
): Ambiguity {
  return {
    id: id ?? nextId(),
    description,
    sourceRefs,
    severity,
    blocking: severity === 'high',
    proposedInterpretations,
  };
}
