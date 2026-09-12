import type {
  Intent,
  LocatorCandidate,
  ScenarioResult,
  ScenarioSpec,
  StepHealingObservation,
  StepResult,
  StepSpec,
} from '../core/types.js';
import type { UiDriver, UiHandle, UiMatchSnapshot } from '../drivers/driver.js';
import {
  candidateKey,
  ElementNotFoundError,
  Resolver,
  type ResolveOptions,
  type Resolution,
} from './resolver.js';
import type { ActionKind } from '../discovery/ElementIntent.js';
import { extractErrorCode, TestPilotError, TestPilotErrorCode } from '../core/ErrorCodes.js';
import {
  assertCapabilitySupported,
  UnsupportedActionCapabilityError,
} from './capabilities.js';
import { performAdaptiveInput } from '../drivers/controlClassifier.js';
import { normalizeHumanText } from '../core/text.js';
import { parseDisplayedNumber } from '../core/number.js';
import { sameDate } from '../drivers/datePicker.js';

export interface ExecutorOptions {
  /** Extra attempts after the first failure. 1 is enough to classify flakiness. */
  retries: number;
  screenshotOnFailure: boolean;
  resolve?: Partial<ResolveOptions>;
  /**
   * `{{name}}` substitutions applied to step text at execution time — chiefly
   * `account.<label>.password`, which must never appear literally in a
   * committed .feature file. See core/secrets.ts.
   */
  variables?: Record<string, string>;
  /**
   * Read each field back after typing and fail the step when it did not take.
   *
   * On by default. Without it an `input` step reports `passed` whenever the
   * driver's call returned, which is not the same as the field holding what you
   * typed — a whole login failed sixty seconds later, at an unrelated locator,
   * because a stale value was still sitting in the password box and the step
   * that should have replaced it had already gone green.
   */
  verifyInput?: boolean;
  /** Maximum wait for the state implied by the next scenario step. */
  postconditionTimeoutMs?: number;
  /** Maximum safe alternatives for a contextual row/menu action. */
  actionHealingAttempts?: number;
}

export const DEFAULT_EXECUTOR: ExecutorOptions = {
  retries: 1,
  screenshotOnFailure: true,
  postconditionTimeoutMs: 12_000,
  actionHealingAttempts: 4,
};

/**
 * How long, and how often, to watch for a postcondition that may be transient.
 * Chosen against a ~2s toast: 150ms leaves roughly a dozen looks inside it.
 */
const TRANSIENT_WATCH_MS = 3_000;

/**
 * Ảnh nhánh thoát còn dùng lại được trong bao lâu.
 *
 * Giữa lúc nhánh thoát chụp ảnh và lúc bước hỏng rơi vào handler chỉ có một
 * lần `throw` — đo trên máy thật là cùng một dấu giây. 5 giây rộng rãi cho
 * đường đi đó mà vẫn hẹp hơn mọi thao tác nào có thể làm màn hình đổi sang
 * trạng thái khác ở giữa, nên không có chuyện report cho xem một màn hình đã
 * cũ.
 */
const DECLINED_SHOT_REUSE_MS = 5_000;
const TRANSIENT_POLL_MS = 150;
/**
 * How long a list may take to settle after the action that changed it.
 *
 * Only spent when the assertion does not already hold, so a passing suite never
 * waits at all.
 */
const COLLECTION_SETTLE_MS = 3_000;

/**
 * How many elements a healing observation will probe.
 *
 * Each probe costs a resolve attempt on a page that has already failed, with
 * somebody waiting on the result. A screen with more controls than this is one
 * where the extra candidates would be weak guesses anyway.
 */
const HEALING_PROBE_LIMIT = 20;

const DEFAULT_POSTCONDITION_TIMEOUT_MS = 12_000;

/**
 * Thời gian tối thiểu dành cho lượt resolve có discovery ở cuối một
 * postcondition hụt.
 *
 * Discovery bắt đầu sau 2,5 giây dò hụt rồi cần thêm khoảng 4 giây để chốt
 * (xem DISCOVERY_AFTER_MS và DISCOVERY_GRACE_MS trong resolver). Cấp ít hơn thế
 * thì nó không kịp sinh ra ứng viên nào, và lượt chạy trả về "after 1 attempts"
 * y như thể không có discovery.
 */
const MIN_DISCOVERY_BUDGET_MS = 6_500;

interface ActionExpectation {
  elementId: string;
  locatorParams?: Record<string, string>;
  state: 'visible' | 'absent';
  action: ActionKind;
  source: string;
}

export class Executor {
  /**
   * Where the current step's screenshot landed, when the step was a screenshot.
   *
   * Reset before every step: it describes one step, and a stale value would
   * attach the previous screenshot to whatever ran next.
   */
  private lastShot?: string;
  /**
   * Ảnh nhánh thoát vừa chụp, để bước hỏng ngay sau đó khỏi chụp lại.
   *
   * Hai chỗ cùng chụp một khoảnh khắc: nhánh thoát khi bấm lỗi, rồi handler
   * bước hỏng. Đo trên một lượt chạy thật — hai file cùng dấu giây 03:09:59,
   * 256 686 và 256 738 byte, cùng một màn hình. Mỗi ca fail trả giá hai lần
   * cho một bức ảnh, và report hiện nó hai lần liền nhau.
   */
  private lastDeclinedShot?: { path: string; at: number };
  /**
   * Bằng chứng của bước assert vừa chạy: locator thắng và chữ đọc được.
   *
   * Thu ngay tại lúc resolve, không phải sau khi bước kết thúc — sau đó màn
   * hình đã có thể đổi, và thứ đọc được lúc ấy không còn là thứ đã làm cho
   * bước này xanh.
   */
  private lastEvidence?: { locator: string; saw?: string };
  /**
   * Set by a tap that completed without anything proving it had an effect.
   * Carried on the instance for the same reason as `lastShot`: the step loop
   * needs it to grade the step, but it is produced deep inside the tap path.
   */
  private lastUnverified = false;
  /** Controls tapped so far in the scenario, for step healing. */
  private tappedSoFar: Array<{ elementId: string; label: string }> = [];
  /** Set when a scenario fails after an earlier step proved nothing. */
  private lastHealingObservation?: StepHealingObservation;
  /**
   * Nesting depth of `execute`. Composite steps such as opening a feature from
   * search perform their own inner taps, and those taps have no postcondition
   * of their own — the composite proves itself another way (a route change).
   * Only the outermost action may declare a step unverified; without this an
   * entirely verified navigation is reported on the strength of its helpers.
   */
  private executeDepth = 0;
  /**
   * Numbers read by `rememberNumber`, for a later delta assertion.
   *
   * Scoped to one scenario and cleared with the rest of the per-scenario state:
   * a balance remembered in one scenario says nothing about the next, which
   * runs after the first has already moved it.
   */
  private readonly remembered = new Map<string, number>();
  /** Assertions already proven by the immediately preceding stateful action. */
  private readonly preverifiedExpectations = new Set<string>();

  private readonly resolver: Resolver;

  constructor(
    private readonly driver: UiDriver,
    resolver: Resolver,
    private readonly opts: ExecutorOptions = DEFAULT_EXECUTOR,
  ) {
    this.resolver = resolver;
  }

  /**
   * @param patches Extra steps to splice in for this run only.
   *
   * Nothing is written to disk. A healing hypothesis has to be executed before
   * it is worth anything, and executing it must not change the suite: six
   * plausible explanations for one failure here were all wrong, and a mechanism
   * that edited the .feature file to find that out would have left six wrong
   * edits behind.
   */
  async runScenario(
    scenario: ScenarioSpec,
    background: StepSpec[] = [],
    patches: ReadonlyArray<{ afterLine: number; step: string; elementId: string }> = [],
  ): Promise<ScenarioResult> {
    const runs: ScenarioResult['runs'] = [];
    const steps = applyStepPatches([...background, ...scenario.steps], patches);

    for (let attempt = 1; attempt <= this.opts.retries + 1; attempt++) {
      const startedAt = new Date().toISOString();
      const t0 = Date.now();

      // One recording per attempt, not per scenario: when a retry passes, the
      // video worth watching is the one from the attempt that failed.
      await this.driver.beginScenario?.(`${scenario.id}-a${attempt}`);
      const stepResults = await this.runSteps(steps, scenario.id, attempt);
      // Read before `endScenario`, which closes the page the observation was
      // taken from — the value is already captured, but keeping the order
      // explicit stops a later edit from moving the collection down here.
      const healingObservation = this.takeHealingObservation();
      const failed = stepResults.some((s) => s.status === 'failed');
      // Một ảnh cho mỗi kịch bản xanh, chụp ở trạng thái cuối.
      //
      // Ca đỏ xưa nay có ảnh, cây DOM và video; ca xanh chỉ có chữ "passed".
      // Phải chụp TRƯỚC `endScenario` — hàm đó đóng trang, và ảnh chụp sau khi
      // trang đóng là ảnh của một màn hình không còn nữa. Ca đỏ đã có ảnh riêng
      // ở handler bước hỏng nên ở đây chỉ lo phần xanh.
      const proof = failed
        ? undefined
        : await this.driver.screenshot?.(`${scenario.id}-a${attempt}-pass`).catch(() => undefined);
      const video = await this.driver.endScenario?.(`${scenario.id}-a${attempt}`);

      runs.push({
        attempt,
        status: failed ? 'failed' : 'passed',
        steps: stepResults,
        startedAt,
        durationMs: Date.now() - t0,
        ...(video ? { video } : {}),
        ...(proof ? { proof } : {}),
        ...(healingObservation ? { healingObservation } : {}),
      });

      // A green first run needs no confirmation. Only a locator/discovery
      // failure is safe to retry: an assertion mismatch is a product/test
      // result and rerunning it until green would create a false pass.
      if (!failed) break;
      const failedStep = stepResults.find((step) => step.status === 'failed');
      if (failedStep?.failureKind !== 'locator') break;
      // `endScenario` is the signal that a driver tore its surface down — the
      // web driver closes the page there to flush the video, so relaunching
      // would target a closed page; the Background step re-enters the app on
      // the next attempt instead. `beginScenario` alone means nothing here: the
      // native driver implements it only to capture a diagnostic tree.
      const tearsDown = Boolean(this.driver.endScenario);
      if (attempt <= this.opts.retries && !tearsDown) await this.driver.launch();
    }

    return {
      scenario,
      platform: this.driver.runPlatform ?? this.driver.platform,
      device: this.driver.device,
      runs,
      verdict: verdictOf(runs),
    };
  }

