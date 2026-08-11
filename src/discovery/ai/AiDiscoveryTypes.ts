/**
 * Shared types for AI-augmented element discovery (plan §12, §47.6).
 *
 * These are interfaces only — no implementation lives here.
 * Concrete implementations: SemanticElementDiscovery, VisionElementDiscovery,
 * AppiumMcpElementDiscovery.
 */

import type { ElementIntent } from '../ElementIntent.js';
import type { UiObservation } from '../UiObservation.js';

// ── AI candidate ──────────────────────────────────────────────────────────────

/**
 * An element the AI believes matches an intent.
 * Always verified by ElementVerifier before being accepted.
 */
export interface AiElementCandidate {
  /** The ObservedElement.id in the corresponding UiObservation. */
  observedElementId: string;
  /** 0..100 — AI-assigned confidence; must still pass ElementVerifier. */
  confidence: number;
  /** AI reasoning trace — stored in evidence for auditability. */
  reasoning: string;
  /** Locator the AI suggests to identify the element stably. */
  suggestedLocator?: { strategy: string; value: string };
}

// ── semantic AI provider (item 19) ───────────────────────────────────────────

export interface SemanticDiscoveryResponse {
  candidate?: AiElementCandidate;
  /** Number of tokens used — tracked for budget. */
  tokensUsed?: number;
  modelId?: string;
}

/**
 * LLM provider for semantic element discovery.
 *
 * Receives the full observation (structured data — no screenshot) and returns
 * the element that best matches the intent.  Implementations call an LLM API
 * such as Claude Messages API.
 */
export interface LlmProvider {
  findElement(
    intent: ElementIntent,
    observation: UiObservation,
  ): Promise<SemanticDiscoveryResponse>;
}

// ── vision provider (item 20) ─────────────────────────────────────────────────

export interface VisionDiscoveryResponse {
  candidate?: AiElementCandidate;
  /** Bounding box coordinates the model identified (screenshot pixels). */
  bounds?: { x: number; y: number; width: number; height: number };
  /** Free-text description of what the model found. */
  description?: string;
  tokensUsed?: number;
  modelId?: string;
}

/**
 * Vision LLM provider for screenshot-based element discovery.
 *
 * Receives the screenshot (base64) and returns the element matching the intent.
 * Optionally receives the structured observation to correlate the visual result
 * back to an ObservedElement id.
 *
 * Vision is the last resort — only called when semantic AI fails.
 */
export interface VisionLlmProvider {
  findElementInScreenshot(
    intent: ElementIntent,
    screenshotBase64: string,
    observation?: UiObservation,
  ): Promise<VisionDiscoveryResponse>;
}

// ── Appium MCP client (item 18) ───────────────────────────────────────────────

/**
 * Raw MCP client interface — kept minimal.
 *
 * AppiumMcpElementDiscovery wraps this into the standard discovery types.
 * Business logic must never call McpClient directly; always go through the adapter.
 */
export interface McpClient {
  /**
   * Capture the live UI hierarchy.
   * Returns a raw, format-specific structure that the adapter converts to UiObservation.
   */
  inspect(): Promise<unknown>;
  /**
   * AI-powered element find via Appium MCP.
   * Returns a raw, format-specific structure the adapter converts to AiElementCandidate.
   */
  findElement(description: string): Promise<unknown>;
  /** Capture a screenshot, return as base64. */
  screenshot(): Promise<string>;
}

/**
 * Unified AI discovery interface (plan §12).
 *
 * Business layer only knows this interface — never the concrete MCP/LLM impls.
 */
export interface AiElementDiscovery {
  /** Take a live UI snapshot — mirrors ObservationProvider.observe(). */
  inspect(): Promise<UiObservation>;
  /** Ask the AI to find an element matching the intent. */
  findElement(intent: ElementIntent): Promise<AiElementCandidate | undefined>;
  /** Capture a screenshot (base64). */
  screenshot(): Promise<string>;
}
