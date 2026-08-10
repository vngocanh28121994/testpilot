/**
 * Core vocabulary of TestPilot.
 *
 * The single most important idea here (borrowed from maestro.dev) is that a test
 * step never names a selector. It names an *intent* against a *logical element*.
 * Selectors live in the element registry and are allowed to change, be reordered
 * by healing, or differ per platform, without any .feature file being touched.
 */

export type Platform = 'web' | 'android' | 'ios';

/** A single way to find an element on one platform. Ordered candidates = healing. */
export interface LocatorCandidate {
  /**
   * Strategy names are intentionally close to Playwright's semantic locators,
   * because accessibility-first locators survive refactors far better than CSS/XPath.
   */
  strategy:
    | 'testId' // data-testid / accessibilityIdentifier / resource-id
    | 'role' // ARIA role (+ name) / Android class + content-desc
    | 'label' // visible text or accessibility label
    | 'placeholder'
    | 'css' // web only
    | 'xpath' // last resort, both platforms
    | 'predicate'; // iOS NSPredicate / Android UiSelector
  value: string;
  /** Optional accessible/visible name that disambiguates a role or label match. */
  name?: string;
  /** 0..1. Confidence that this candidate is stable. Drives ordering. */
  weight: number;
  /** Where this candidate came from, so the report can explain itself. */
  origin: 'authored' | 'figma' | 'crawler' | 'llm' | 'healed';
}

/** A logical element: "the login button", independent of platform or markup. */
export interface ElementDef {
  /** Stable key referenced from Gherkin, e.g. "login.submitButton". */
  id: string;
  /** Human label used in generated Gherkin and in reports. */
  label: string;
  screen: string;
  /** Candidates per platform, each list kept sorted by descending weight. */
  candidates: Partial<Record<Platform, LocatorCandidate[]>>;
  /** Rolling healing stats, used by the flake detector and the "propose fix" report. */
  health?: ElementHealth;
}

export interface ElementHealth {
  resolutions: number;
  /** How many times the top candidate failed and a fallback won. */
  heals: number;
  /** candidate value -> times it was the winner. */
  winners: Record<string, number>;
  lastHealedAt?: string;
}

export interface ScreenDef {
  id: string;
  title: string;
  /** Free-text description pulled from Confluence/Figma; fed to the LLM at gen time. */
  description?: string;
  source?: { kind: 'confluence' | 'figma' | 'manual'; ref: string };
}

export interface ElementRegistry {
  version: 1;
  screens: Record<string, ScreenDef>;
  elements: Record<string, ElementDef>;
}

/* ------------------------------------------------------------------ */
/* Intents — the platform-agnostic instruction set                      */
/* ------------------------------------------------------------------ */

/**
 * Deliberately small. Every intent must be expressible on both Playwright and
 * Appium, and every intent must be *retryable* (see runtime/resolver.ts).
 * Adding an intent is a design decision, not a convenience — a bloated
 * instruction set is what makes cross-platform suites rot.
 */
export type Intent =
  | { kind: 'launch'; target?: string }
  | { kind: 'tap'; element: string }
  | { kind: 'longPress'; element: string; ms?: number }
  | { kind: 'input'; element: string; text: string }
  | { kind: 'clear'; element: string }
  | { kind: 'select'; element: string; option: string }
  | { kind: 'scrollTo'; element: string; direction?: 'down' | 'up' }
  | { kind: 'swipe'; direction: 'left' | 'right' | 'up' | 'down' }
  | { kind: 'back' }
  | { kind: 'assertVisible'; element: string }
  | { kind: 'assertNotVisible'; element: string }
  | { kind: 'assertText'; element: string; text: string; mode?: 'equals' | 'contains' }
  | { kind: 'waitFor'; element: string; timeoutMs?: number }
  | { kind: 'screenshot'; name: string };

export interface StepSpec {
  /** Original Gherkin line, kept verbatim for the report. */
  text: string;
  keyword: 'Given' | 'When' | 'Then' | 'And' | 'But';
  intent: Intent;
  line: number;
}

export interface ScenarioSpec {
  id: string;
  name: string;
  tags: string[];
  steps: StepSpec[];
  /** Platforms this scenario is allowed to run on, derived from @web/@android/@ios tags. */
  platforms: Platform[];
}

export interface FeatureSpec {
  uri: string;
  name: string;
  /** Traceability back to the source document — required for the coverage report. */
  source?: { kind: 'confluence' | 'figma'; ref: string; title?: string };
  background: StepSpec[];
  scenarios: ScenarioSpec[];
}

/* ------------------------------------------------------------------ */
/* Results                                                              */
/* ------------------------------------------------------------------ */

export type StepStatus = 'passed' | 'failed' | 'skipped' | 'healed';

export interface StepResult {
  step: StepSpec;
  status: StepStatus;
  durationMs: number;
  attempts: number;
  /** Set when the winning locator was not the first candidate. */
  heal?: { elementId: string; from: LocatorCandidate; to: LocatorCandidate };
  error?: { message: string; stack?: string };
  screenshot?: string;
}

export interface ScenarioResult {
  scenario: ScenarioSpec;
  platform: Platform;
  device: string;
  /** One entry per execution attempt; length > 1 means the retry policy kicked in. */
  runs: Array<{
    attempt: number;
    status: 'passed' | 'failed';
    steps: StepResult[];
    startedAt: string;
    durationMs: number;
    video?: string;
  }>;
  /** passed / failed / flaky — flaky = mixed outcomes across attempts. */
  verdict: 'passed' | 'failed' | 'flaky';
}

export interface RunReport {
  runId: string;
  startedAt: string;
  finishedAt: string;
  results: ScenarioResult[];
  healSuggestions: HealSuggestion[];
  /**
   * Scenarios the flake detector held back, which therefore have no result.
   * Reported explicitly because the alternative is a suite that quietly shrinks
   * toward zero while every report it produces still says everything passed.
   */
  quarantined: Array<{ id: string; name: string; platform: Platform; device: string }>;
}

export interface HealSuggestion {
  elementId: string;
  platform: Platform;
  current: LocatorCandidate;
  proposed: LocatorCandidate;
  successes: number;
  rationale: string;
}