  /**
   * Drive the app through steps without the scenario lifecycle around them.
   *
   * `runScenario` finishes by calling `endScenario`, and the web driver closes
   * the page there to flush the video. That is right for a suite and wrong for
   * anything that wants to look at the page afterwards: the locator verifier
   * navigated correctly, then queried a closed page and reported all 32
   * locators missing — including two with 49 and 53 proven resolutions.
   *
   * The caller owns the surface: begin it before, tear it down after.
   */
  async runStepsWithoutTeardown(steps: StepSpec[], id = 'adhoc'): Promise<StepResult[]> {
    return this.runSteps(steps, id, 1);
  }

  private async runSteps(
    steps: StepSpec[],
    scenarioId: string,
    attempt: number,
  ): Promise<StepResult[]> {
    const results: StepResult[] = [];
    let aborted = false;
    let activeContext: string[] = [];
    this.preverifiedExpectations.clear();
    this.tappedSoFar = [];
    this.lastHealingObservation = undefined;
    this.remembered.clear();

    for (let index = 0; index < steps.length; index++) {
      const step = steps[index]!;
      if (aborted) {
        results.push({ step, status: 'skipped', durationMs: 0, attempts: 0 });
        continue;
      }
      const t0 = Date.now();
      this.lastShot = undefined;
      this.lastUnverified = false;
      // Xoá ở ĐẦU mỗi bước, không chỉ sau khi gắn: một bước hỏng giữa chừng mà
      // để sót bằng chứng của bước trước thì report gán nhầm chứng cứ cho bước
      // sai — tệ hơn hẳn việc không có chứng cứ.
      this.lastEvidence = undefined;
      try {
        const expectation = ['tap', 'hover', 'dragDrop', 'openFeatureFromSearch'].includes(step.intent.kind)
          ? expectationAfter(steps, index)
          : undefined;
        const expectedLabel = expectation
          ? this.resolver.registry.element(expectation.elementId).label
          : undefined;
        const heal = await this.execute(
          step.intent,
          expectation,
          [...activeContext, ...(expectedLabel ? [expectedLabel] : [])].slice(-3),
          activeContext.at(-1),
        );
        results.push({
          step,
          // `healed` outranks `unverified`: a heal is the more actionable fact,
          // and a healed step is reported as such today.
          status: heal ? 'healed' : this.lastUnverified ? 'unverified' : 'passed',
          durationMs: Date.now() - t0,
          attempts: 1,
          ...(heal ? { heal } : {}),
          ...(this.lastShot ? { screenshot: this.lastShot } : {}),
          ...(this.lastEvidence ? { evidence: this.lastEvidence } : {}),
        });
        this.lastEvidence = undefined;
        if (step.intent.kind === 'tap' && 'element' in step.intent) {
          const def = this.resolver.registry.element(step.intent.element);
          this.tappedSoFar.push({ elementId: def.id, label: def.label });
        }
        if (step.intent.kind === 'focusRegion') {
          activeContext = [this.resolver.registry.element(step.intent.element).label];
        }
        if (step.intent.kind === 'launch' || step.intent.kind === 'openFeatureFromSearch') {
          activeContext = [];
        }
      } catch (err) {
        const e = err as Error;
        const stem = `${scenarioId}-a${attempt}-l${step.line}-fail`;
        // Dùng lại ảnh nhánh thoát vừa chụp, nếu nó còn nóng.
        //
        // Đường đi phổ biến nhất tới đây là: bấm lỗi → nhánh thoát chụp một
        // ảnh → ném lỗi → rơi vào chính handler này. Hai lần chụp cách nhau
        // chưa tới một giây và cho cùng một màn hình. Ngoài đường đó (bước
        // assert hỏng, bấm hỏng kiểu khác) thì không có ảnh sẵn và vẫn chụp
        // như cũ.
        const conNong = this.lastDeclinedShot
          && Date.now() - this.lastDeclinedShot.at < DECLINED_SHOT_REUSE_MS;
        const shot = this.opts.screenshotOnFailure
          ? (conNong
            ? this.lastDeclinedShot!.path
            : await this.driver.screenshot(stem).catch(() => undefined))
          : undefined;
        this.lastDeclinedShot = undefined;
        // Captured beside the screenshot, not instead of it: the picture shows
        // what the screen looked like, the tree shows what was matchable.
        if (this.opts.screenshotOnFailure) {
          await this.driver.dumpTree?.(stem).catch(() => undefined);
        }
        // Gathered here because here is the only place it can be. The page is
        // still open — the same reason the screenshot above works — and it
        // closes the moment the scenario ends. Skipped unless an earlier step
        // proved nothing, so a scenario that simply fails pays nothing for it.
        // The suspect is the last tap before the failure, whether or not it was
        // flagged unverified.
        //
        // Keying on the `unverified` flag alone was tried first and does not
        // hold: the flag is cleared whenever the element's contents changed at
        // all, and selecting a symbol already in the watchlist scrolls the board
        // to it — the rows change completely, so the tap looks proven while the
        // assertion it was supposed to satisfy still fails. Content moving is
        // not the same as the right content moving, and only the failure that
        // follows can tell them apart.
        const suspect = [...results]
          .reverse()
          .find((r) => r.step.intent.kind === 'tap' && 'element' in r.step.intent);
        if (suspect) {
          this.lastHealingObservation = {
            failingLine: step.line,
            unverifiedLine: suspect.step.line,
            priorTaps: [...this.tappedSoFar],
            visibleNow: await this.visibleOnScreenOf(step.intent),
          };
        }
        results.push({
          step,
          status: 'failed',
          durationMs: Date.now() - t0,
          attempts: 1,
          error: { message: e.message, stack: e.stack },
          failureKind: classifyFailure(e, step.intent.kind),
          ...(shot ? { screenshot: shot } : {}),
        });
        // Stop at the first failure: everything after it runs on an unknown state
        // and would only produce noise in the report.
        aborted = true;
      }
    }
    return results;
  }

  /**
   * Registry elements on the failing step's screen that are on the page now.
   *
   * Bounded on purpose. Each entry costs a visibility probe, and this runs at
   * the worst possible moment — a scenario that has already failed, with the
   * operator waiting. Elements with no locator are skipped rather than probed:
   * they cannot be driven, so healing could not propose them anyway.
   */
  private async visibleOnScreenOf(
    intent: Intent,
  ): Promise<Array<{ elementId: string; label: string }>> {
    const elementId = 'element' in intent ? intent.element : undefined;
    if (!elementId) return [];
    const screen = this.resolver.registry.element(elementId).screen;
    const platform = this.driver.platform;

    const candidates = Object.values(this.resolver.registry.raw.elements)
      .filter((el) => el.screen === screen)
      .filter((el) => (el.candidates[platform]?.length ?? 0) > 0)
      .slice(0, HEALING_PROBE_LIMIT);

    const visible: Array<{ elementId: string; label: string }> = [];
    for (const el of candidates) {
      const seen = await this.resolver.isVisibleNow(el.id).catch(() => false);
      if (seen) visible.push({ elementId: el.id, label: el.label });
    }
    return visible;
  }

  /**
   * Everything the element's locator matches, with the caption fallback applied.
   *
   * Shared so a remembered number and an asserted one are read the same way.
   * `"Được chuyển"` is a caption whose value lives in the next node, and a
   * `remember` step that read the caption would store the label instead of the
   * balance — then compare it against a real figure later and report a
   * difference that never happened.
   */
  private async readTexts(
    elementId: string,
    resolution: { candidate: LocatorCandidate; handle: UiHandle },
  ): Promise<string[]> {
    const snapshot = this.driver.inspectMatches
      ? await this.driver.inspectMatches(resolution.candidate)
      : { count: 1, texts: [(await resolution.handle.text()).trim()], focused: [] };
    const seen = snapshot.texts.map((value) => value.trim());

    if (!this.driver.captionValue || seen.length === 0) return seen;
    const label = this.resolver.registry.element(elementId).label;
    const readTheLabel = seen.every(
      (value) => normalizeHumanText(value) === normalizeHumanText(label),
    );
    if (!readTheLabel) return seen;
    const value = await this.driver.captionValue(resolution.handle).catch(() => undefined);
    if (value === undefined) return seen;
    console.log(`[assert] "${label}" là nhãn, không phải giá trị — đọc sang "${value.trim()}".`);
    return [value.trim()];
  }

  /** The observation gathered by the most recent failing attempt, if any. */
  takeHealingObservation(): StepHealingObservation | undefined {
    const observation = this.lastHealingObservation;
    this.lastHealingObservation = undefined;
    return observation;
  }

  /** Returns heal info when the element resolved through a fallback locator. */
  private async execute(
    intent: Intent,
    expectation?: ActionExpectation,
    semanticContext: string[] = [],
    contextAnchor?: string,
  ): Promise<StepResult['heal']> {
    this.executeDepth += 1;
    try {
      return await this.executeIntent(intent, expectation, semanticContext, contextAnchor);
    } finally {
      this.executeDepth -= 1;
    }
  }

