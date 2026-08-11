/**
 * Requirement model types — item 29 (plan §23, §52).
 *
 * Two representations:
 *   RequirementModel   — minimal form used between pipeline stages.
 *   RequirementArtifact — full structured output from the requirement analysis AI.
 */

import type { SourceReference } from './SourceReference.js';
import type { Ambiguity } from './Ambiguity.js';

// ── sub-types ─────────────────────────────────────────────────────────────────

export interface Actor {
  id: string;
  name: string;
  role: string;
  description?: string;
}

export interface BusinessRule {
  id: string;
  description: string;
  /** Concrete value or threshold (e.g. "100,000,000 VND"). */
  value?: string;
  sourceRefs: SourceReference[];
  /**
   * 'verified'  — rule has explicit textual evidence.
   * 'unverified' — inferred by AI without direct evidence.
   * 'assumed'   — stated without source; must be confirmed by stakeholder.
   */
  status: 'verified' | 'unverified' | 'assumed';
}

export interface Risk {
  id: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  /** Business impact if the risk materialises. */
  impact: string;
  sourceRefs?: SourceReference[];
}

export interface StateDefinition {
  id: string;
  name: string;
  description?: string;
  /** Valid next states (state machine edges). */
  transitions: string[];
}

export interface DataRule {
  id: string;
  description: string;
  type: 'format' | 'range' | 'uniqueness' | 'mandatory' | 'conditional';
  /** Human-readable constraints (e.g. "must be > 0 and ≤ 100,000,000"). */
  constraints: string[];
  sourceRefs?: SourceReference[];
}

export interface IntegrationDependency {
  id: string;
  service: string;
  endpoint?: string;
  description: string;
  critical: boolean;
}

// ── RequirementModel (§23 — minimal, used between stages) ────────────────────

export interface RequirementModel {
  id: string;
  title: string;
  description: string;
  businessRules: BusinessRule[];
  actors: string[];
  risks: string[];
  constraints: string[];
}

// ── RequirementArtifact (§52 — full AI analysis output) ──────────────────────

/**
 * Structured output from the Requirement Analysis Agent.
 *
 * The AI must fill every field — it cannot summarise into free text.
 * Ambiguities and unverified rules must be surfaced explicitly; they
 * are never silently resolved.
 */
export interface RequirementArtifact {
  id: string;
  sourceRefs: SourceReference[];

  title: string;
  /** One-paragraph summary — not a replacement for the structured fields. */
  summary: string;

  actors: Actor[];
  preconditions: string[];

  businessRules: BusinessRule[];

  states?: StateDefinition[];
  dataRules?: DataRule[];
  integrations?: IntegrationDependency[];

  risks: Risk[];

  /**
   * Detected ambiguities or contradictions in the source documents.
   * Blocking ones prevent test design from proceeding (plan §54).
   */
  ambiguities: Ambiguity[];

  /** Explicit assumptions the AI made that are not sourced from documents. */
  assumptions: string[];
}

// ── coverage helpers (plan §55) ───────────────────────────────────────────────

/** Returns the ids of all business rules in an artifact. */
export function businessRuleIds(artifact: RequirementArtifact): string[] {
  return artifact.businessRules.map((r) => r.id);
}

/** Returns true when any rule is unverified or assumed — a signal to flag for review. */
export function hasUnverifiedRules(artifact: RequirementArtifact): boolean {
  return artifact.businessRules.some((r) => r.status !== 'verified');
}
