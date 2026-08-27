/**
 * Core vocabulary of TestPilot.
 *
 * The single most important idea here (borrowed from maestro.dev) is that a test
 * step never names a selector. It names an *intent* against a *logical element*.
 * Selectors live in the element registry and are allowed to change, be reordered
 * by healing, or differ per platform, without any .feature file being touched.
 */

export type Platform = 'web' | 'android' | 'ios';

/** Semantic control shape learned from the live UI, independent of platform. */
export type ControlType =
  | 'text'
  | 'date'
  | 'select'
  | 'checkbox'
  | 'file'
  | 'slider'
  | 'button'
  | 'unknown';

/** A single way to find an element on one platform. Ordered candidates = healing. */
export interface LocatorCandidate {
  /**
   * When true, the resolver will NOT apply the screen's cssScope to this
   * candidate. Use for elements that live outside the normal page DOM tree
   * (Material dialogs, CDK overlays, toast notifications).
   */
  noScope?: boolean;
  /**
   * CSS ancestor selector injected at runtime by the resolver from the screen's
   * cssScope. Never stored in the registry — set per-call on a shallow copy.
   * The web driver uses this to scope the locator within the active page area.
   */
  runtimeScope?: string;
  /** Original registry template before runtime parameter substitution. */
  runtimeTemplateValue?: string;
  /**
   * Strategy names are intentionally close to Playwright's semantic locators,
   * because accessibility-first locators survive refactors far better than CSS/XPath.
   */
  strategy:
    | 'testId' // data-testid / accessibilityIdentifier / resource-id
    | 'role' // ARIA role (+ name) / Android class + content-desc
    | 'label' // visible text or accessibility label
    | 'placeholder'
    | 'relative' // Playwright row/container relation, e.g. row("ADS") >> overflow:metadata
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
  /** Only a human-approved healed locator may become registry primary. */
  approved?: boolean;
}