  private async executeIntent(
    intent: Intent,
    expectation?: ActionExpectation,
    semanticContext: string[] = [],
    contextAnchor?: string,
  ): Promise<StepResult['heal']> {
    const d = this.driver;

    const withElement = async (
      id: string,
      action: ActionKind,
      override?: Partial<ResolveOptions>,
    ) => {
      const r = await this.resolver.resolve(id, {
        semanticContext,
        contextAnchor,
        ...override,
        discoveryAction: action,
      });
      const heal =
        r.healed && r.previous
          ? { elementId: id, from: r.previous, to: r.candidate }
          : undefined;
      if (action === 'assert-visible') {
        // Chữ đọc không được thì vẫn ghi locator: một nút icon không có chữ nào
        // để đọc, mà "khớp bằng locator nào" tự nó đã là bằng chứng.
        const saw = await r.handle.text().catch(() => undefined);
        this.lastEvidence = {
          locator: `${r.candidate.strategy}=${r.candidate.value}`,
          ...(saw && saw.trim() ? { saw: saw.trim().slice(0, 200) } : {}),
        };
      }
      return {
        r,
        heal,
        confirm: () => this.resolver.confirmResolution(id, r),
      };
    };

    switch (intent.kind) {
      case 'launch':
        await d.launch(intent.target);
        return undefined;

      case 'ensureLoggedIn':
        return this.ensureLoggedIn(intent.account);

      case 'openFeatureFromSearch':
        return this.openFeatureFromSearch(intent.query, expectation);

      case 'tap': {
        return this.tapWithVerifiedOutcome(
          intent.element,
          expectation,
          withElement,
          intent.rowAction,
          intent.locatorParams,
          contextAnchor,
        );
      }

      case 'hover': {
        assertCapabilitySupported('hover', d.platform);
        if (!d.hover) throw new UnsupportedActionCapabilityError('hover', d.platform);
        const { r, heal, confirm } = await withElement(intent.element, 'hover', {
          locatorParams: intent.locatorParams,
        });
        await d.hover(r.handle);
        if (expectation) await this.verifyExpectation(expectation, false);
        confirm();
        return heal;
      }

      case 'dragDrop': {
        assertCapabilitySupported('dragDrop', d.platform);
        if (!d.dragDrop) throw new UnsupportedActionCapabilityError('dragDrop', d.platform);
        const source = await withElement(intent.source, 'drag', {
          locatorParams: intent.sourceLocatorParams,
        });
        const target = await withElement(intent.target, 'assert-visible', {
          locatorParams: intent.targetLocatorParams,
        });
        await d.dragDrop(source.r.handle, target.r.handle);
        if (expectation) await this.verifyExpectation(expectation, false);
        source.confirm();
        target.confirm();
        return source.heal ?? target.heal;
      }

      case 'longPress': {
        const { r, heal, confirm } = await withElement(intent.element, 'tap', {
          locatorParams: intent.locatorParams,
        });
        await d.longPress(r.handle, intent.ms ?? 1000);
        confirm();
        return heal;
      }

      case 'input': {
        const { r, heal, confirm } = await withElement(intent.element, 'input', {
          locatorParams: intent.locatorParams,
        });
        const text = this.expand(intent.text);
        const element = this.resolver.registry.element(intent.element);
        const typeDelay = element.typeDelay;
        const routed = await performAdaptiveInput(
          d,
          r.handle,
          text,
          typeDelay,
          element.controlType,
        );
        if (routed.action === 'selectDate') {
          const evidence = routed.inspection?.evidence ?? [];
          this.resolver.registry.recordControlType(intent.element, 'date', evidence);
          const actual = await r.handle.value?.();
          if (actual !== undefined && actual !== null && !sameDate(actual, text)) {
            throw new Error(
              `Date assertion failed on "${intent.element}": expected "${intent.text}", got "${actual}".`,
            );
          }
          console.log(
            `[control] "${intent.element}": input → selectDate` +
              (evidence.length ? ` (${evidence.join('; ')})` : ''),
          );
          confirm();
          return heal;
        }
        if (this.opts.verifyInput !== false) {
          try {
            await this.verifyInput(r.handle, text, intent.text);
          } catch (firstError) {
            // Reactive/autocomplete inputs can re-render between two key events
            // and drop a character even though Playwright completed typing.
            // Read-back already proved the write was wrong, so clear and make
            // one slower corrective attempt instead of failing the whole flow.
            await d.clear(r.handle).catch(() => {});
            const retryDelay = typeDelay ? Math.max(100, typeDelay * 2) : undefined;
            await d.input(r.handle, text, retryDelay);
            try {
              await this.verifyInput(r.handle, text, intent.text);
            } catch {
              throw firstError;
            }
          }
        }
        confirm();
        return heal;
      }

      case 'selectDate': {
        if (!d.selectDate) {
          throw new Error(`Nền tảng ${d.platform} chưa hỗ trợ thao tác chọn ngày.`);
        }
        const { r, heal, confirm } = await withElement(intent.element, 'input', {
          locatorParams: intent.locatorParams,
        });
        const date = this.expand(intent.date);
        const inspection = await d.inspectControl?.(r.handle).catch(() => undefined);
        await d.selectDate(r.handle, date);
        const actual = await r.handle.value?.();
        if (actual !== undefined && actual !== null) {
          if (!sameDate(actual, date)) {
            throw new Error(
              `Date assertion failed on "${intent.element}": expected "${intent.date}", got "${actual}".`,
            );
          }
        }
        if (inspection?.type === 'date') {
          this.resolver.registry.recordControlType(intent.element, 'date', inspection.evidence);
        }
        confirm();
        return heal;
      }

      case 'clear': {
        const { r, heal, confirm } = await withElement(intent.element, 'input', {
          locatorParams: intent.locatorParams,
        });
        await d.clear(r.handle);
        confirm();
        return heal;
      }

      case 'select': {
        const { r, heal, confirm } = await withElement(intent.element, 'select', {
          locatorParams: intent.locatorParams,
        });
        await d.selectOption(r.handle, intent.option);
        confirm();
        return heal;
      }

      case 'scrollTo': {
        assertCapabilitySupported('scrollTo', d.platform);
        // Resolve without the visibility requirement first: the element may be
        // in the tree but off-screen, which is exactly the case scrollTo exists for.
        const { r, heal, confirm } = await withElement(intent.element, 'scroll', {
          requireVisible: false,
          locatorParams: intent.locatorParams,
        });
        await d.scrollIntoView(r.handle);
        const visible = await this.resolver.resolve(intent.element, {
          timeoutMs: 3000,
          discoveryAction: 'assert-visible',
          locatorParams: intent.locatorParams,
        });
        confirm();
        this.resolver.confirmResolution(intent.element, visible);
        return heal;
      }

      case 'swipe':
        await d.swipe(intent.direction);
        return undefined;

      case 'scroll':
        assertCapabilitySupported('scroll', d.platform);
        await d.scroll(intent.direction);
        return undefined;

      case 'back':
        await d.back();
        return undefined;

      case 'focusRegion': {
        const { heal, confirm } = await withElement(intent.element, 'assert-visible', {
          locatorParams: intent.locatorParams,
        });
        confirm();
        return heal;
      }

      case 'waitFor': {
        if (this.consumePreverified(intent.element, intent.locatorParams)) return undefined;
        const { heal, confirm } = await withElement(intent.element, 'assert-visible', {
          ...(intent.timeoutMs ? { timeoutMs: intent.timeoutMs } : {}),
          locatorParams: intent.locatorParams,
        });
        confirm();
        return heal;
      }

      case 'assertVisible': {
        if (this.consumePreverified(intent.element, intent.locatorParams)) return undefined;
        const { heal, confirm } = await withElement(intent.element, 'assert-visible', {
          locatorParams: intent.locatorParams,
        });
        confirm();
        return heal;
      }

      case 'assertNotVisible':
        await this.resolver.resolveAbsent(intent.element, {
          locatorParams: intent.locatorParams,
        });
        return undefined;

      case 'assertOption': {
        const { r, heal, confirm } = await withElement(intent.element, 'assert-visible', {
          locatorParams: intent.locatorParams,
        });
        if (!this.driver.listOptions) {
          throw new Error(
            `Driver ${this.driver.platform} không đọc được danh sách lựa chọn, `
            + `nên không kiểm tra được "${intent.option}" trong "${intent.element}".`,
          );
        }
        const options = await this.driver.listOptions(r.handle);
        // `undefined` is "cannot tell", and it must never be read as "no
        // options" — that would make an `absent` assertion pass having checked
        // nothing at all.
        if (options === undefined) {
          throw new Error(
            `Không mở/đọc được danh sách lựa chọn của "${intent.element}" trên ${this.driver.platform}.`,
          );
        }
        const wanted = normalizeHumanText(intent.option);
        const found = options.some((label) => normalizeHumanText(label) === wanted);
        if (found !== (intent.expect === 'present')) {
          const list = options.length > 0 ? options.join(' | ') : '(danh sách trống)';
          throw new Error(
            intent.expect === 'absent'
              ? `"${intent.option}" vẫn nằm trong danh sách của "${intent.element}": ${list}`
              : `"${intent.option}" không có trong danh sách của "${intent.element}": ${list}`,
          );
        }
        confirm();
        return heal;
      }

      case 'assertText': {
        if (intent.mode === 'notContains') {
          // "Does not show" is satisfied by an element that is not there at
          // all — after the last matching row is deleted there is nothing left
          // to read — so absence is checked first and passes.
          const present = await this.resolver.isVisibleNow(intent.element, {
            locatorParams: intent.locatorParams,
          });
          if (!present) return undefined;
          const { r, heal, confirm } = await withElement(intent.element, 'assert-text', {
            locatorParams: intent.locatorParams,
          });
          // Every match, not just the first: the label usually names a list,
          // and a row further down still counts as "shown".
          const snapshot = this.driver.inspectMatches
            ? await this.driver.inspectMatches(r.candidate)
            : { count: 1, texts: [(await r.handle.text()).trim()], focused: [] };
          const unwanted = this.expand(intent.text).trim();
          const offender = snapshot.texts.find((value) => value.trim().includes(unwanted));
          if (offender !== undefined) {
            throw new Error(
              `Text assertion failed on "${intent.element}": expected not to contain ` +
                `"${intent.text.trim()}", but found it in "${offender.trim()}".`,
            );
          }
          confirm();
          return heal;
        }
        let { r, heal, confirm } = await withElement(intent.element, 'assert-text', {
          locatorParams: intent.locatorParams,
        });
        // Every match, not just the first — the same reason the negative form
        // above reads them all. A label like "Dòng cổ phiếu trong danh mục"
        // names a repeated row, so "shows VIC" asks whether any row shows it;
        // reading only the first turned "VIC is in the watchlist" into "VIC is
        // at the top of the watchlist", which is a different claim and failed
        // against a list sorted alphabetically. An element that matches once is
        // unaffected: the snapshot then holds exactly one text.
        const read = async (resolution: typeof r) => this.driver.inspectMatches
          ? await this.driver.inspectMatches(resolution.candidate)
          : { count: 1, texts: [(await resolution.handle.text()).trim()], focused: [] };
        let snapshot = await read(r);

        // Một candidate đã resolve nhưng giờ khớp KHÔNG phần tử nào không phải
        // bằng chứng "chữ không đúng" — nó là bằng chứng phần tử đã rời màn
        // hình giữa lúc resolve và lúc đọc.
        //
        // Trước đây snapshot rỗng đi thẳng xuống phần so sánh, thành `got ""`,
        // và câu đó gửi người đọc đi tìm một lỗi nội dung không hề tồn tại:
        //
        //   Text assertion failed on "transfer.thongBao":
        //   expected to contain "Chuyển tiền thành công", got "".
        //
        // Thực tế `.subtitle-dialog-common` (candidate nặng ký nhất) trỏ vào
        // dialog xác nhận, mà dialog ấy đóng ngay sau khi bấm XÁC NHẬN. Câu
        // thành công vẫn nằm trên màn hình, ở candidate xếp sau —
        // `.msg-row-wraper .label-content` — nhưng không ai hỏi tới nó, vì
        // resolver đã dừng ở candidate đầu tiên tìm thấy.
        const rejected: string[] = [];
        while (snapshot.count === 0 && rejected.length < 3) {
          this.resolver.rejectResolution(intent.element, r);
          rejected.push(candidateKey(r.candidate));
          const next = await withElement(intent.element, 'assert-text', {
            locatorParams: intent.locatorParams,
            excludeCandidateKeys: rejected,
          }).catch(() => null);
          if (!next) break;
          ({ r, heal, confirm } = next);
          snapshot = await read(r);
        }
        if (snapshot.count === 0) {
          throw new Error(
            `"${intent.element}" không còn trên màn hình lúc kiểm tra `
            + `(đã thử ${rejected.length + 1} locator). Không kết luận được về nội dung.`,
          );
        }
        const seen = snapshot.texts.map((value) => value.trim());
        const expected = this.expand(intent.text).trim();
        const matches = (values: string[]) => intent.mode === 'equals'
          ? values.some((value) => value === expected)
          : values.some((value) => value.includes(expected));
        let ok = matches(seen);

        // An amount written plainly against an amount rendered with separators.
        // The screen says "1,000" and a scenario says "1000" — or the reverse,
        // or "1.000" in another locale — and a string comparison calls the
        // product broken over punctuation nobody typed. Compared as numbers
        // only when the scenario asked for one, so "VIC" and "Ký Quỹ" are
        // untouched, and by equality, so "1" never matches "1,000".
        if (!ok) ok = matchesAsNumber(expected, seen);

        // Everything we read back was the element's own name — the signature of
        // having matched a caption rather than the field it names. Only worth
        // the extra read when the comparison has already failed.
        if (!ok) {
          const withValue = await this.readTexts(intent.element, r);
          if (withValue.join(' ') !== seen.join(' ')) {
            seen.splice(0, seen.length, ...withValue);
            // Both comparisons again, not just the string one. The numeric
            // check above ran while `seen` still held the caption -- "Tien
            // chuyen (Phi = 0)" -- so the amount it was meant to compare had
            // not been read yet. Retrying only `matches` here left "1000"
            // failing against "1,000" with the fix apparently installed.
            ok = matches(seen) || matchesAsNumber(expected, seen);
          }
        }
        if (!ok) {
          // Report the *unexpanded* text. A substituted secret must not end up
          // in an error message, and from there in the HTML report.
          // Read from `seen` here, after any caption fallback has replaced it.
          // Reporting the pre-fallback text said `got "Được chuyển"` while the
          // comparison had actually used "7,329" — sending the reader to hunt a
          // locator problem that had already been solved.
          const shown = seen.length > 1
            ? `${seen.length} phần tử, ví dụ "${seen.slice(0, 3).join('" / "')}"`
            : `"${seen[0] ?? ''}"`;
          throw new Error(
            `Text assertion failed on "${intent.element}": expected ` +
              `${intent.mode === 'equals' ? '' : 'to contain '}"${intent.text.trim()}", got ${shown}.`,
          );
        }
        confirm();
        return heal;
      }

      case 'rememberNumber': {
        const { r, heal, confirm } = await withElement(intent.element, 'assert-text', {
          ...(intent.locatorParams ? { locatorParams: intent.locatorParams } : {}),
        });
        const texts = await this.readTexts(intent.element, r);
        const value = parseDisplayedNumber(texts[0] ?? '');
        this.remembered.set(intent.as, value);
        console.log(`[remember] "${intent.as}" = ${value}`);
        confirm();
        return heal;
      }

      case 'assertNumberDelta': {
        const before = this.remembered.get(intent.as);
        if (before === undefined) {
          // Naming the step rather than the value: a scenario that asserts a
          // delta without having taken a reading is a wording mistake, and the
          // fix is to add the remember step, not to guess a starting figure.
          throw new Error(
            `Chưa có giá trị nào được ghi nhớ dưới tên "${intent.as}". `
            + `Thêm bước: I remember "..." as "${intent.as}" trước bước này.`,
          );
        }
        const { r, heal, confirm } = await withElement(intent.element, 'assert-text', {
          ...(intent.locatorParams ? { locatorParams: intent.locatorParams } : {}),
        });
        const texts = await this.readTexts(intent.element, r);
        const after = parseDisplayedNumber(texts[0] ?? '');
        const delta = after - before;
        const expected = intent.direction === 'unchanged'
          ? 0
          : intent.direction === 'increased' ? (intent.by ?? 0) : -(intent.by ?? 0);

        const ok = intent.direction === 'unchanged'
          ? delta === 0
          : intent.direction === 'changed'
          ? delta !== 0
          : intent.by === undefined
            // No amount given: only the direction is claimed.
            ? (intent.direction === 'increased' ? delta > 0 : delta < 0)
            : delta === expected;
        if (!ok) {
          throw new Error(
            `"${this.resolver.registry.element(intent.element).label}" ${
              intent.direction === 'unchanged' ? 'phải không đổi' :
              intent.direction === 'changed' ? 'phải thay đổi' :
              `phải ${intent.direction === 'increased' ? 'tăng' : 'giảm'}` +
              (intent.by === undefined ? '' : ` ${intent.by}`)
            } so với "${intent.as}" (${before}), nhưng giá trị hiện tại là ${after} `
            + `(chênh lệch ${delta >= 0 ? '+' : ''}${delta}).`,
          );
        }
        confirm();
        return heal;
      }

      case 'assertNumber': {
        const { r, heal, confirm } = await withElement(intent.element, 'assert-text', {
          locatorParams: intent.locatorParams,
        });
        const actualText = (await r.handle.text()).trim();
        const actual = parseDisplayedNumber(actualText);
        const expected = intent.value;
        const ok = intent.operator === 'notEquals'
          ? actual !== expected
          : intent.operator === 'greaterThan'
            ? actual > expected
            : intent.operator === 'atLeast'
              ? actual >= expected
              : intent.operator === 'atMost'
                ? actual <= expected
              : actual === expected;
        if (!ok) {
          throw new Error(
            `Numeric assertion failed on "${intent.element}": value "${actualText}" ` +
              `does not satisfy ${intent.operator} ${expected}.`,
          );
        }
        confirm();
        return heal;
      }

      case 'assertCollection': {
        const { r, heal, confirm } = await withElement(intent.element, 'assert-text', {
          locatorParams: intent.locatorParams,
        });
        const check = intent.check;
        // Counted once, the moment the rows resolve — which is not the moment
        // the list finishes changing. Adding a ticker and immediately asking
        // how many rows carry it read 0 of 30 while the row was on its way in.
        //
        // This is waiting for a state, not retrying an assertion: the loop ends
        // the instant the condition holds, so a correct step pays nothing, and
        // a genuinely wrong one still fails with the last thing actually seen.
        // The scenario is never re-run — a wrong assertion must stay wrong.
        let snapshot = await this.collectionSnapshot(r);
        const deadline = Date.now() + COLLECTION_SETTLE_MS;
        while (!collectionVerdict(check, snapshot, (value) => this.expand(value)).ok
          && Date.now() < deadline) {
          await sleep(TRANSIENT_POLL_MS);
          snapshot = await this.collectionSnapshot(r);
        }
        const verdict = collectionVerdict(check, snapshot, (value) => this.expand(value));
        if (!verdict.ok) {
          throw new Error(
            `Collection assertion failed on "${intent.element}": expected ${verdict.expected}; `
            + verdict.observed,
          );
        }
        confirm();
        return heal;
      }

      case 'screenshot':
        // Kept, not discarded. The path used to be thrown away here, so a
        // screenshot a scenario deliberately asked for was written to disk and
        // recorded nowhere — `StepResult.screenshot` existed but only the
        // failure path ever filled it, and the report renders what the result
        // says, not what the directory happens to contain.
        this.lastShot = await d.screenshot(intent.name);
        return undefined;
    }
  }

