/**
 * Observation freshness — G15 / review v6 §30-31 (Phase 7).
 *
 * A UiObservation is a snapshot. After a UI-changing action (tap, input, scroll,
 * navigation, dialog, keyboard, WebView reload) the snapshot may be stale.
 *
 * ObservationToken is a lightweight value that identifies an observation and
 * lets callers detect staleness without re-running a full inspect():
 *
 *   token.hierarchyHash  — changes when any element is added/removed/changed
 *   token.contextHash    — changes when app context switches (screen, activity)
 *   isObservationStale() — age-based freshness check
 *   isHierarchyChanged() — content-based freshness check
 *
 * After every UI-changing action, invalidate the current token. The next access
 * to the observation MUST either re-observe or prove the token is still valid.
 *
 * Actions that MUST invalidate the token:
 *   tap, input, scroll, swipe, navigation, dialog open/close,
 *   keyboard show/hide, context switch, WebView reload
 */

import { createHash } from 'node:crypto';
import type { UiObservation } from './UiObservation.js';

export interface ObservationToken {
  /** ID of the observation this token was created from. */
  observationId: string;
  /** Session ID binding the observation to a specific runtime session. */
  sessionId: string;
  /** ISO timestamp when the observation was taken. */
  createdAt: string;
  /** SHA-256 (12 hex) of the observation context (screen/activity/bundle). */
  contextHash?: string;
  /** SHA-256 (12 hex) of the element hierarchy (id:role:text:visible per element). */
  hierarchyHash?: string;
}

/**
 * Create an ObservationToken from a fresh UiObservation.
 *
 * @param obs       The observation to snapshot.
 * @param sessionId The runtime session this observation belongs to.
 */
export function makeObservationToken(obs: UiObservation, sessionId: string): ObservationToken {
  return {
    observationId: obs.id,
    sessionId,
    createdAt: obs.timestamp,
    contextHash: hashJson(obs.context),
    hierarchyHash: hashHierarchy(obs.elements),
  };
}

/**
 * Returns true when the token is older than `maxAgeMs` (default: 30 s).
 * Time-based staleness — use when the app may have changed asynchronously.
 */
export function isObservationStale(token: ObservationToken, maxAgeMs = 30_000): boolean {
  return Date.now() - new Date(token.createdAt).getTime() > maxAgeMs;
}

/**
 * Returns true when the current observation's element hierarchy no longer
 * matches the token. Content-based staleness — guaranteed to catch any change
 * visible in the element tree.
 */
export function isHierarchyChanged(token: ObservationToken, current: UiObservation): boolean {
  if (!token.hierarchyHash) return false; // no hash to compare
  return hashHierarchy(current.elements) !== token.hierarchyHash;
}

/**
 * Returns true when the current observation's app context (screen/activity)
 * has changed since the token was created.
 */
export function isContextChanged(token: ObservationToken, current: UiObservation): boolean {
  if (!token.contextHash) return false;
  return hashJson(current.context) !== token.contextHash;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function hashJson(obj: unknown): string {
  return createHash('sha256').update(JSON.stringify(obj ?? {})).digest('hex').slice(0, 12);
}

function hashHierarchy(elements: UiObservation['elements']): string {
  const sig = elements
    .map((e) => `${e.id}:${e.role ?? ''}:${e.text ?? ''}:${String(e.visible)}`)
    .join('|');
  return createHash('sha256').update(sig).digest('hex').slice(0, 12);
}