/** A logical element: "the login button", independent of platform or markup. */
export interface ElementDef {
  /** Stable key referenced from Gherkin, e.g. "login.submitButton". */
  id: string;
  /** Human label used in generated Gherkin and in reports. */
  label: string;
  /**
   * Other names this same control answers to in Gherkin.
   *
   * One control acquires several Vietnamese phrasings ("Thêm mã", "Nút thêm mã
   * cổ phiếu"), and without aliases each new phrasing mints a fresh, empty
   * element while the proven locators and health stay on whichever name was
   * used first. Aliases keep one candidate list and one health record behind
   * every phrasing, which also stops the duplicate from being created at all.
   *
   * An alias must be unique across the registry: two different controls sharing
   * a name would bind a step to the wrong one silently. `Registry.load`
   * enforces that.
   */
  aliases?: string[];
  screen: string;
  /** Candidates per platform, each list kept sorted by descending weight. */
  candidates: Partial<Record<Platform, LocatorCandidate[]>>;
  /** Rolling healing stats, used by the flake detector and the "propose fix" report. */
  health?: ElementHealth;
  /**
   * How this element came to exist — which is not the same question as where
   * its locators came from.
   *
   * Without it every element looks alike in the file, and "never resolved"
   * reads as "worthless". It is not: a locator library is loaded before the
   * scenarios that will use it exist, so a deliberately supplied element is
   * expected to sit unused for a while. Meanwhile the drift this registry
   * really accumulates is `byproduct` — an element minted automatically the
   * first time a scenario mentioned an unfamiliar label. Only that kind is ever
   * safe to clean up unattended.
   *
   * Absent means unknown, and unknown is treated as deliberate: a cleanup rule
   * must never delete something it cannot account for.
   */
  provenance?:
    | 'authored'   // a person wrote it into the registry
    | 'imported'   // came from a locator library built against the app
    | 'discovered' // observed on the running app by the crawler
    | 'generated'  // produced by the spec pipeline from source documents
    | 'byproduct'; // minted because a scenario named a label nothing knew
  /**
   * Milliseconds between keystrokes when typing into this element.
   * When set, the driver uses pressSequentially instead of fill() so that
   * autocomplete/search APIs receive one event per character rather than
   * the entire value at once. Omit for login/password fields.
   */
  typeDelay?: number;
  /** Runtime control shape confirmed by Playwright/Appium and reused by POM. */
  controlType?: ControlType;
  /** Short, non-sensitive evidence explaining the learned control type. */
  controlEvidence?: string[];
  /** Reusable logical element whose locator is instantiated from step data. */
  template?:
    | {
        kind: 'rowAction';
        action: string;
      }
    | {
        /** Visible text supplied by the scenario, e.g. ADS/FPT/TCB. */
        kind: 'text';
      };
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
  /**
   * Behavioural facts about this screen that no document states and no locator
   * can express — learned by debugging a real run, and true of the application
   * rather than of any one scenario.
   *
   * These exist because a hand-fixed .feature file is the wrong place to keep
   * them: regeneration overwrites it, and the knowledge is lost every time.
   * "The ⊕ button must be clicked a second time to commit the symbol" cost a
   * day to find, lived only in an edited scenario, and vanished on the next
   * generation. Notes go into the generation prompt verbatim, so what was
   * learned once is applied to every scenario written afterwards.
   */
  notes?: string[];
  source?: { kind: 'confluence' | 'figma' | 'manual'; ref: string };
  /**
   * CSS ancestor selector that scopes all web candidates on this screen.
   * The resolver prepends this automatically so individual candidates don't
   * need to repeat it (e.g. ".ion-page-active", "section.header-content").
   */
  cssScope?: string;
  /**
   * URL substring that identifies this screen (e.g. "/login", "/price-board").
   * When set, a URL mismatch is included in the ElementNotFoundError message
   * so the cause is obvious: the test landed on the wrong page.
   */
  urlPattern?: string;
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
  | { kind: 'ensureLoggedIn'; account: string }
  | { kind: 'openFeatureFromSearch'; query: string }
  /** Verify a business region and keep it as scope for subsequent steps. */
  | { kind: 'focusRegion'; element: string; locatorParams?: Record<string, string> }
  | {
      kind: 'tap';
      element: string;
      locatorParams?: Record<string, string>;
      /** Concrete row/action extracted from natural-language Gherkin. */
      rowAction?: { rowText: string; action: string };
    }
  | { kind: 'hover'; element: string; locatorParams?: Record<string, string> }
  | {
      kind: 'dragDrop';
      source: string;
      target: string;
      sourceLocatorParams?: Record<string, string>;
      targetLocatorParams?: Record<string, string>;
    }
  | { kind: 'longPress'; element: string; ms?: number; locatorParams?: Record<string, string> }
  | { kind: 'input'; element: string; text: string; locatorParams?: Record<string, string> }
  | { kind: 'selectDate'; element: string; date: string; locatorParams?: Record<string, string> }
  | { kind: 'clear'; element: string; locatorParams?: Record<string, string> }
  | { kind: 'select'; element: string; option: string; locatorParams?: Record<string, string> }
  | { kind: 'scrollTo'; element: string; direction?: 'down' | 'up'; locatorParams?: Record<string, string> }
  | { kind: 'swipe'; direction: 'left' | 'right' | 'up' | 'down' }
  | { kind: 'scroll'; direction: 'up' | 'down' }
  | { kind: 'back' }
  | { kind: 'assertVisible'; element: string; locatorParams?: Record<string, string> }
  | { kind: 'assertNotVisible'; element: string; locatorParams?: Record<string, string> }
  | { kind: 'assertText'; element: string; text: string; mode?: 'equals' | 'contains' | 'notContains'; locatorParams?: Record<string, string> }
  /**
   * Whether a dropdown offers a choice, asked of that dropdown rather than of
   * the whole screen.
   *
   * `assertNotVisible` cannot express this. "The account chosen as the source
   * must not appear in the destination list" was written as `"TK Thường" is not
   * visible`, and that assertion can never pass while the source field displays
   * the very account it names — the app was correct and the scenario could not
   * be satisfied. Scope is the whole difference.
   */
  | {
      kind: 'assertOption';
      element: string;
      option: string;
      /** `absent` is the case that had no vocabulary; `present` is its mirror. */
      expect: 'present' | 'absent';
      locatorParams?: Record<string, string>;
    }
  | {
      kind: 'assertNumber';
      element: string;
      operator: 'equals' | 'notEquals' | 'greaterThan' | 'atLeast' | 'atMost';
      value: number;
      locatorParams?: Record<string, string>;
    }
  /**
   * Read a number now, to compare against later.
   *
   * Balances, counts and totals move because the test itself moved them, so a
   * scenario asserting an absolute figure is true only until the first time it
   * runs. One here claimed `"Được chuyển" shows "8,829"` and was never right
   * again: each run transferred another 1,000 and the balance walked away from
   * it — 7,329, then 5,329, then 1,329 — while the application was behaving
   * perfectly. What the business actually cares about is the change.
   */
  | { kind: 'rememberNumber'; element: string; as: string; locatorParams?: Record<string, string> }
  | {
      kind: 'assertNumberDelta';
      element: string;
      /** Name given to the earlier reading by `rememberNumber`. */
      as: string;
      /**
       * `changed` covers a rule that promises movement without saying which
       * way: switching the source sub-account changes the transferable amount,
       * but by how much is account data, not a product rule. Without it the
       * only expressible check was that the field is still on screen — which is
       * true whether the feature works or not, and was exactly how a scenario
       * came to carry the right name while proving nothing.
       */
      direction: 'increased' | 'decreased' | 'unchanged' | 'changed';
      /** Omitted for `unchanged`/`changed`, and for "moved at all this way". */
      by?: number;
      locatorParams?: Record<string, string>;
    }
  | {
      kind: 'assertCollection';
      element: string;
      check:
        | { kind: 'count'; operator: 'equals' | 'notEquals' | 'greaterThan' | 'atLeast' | 'atMost'; value: number }
        /**
         * How many members carry a given text — "VIC appears once", not "the
         * list has one row". Written as `count` at first, which counts the
         * whole collection and so failed on any account holding more than one
         * stock, whether or not the duplicate it was testing for existed.
         */
        | {
            kind: 'countMatching';
            text: string;
            operator: 'equals' | 'notEquals' | 'greaterThan' | 'atLeast' | 'atMost';
            value: number;
          }
        | { kind: 'uniqueText' }
        | { kind: 'firstText'; text: string }
        | { kind: 'focused' };
      locatorParams?: Record<string, string>;
    }
  | { kind: 'waitFor'; element: string; timeoutMs?: number; locatorParams?: Record<string, string> }
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
  /**
   * Choices binding had to make that it could not make on evidence — resolved
   * so the run proceeds, but reported so a wrong guess is visible rather than
   * silent.
   */
  warnings?: string[];
}