  /**
   * Reusable authenticated precondition shared by web, Android and iOS.
   * Web may restore a private local Playwright state; native simply follows
   * the same UI flow. In every case the visible logged-in state is verified.
   */
  private async ensureLoggedIn(account: string): Promise<StepResult['heal']> {
    await this.ensureApplicationSurface();
    const homeId = 'home.totalAssets';
    if (await this.resolver.isVisibleNow(homeId).catch(() => false)) return undefined;

    if (this.driver.restoreAuthenticatedSession) {
      const restored = await this.driver.restoreAuthenticatedSession(account).catch(() => false);
      if (restored) {
        try {
          const resolution = await this.resolver.resolve(homeId, {
            timeoutMs: 8_000,
            discoveryAction: 'assert-visible',
          });
          this.resolver.confirmResolution(homeId, resolution);
          console.log(`[flow] dùng session đăng nhập local đã được kiểm tra cho "${account}"`);
          return resolution.healed && resolution.previous
            ? { elementId: homeId, from: resolution.previous, to: resolution.candidate }
            : undefined;
        } catch {
          await this.driver.invalidateAuthenticatedSession?.(account).catch(() => {});
          console.log(`[flow] session local của "${account}" không còn hợp lệ — đăng nhập lại qua UI`);
        }
      }
    }

    let firstHeal: StepResult['heal'];
    const remember = (heal: StepResult['heal']) => { firstHeal ??= heal; };
    remember(await this.execute({
      kind: 'input',
      element: 'login.usernameField',
      text: `{{account.${account}.username}}`,
    }));
    remember(await this.execute({
      kind: 'input',
      element: 'login.passwordField',
      text: `{{account.${account}.password}}`,
    }));
    remember(await this.execute({ kind: 'tap', element: 'login.submitButton' }, {
      elementId: homeId,
      state: 'visible',
      action: 'assert-visible',
      source: 'đăng nhập thành công',
    }));
    const home = await this.resolver.resolve(homeId, {
      timeoutMs: 20_000,
      discoveryAction: 'assert-visible',
    });
    this.resolver.confirmResolution(homeId, home);
    await this.driver.saveAuthenticatedSession?.(account).catch((err) => {
      console.warn(`[flow] không lưu được session local: ${(err as Error).message}`);
    });
    return firstHeal ?? (home.healed && home.previous
      ? { elementId: homeId, from: home.previous, to: home.candidate }
      : undefined);
  }

