/**
 * Semantic contract for an element — what we're looking for, not how to find it.
 *
 * ElementIntent is the stable layer between a Gherkin step and runtime locators.
 * It describes WHAT the test needs; the discovery pipeline finds WHERE it lives
 * at runtime.
 *
 * Do NOT put xpath, resource-id, css, or index values into an intent.
 * Those are discovered and verified at runtime, never authored here.
 */

export type ActionKind =
  | 'tap'
  | 'input'
  | 'select'
  | 'check'
  | 'uncheck'
  | 'scroll'
  | 'swipe'
  | 'assert-visible'
  | 'assert-text'
  | 'assert-enabled'
  | 'assert-disabled';

export interface ElementIntent {
  /** Stable key — matches the element registry id, e.g. "login.submitButton". */
  id: string;
  /** Screen or view the element belongs to. Helps disambiguation. */
  screen?: string;
  /** ARIA role / Android class / iOS accessibility type. */
  semanticRole?: string;
  /** Human-readable accessible name or visible label. */
  label?: string;
  /** Free-text description — context for semantic AI discovery. */
  description?: string;
  /** Exact visible text the element should show. */
  text?: string;
  /** Placeholder text (for inputs). */
  placeholder?: string;
  /** The action the step intends to perform — drives verification rules. */
  action: ActionKind;
  /** Sibling / ancestor element ids that disambiguate this element. */
  context?: string[];
  /** Expected interaction state. Drives verification pass/fail criteria. */
  expectedState?: {
    visible?: boolean;
    enabled?: boolean;
    interactive?: boolean;
    selected?: boolean;
    checked?: boolean;
    focused?: boolean;
  };
  /** Relative spatial constraints — used by semantic and vision discovery. */
  constraints?: {
    near?: string;
    inside?: string;
    below?: string;
    above?: string;
    leftOf?: string;
    rightOf?: string;
  };
  /** Full traceability back to requirement / test / scenario / step. */
  source?: {
    requirementId?: string;
    testCaseId?: string;
    scenarioId?: string;
    stepId?: string;
  };
}
