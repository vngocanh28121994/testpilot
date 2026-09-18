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
import { provenWins } from '../core/registry.js';
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
import { resolveDropdownOption } from '../drivers/dropdownSelection.js';
import { waitForExactSearchResult } from './searchResult.js';

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
 * Steps whose outcome is evidence about the product, rather than an action.
 *
 * The `assert` prefix deliberately makes future assertion intents opt in
 * automatically. `waitFor` and `focusRegion` predate that naming convention,
 * so they are the two explicit compatibility entries.
 */
export function isVerificationIntent(intent: Intent): boolean {
  return intent.kind.startsWith('assert')
    || intent.kind === 'waitFor'
    || intent.kind === 'focusRegion';
}

/**
 * Thời gian tối thiểu dành cho lượt resolve có discovery ở cuối một
 * postcondition hụt.
 *
 * Discovery bắt đầu sau 2,5 giây dò hụt rồi cần thêm khoảng 4 giây để chốt
 * (xem DISCOVERY_AFTER_MS và DISCOVERY_GRACE_MS trong resolver). Cấp ít hơn thế
 * thì nó không kịp sinh ra ứng viên nào, và lượt chạy trả về "after 1 attempts"
 * y như thể không có discovery.
 */
const MIN_DISCOVERY_BUDGET_MS = 8_500;

interface ActionExpectation {
  elementId: string;
  locatorParams?: Record<string, string>;
  state: 'visible' | 'absent';
  action: ActionKind;
  source: string;
  /** The next assertion proves the action semantically, after it executes. */
  verification?: 'deferred';
}

export class Executor {
  /**
   * Where the current step's screenshot landed, when the step was a screenshot.
   *
   * Reset before every step: it describes one step, and a stale value would
   * attach the previous screenshot to whatever ran next.
   */
  private lastShot?: string;
  /** Latest assertion image, captured while the asserted state is still visible. */
  private lastAssertionProof?: string;
  /** Unique screenshot stem for the assertion currently being evaluated. */
  private assertionShotStem?: string;
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
   * Chữ vừa được gõ vào một ô, còn hiệu lực cho đúng bước kế tiếp.
   *
   * Sống một bước thôi là cố ý: "gõ X rồi bấm kết quả" là một cặp, còn "gõ X
   * rồi bấm Lưu" thì chữ X không nói gì về nút Lưu. Xem anchorToTypedQuery().
   */
  private typedQuery?: string;
  /** Chữ ấy trong phạm vi bước đang chạy — xem execute(). */
  private pendingQuery?: string;
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
  /** Exact causal gap behind `lastUnverified`, for reports and diagnostics. */
  private lastUnverifiedReason?: string;
  /** Which of the three gaps it is — only `unchanged` may turn a scenario red. */
  private lastUnverifiedKind?: StepResult['unverifiedKind'];
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
    await this.driver.setScenarioMode?.(scenario.tags.includes('@native') ? 'native' : 'default');
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
      // Một bước "chưa chứng minh được" KHÔNG tự động là đỏ — chỉ một loại thôi.
      //
      // Cờ `unverified` gộp ba tình huống rất khác nhau, và chỉ một trong ba là
      // tin xấu:
      //
      //  - `deferred`  — cố ý hoãn, chờ bước sau đo thay đổi nghiệp vụ.
      //                  `confirmTapProvenByNumberDelta` / `...ByFocusedState`
      //                  gỡ cờ khi bước ấy chứng minh xong. Bình thường.
      //  - `no-postcondition` — bước sau không mô tả kết quả nào quan sát được.
      //                  Đây là khoảng trống của KỊCH BẢN, không phải bằng chứng
      //                  thao tác đã hỏng. Bắt đỏ ở đây là phạt người viết
      //                  kịch bản vì một việc công cụ không đo được.
      //  - `unchanged` — điều kiện đã đúng TỪ TRƯỚC thao tác và không gì đổi
      //                  sau đó. Không có gì phân biệt "đã chạy đúng" với
      //                  "không làm gì cả".
      //
      // Chỉ `unchanged` làm đỏ. Đo trên máy thật 2026-09-16, suite Chuyển tiền
      // trên prod: cả CHUYỂN lẫn XÁC NHẬN đều là `unchanged` — hậu điều kiện của
      // mỗi cú bấm đã thoả sẵn trước khi bấm — ảnh chụp lúc "pass" cho thấy ô
      // nhận tiền còn trống viền đỏ, không đồng nào được chuyển, kịch bản vẫn
      // xanh. Một suite chuyển tiền báo xanh khi không chuyển gì là kiểu sai đắt
      // nhất công cụ này mắc được.
      //
      // Và lưu ý chiều ngược lại: nếu thông báo thành công thực sự HIỆN RA do cú
      // bấm, thì `transitionCanBeProven` đúng và bước đó không bao giờ mang cờ
      // `unchanged` ngay từ đầu. Loại này chỉ xuất hiện đúng lúc bằng chứng đã
      // có sẵn từ trước — tức đúng lúc nó không chứng minh được gì.
      const unproven = stepResults.filter(
        (s) => s.status === 'unverified' && s.unverifiedKind === 'unchanged',
      );
      const hardFailed = stepResults.some((s) => s.status === 'failed');
      const failed = hardFailed || unproven.length > 0;
      for (const step of unproven) {
        console.warn(
          `[verdict] "${step.step.text}" không chứng minh được — kịch bản không thể xanh.`
          + (step.unverifiedReason ? ` ${step.unverifiedReason}` : ''),
        );
      }
      // Prefer the latest assertion image: that is the state that made the
      // scenario green. Toasts and open dropdowns may be gone by scenario end.
      //
      // Ca đỏ xưa nay có ảnh, cây DOM và video; ca xanh chỉ có chữ "passed".
      // Phải chụp TRƯỚC `endScenario` — hàm đó đóng trang, và ảnh chụp sau khi
      // trang đóng là ảnh của một màn hình không còn nữa. Ca đỏ đã có ảnh riêng
      // ở handler bước hỏng nên ở đây chỉ lo phần xanh.
      // `hardFailed`, không phải `failed`: một bước hỏng hẳn đã tự chụp ảnh ở
      // handler của nó, nhưng một kịch bản chỉ đỏ vì `unverified` thì không đi
      // qua handler ấy — và ảnh cuối cùng chính là bằng chứng đắt nhất ở đây.
      // Đúng tấm ảnh này đã cho thấy ô nhận tiền còn trống trong khi kịch bản
      // báo xanh; bỏ nó đi là bỏ mất thứ đã vạch ra lỗi.
      const proof = hardFailed
        ? undefined
        : this.lastAssertionProof
          ?? await this.driver.screenshot?.(`${scenario.id}-a${attempt}-pass`).catch(() => undefined);
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