  /**
   * `beginScenario()` deliberately creates a clean Playwright page. A reusable
   * precondition such as "I am logged in" must therefore be able to establish
   * its own application surface instead of assuming a preceding Background
   * step happened to navigate there.
   *
   * Native drivers are left alone: launching an installed app is platform
   * lifecycle work and generated features receive an explicit Background guard.
   */
  private async ensureApplicationSurface(): Promise<void> {
    const platform = this.driver.runPlatform ?? this.driver.platform;
    if (platform !== 'web' || !this.driver.currentUrl) return;

    const before = await this.driver.currentUrl().catch(() => '');
    if (before && before !== 'about:blank') return;

    try {
      await this.driver.launch();
    } catch (err) {
      throw new TestPilotError(
        TestPilotErrorCode.RUNTIME_APP_NOT_LAUNCHED,
        `Không mở được ứng dụng web trước điều kiện đăng nhập: ${(err as Error).message}`,
        { url: before || 'unknown' },
      );
    }

    const after = await this.driver.currentUrl().catch(() => '');
    if (!after || after === 'about:blank') {
      throw new TestPilotError(
        TestPilotErrorCode.RUNTIME_APP_NOT_LAUNCHED,
        'Ứng dụng web chưa được mở; trang hiện tại vẫn là about:blank.',
        { url: after || 'unknown' },
      );
    }
    console.log(`[flow] đã mở ứng dụng trước điều kiện đăng nhập (${after})`);
  }

