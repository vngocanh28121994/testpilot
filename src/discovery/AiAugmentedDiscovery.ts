/**
 * Full AI-augmented discovery pipeline (plan §47.6 decision tree).
 *
 * Composes all four discovery levels:
 *   1. Deterministic (ElementDiscovery — known locator + runtime observation)
 *   2. Semantic AI (SemanticElementDiscovery — LLM over structured observation)
 *   3. Vision (VisionElementDiscovery — screenshot + vision LLM)
 *
 * Each level is tried only when the previous level failed.
 * AI calls are gated by AgentBudget — when the budget is exhausted the pipeline
 * stops and returns the best evidence collected so far.
 */

import type { ElementIntent } from './ElementIntent.js';
import type { DiscoveryResult, DiscoveryOptions } from './ElementDiscovery.js';
import { ElementDiscovery } from './ElementDiscovery.js';
import { SemanticElementDiscovery } from './ai/SemanticElementDiscovery.js';
import { VisionElementDiscovery } from './ai/VisionElementDiscovery.js';
import type { AgentBudget } from '../agent/AgentTypes.js';
import { DEFAULT_AGENT_BUDGET } from '../agent/AgentTypes.js';

export interface AiAugmentedDiscoveryOptions extends DiscoveryOptions {
  /**
   * Allow the semantic AI step.
   * False when policy.allowAiDiscovery = false (plan §AgentRunInput).
   */
  allowSemanticAi?: boolean;
  /**
   * Allow the vision step.
   * False when policy.allowVision = false.
   */
  allowVision?: boolean;
}

export interface BudgetTracker {
  /** Returns false when the AI budget is exhausted; true when the call is allowed. */
  trackAiCall(vision?: boolean): boolean;
}

/** Simple in-call budget tracker — for callers without a full AgentStateMachine. */
export class SimpleBudgetTracker implements BudgetTracker {
  private aiCalls = 0;
  private visionCalls = 0;

  constructor(private readonly budget: AgentBudget = DEFAULT_AGENT_BUDGET) {}

  trackAiCall(vision = false): boolean {
    if (this.aiCalls >= this.budget.maxAiCalls) return false;
    if (vision && this.visionCalls >= this.budget.maxVisionCalls) return false;
    this.aiCalls += 1;
    if (vision) this.visionCalls += 1;
    return true;
  }
}

/**
 * Orchestrates all four discovery levels with budget enforcement.
 *
 * Callers that already have an AgentStateMachine should pass its
 * `trackAiCall` method as the `BudgetTracker`.
 */
export class AiAugmentedDiscovery {
  constructor(
    private readonly deterministic: ElementDiscovery,
    private readonly semanticAi?: SemanticElementDiscovery,
    private readonly vision?: VisionElementDiscovery,
    private readonly budgetTracker: BudgetTracker = new SimpleBudgetTracker(),
  ) {}

  async discover(
    intent: ElementIntent,
    opts: AiAugmentedDiscoveryOptions = {},
  ): Promise<DiscoveryResult> {
    const evidence: string[] = [];

    // ── Level 1: Deterministic ────────────────────────────────────────────────
    const deterministicResult = await this.deterministic.discover(intent, opts);

    if (deterministicResult.method !== 'failed' && deterministicResult.locator) {
      // Verified match — done
      if (deterministicResult.match?.verified !== false) {
        return deterministicResult;
      }
    }

    // Collect evidence from deterministic step for the merged result
    for (const line of deterministicResult.evidence) {
      evidence.push(`[deterministic] ${line}`);
    }

    // ── Level 2: Semantic AI ──────────────────────────────────────────────────
    const allowSemantic = opts.allowSemanticAi !== false && this.semanticAi != null;

    if (allowSemantic) {
      if (!this.budgetTracker.trackAiCall(false)) {
        evidence.push('[semantic-ai] skipped — AI call budget exhausted');
      } else {
        // Re-use the observation from the deterministic step if available
        const observation = deterministicResult.observation;
        if (!observation) {
          evidence.push('[semantic-ai] skipped — no observation available');
        } else {
          const semanticResult = await this.semanticAi!.discover(intent, observation, {
            minConfidence: opts.minConfidence,
            platform: opts.platform,
          });

          for (const line of semanticResult.evidence) evidence.push(line);

          if (semanticResult.method !== 'failed' && semanticResult.match?.verified) {
            return { ...semanticResult, evidence: [...evidence, ...semanticResult.evidence.filter(l => !evidence.includes(l))] };
          }
        }
      }
    } else if (!allowSemantic) {
      evidence.push('[semantic-ai] skipped — disabled by policy or not configured');
    }

    // ── Level 3: Vision ───────────────────────────────────────────────────────
    const allowVisionStep = opts.allowVision !== false && this.vision != null;

    if (allowVisionStep) {
      // Vision requires a screenshot — must be captured from the observation provider
      // Here we delegate to the caller: if the deterministic observation has a
      // screenshot path, we could use it. Otherwise vision is skipped.
      const screenshotPath = deterministicResult.observation?.screenshot?.path;

      if (!screenshotPath) {
        evidence.push('[vision] skipped — no screenshot available in observation');
      } else if (!this.budgetTracker.trackAiCall(true)) {
        evidence.push('[vision] skipped — vision call budget exhausted');
      } else {
        const { readFile } = await import('node:fs/promises');
        let screenshotBase64: string;
        try {
          const buf = await readFile(screenshotPath);
          screenshotBase64 = buf.toString('base64');
        } catch {
          evidence.push(`[vision] skipped — could not read screenshot at "${screenshotPath}"`);
          return { intent, method: 'failed', evidence };
        }

        const visionResult = await this.vision!.discover(
          intent,
          screenshotBase64,
          deterministicResult.observation,
          {
            minConfidence: opts.minConfidence,
            platform: opts.platform,
          },
        );

        for (const line of visionResult.evidence) {
          if (!evidence.includes(line)) evidence.push(line);
        }

        if (visionResult.method !== 'failed' && visionResult.match?.verified) {
          return { ...visionResult, evidence };
        }
      }
    } else if (!allowVisionStep) {
      evidence.push('[vision] skipped — disabled by policy or not configured');
    }

    // ── All levels exhausted ──────────────────────────────────────────────────
    evidence.push('[pipeline] all discovery levels exhausted — no verified element found');
    return {
      intent,
      method: 'failed',
      observation: deterministicResult.observation,
      evidence,
    };
  }
}