  /**
   * Freeze the screen at the assertion, not after the scenario.
   *
   * A successful toast and an opened dropdown are both deliberately
   * short-lived. The old end-of-scenario/failure-handler screenshots therefore
   * documented the state after the proof had disappeared. Keeping the image on
   * `lastShot` also lets a failing step reuse this exact frame instead of taking
   * a second, later one.
   */
  private async captureAssertionState(): Promise<void> {
    if (!this.assertionShotStem || !this.driver.screenshot) return;
    const shot = await this.driver.screenshot(this.assertionShotStem).catch(() => undefined);
    if (!shot) return;
    this.lastShot = shot;
    this.lastAssertionProof = shot;
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
    this.lastAssertionProof = undefined;
    this.assertionShotStem = undefined;

    for (let index = 0; index < steps.length; index++) {
      const step = steps[index]!;
      if (aborted) {
        results.push({ step, status: 'skipped', durationMs: 0, attempts: 0 });
        continue;
      }
      const t0 = Date.now();
      this.lastShot = undefined;
      this.assertionShotStem = `${scenarioId}-a${attempt}-l${step.line}-pass`;
      this.lastUnverified = false;
      this.lastUnverifiedReason = undefined;
      this.lastUnverifiedKind = undefined;
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
        const previousStep = [...steps.slice(0, index)]
          .reverse()
          .find((candidate) => candidate.intent.kind !== 'screenshot');
        const assertedValues = semanticValuesFromIntent(step.intent)
          .map((value) => this.expand(value));
        const heal = await this.execute(
          step.intent,
          expectation,
          [
            ...activeContext,
            ...(previousStep ? [`Bước trước: ${previousStep.text}`] : []),
            `Bước hiện tại: ${step.text}`,
            ...(expectedLabel ? [`Phần tử kết quả: ${expectedLabel}`] : []),
            ...(expectation ? [`Kết quả cần chứng minh: ${expectation.source}`] : []),
            ...assertedValues,
          ].slice(-6),
          activeContext.at(-1),
        );
        // Central safety net for every verification kind. Most assertion
        // branches capture earlier, beside the value/list they evaluate, so
        // transient UI is still present. This fallback covers early-return
        // paths such as a postcondition already proven by the preceding action,
        // and automatically covers future `assert*` intents.
        if (isVerificationIntent(step.intent) && !this.lastShot) {
          await this.captureAssertionState();
        }
        results.push({
          step,
          // Causal proof outranks locator telemetry. A step may find a fresh
          // locator and still fail to prove that its action changed anything;
          // hiding that behind `healed` recreates the same false-green result.
          // The `heal` payload remains attached, so no diagnostic is lost.
          status: this.lastUnverified ? 'unverified' : heal ? 'healed' : 'passed',
          durationMs: Date.now() - t0,
          attempts: 1,
          ...(heal ? { heal } : {}),
          ...(this.lastShot ? { screenshot: this.lastShot } : {}),
          ...(this.lastEvidence ? { evidence: this.lastEvidence } : {}),
          ...(this.lastUnverifiedReason ? { unverifiedReason: this.lastUnverifiedReason } : {}),
          ...(this.lastUnverifiedKind ? { unverifiedKind: this.lastUnverifiedKind } : {}),
        });
        // A numerical delta can only be evaluated after the tap has returned.
        // When it passes, it is stronger proof of the preceding action than a
        // visibility probe: the business value changed by exactly the amount
        // the scenario required. Upgrade only the immediately preceding
        // meaningful step; a screenshot between them is observational and
        // does not break the causal chain.
        if (step.intent.kind === 'assertNumberDelta') {
          confirmTapProvenByNumberDelta(results, step);
        }
        if (
          step.intent.kind === 'assertCollection'
          && step.intent.check.kind === 'focused'
        ) {
          confirmTapProvenByFocusedState(results, step);
        }
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
          ? (this.lastShot
            ?? (conNong
            ? this.lastDeclinedShot!.path
            : await this.driver.screenshot(stem).catch(() => undefined)))
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

  /**
   * Cú bấm ngay sau một lần gõ phải trúng thứ phản ánh chữ vừa gõ.
   *
   * "Kết quả tìm kiếm đầu tiên" là một locator khớp MỌI lựa chọn trong panel,
   * nên cái được bấm là cái driver bắt gặp trước — và panel của một
   * autocomplete thì đổi sau chữ gõ vào, không đổi cùng lúc. Trong khoảng trễ
   * ấy, lựa chọn còn sót lại từ truy vấn trước vẫn nằm nguyên đó và vẫn bấm
   * được.
   *
   * Đo trên máy thật ngày 2026-09-16: kịch bản gõ "VIC", bấm kết quả đầu tiên,
   * và thêm mã EVS vào danh mục. Lỗi ấy còn sống được lâu vì assertion kiểm
   * "dòng đầu tiên là VIC" mà VIC vốn đã nằm sẵn ở đầu danh sách — cú bấm sai
   * không đổi được kết quả kiểm tra, cho tới hôm mã sai chen lên trước nó.
   *
   * Cơ chế này đã có sẵn trong `waitForExactSearchResult` và chạy đúng, nhưng
   * chỉ cho ô tìm tính năng ở Home. Ở đây nó thành luật chung cho mọi bước gõ
   * rồi bấm.
   *
   * Hai điều kiện thu hẹp phạm vi, và cả hai đều cần:
   *
   *   - locator khớp NHIỀU phần tử. Một nút "Lưu" khớp đúng một cái thì chữ
   *     vừa gõ chẳng liên quan gì tới nó, và neo vào đó sẽ chặn oan.
   *   - những phần tử ấy phải mang nội dung KHÁC nhau. Một panel kết quả thì
   *     mỗi dòng một chữ; một locator mơ hồ thì khớp cùng một chữ vài lần.
   *   - chữ vừa gõ còn hiệu lực đúng một bước, nên "gõ rồi làm việc khác" cũng
   *     không bị neo.
   *
   * Điều kiện thứ hai được thêm sau khi luật này giết 4/8 kịch bản Chuyển tiền
   * ngày 2026-09-16. `transfer.submitButton` chỉ có `label:CHUYỂN`, và trên màn
   * đó có ba phần tử chữ "CHUYỂN", nên điều kiện đếm mở cổng — rồi chờ một nút
   * submit "phản ánh 1000" cho tới hết giờ. Cùng feature ấy chạy xanh ngày
   * 14-09, trước khi có luật này. Đếm thôi không phân biệt được "panel kết quả"
   * với "locator trùng nhãn"; nội dung thì có.
   *
   * Không tìm được thì CHỜ, không bấm đại: panel chưa kịp đổi là trạng thái
   * tạm, và bấm trong lúc đó chính là lỗi đang sửa. Hết giờ thì hỏng có địa
   * chỉ, kèm những gì đang thực sự hiện ra.
   */
  private async anchorToTypedQuery(
    actionLabel: string,
    resolution: Resolution,
    matches: UiMatchSnapshot | undefined,
  ): Promise<UiHandle> {
    const query = this.pendingQuery;
    if (!query || !matches || matches.count <= 1) return resolution.handle;

    // Cùng một chữ lặp lại thì đây là locator trùng nhãn, không phải danh sách
    // kết quả — chữ vừa gõ không nói gì về việc phải bấm cái nào trong số đó.
    // Nói ra thay vì im lặng bỏ qua: một locator khớp ba phần tử giống hệt nhau
    // là thứ cần sửa ở registry, và dòng này là chỗ duy nhất nhìn thấy nó.
    const distinct = new Set(matches.texts.map((text) => normalizeHumanText(text)));
    if (matches.texts.length > 1 && distinct.size === 1) {
      console.warn(
        `[flow] "${actionLabel}" khớp ${matches.count} phần tử cùng nội dung `
        + `${JSON.stringify(matches.texts[0]?.slice(0, 40) ?? '')} — locator trùng nhãn, `
        + 'không phải danh sách kết quả; không neo theo chữ vừa gõ.',
      );
      return resolution.handle;
    }

    const wanted = normalizeHumanText(query);
    const reflects = (texts: string[]) =>
      texts.some((text) => normalizeHumanText(text).includes(wanted));
    if (matches.texts.length > 0 && reflects(matches.texts)) {
      const narrowed = await this.driver
        .find({ ...resolution.candidate, runtimeText: query })
        .catch(() => null);
      if (narrowed) return narrowed;
    }

    const deadline = Date.now()
      + (this.opts.postconditionTimeoutMs ?? DEFAULT_POSTCONDITION_TIMEOUT_MS);
    let seen = matches.texts;
    console.log(
      `[flow:wait] "${actionLabel}": đang chờ kết quả phản ánh "${query}"…`,
    );
    while (Date.now() < deadline) {
      await sleep(TRANSIENT_POLL_MS);
      const narrowed = await this.driver
        .find({ ...resolution.candidate, runtimeText: query })
        .catch(() => null);
      if (narrowed && await narrowed.isVisible().catch(() => false)) {
        console.log(`[flow:wait] "${actionLabel}": đã thấy kết quả cho "${query}".`);
        return narrowed;
      }
      const fresh = this.driver.inspectMatches
        ? await this.driver.inspectMatches(resolution.candidate).catch(() => undefined)
        : undefined;
      if (fresh?.texts.length) seen = fresh.texts;
    }

    throw new Error(
      `Không bấm "${actionLabel}": không có kết quả nào phản ánh "${query}" `
      + `sau khi đã gõ. Đang hiển thị: ${seen.slice(0, 5).map((t) => JSON.stringify(t.slice(0, 40))).join(', ')}.`,
    );
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
    // Chữ vừa gõ có hiệu lực đúng MỘT bước, và ranh giới của "một bước" nằm ở
    // đây chứ không ở từng lần thử lại bên trong một bước: bước hỏng rồi thử
    // lại vẫn là cùng một cú bấm, nên nó phải được neo y như lần đầu. Bước
    // tiếp theo — dù là bấm, kiểm tra hay gì khác — bắt đầu với bảng sạch.
    const carried = this.executeDepth === 1 ? this.typedQuery : this.pendingQuery;
    if (this.executeDepth === 1) this.typedQuery = undefined;
    const outerPending = this.pendingQuery;
    this.pendingQuery = carried;
    try {
      return await this.executeIntent(intent, expectation, semanticContext, contextAnchor);
    } finally {
      this.executeDepth -= 1;
      this.pendingQuery = this.executeDepth === 0 ? undefined : outerPending;
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
        // Chữ vừa gõ là NGỮ CẢNH của bước ngay sau nó — nhưng chỉ khi chính
        // BƯỚC ấy là lệnh gõ, chứ không phải khi một bước phức hợp tự gõ gì đó
        // bên trong nó.
        //
        // `openFeatureFromSearch` gõ tên tính năng vào ô tìm kiếm của Home rồi
        // tự chọn kết quả bằng waitForExactSearchResult — xong việc, không còn
        // gì để neo. Không có điều kiện độ sâu này, "Bảng giá cổ phiếu" rò sang
        // bước đầu tiên của kịch bản: lượt chạy thật in ra
        // `"Nút tùy chọn dòng": đang chờ kết quả phản ánh "Bảng giá cổ phiếu"`
        // rồi chờ đến hết giờ.
        if (this.executeDepth === 1) this.typedQuery = text.trim() || undefined;
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
        const option = await resolveDropdownOption(d, r.handle, intent.option);
        await d.selectOption(r.handle, option);
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

      case 'simulateBiometricSuccess':
        if (!d.runNativeFixture) {
          throw new Error('Driver hiện tại không hỗ trợ giả lập sinh trắc học native.');
        }
        await d.runNativeFixture({ kind: 'biometricSuccess', biometric: intent.biometric });
        return undefined;

      case 'injectCameraImage':
        if (!d.runNativeFixture) {
          throw new Error('Driver hiện tại không hỗ trợ inject ảnh vào camera native.');
        }
        await d.runNativeFixture({ kind: 'cameraImage', path: this.expand(intent.path) });
        return undefined;

      case 'focusRegion': {
        const { heal, confirm } = await withElement(intent.element, 'assert-visible', {
          locatorParams: intent.locatorParams,
        });
        await this.captureAssertionState();
        confirm();
        return heal;
      }

      case 'waitFor': {
        if (this.consumePreverified(intent.element, intent.locatorParams)) return undefined;
        const { heal, confirm } = await withElement(intent.element, 'assert-visible', {
          ...(intent.timeoutMs ? { timeoutMs: intent.timeoutMs } : {}),
          locatorParams: intent.locatorParams,
        });
        await this.captureAssertionState();
        confirm();
        return heal;
      }

      case 'assertVisible': {
        if (this.consumePreverified(intent.element, intent.locatorParams)) return undefined;
        const { heal, confirm } = await withElement(intent.element, 'assert-visible', {
          locatorParams: intent.locatorParams,
        });
        await this.captureAssertionState();
        confirm();
        return heal;
      }

      case 'assertNotVisible':
        await this.resolver.resolveAbsent(intent.element, {
          locatorParams: intent.locatorParams,
        });
        await this.captureAssertionState();
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
        // The callback runs after the complete option list is visible and
        // before listOptions restores a panel it opened. This is the only frame
        // that can prove which choices were actually offered.
        const options = await this.driver.listOptions(
          r.handle,
          () => this.captureAssertionState(),
        );
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
          if (!present) {
            await this.captureAssertionState();
            return undefined;
          }
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
            await this.captureAssertionState();
            throw new Error(
              `Text assertion failed on "${intent.element}": expected not to contain ` +
                `"${intent.text.trim()}", but found it in "${offender.trim()}".`,
            );
          }
          await this.captureAssertionState();
          confirm();
          return heal;
        }
        let { r, heal, confirm } = await withElement(intent.element, 'assert-text', {
          locatorParams: intent.locatorParams,
          semanticText: this.expand(intent.text),
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
            semanticText: this.expand(intent.text),
          }).catch(() => null);
          if (!next) break;
          ({ r, heal, confirm } = next);
          snapshot = await read(r);
        }
        if (snapshot.count === 0) {
          await this.captureAssertionState();
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
          await this.captureAssertionState();
          throw new Error(
            `Text assertion failed on "${intent.element}": expected ` +
              `${intent.mode === 'equals' ? '' : 'to contain '}"${intent.text.trim()}", got ${shown}.`,
          );
        }
        // Capture before confirm/return: a toast can disappear between this
        // successful comparison and the old scenario-end screenshot.
        await this.captureAssertionState();
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
          await this.captureAssertionState();
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
        await this.captureAssertionState();
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
          await this.captureAssertionState();
          throw new Error(
            `Numeric assertion failed on "${intent.element}": value "${actualText}" ` +
              `does not satisfy ${intent.operator} ${expected}.`,
          );
        }
        await this.captureAssertionState();
        confirm();
        return heal;
      }

      case 'assertCollection': {
        const { r, heal, confirm } = await withElement(intent.element, 'assert-text', {
          locatorParams: intent.locatorParams,
          ...('text' in intent.check ? { semanticText: this.expand(intent.check.text) } : {}),
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
          await this.captureAssertionState();
          throw new Error(
            `Collection assertion failed on "${intent.element}": expected ${verdict.expected}; `
            + verdict.observed,
          );
        }
        await this.captureAssertionState();
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

    // Session restoration may redirect to login before Angular has mounted the
    // form. Resolving immediately used to exhaust the ordinary step budget just
    // as the username field appeared in the failure screenshot. Wait for the
    // login surface once; the input below still performs normal resolution and
    // verification.
    await this.resolver.resolve('login.usernameField', {
      timeoutMs: 20_000,
      discoveryAction: 'input',
    });

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

  /**
   * Trang chủ còn hiển thị thì ta chưa đi đâu cả — hỏi bằng thứ đang thấy.
   *
   * Lối tắt "màn đích mở sẵn thì khỏi điều hướng" chỉ an toàn sau khi đã rời
   * màn xuất phát: Home mount sẵn cả danh mục tính năng, nên đứng ở đó thì gần
   * như thứ gì cũng tìm thấy được. Web có câu trả lời rồi — `isHomeLikeRoute`
   * trên URL — nhưng nó nằm bên trong `if (this.driver.currentUrl)`, và
   * NativeDriver KHÔNG có `currentUrl`: không phải trả về rỗng, mà không có
   * phương thức đó. Cả khối bị bỏ qua, nên trên app lối tắt này chạy không một
   * cái chốt nào. Đo ngày 2026-09-16: một hộp thoại thông báo bất kỳ trên Home
   * đủ để kết luận "Chuyển tiền đã mở sẵn", và kịch bản chạy trên màn hình sai.
   *
   * Cùng một câu hỏi, hỏi bằng thứ có trên mọi nền tảng. Ba element dưới đây
   * không phải chọn mới: `ensureLoggedIn` đã dùng `home.totalAssets` làm bằng
   * chứng đang ở Home, và `returnToHomeForSearch` đã dùng cặp searchInput /
   * searchBox cho đúng việc ấy — cả hai đều có locator native và đều định danh
   * bằng text chính xác.
   *
   * Đoán sai thì chỉ mất một lượt điều hướng thừa: đường tìm kiếm là read-only
   * và lặp lại được. Đoán sai theo chiều kia là cả loạt kịch bản chạy nhầm màn
   * hình mà vẫn báo PASS. Chốt này cố tình lệch về phía tốn vài giây.
   */
  private async onSourceSurface(): Promise<boolean> {
    const probes = [
      ['home.searchInput', 'input'],
      ['home.searchBox', 'tap'],
      ['home.totalAssets', 'assert-visible'],
    ] as const;
    for (const [id, discoveryAction] of probes) {
      if (await this.resolver.isVisibleNow(id, { discoveryAction }).catch(() => false)) {
        console.log(`[flow] vẫn đang ở Trang chủ (thấy "${id}") — không bỏ qua điều hướng.`);
        return true;
      }
    }
    return false;
  }

  /** Search by exact business name rather than blindly clicking row one. */
  private async openFeatureFromSearch(
    query: string,
    expectation?: ActionExpectation,
  ): Promise<StepResult['heal']> {
    let firstHeal: StepResult['heal'];
    const remember = (heal: StepResult['heal']) => { firstHeal ??= heal; };
    let lastError: Error | undefined;

    // A fresh scenario may already be on the requested feature (the account
    // keeps route state between launches). Do not force it through Home search
    // merely because the first business assertion is not true yet.
    if (expectation && !(await this.onSourceSurface())) {
      // Before searching, a same-route dialog title is not sufficient proof:
      // TCInvest keeps every toolbox item (including feature names) mounted in
      // an off-screen Home drawer. Only an actual next-step locator, URL, or a
      // stable landmark on a non-Home route may skip navigation here.
      const landmark = await this.featureScreenLandmark(expectation, false);
      if (landmark) {
        console.log(`[flow] tính năng "${query}" đã mở sẵn — nhận diện bằng "${landmark}".`);
        return firstHeal;
      }
    }

    // Search navigation is read-only and safe to repeat. TCInvest occasionally
    // closes the result drawer while leaving `/home` blank; one fresh search
    // recovers that transient state without turning every action into a retry.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const searchInputAlreadyOpen = await this.resolver.isVisibleNow('home.searchInput', {
          discoveryAction: 'input',
        }).catch(() => false);
        if (!searchInputAlreadyOpen) {
          remember(await this.execute({ kind: 'tap', element: 'home.searchBox' }));
        }
        remember(await this.execute({ kind: 'input', element: 'home.searchInput', text: query }));
        const result = await waitForExactSearchResult(
          this.driver,
          query,
          this.opts.postconditionTimeoutMs ?? DEFAULT_POSTCONDITION_TIMEOUT_MS,
          TRANSIENT_POLL_MS,
        );
        const beforeResultUrl = await this.driver.currentUrl?.().catch(() => '') ?? '';
        const clickStarted = Date.now();
        try {
          await this.driver.tap(result.handle);
        } catch (tapError) {
          // Closing a late notification/walkthrough can replace Angular's
          // search-result nodes. The handle was exact when obtained but is now
          // stale; retrying that object only repeats the timeout. First accept
          // navigation if the click actually landed, otherwise refresh the
          // query and acquire the exact result again before one bounded retry.
          if (await this.featureNavigationSucceeded(
            beforeResultUrl,
            expectation,
            this.opts.postconditionTimeoutMs ?? DEFAULT_POSTCONDITION_TIMEOUT_MS,
          )) {
            return firstHeal;
          }
          await this.driver.dismissOverlay?.().catch(() => false);
          remember(await this.execute({ kind: 'input', element: 'home.searchInput', text: query }));
          const fresh = await waitForExactSearchResult(
            this.driver,
            query,
            this.opts.postconditionTimeoutMs ?? DEFAULT_POSTCONDITION_TIMEOUT_MS,
            TRANSIENT_POLL_MS,
          );
          try {
            await this.driver.tap(fresh.handle);
          } catch {
            throw tapError;
          }
        }
        const clickElapsed = Date.now() - clickStarted;
        if (clickElapsed >= 500) {
          console.log(`[timing] click kết quả chính xác "${query}": ${clickElapsed}ms`);
        }
        // The destination landmark below is the useful readiness condition.
        // Waiting for global network/DOM idleness first added a fixed pause on
        // apps with live prices and telemetry, without proving navigation.
        if (await this.featureNavigationSucceeded(
          beforeResultUrl,
          expectation,
          this.opts.postconditionTimeoutMs ?? DEFAULT_POSTCONDITION_TIMEOUT_MS,
        )) {
          return firstHeal;
        }
        throw new Error(
          `Đã click đúng kết quả "${query}" nhưng màn hình đích không hiển thị `
          + `${expectation ? `"${expectation.source}"` : 'bằng chứng nhận diện nào'}.`,
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
        await this.returnToHomeForSearch();
      }
    }

    throw lastError ?? new Error(`Không mở được tính năng "${query}" từ tìm kiếm.`);
  }

  /** Put a failed inner retry back on a visibly interactive Home surface. */
  private async returnToHomeForSearch(): Promise<void> {
    await this.driver.dismissOverlay?.().catch(() => false);
    for (let attempt = 0; attempt < 3; attempt++) {
      if (await this.resolver.isVisibleNow('home.searchInput', {
        discoveryAction: 'input',
      }).catch(() => false)) return;
      if (await this.resolver.isVisibleNow('home.searchBox', {
        discoveryAction: 'tap',
      }).catch(() => false)) return;
      await this.driver.back();
      await sleep(300);
    }
    throw new Error('Không thể quay về Trang chủ để thử lại thao tác tìm kiếm.');
  }

  /**
   * A changed route alone is not proof: the stale-result race changed the route
   * too, but opened e-voting instead of money transfer. The destination must
   * expose the element implied by the next business step (or match that
   * element's authored screen URL when one exists).
   */
  private async featureNavigationSucceeded(
    beforeUrl: string,
    expectation?: ActionExpectation,
    timeoutMs = 5_000,
  ): Promise<boolean> {
    const started = Date.now();
    let changedRoute = '';
    let landmarkChecked = false;
    do {
      const current = await this.driver.currentUrl?.().catch(() => '') ?? '';
      if (routeIdentity(current) && routeIdentity(current) !== routeIdentity(beforeUrl)) {
        changedRoute = current;
      }
      if (expectation && await this.resolver.isVisibleNow(expectation.elementId, {
        locatorParams: expectation.locatorParams,
      }).catch(() => false)) {
        console.log(`[flow] màn hình tính năng đã mở và hiển thị "${expectation.source}"`);
        return true;
      }
      if (expectation && current) {
        const element = this.resolver.registry.element(expectation.elementId);
        const screen = element.screen ? this.resolver.registry.screen(element.screen) : undefined;
        if (screen?.urlPattern && current.includes(screen.urlPattern)) {
          console.log(`[flow] màn hình tính năng đã mở (${current})`);
          return true;
        }
      }
      // Some TCInvest features are dialogs mounted over `/home`, so their URL
      // never changes. A selector-less first action (the common state for a new
      // document) cannot identify the destination yet, but the authored screen
      // title can. Do not accept the same title while the search drawer is
      // still open: the exact result row itself contains that text.
      if (expectation) {
        const searchStillOpen = await this.resolver.isVisibleNow('home.searchInput', {
          discoveryAction: 'input',
        }).catch(() => false);
        if (!searchStillOpen) {
          const title = await this.resolver.visibleScreenTitleForElement(
            expectation.elementId,
          ).catch(() => undefined);
          if (title) {
            console.log(`[flow] màn hình tính năng đã mở — nhận diện bằng tiêu đề "${title}".`);
            return true;
          }
        }
      }
      // A screen landmark is deliberately weaker than the exact next
      // expectation, so on web it is usable only after navigation has actually
      // left the source route. Price Board's "Cơ sở" tab also exists in a Home
      // widget; accepting that single word while still on /home skipped the
      // search and made every following locator fail on the wrong page.
      if (expectation && changedRoute && !landmarkChecked) {
        landmarkChecked = true;
        const landmark = await this.featureScreenLandmark(expectation);
        if (landmark) {
          console.log(`[flow] màn hình tính năng đã mở — nhận diện bằng "${landmark}".`);
          return true;
        }
      }
      await sleep(100);
    } while (Date.now() - started < timeoutMs);
    if (changedRoute) {
      console.warn(`[flow] route đã đổi sang ${changedRoute}, nhưng không có bằng chứng đúng màn hình đích.`);
    }
    return false;
  }

  /** Exact expected state first; otherwise a stable landmark on its screen. */
  private async featureScreenLandmark(
    expectation: ActionExpectation,
    allowSameRouteScreenTitle = true,
  ): Promise<string | undefined> {
    // Android/iOS hybrid runs expose the same WebView URL and the same search
    // DOM as web. Limiting this guard to platform === 'web' let a visible
    // search-result row be mistaken for the destination screen title on
    // Android, so the runner skipped clicking the result and acted on stale
    // controls mounted underneath the search drawer.
    // Ô tìm tính năng còn trên màn hình nghĩa là ta vẫn đang ở chỗ xuất phát,
    // bất kể đường dẫn nói gì.
    //
    // Guard này từng hỏi đường dẫn trước — `isHomeLikeRoute`, tức pathname phải
    // là `/` hoặc `/home`. Đúng với bản web, và chỉ đúng với bản web. Trong
    // WebView của bản hybrid (Capacitor/Cordova), ngăn kéo "Tìm tính năng" là
    // một lớp phủ mở trên route đang có, nên pathname không bao giờ là `/home`,
    // guard không nổ, và cả nhánh landmark bên dưới chạy ngay giữa màn hình
    // Home. Đo ngày 2026-09-15: bốn kịch bản liên tiếp kết luận "Bảng giá đã mở
    // sẵn" trong khi app đứng nguyên ở danh mục tính năng.
    //
    // Sự hiện diện của chính ngăn kéo ấy là câu trả lời đúng cho mọi nền tảng:
    // nó nói về thứ đang hiển thị, không suy diễn từ hình dạng URL của một bản
    // đóng gói cụ thể.
    const searchStillOpen = await this.resolver.isVisibleNow('home.searchInput', {
      discoveryAction: 'input',
    }).catch(() => false);
    if (searchStillOpen) return undefined;

    if (this.driver.currentUrl) {
      const current = await this.driver.currentUrl().catch(() => '');
      if (isHomeLikeRoute(current)) {
        // A same-route feature dialog is valid only after the search drawer has
        // gone. This preserves the Home-widget guard while allowing a newly
        // authored modal screen to be recognised before its actions have
        // locators.
        if (!allowSameRouteScreenTitle) return undefined;
        return this.resolver.visibleScreenTitleForElement(expectation.elementId)
          .catch(() => undefined);
      }
    }
    if (await this.resolver.isVisibleNow(expectation.elementId, {
      locatorParams: expectation.locatorParams,
    }).catch(() => false)) {
      return expectation.source;
    }
    const element = this.resolver.registry.element(expectation.elementId);
    if (!element.screen) return undefined;
    const title = await this.resolver.visibleScreenTitleForElement(expectation.elementId)
      .catch(() => undefined);
    if (title) return title;
    const landmark = await this.resolver.visibleLandmarkOnScreen(
      element.screen,
      [expectation.elementId],
    );
    return landmark?.label;
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
    /** Ứng viên bị loại vì mơ hồ, để thông báo cuối nói được nguyên nhân. */
    const ambiguous: string[] = [];
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
          // Ambiguous discovery candidates may be tried only when this action
          // has an observable proof path. The executor rejects a candidate whose
          // postcondition fails and asks Resolver for the next ranked candidate.
          allowAmbiguousDiscovery: Boolean(
            expectation && (
              transitionCanBeProven ||
              expectation.verification === 'deferred' ||
              preSnapshot
            )
          ),
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
        // Hết ứng viên vì tất cả đều mơ hồ là một chẩn đoán, không phải một
        // lần hết giờ. Nói ra locator nào và mơ hồ ra sao, vì cách sửa nằm ở
        // chính locator ấy — thu hẹp nó lại, hoặc dùng element có ngữ cảnh
        // dòng thay vì element chung chung.
        if (ambiguous.length > 0) {
          throw new Error(
            `Không bấm được "${actionLabel}": mọi locator còn lại đều khớp nhiều phần tử `
            + `bấm được mà không có gì phân biệt (${ambiguous.join(', ')}). `
            + 'Cần một locator thu hẹp được, hoặc một element mang ngữ cảnh dòng/vùng.',
          );
        }
        throw error;
      }
      const { r, heal, confirm } = resolved;

      // Bấm là hành động không lấy lại được, nên "chọn đại một cái" phải bị từ
      // chối TRƯỚC khi bấm, không phải được phát hiện qua postcondition sau đó.
      //
      // Bốn vòng healing trên một locator khớp 20 dòng vẫn bấm đúng dòng đầu cả
      // bốn lần: mỗi vòng thất bại theo đúng một kiểu, và thông báo cuối cùng
      // nói "không tạo ra được kết quả" — đúng, nhưng không nói vì sao. Loại
      // ứng viên ngay ở đây thì vòng sau được dùng cho một locator KHÁC, và
      // thông báo nói thẳng ra vấn đề là gì.
      //
      // Chỉ chặn khi driver tự khẳng định là mơ hồ. `undefined` là "không trả
      // lời được", và coi nó như "có" sẽ giết mọi locator hợp lệ trên những
      // driver không thu hẹp được — xem UiMatchSnapshot.ambiguousForAction.
      //
      // Và chỉ chặn khi locator này CHƯA TỪNG chứng minh được gì cho element
      // này. Ranh giới nằm ở lịch sử, không ở số khớp, vì số khớp không phân
      // biệt được hai chuyện khác hẳn nhau — đo trên máy thật cùng một tối:
      //
      //   label="THÊM MÃ"           khớp 2, thắng 10 lần  → cái đầu vẫn luôn đúng
      //   mat-icon.mat-menu-trigger khớp 53, thắng 0 lần  → mỗi dòng một cái
      //
      // Bản đầu của cổng chặn chỉ hỏi driver, nên nó chặn luôn cả cái thứ nhất
      // và biến bốn kịch bản đang xanh thành đỏ. Một locator đã sinh ra đúng
      // kết quả mong đợi hàng chục lần thì "phần tử đầu tiên" của nó không còn
      // là trùng hợp nữa, dù DOM có bao nhiêu phần tử giống nó đi nữa.
      const matches = this.driver.inspectMatches
        ? await this.driver.inspectMatches(r.candidate).catch(() => undefined)
        : undefined;
      const proven = provenWins(definition, r.candidate);
      if (matches?.ambiguousForAction && proven === 0) {
        excluded.add(candidateKey(r.candidate));
        ambiguous.push(`${r.candidate.strategy}=${r.candidate.value}`);
        console.warn(
          `[tap] "${actionLabel}": ${r.candidate.strategy}=${JSON.stringify(r.candidate.value)} `
          + `khớp ${matches.count} phần tử đang hiển thị, không có gì để chọn giữa chúng, `
          + 'và chưa từng chứng minh được kết quả nào — bỏ locator này, thử ứng viên khác '
          + 'thay vì bấm đại.',
        );
        continue;
      }

      const anchored = await this.anchorToTypedQuery(actionLabel, r, matches);

      // Được bấm tới trước khi bấm hay không — hỏi TRƯỚC, vì sau cú bấm thì
      // không còn đo được nữa. Chỉ hỏi khi câu trả lời có thể đổi phán quyết:
      // đúng lúc điều kiện đã thoả sẵn nên `transitionCanBeProven` là false, và
      // một lỗi interception sắp tới là thứ duy nhất phân biệt "bấm trúng, bị
      // chính kết quả che" với "bấm vào hư không". Mỗi lần hỏi là một `evaluate`
      // nên không hỏi ở những cú bấm mà nó không nói thêm được gì.
      const hittableBefore = expectation && !transitionCanBeProven
        ? await this.driver.isHittable?.(anchored).catch(() => undefined)
        : undefined;
      /** Cú bấm ném lỗi vì chính kết quả của nó chắn con trỏ, đã đo được. */
      let coveredByOwnResult = false;
      /** Cùng tình huống, nhưng driver không hit-test được nên không dám chắc. */
      let coveredUnmeasured = false;

      phaseStarted = Date.now();
      try {
        await this.driver.tap(anchored);
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
        const provable = expectation
          && expectation.verification !== 'deferred'
          && expectation.state !== 'absent';
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
        // Và GIỮ LẤY kết luận đó. Đoạn phân loại phía dưới chỉ nhìn "điều kiện
        // đã thoả sẵn, nội dung không đổi" nên nó xếp ca này vào `unchanged` và
        // bắt kịch bản đỏ — phủ định đúng cái vừa được chứng minh ở đây, trong
        // cùng một bước, cách nhau vài chục dòng.
        //
        // Lỗi interception là một QUAN SÁT: có lớp phủ đang chắn con trỏ. Nó chỉ
        // trở thành bằng chứng khi biết trước đó phần tử còn bấm được — bằng
        // không thì một dialog mở sẵn từ bước trước cũng ném đúng lỗi này.
        if (looksIntercepted(error)) {
          if (hittableBefore === true) coveredByOwnResult = true;
          else if (hittableBefore === undefined) coveredUnmeasured = true;
        }
      }
      logSlowActionPhase(actionLabel, `click attempt ${attempt}`, phaseStarted);
      phaseStarted = Date.now();
      await this.driver.isIdle().catch(() => {});
      logSlowActionPhase(actionLabel, `idle wait attempt ${attempt}`, phaseStarted);

      if (expectation?.verification === 'deferred') {
        // The tap resolved and did not throw, but the authoritative proof is
        // the next numerical assertion. Keep it unverified for now so a failed
        // assertion cannot accidentally make the action green.
        if (this.executeDepth <= 1) {
          this.lastUnverified = true;
          this.lastUnverifiedKind = 'deferred';
          this.lastUnverifiedReason =
            `Đang chờ bước "${expectation.source}" đo thay đổi nghiệp vụ sau hành động.`;
          console.log(
            `[tap] "${actionLabel}": chờ bước "${expectation.source}" chứng minh kết quả.`,
          );
        }
        confirm();
        return heal;
      }

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
        // Bằng chứng nhân quả đã có từ cửa thoát phía trên: phần tử còn bấm được
        // ngay trước cú bấm, sau cú bấm thì bị chắn, và thứ nó phải tạo ra đã
        // thấy. Một cú bấm rơi vào hư không không dựng được lớp phủ ấy.
        if (coveredByOwnResult) {
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
          this.lastUnverifiedKind = coveredUnmeasured
            ? 'covered'
            : expectation ? 'unchanged' : 'no-postcondition';
          this.lastUnverifiedReason = coveredUnmeasured
            ? `Cú bấm báo lỗi vì có lớp phủ chắn con trỏ và "${expectation!.source}" đã thấy, `
              + 'nhưng driver này không hit-test được nên không nói chắc lớp phủ do cú bấm tạo ra.'
            : expectation
              ? `Điều kiện "${expectation.source}" đã đúng trước thao tác và trạng thái quan sát được không đổi.`
              : 'Bước tiếp theo không mô tả một kết quả có thể quan sát để đối chiếu trước và sau thao tác.';
          console.warn(
            coveredUnmeasured
              ? `[tap] "${actionLabel}": lớp phủ chắn cú bấm và "${expectation!.source}" đã thấy, `
                + 'nhưng driver không đo được trước đó có bấm được không — không kết luận theo chiều nào.'
              : `[tap] "${actionLabel}": không có gì chứng minh cú bấm tạo ra thay đổi`
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

        // Hậu điều kiện chưa từng được nhìn thấy thì nó không buộc tội ai được.
        //
        // Cùng một bài học với nhánh `saidSince` ngay trên: healing chỉ biết
        // "màn hình mong đợi không có", và nó mặc định suy ra "locator vừa bấm
        // là thủ phạm". Suy luận ấy chỉ đúng khi hậu điều kiện CÓ THỂ được nhìn
        // thấy. Nếu chính element hậu điều kiện chưa từng resolve trên nền tảng
        // này và cũng không có locator nào, thì sự vắng mặt của nó không phân
        // biệt được "bấm sai" với "chưa bao giờ biết tìm nó ở đâu".
        //
        // Đo trên máy thật 2026-09-16, feature Thêm mới template: bước bấm thẻ
        // "Lợi nhuận theo tháng" tìm đúng và bấm đúng — discovery vừa học được
        // locator và ghi `learn:new ... đã chứng minh bằng kết quả action`. Rồi
        // bước SAU nó, "Nút đóng popup Thêm thẻ" (0 resolutions, không locator
        // nền tảng nào), không resolve nổi. Healing quy ngược trách nhiệm lên
        // bước trước: gỡ bỏ locator vừa học, rồi đi thử thẻ "Tài sản" — một thẻ
        // hoàn toàn khác. Mỗi lượt chạy lặp lại đúng như vậy, nên lượt nào cũng
        // vừa mất locator đúng vừa bấm nhầm thẻ.
        //
        // Đây KHÔNG phải cái cớ để tha cho mọi hậu điều kiện hụt: một element
        // đã từng resolve, hoặc có locator cho nền tảng này, vẫn buộc tội được
        // như cũ — vắng mặt lúc ấy là một tín hiệu thật.
        if (this.expectationCanAccuse(expectation, lastOutcomeError)) {
          this.resolver.rejectResolution(elementId, r);
          excluded.add(candidateKey(r.candidate));
        } else {
          console.warn(
            `[healing] "${actionLabel}": giữ nguyên locator — "${expectation.source}" `
            + 'chưa từng resolve trên nền tảng này nên không kết luận được cú bấm sai.',
          );
          break;
        }
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

  /**
   * Hậu điều kiện hụt này có đủ tư cách buộc tội locator của cú bấm không?
   *
   * Chỉ xét đúng một tình huống: lỗi là "không tìm thấy" và đối tượng không tìm
   * thấy chính là element hậu điều kiện. Mọi lỗi khác — sai giá trị, sai trạng
   * thái, app từ chối — vẫn nói được điều gì đó về cú bấm.
   *
   * Element đã từng resolve (dù ở nền tảng khác) hoặc có sẵn locator cho nền
   * tảng này thì vẫn buộc tội được: discovery có căn cứ để tìm nó, nên vắng mặt
   * là tín hiệu. Chưa từng resolve VÀ không có locator nào thì không: ta chưa
   * từng nhìn thấy nó lần nào, nên không phân biệt được "không có ở đó" với
   * "không biết tìm ở đâu".
   */
  private expectationCanAccuse(expectation: ActionExpectation, err: unknown): boolean {
    if (!(err instanceof ElementNotFoundError)) return true;
    if (err.elementId !== expectation.elementId) return true;
    const def = this.resolver.registry.element(expectation.elementId);
    const hasLocator = (def.candidates?.[this.driver.platform]?.length ?? 0) > 0;
    const everResolved = (def.health?.resolutions ?? 0) > 0;
    return hasLocator || everResolved;
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
      case 'assertNumberDelta':
        return {
          elementId: intent.element,
          locatorParams: intent.locatorParams,
          state: 'visible',
          action: 'assert-text',
          source: step.text,
          verification: 'deferred',
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
      case 'simulateBiometricSuccess':
      case 'injectCameraImage':
        return undefined;
    }
  }
  return undefined;
}

function confirmTapProvenByNumberDelta(results: StepResult[], proof: StepSpec): void {
  for (let index = results.length - 2; index >= 0; index--) {
    const candidate = results[index]!;
    if (candidate.step.intent.kind === 'screenshot') continue;
    if (candidate.status === 'unverified' && candidate.step.intent.kind === 'tap') {
      candidate.status = 'passed';
      delete candidate.unverifiedReason;
      // Cả loại nữa, không chỉ lý do. Phán quyết kịch bản đọc `unverifiedKind`,
      // nên bỏ sót dòng này là một bước ĐÃ ĐƯỢC chứng minh vẫn kéo kịch bản đỏ.
      delete candidate.unverifiedKind;
      console.log(
        `[tap] ${candidate.step.text}: đã được bước sau chứng minh — ${proof.text}.`,
      );
    }
    return;
  }
}

/**
 * A focus/highlight assertion is a direct answer to the preceding tap.  It may
 * follow an idempotency assertion (for example "still exactly one row"), so it
 * is not necessarily the immediately following line.  Once the UI reports the
 * row focused, the earlier tap is no longer causally unproven.
 */
function confirmTapProvenByFocusedState(results: StepResult[], proof: StepSpec): void {
  for (let index = results.length - 2; index >= 0; index--) {
    const candidate = results[index]!;
    if (candidate.step.intent.kind === 'screenshot') continue;
    if (candidate.step.intent.kind.startsWith('assert')) continue;
    if (candidate.status === 'unverified' && candidate.step.intent.kind === 'tap') {
      candidate.status = 'passed';
      delete candidate.unverifiedReason;
      // Cả loại nữa, không chỉ lý do. Phán quyết kịch bản đọc `unverifiedKind`,
      // nên bỏ sót dòng này là một bước ĐÃ ĐƯỢC chứng minh vẫn kéo kịch bản đỏ.
      delete candidate.unverifiedKind;
      console.log(`[tap] ${candidate.step.text}: đã được trạng thái focus/highlight chứng minh — ${proof.text}.`);
    }
    return;
  }
}

function normalizeCollectionText(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('vi-VN');
}

/** Business values that help discovery identify the control being verified. */
function semanticValuesFromIntent(intent: Intent): string[] {
  switch (intent.kind) {
    case 'assertText':
      return [intent.text];
    case 'assertOption':
      return [intent.option];
    case 'assertCollection':
      return 'text' in intent.check ? [intent.check.text] : [];
    case 'select':
      return [intent.option];
    default:
      return [];
  }
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

/** Routes that are only the search source, never proof that a feature opened. */
function isHomeLikeRoute(value: string): boolean {
  if (!value || value === 'about:blank') return false;
  try {
    const path = new URL(value).pathname.replace(/\/+$/, '') || '/';
    return path === '/' || path === '/home';
  } catch {
    return false;
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
/**
 * Whether a click failure says "something was in the way" rather than "there
 * was nothing to click".
 *
 * Only this shape of failure can be read as evidence that a tap landed: the
 * pointer reached the page and another layer took the event. A detached node,
 * a missing element or a navigation abort say nothing of the sort, and must not
 * borrow the conclusion. Three engines phrase the same fact differently, hence
 * three patterns rather than one.
 */
function looksIntercepted(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /intercepts pointer events/i.test(message)            // Playwright
    || /is not clickable at point/i.test(message)              // ChromeDriver
    || /other element would receive the click/i.test(message); // Selenium/Appium
}

function driverReason(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const first = raw.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return first ? `bấm lỗi (${first.slice(0, 160)})` : 'bấm lỗi';
}