  /** Search by exact business name rather than blindly clicking row one. */
  private async openFeatureFromSearch(
    query: string,
    expectation?: ActionExpectation,
  ): Promise<StepResult['heal']> {
    let firstHeal: StepResult['heal'];
    const remember = (heal: StepResult['heal']) => { firstHeal ??= heal; };
    let lastError: Error | undefined;

    // Search navigation is read-only and safe to repeat. TCInvest occasionally
    // closes the result drawer while leaving `/home` blank; one fresh search
    // recovers that transient state without turning every action into a retry.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        remember(await this.execute({ kind: 'tap', element: 'home.searchBox' }));
        remember(await this.execute({ kind: 'input', element: 'home.searchInput', text: query }));
        remember(await this.execute({ kind: 'waitFor', element: 'home.searchFirstResult' }));
        const beforeResultUrl = await this.driver.currentUrl?.().catch(() => '') ?? '';
        // Clicked through the same locator this just waited on, not by the
        // query text. Searching "Chuyển tiền" leaves that phrase in seven
        // visible places on this app — the header toolbox, the home grid behind
        // the dialog, the screen title — and the text lookup returned all
        // seven, clicking whichever came first in the DOM. That was the right
        // one until the home screen changed behind the dialog, and then eight
        // scenarios in one run failed on this single step.
        // `home.searchFirstResult` matches exactly one node.
        remember(await this.execute({ kind: 'tap', element: 'home.searchFirstResult' }));
        if (await this.featureNavigationSucceeded(beforeResultUrl, expectation)) {
          return firstHeal;
        }
        throw new Error(
          `Kết quả tìm kiếm "${query}" đã được click nhưng không đổi màn hình hoặc URL.`,
        );
      } catch (err) {
        lastError = err as Error;
        if (attempt >= 2) break;
        // Kèm lý do: lượt thử thứ hai thường hỏng y hệt lượt đầu, và nếu dòng
        // này im lặng thì cả hai lần đều không để lại gì để lần theo.
        console.warn(
          `[flow] tìm kiếm "${query}" chưa mở được trang đích `
          + `(${lastError.message.split('\n')[0]!.trim().slice(0, 160)}) `
          + '— làm mới thao tác tìm kiếm một lần.',
        );
        await this.driver.dismissOverlay?.().catch(() => false);
        await sleep(500);
      }
    }

    throw lastError ?? new Error(`Không mở được tính năng "${query}" từ tìm kiếm.`);
  }

  /**
   * Prove the search navigation itself, independently from the first action on
   * the destination screen. A freshly generated next-step element may not have
   * a locator yet; using it as the sole postcondition made a successful route
   * change look like a failed search and retried against the now-hidden home
   * input.
   */
  private async featureNavigationSucceeded(
    beforeUrl: string,
    expectation?: ActionExpectation,
    timeoutMs = 5_000,
  ): Promise<boolean> {
    const started = Date.now();
    do {
      const current = await this.driver.currentUrl?.().catch(() => '') ?? '';
      if (routeIdentity(current) && routeIdentity(current) !== routeIdentity(beforeUrl)) {
        console.log(`[flow] feature route đã mở (${current})`);
        return true;
      }
      if (expectation && await this.resolver.isVisibleNow(expectation.elementId, {
        locatorParams: expectation.locatorParams,
      }).catch(() => false)) {
        return true;
      }
      await sleep(100);
    } while (Date.now() - started < timeoutMs);
    return false;
  }

  /**
   * A click is successful only when it produces the state implied by the next
   * scenario step.  Contextual row/menu actions may try bounded alternatives;
   * ordinary actions fail rather than exploring potentially destructive UI.
   */
  private async tapWithVerifiedOutcome(
    elementId: string,
    expectation: ActionExpectation | undefined,
    withElement: (
      id: string,
      action: ActionKind,
      override?: Partial<ResolveOptions>,
    ) => Promise<{
      r: Resolution;
      heal: StepResult['heal'] | undefined;
      confirm: () => void;
    }>,
    rowAction?: { rowText: string; action: string },
    locatorParams?: Record<string, string>,
    contextAnchor?: string,
  ): Promise<StepResult['heal']> {
    const definition = this.resolver.registry.element(elementId);
    // This project executes against test accounts/environments. Every tap may
    // therefore try bounded locator alternatives; correctness is still gated
    // by the observable postcondition, not by a guessed business-risk label.
    const retryable = true;
    const actionLabel = rowAction
      ? `Icon ${rowAction.action} tại dòng ${rowAction.rowText}`
      : definition.label;
    const maxAttempts = retryable ? (this.opts.actionHealingAttempts ?? 4) : 1;
    const excluded = new Set<string>();
    let phaseStarted = Date.now();
    const preResolution = expectation
      ? await this.resolver.visibleResolutionNow(expectation.elementId, {
          locatorParams: expectation.locatorParams,
        }).catch(() => undefined)
      : undefined;
    const preVisible = expectation ? Boolean(preResolution) : undefined;
    // What the element held before the tap. Visibility alone cannot tell a tap
    // that changed a list from one that did nothing: a watchlist's rows are on
    // screen either way. The contents can.
    const preSnapshot = preResolution
      ? await this.collectionSnapshot(preResolution).catch(() => undefined)
      : undefined;
    logSlowActionPhase(actionLabel, 'precondition probe', phaseStarted);
    const transitionCanBeProven = expectation
      ? expectation.state === 'visible' ? !preVisible : Boolean(preVisible)
      : false;
    let lastOutcomeError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Marks the point after which anything the application says is a reply to
      // this attempt, and not left over from before it.
      const attemptStartedAt = Date.now();
      let resolved: Awaited<ReturnType<typeof withElement>>;
      try {
        phaseStarted = Date.now();
        resolved = await withElement(elementId, 'tap', {
          ...((locatorParams || rowAction) ? {
            locatorParams: { ...locatorParams, ...rowAction },
          } : {}),
          ...(excluded.size > 0 ? {
            excludeCandidateKeys: [...excluded],
            timeoutMs: 1_000,
          } : {}),
        });
        logSlowActionPhase(actionLabel, `resolve attempt ${attempt}`, phaseStarted);
      } catch (error) {
        // Preserve the meaningful outcome failure from the candidate we did
        // click. "0 candidates after exclusion" is only an implementation
        // detail and must not replace the reason healing started.
        if (lastOutcomeError) break;
        throw error;
      }
      const { r, heal, confirm } = resolved;

      phaseStarted = Date.now();
      try {
        await this.driver.tap(r.handle);
      } catch (error) {
        // A click can land and still be reported as failed: what it opens
        // covers the control it was aimed at, so the driver's own actionability
        // retry finds the button intercepted and eventually gives up. Deleting
        // a watchlist row failed exactly this way — the row menu it had just
        // opened was sitting over the "..." that opened it, and the artifact
        // showed the menu present with every item the next step needed.
        //
        // Neither driver-level fallback fits: dismissing the overlay would
        // close the very thing the step produced, and clicking another match
        // would act on a different row. The outcome is the authority — if what
        // the tap was supposed to produce is already on screen, the tap
        // happened.
        const provable = expectation && expectation.state !== 'absent';
        // Given a window, not a glance. `isVisibleNow` gives each candidate one
        // 250ms attach probe, and what a click opens is usually still animating
        // when the click itself is declared failed — the captured artifact for
        // this exact failure showed the menu present while the check a moment
        // earlier had reported nothing.
        const already = provable
          ? (await this.watchBriefly(expectation, TRANSIENT_WATCH_MS)).seen
          : false;
        if (!already) {
          // Say why the escape hatch declined. Without this the step just fails
          // with the driver's click error and there is no way to tell whether
          // the outcome was checked at all.
          // Distinguish "not on the page" from "on the page but not visible":
          // the two have different causes and different fixes, and the message
          // above cannot tell them apart.
          // A picture of the page at the moment the outcome was looked for.
          // Reasoning from logs alone produced five wrong explanations for this
          // one failure; the screenshot taken here is of the state that matters
          // rather than the state left behind after everything else gave up.
          // A picture of the page at the moment the outcome was looked for.
          // Reasoning from logs alone produced six wrong explanations for one
          // failure here; the screenshot is of the state that matters rather
          // than the state left behind after everything else gave up.
          const shot = await this.driver.screenshot?.(`tap-declined-${Date.now()}`)
            .catch(() => undefined);
          if (shot) this.lastDeclinedShot = { path: shot, at: Date.now() };
          const presence = shot ? ` [ảnh: ${shot}]` : '';
          console.warn(
            `[tap] "${actionLabel}": ${driverReason(error)}, và ${provable
              ? `"${expectation!.source}" cũng không thấy${presence} → coi là lỗi thật`
              : 'bước sau không chứng minh được kết quả → không thể xác nhận'}`,
          );
          throw error;
        }
        console.warn(
          `[tap] "${actionLabel}": driver báo lỗi bấm nhưng "${expectation!.source}" đã xuất hiện `
          + '— cú bấm đã trúng, phần tử bị chính kết quả của nó che.',
        );
      }
      logSlowActionPhase(actionLabel, `click attempt ${attempt}`, phaseStarted);
      phaseStarted = Date.now();
      await this.driver.isIdle().catch(() => {});
      logSlowActionPhase(actionLabel, `idle wait attempt ${attempt}`, phaseStarted);

      if (!expectation || !transitionCanBeProven) {
        // Visibility could not prove the transition, but contents still might:
        // the element was already on screen, so read it again and see whether
        // the tap moved anything inside it. This is what separates a click that
        // added a row from a click that landed on nothing — both leave the same
        // rows visible, and only one changes them.
        const postSnapshot = preSnapshot
          ? await this.resolver.visibleResolutionNow(expectation!.elementId, {
              locatorParams: expectation!.locatorParams,
            })
            .then((r) => (r ? this.collectionSnapshot(r) : undefined))
            .catch(() => undefined)
          : undefined;
        if (preSnapshot && postSnapshot && snapshotChanged(preSnapshot, postSnapshot)) {
          confirm();
          return heal;
        }
        // Nothing observable separates "it worked" from "it did nothing".
        // Confirm the locator — it did resolve and click — but do not let the
        // step claim it verified an outcome.
        // Same gate as the flag: a helper tap inside a composite step is not
        // something the reader can act on, and eight such lines per run is how
        // a warning stops being read at all.
        if (this.executeDepth <= 1) {
          this.lastUnverified = true;
          console.warn(
            `[tap] "${actionLabel}": không có gì chứng minh cú bấm tạo ra thay đổi`
            + (expectation
              ? ` — "${expectation.source}" đã thoả sẵn từ trước khi bấm`
                + (postSnapshot ? ' và nội dung không đổi.' : '.')
              : ' — bước sau không dùng được làm hậu điều kiện.'),
          );
        }
        confirm();
        return heal;
      }

      const expectedLabel = this.resolver.registry.element(expectation.elementId).label;
      // Reading selected state may require a browser evaluate. Do it only when
      // selection could actually prove the business expectation (e.g. a 1M
      // period tab proving a one-month chart). Running it for ordinary buttons
      // such as "Thêm mã" blocked for ~30 s on TCInvest's chart-heavy page and
      // could never influence the result anyway.
      const selectedCanProve =
        expectation.state === 'visible' &&
        !contextAnchor &&
        selectionProvesBusinessState(actionLabel, expectedLabel);
      phaseStarted = Date.now();
      const selected = selectedCanProve && r.handle.selected
        ? await r.handle.selected().catch(() => undefined)
        : undefined;
      if (selectedCanProve) {
        logSlowActionPhase(actionLabel, `selected-state attempt ${attempt}`, phaseStarted);
      }
      if (
        selectedCanProve &&
        selected === true &&
        expectation.state === 'visible'
      ) {
        confirm();
        this.preverifiedExpectations.add(expectationKey(
          expectation.elementId,
          expectation.locatorParams,
        ));
        console.log(
          `[state] "${actionLabel}" đã selected — xác nhận "${expectedLabel}" bằng trạng thái control.`,
        );
        return heal;
      }

      try {
        phaseStarted = Date.now();
        await this.verifyExpectation(expectation, retryable);
        logSlowActionPhase(actionLabel, `postcondition attempt ${attempt}`, phaseStarted);
        confirm();
        return heal;
      } catch (err) {
        lastOutcomeError = err as Error;

        // The application answered, so the locator is not the suspect.
        //
        // Healing exists to find a better locator when the current one missed.
        // It cannot tell "I clicked the wrong thing" from "I clicked the right
        // thing and was told no" — both end with the expected screen absent —
        // so it treated a refusal as a bad locator and went hunting through
        // other candidates, clicking them, on a live account. One run produced
        // 216 lines of that while the reason sat in the line above:
        //
        //   [popup] nội dung: "TIỀN CHUYỂN + PHÍ VƯỢT QUÁ SỐ TIỀN CÓ THỂ CHUYỂN"
        //
        // A message means the interaction landed. Stop, and report what the
        // application said rather than blaming the element that delivered it.
        const said = this.driver.saidSince?.(attemptStartedAt);
        if (said) {
          throw new Error(
            `"${actionLabel}" đã bấm thành công nhưng app từ chối: "${said}"\n`
            + `Không phải lỗi locator — bước sau ("${expectation?.source ?? 'kết quả mong đợi'}") `
            + 'không xảy ra vì app trả lời như trên.',
          );
        }

        this.resolver.rejectResolution(elementId, r);
        excluded.add(candidateKey(r.candidate));
        if (!retryable || attempt >= maxAttempts) break;
        console.warn(
          `[healing] "${actionLabel}": locator ${r.candidate.strategy} did not produce ` +
          `"${expectation.source}"; trying another contextual candidate.`,
        );
      }
    }

    const state = expectation?.state === 'absent' ? 'biến mất' : 'xuất hiện';
    const message =
      `Click "${actionLabel}" không tạo đúng trạng thái: ` +
      `"${expectation?.source ?? 'bước tiếp theo'}" chưa ${state}.` +
      (lastOutcomeError ? ` Nguyên nhân cuối: ${lastOutcomeError.message}` : '');
    if (retryable) {
      throw new TestPilotError(TestPilotErrorCode.HEALING_REJECTED, message, { elementId });
    }
    throw new Error(message);
  }

  private async verifyExpectation(
    expectation: ActionExpectation,
    fastRetry: boolean,
  ): Promise<void> {
    const configured = this.opts.postconditionTimeoutMs ?? DEFAULT_POSTCONDITION_TIMEOUT_MS;
    const timeoutMs = fastRetry ? Math.min(configured, 2_000) : configured;
    if (expectation.state === 'absent') {
      await this.resolver.resolveAbsent(expectation.elementId, {
        timeoutMs,
        locatorParams: expectation.locatorParams,
      });
      return;
    }

    // Look often before looking hard. What a click produces is frequently a
    // toast that lives about two seconds, while a full resolve tick on a real
    // device costs three: it dismisses overlays, asks whether the page is idle
    // and, from the third tick, observes the entire UI tree. A message can open
    // and close entirely between two of those. Here nothing is diagnosed and
    // nothing is healed — the candidates are simply checked, ~20 times in the
    // window where one patient tick would have looked once.
    const spent = await this.watchBriefly(expectation, timeoutMs);
    if (spent.seen) return;

    // Phần còn lại của ngân sách, nhưng có sàn.
    //
    // Trước đây đây là `max(0, timeoutMs - spent)` — chia thuần từ cùng một
    // ngân sách. Khi bước này chạy trong một lượt thử lại, ngân sách là 2 giây,
    // `watchBriefly` ăn trọn 2 giây, và resolve nhận đúng 0 ms. Mà discovery
    // chỉ BẮT ĐẦU sau 2,5 giây dò hụt, nên nó chưa từng có cơ hội chạy: lỗi trả
    // về là "Could not resolve … after 1 attempts".
    //
    // Đo trên một lượt Device Farm thật: `priceBoard.oMaCoPhieu` chỉ có một
    // locator, `placeholder="Mã cổ phiếu"`, đã thắng 30 lần liên tiếp. Giao
    // diện đổi placeholder, locator hụt, và cả kịch bản đỏ — trong khi thứ cần
    // làm chỉ là nhìn màn hình một lượt và tìm lại ô nhập đó. Discovery làm
    // được việc ấy; nó chỉ không được cấp thời gian.
    //
    // Sàn này là cái giá phải trả đúng ở nhánh hỏng: chậm thêm vài giây cho một
    // postcondition không bao giờ đúng, đổi lấy việc một locator gãy không còn
    // kéo theo cả kịch bản — mà trên farm, một kịch bản là vài phút và tiền
    // thiết bị.
    const remaining = Math.max(0, timeoutMs - spent.elapsedMs);
    const outcome = await this.resolver.resolve(expectation.elementId, {
      timeoutMs: Math.max(remaining, MIN_DISCOVERY_BUDGET_MS),
      discoveryAction: expectation.action,
      locatorParams: expectation.locatorParams,
    });
    this.resolver.confirmResolution(expectation.elementId, outcome);
  }

  private consumePreverified(
    elementId: string,
    locatorParams?: Record<string, string>,
  ): boolean {
    const key = expectationKey(elementId, locatorParams);
    if (!this.preverifiedExpectations.has(key)) return false;
    this.preverifiedExpectations.delete(key);
    return true;
  }

  /**
   * A tight, cheap watch for something that may not stay on screen.
   *
   * Returns whether it was seen, and how much of the budget went into looking.
   */
  /** One reading of everything the element's locator currently matches. */
  private async collectionSnapshot(
    r: { candidate: LocatorCandidate; handle: UiHandle },
  ): Promise<UiMatchSnapshot> {
    return this.driver.inspectMatches
      ? this.driver.inspectMatches(r.candidate)
      : { count: 1, texts: [(await r.handle.text()).trim()], focused: [] };
  }

  private async watchBriefly(
    expectation: ActionExpectation,
    budgetMs: number,
  ): Promise<{ seen: boolean; elapsedMs: number }> {
    const started = Date.now();
    const deadline = started + Math.min(TRANSIENT_WATCH_MS, budgetMs);
    for (;;) {
      const seen = await this.resolver
        .isVisibleNow(expectation.elementId, { locatorParams: expectation.locatorParams })
        .catch(() => false);
      if (seen) return { seen: true, elapsedMs: Date.now() - started };
      if (Date.now() >= deadline) return { seen: false, elapsedMs: Date.now() - started };
      await sleep(TRANSIENT_POLL_MS);
    }
  }

  /**
   * Replaces `{{name}}` with a configured value. An unknown placeholder is left
   * as-is rather than blanked: typing the literal `{{account.maker.password}}`
   * into the field makes the mistake obvious in the failure screenshot, where a
   * silently empty field would just look like a flaky test.
   */
  /**
   * Confirms the field actually holds what was typed.
   *
   * Deliberately tolerant, because the alternative to a few false failures is a
   * suite people switch off:
   *   - a password box reports bullets rather than characters, so a masked
   *     read-back is compared on length alone;
   *   - a field that formats as you type ("0123 456 789") is compared with the
   *     separators removed.
   * What survives both is the case that matters: the field holding a different
   * number of characters than were typed into it.
   *
   * Values are only quoted in the error when the step text had no `{{...}}` in
   * it. A password reaches this function fully expanded, and an error message
   * ends up in the report, in the run log, and in the terminal — the three
   * places a credential must never be written.
   */
  private async verifyInput(handle: UiHandle, typed: string, raw: string): Promise<void> {
    if (!handle.value) return;

    // Polled, not read once. Typing is not synchronous: on a device the value
    // travels setValue -> WebView -> the app's model -> the rendered field, and
    // a cold-started app is still laying out while the next command arrives.
    // Reading immediately caught a field mid-flight and called it empty, which
    // is the same false confidence as not checking at all, only red.
    const deadline = Date.now() + VERIFY_TIMEOUT_MS;
    let got: string | null = null;
    for (;;) {
      got = await handle.value().catch(() => null);
      // null means "not a field"; the driver could not read it and guessing
      // would turn an unknown into a false failure.
      if (got === null) return;
      if (this.inputMatches(got, typed)) return;
      if (Date.now() >= deadline) break;
      await sleep(VERIFY_POLL_MS);
    }

    const detail = /\{\{/.test(raw)
      ? `đã gõ ${typed.length} ký tự, ô đang chứa ${got.length}`
      : `đã gõ "${typed}", ô đang chứa "${got}"`;
    throw new Error(`Ô nhập không nhận đúng giá trị — ${detail}.`);
  }

  /**
   * Deliberately tolerant, because the alternative to a few false failures is a
   * suite people switch off:
   *   - a password box reports bullets rather than characters, so a masked
   *     read-back is compared on length alone;
   *   - a field that formats as you type ("0123 456 789") is compared with the
   *     separators removed.
   * What survives both is the case that matters: the field holding a different
   * number of characters than were typed into it.
   */
  private inputMatches(got: string, typed: string): boolean {
    if (got === typed) return true;
    if (isMasked(got) && got.length === typed.length) return true;
    return squash(got) === squash(typed);
  }

  /**
   * Substitutes `{{name}}`, and refuses to leave one behind.
   *
   * Returning the placeholder unchanged used to look harmless — until a missing
   * password meant the literal `{{account.tcbs.password}}` was typed into the
   * login form and the server, quite correctly, said the credentials did not
   * match. Every layer downstream then reported something true and useless.
   * A value that is missing is an error, not a default.
   */
  private expand(text: string): string {
    const vars = this.opts.variables ?? {};
    const unresolved: string[] = [];
    const out = text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (whole, name: string) => {
      const value = vars[name];
      if (value === undefined) {
        unresolved.push(name);
        return whole;
      }
      return value;
    });
    if (unresolved.length > 0) {
      throw new Error(
        `Không giải được biến ${unresolved.map((n) => `{{${n}}}`).join(', ')} — ` +
          'chưa có giá trị nào được cung cấp cho nó.',
      );
    }
    return out;
  }
}