/* ------------------------------------------------------------------ */
/* Results                                                              */
/* ------------------------------------------------------------------ */

/**
 * `unverified` is a tap that raised no error but that nothing proved had any
 * effect: the thing the next step looks for was already on screen before the
 * tap, so finding it afterwards says nothing. Such a step is not a failure —
 * the run should not turn red on it — but calling it `passed` is how a click
 * that landed on nothing stayed green through seven consecutive runs.
 */
export type StepStatus = 'passed' | 'failed' | 'skipped' | 'healed' | 'unverified';

export interface StepResult {
  step: StepSpec;
  status: StepStatus;
  durationMs: number;
  attempts: number;
  /** Set when the winning locator was not the first candidate. */
  heal?: { elementId: string; from: LocatorCandidate; to: LocatorCandidate };
  error?: { message: string; stack?: string };
  /** Drives retry policy: assertions never become green merely by rerunning. */
  failureKind?: 'locator' | 'assertion' | 'interaction' | 'environment';
  screenshot?: string;
}

/**
 * What the page looked like when a scenario failed after a step proved nothing.
 *
 * Collected at the moment of failure and nowhere else. The web driver closes
 * the page when a scenario ends, so anything asked afterwards observes a dead
 * surface — a locator sweep run that way reported 0 of 32 elements missing when
 * in fact 21 were present. It is also skipped entirely unless an earlier step
 * was `unverified`, so scenarios that pass never pay for it.
 */
export interface StepHealingObservation {
  /** Line of the step that failed. */
  failingLine: number;
  /** Line of the earlier step that ran clean but proved nothing. */
  unverifiedLine: number;
  /** Controls this scenario had already tapped, oldest first. */
  priorTaps: Array<{ elementId: string; label: string }>;
  /** Registry elements on the failing screen that resolve right now. */
  visibleNow: Array<{ elementId: string; label: string }>;
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
    /** Present only when this attempt failed after a step proved nothing. */
    healingObservation?: StepHealingObservation;
  }>;
  /** passed / failed / flaky — flaky = mixed outcomes across attempts. */
  verdict: 'passed' | 'failed' | 'flaky';
}

/**
 * Something the run could not decide, recorded rather than acted on.
 *
 * Step healing sometimes forms hypotheses it cannot separate. Pausing the
 * workflow to ask would make every such moment an obstruction, and three days
 * of real runs produced no question anybody would have wanted to answer. So
 * they are written into the report instead: visible where the run is reviewed,
 * blocking nothing, and accumulating the evidence needed to decide whether a
 * blocking gate is worth building at all.
 */
export interface OpenQuestion {
  source: 'healing' | 'generation';
  prompt: string;
  /** Why the run could not settle it by itself. */
  reason?: string;
  options?: string[];
  scenario?: string;
  line?: number;
}

export interface RunReport {
  runId: string;
  startedAt: string;
  finishedAt: string;
  results: ScenarioResult[];
  healSuggestions: HealSuggestion[];
  /** Decisions the run deferred; see OpenQuestion. Never blocks the run. */
  openQuestions?: OpenQuestion[];
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
  /** Distinct executions that contributed evidence to this proposal. */
  runs?: number;
  firstSeen?: string;
  lastSeen?: string;
  rationale: string;
}