/**
 * Classify the first failing step without message matching whenever possible.
 * Locator failures may be retried with a fresh observation. Assertion failures
 * are authoritative and must stay red.
 */
function classifyFailure(
  error: unknown,
  intent: Intent['kind'],
): NonNullable<StepResult['failureKind']> {
  if (error instanceof ElementNotFoundError) return 'locator';

  const code = extractErrorCode(error);
  if (code) {
    if (
      code.startsWith('ELEMENT_')
      || code.startsWith('PROVIDER_')
      || code === 'HEALING_REJECTED'
      || code === 'DISCOVERY_BUDGET_EXCEEDED'
    ) return 'locator';
    if (code.startsWith('RUNTIME_')) return 'environment';
  }

  if (
    intent === 'assertText'
    || intent === 'assertNumber'
    || intent === 'assertCollection'
    || intent === 'assertNotVisible'
  ) {
    return 'assertion';
  }
  return 'interaction';
}

/** How long a typed value gets to reach the field before the step is failed. */
const VERIFY_TIMEOUT_MS = 3000;
const VERIFY_POLL_MS = 150;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Infer the observable outcome of a tap from the next meaningful Gherkin step.
 * Screenshots are transparent; navigation/back/swipe starts a new action chain
 * and therefore stops inference.  No selector knowledge is encoded here.
 */
/**
 * Does the collection satisfy the check, and what did it look like if not.
 *
 * One place decides, used both while waiting for the list to settle and when
 * reporting the failure — so the message can never describe a different reading
 * from the one that failed.
 */
function collectionVerdict(
  check: Extract<Intent, { kind: 'assertCollection' }>['check'],
  snapshot: UiMatchSnapshot,
  expand: (value: string) => string,
): { ok: boolean; expected: string; observed: string } {
  const compare = (actual: number, operator: string, value: number): boolean =>
    operator === 'notEquals' ? actual !== value
      : operator === 'greaterThan' ? actual > value
        : operator === 'atLeast' ? actual >= value
          : operator === 'atMost' ? actual <= value
            : actual === value;

  if (check.kind === 'count') {
    return {
      ok: compare(snapshot.count, check.operator, check.value),
      expected: `${check.operator} ${check.value}`,
      observed: `observed count=${snapshot.count}, focused=${snapshot.focused.length}.`,
    };
  }
  if (check.kind === 'countMatching') {
    const wanted = normalizeCollectionText(expand(check.text));
    const hits = snapshot.texts
      .filter((value) => normalizeCollectionText(value).includes(wanted)).length;
    return {
      ok: compare(hits, check.operator, check.value),
      expected: `${check.operator} ${check.value} member(s) containing ${JSON.stringify(check.text)}`,
      observed: `observed ${hits} of ${snapshot.count}.`,
    };
  }
  if (check.kind === 'uniqueText') {
    const values = snapshot.texts.map(normalizeCollectionText).filter(Boolean);
    return {
      ok: values.length === snapshot.count && new Set(values).size === values.length,
      expected: 'uniqueText',
      observed: `observed count=${snapshot.count}, focused=${snapshot.focused.length}.`,
    };
  }
  if (check.kind === 'firstText') {
    return {
      ok: normalizeCollectionText(snapshot.texts[0] ?? '')
        .includes(normalizeCollectionText(expand(check.text))),
      expected: `first item contains ${JSON.stringify(check.text)}`,
      observed: `observed count=${snapshot.count}, focused=${snapshot.focused.length}.`,
    };
  }
  return {
    ok: snapshot.focused.length > 0,
    expected: 'focused',
    observed: `observed count=${snapshot.count}, focused=${snapshot.focused.length}.`,
  };
}

/**
 * Did the element's contents move at all?
 *
 * Compares what the locator matched, not whether it matched. `focused` is left
 * out on purpose: focus moves on almost every click and would report a change
 * for taps that changed nothing else.
 */
/**
 * Does any number on screen equal the number the scenario asked for?
 *
 * Only when the scenario wrote a number: "Ký Quỹ" must never be reinterpreted.
 * Equality rather than containment, so a step expecting 1 does not pass against
 * a balance of 1,000 — the looseness being bought here is about separators, not
 * about what counts as a match.
 */
function matchesAsNumber(expected: string, seen: string[]): boolean {
  let wanted: number;
  try {
    if (!/^-?\d[\d.,]*$/u.test(expected.trim())) return false;
    wanted = parseDisplayedNumber(expected);
  } catch {
    return false;
  }
  return seen.some((text) =>
    (text.match(/-?\d[\d.,]*/gu) ?? []).some((token) => {
      try {
        return parseDisplayedNumber(token) === wanted;
      } catch {
        return false;
      }
    }));
}

function snapshotChanged(before: UiMatchSnapshot, after: UiMatchSnapshot): boolean {
  if (before.count !== after.count) return true;
  if (before.texts.length !== after.texts.length) return true;
  return before.texts.some((text, index) => text !== after.texts[index]);
}

/**
 * Splice healing steps into a scenario for one run.
 *
 * The proposed step is built directly rather than parsed back from its Gherkin
 * text: healing only ever proposes a tap on an element the registry already
 * knows, so the intent is known without going through binding, and a parse here
 * would be a second place for step wording to drift.
 *
 * The inserted step keeps the line number of the step it follows. Line numbers
 * address the .feature file, which this run is not editing; renumbering would
 * make the report point at lines that do not exist.
 */
function applyStepPatches(
  steps: StepSpec[],
  patches: ReadonlyArray<{ afterLine: number; step: string; elementId: string }>,
): StepSpec[] {
  if (patches.length === 0) return steps;
  const out: StepSpec[] = [];
  for (const step of steps) {
    out.push(step);
    for (const patch of patches.filter((p) => p.afterLine === step.line)) {
      out.push({
        text: patch.step,
        keyword: 'And',
        line: step.line,
        intent: { kind: 'tap', element: patch.elementId },
      });
    }
  }
  return out;
}

function expectationAfter(steps: StepSpec[], currentIndex: number): ActionExpectation | undefined {
  for (let index = currentIndex + 1; index < steps.length; index++) {
    const step = steps[index]!;
    const intent = step.intent;
    switch (intent.kind) {
      case 'screenshot':
        continue;
      case 'waitFor':
      case 'assertVisible':
      case 'focusRegion':
        return {
          elementId: intent.element,
          locatorParams: intent.locatorParams,
          state: 'visible',
          action: 'assert-visible',
          source: step.text,
        };
      case 'assertNotVisible':
        return {
          elementId: intent.element,
          locatorParams: intent.locatorParams,
          state: 'absent',
          action: 'assert-visible',
          source: step.text,
        };
      case 'assertText':
      case 'assertNumber':
      case 'assertCollection':
        return {
          elementId: intent.element,
          locatorParams: intent.locatorParams,
          state: 'visible',
          action: 'assert-text',
          source: step.text,
        };
      case 'tap':
      case 'longPress':
      case 'hover':
        return {
          elementId: intent.element,
          locatorParams: intent.locatorParams,
          state: 'visible',
          action: 'tap',
          source: step.text,
        };
      case 'dragDrop':
        return {
          elementId: intent.target,
          locatorParams: intent.targetLocatorParams,
          state: 'visible',
          action: 'assert-visible',
          source: step.text,
        };
      case 'input':
      case 'selectDate':
      case 'clear':
        return {
          elementId: intent.element,
          locatorParams: intent.locatorParams,
          state: 'visible',
          action: 'input',
          source: step.text,
        };
      case 'select':
        return {
          elementId: intent.element,
          locatorParams: intent.locatorParams,
          state: 'visible',
          action: 'select',
          source: step.text,
        };
      case 'scrollTo':
        return {
          elementId: intent.element,
          locatorParams: intent.locatorParams,
          state: 'visible',
          action: 'scroll',
          source: step.text,
        };
      case 'launch':
      case 'swipe':
      case 'scroll':
      case 'back':
        return undefined;
    }
  }
  return undefined;
}

function normalizeCollectionText(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('vi-VN');
}

function expectationKey(elementId: string, params?: Record<string, string>): string {
  return `${elementId}\u0000${JSON.stringify(params ?? {})}`;
}

function routeIdentity(value: string): string {
  if (!value || value === 'about:blank') return '';
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return value;
  }
}

/** Emit actionable timing evidence without making successful fast steps noisy. */
function logSlowActionPhase(actionLabel: string, phase: string, startedAt: number): void {
  const elapsedMs = Date.now() - startedAt;
  if (elapsedMs < 500) return;
  console.log(`[timing] "${actionLabel}" ${phase}: ${elapsedMs}ms`);
}

/**
 * A selected period tab is stronger evidence than prose that is not rendered.
 * Example: "Giá 1M" selected proves "Diễn biến giá trong vòng 1 tháng".
 * Both period and business topic must agree; selection alone never passes an
 * unrelated assertion.
 */
function selectionProvesBusinessState(actionLabel: string, expectedLabel: string): boolean {
  const actionPeriod = periodIn(actionLabel);
  const expectedPeriod = periodIn(expectedLabel);
  if (!actionPeriod || actionPeriod !== expectedPeriod) return false;

  const actionTopics = topicWords(actionLabel);
  const expectedTopics = new Set(topicWords(expectedLabel));
  return actionTopics.some((word) => expectedTopics.has(word));
}

function periodIn(value: string): string | undefined {
  const text = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const compact = text.match(/\b(\d+)\s*([dwmy])\b/);
  if (compact) return periodKey(Number(compact[1]), compact[2]!);
  const spoken = text.match(/\b(\d+)\s*(ngay|day|days|tuan|week|weeks|thang|month|months|nam|year|years)\b/);
  if (!spoken) return undefined;
  const unit = spoken[2]!;
  return periodKey(
    Number(spoken[1]),
    /^(ngay|day)/.test(unit) ? 'd' : /^(tuan|week)/.test(unit) ? 'w' :
      /^(thang|month)/.test(unit) ? 'm' : 'y',
  );
}

function periodKey(amount: number, unit: string): string {
  if (unit === 'y') return `${amount * 12}m`;
  if (unit === 'w') return `${amount * 7}d`;
  return `${amount}${unit}`;
}

function topicWords(value: string): string[] {
  const periodWords = new Set([
    'ngay', 'day', 'days', 'tuan', 'week', 'weeks', 'thang', 'month', 'months',
    'nam', 'year', 'years', 'trong', 'vong', 'theo', 'ky',
  ]);
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !/^\d+[dwmy]$/.test(word) && !periodWords.has(word));
}

/** Extract the first human-formatted number without treating copy as a value. */

/** A field that renders its contents as one repeated symbol: ••••, ****. */
function isMasked(value: string): boolean {
  return value.length > 0 && !/[\p{L}\p{N}]/u.test(value) && new Set(value).size === 1;
}

/** Drops the separators a formatting field inserts on its own. */
function squash(value: string): string {
  return value.replace(/[\s.,\-()]/g, '');
}

function verdictOf(runs: ScenarioResult['runs']): ScenarioResult['verdict'] {
  const passed = runs.some((r) => r.status === 'passed');
  const failed = runs.some((r) => r.status === 'failed');
  if (passed && failed) return 'flaky';
  return passed ? 'passed' : 'failed';
}

/**
 * Câu của driver, rút gọn đủ để đọc trong một dòng log.
 *
 * Trước đây chỗ này chỉ ghi "bấm lỗi". Một lượt chạy thật hỏng ở bước mở chức
 * năng từ tìm kiếm, và để biết vì sao đã phải đi đọc 19 file cây XML kèm ảnh
 * chụp — trong khi câu trả lời ("không có phần tử nào khớp") vốn nằm sẵn trong
 * lỗi mà dòng log vứt đi. Log để trace, mà lại giấu đúng phần cần trace.
 *
 * Cắt ở dòng đầu và 160 ký tự: WebdriverIO đính kèm cả trang gợi ý và link tài
 * liệu, dán nguyên vào thì dòng log dài hơn màn hình và không ai đọc nữa.
 */
function driverReason(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const first = raw.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return first ? `bấm lỗi (${first.slice(0, 160)})` : 'bấm lỗi';
}
