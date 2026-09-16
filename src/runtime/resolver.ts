import type { ElementDef, LocatorCandidate, Platform } from '../core/types.js';
import type { Registry } from '../core/registry.js';
import { protectedSelectors, type UiDriver, type UiHandle } from '../drivers/driver.js';
import type { DiscoveryResult, ElementDiscovery } from '../discovery/ElementDiscovery.js';
import type { SemanticElementDiscovery } from '../discovery/ai/SemanticElementDiscovery.js';
import type { VisionElementDiscovery } from '../discovery/ai/VisionElementDiscovery.js';
import type { ObservedElement, UiObservation } from '../discovery/UiObservation.js';
import type { ActionKind, ElementIntent } from '../discovery/ElementIntent.js';
import { buildElementIntent, mapDiscoveryStrategy } from '../discovery/DriverObservationAdapter.js';
import { StandardElementVerifier } from '../discovery/ElementVerifier.js';
import { iconMeaningMatches } from '../discovery/ConfidenceScorer.js';
import {
  contextualRowActionCandidates,
  formatRelativeRowLocator,
  parseRelativeRowLocator,
} from '../core/contextual.js';
import {
  assessLocatorQuality,
  asUnapprovedFallback,
  matchesByContainment,
  matchesByShape,
} from '../core/locatorQuality.js';
import { xpathLiteral } from '../core/labelXPath.js';
import { normalizeHumanText } from '../core/text.js';
import { semanticControlTokens } from '../core/controlNames.js';

export interface ResolveOptions {
  /** Total budget for finding the element. */
  timeoutMs: number;
  pollMs: number;
  /** Require the element to be visible, not merely present in the tree. */
  requireVisible: boolean;
  /**
   * Before accepting a *fallback* candidate, check that its text plausibly
   * matches the element's label. Prevents the classic self-healing failure mode:
   * the framework "recovers" by clicking a completely different button.
   */
  verifyHealedMatch: boolean;
  /** Runtime action that the discovered element must safely support. */
  discoveryAction?: ActionKind;
  /** Candidate keys rejected by an action postcondition during this step. */
  excludeCandidateKeys?: string[];
  /** Allow ranked ambiguous candidates only when the caller can prove outcome. */
  allowAmbiguousDiscovery?: boolean;
  /** Values used to instantiate authored locator templates for this step. */
  locatorParams?: Record<string, string>;
  /** Previous/next business assertions that narrow runtime discovery. */
  semanticContext?: string[];
  /** Exact business value the current read-only assertion expects to see. */
  semanticText?: string;
  /** The last successfully asserted business region, when one exists. */
  contextAnchor?: string;
}

export const DEFAULT_RESOLVE: ResolveOptions = {
  timeoutMs: 10_000,
  pollMs: 250,
  requireVisible: true,
  verifyHealedMatch: true,
};

export interface Resolution {
  handle: UiHandle;
  candidate: LocatorCandidate;
  /** True when the winner was not the highest-weighted candidate. */
  healed: boolean;
  previous?: LocatorCandidate;
  attempts: number;
}

export interface VerifiedLearningEvent {
  elementId: string;
  platform: Platform;
  candidate: LocatorCandidate;
  kind?: 'confirmed' | 'rejected';
}

/**
 * Chờ thêm bao lâu cho một discovery còn dang dở khi hạn resolve đã hết.
 *
 * Đủ để tầng AI kịp trả lời (đo được khoảng 2-3 giây trên máy thật), và chỉ
 * tiêu tốn đúng lúc bước sắp hỏng — nên nó không làm chậm lượt chạy nào đang
 * đi đúng đường.
 */
const DISCOVERY_GRACE_MS = 6_000;

/**
 * Chờ bao lâu trước khi gọi discovery, khi số vòng lặp chưa đủ.
 *
 * Trên Appium-trong-WebView mỗi vòng tốn hàng giây, nên đếm vòng là sai đơn vị.
 * 2,5 giây đủ để một chuyển màn bình thường kịp xong mà vẫn còn phần lớn ngân
 * sách resolve cho việc tìm kiếm thật sự.
 */
const DISCOVERY_AFTER_MS = 2_500;

export class ElementNotFoundError extends Error {
  constructor(
    readonly elementId: string,
    readonly platform: Platform,
    readonly tried: LocatorCandidate[],
    readonly attempts: number,
    readonly urlMismatch?: { expected: string; actual: string },
  ) {
    const base =
      `Could not resolve "${elementId}" on ${platform} after ${attempts} attempts. ` +
      `Tried: ${tried.map((c) => `${c.strategy}=${c.value}`).join(', ')}`;
    const hint = urlMismatch
      ? ` | URL mismatch: expected "${urlMismatch.expected}" but got "${urlMismatch.actual}" — app may have navigated to the wrong screen.`
      : '';
    super(base + hint);
    this.name = 'ElementNotFoundError';
  }
}

/**
 * All waiting in TestPilot happens here, and nowhere else.
 *
 * The loop re-queries the whole candidate list on every tick instead of locking
 * onto one selector and waiting on it. That is what makes a step survive a
 * re-render, a late hydration, or a renamed testId: the *element* is the unit of
 * waiting, not the selector.
 */
export class Resolver {
  // G04: single authoritative verification engine — shared with ElementDiscovery
  private readonly verifier = new StandardElementVerifier();
  /** Locators proven during this process, so later scenarios can report reuse. */
  private readonly learnedThisRun = new Set<string>();
  private readonly reuseReported = new Set<string>();
  private visionDisabledForRun = false;
  private visionUnavailableUntil = 0;
  private visionCircuitReported = false;

  constructor(
    private readonly driver: UiDriver,
    readonly registry: Registry,
    private readonly opts: ResolveOptions = DEFAULT_RESOLVE,
    /**
     * Optional discovery engine.  When present, the resolver tries it once
     * after all known candidates fail on the first tick — effectively adding a
     * self-healing observation pass before giving up.
     *
     * Kept optional so callers that haven't wired a RuntimeRegistry yet
     * (scripts, CLI commands) continue to work without changes.
     */
    private readonly elementDiscovery?: ElementDiscovery,
    /**
     * The AI fallback, when the config turns it on. Absent means the resolver
     * behaves exactly as it did before this tier existed.
     */
    private readonly semanticDiscovery?: SemanticElementDiscovery,
    private readonly aiMinConfidence = 60,
    private readonly visionDiscovery?: VisionElementDiscovery,
    private readonly screenshotProvider?: { screenshot(): Promise<string> },
    /** Persist a proven locator without waiting for the whole suite to finish. */
    private readonly onVerifiedLearning?: (event: VerifiedLearningEvent) => void,
  ) {}

  async resolve(elementId: string, override: Partial<ResolveOptions> = {}): Promise<Resolution> {
    const o = { ...this.opts, ...override };

    // Load screen definition for this element — used for cssScope + urlPattern.
    const elementDef = this.registry.element(elementId);
    const screenDef = elementDef.screen ? this.registry.screen(elementDef.screen) : undefined;
    const cssScope = screenDef?.cssScope;

    // Copy so unshift() below doesn't mutate the registry's internal array,
    // then apply cssScope: prefix every css candidate with the screen scope so
    // selectors stay short in the registry but are safely narrowed at runtime.
    const declaredCandidates = this.registry.candidates(elementId, this.driver.platform)
      .map((candidate) => instantiateCandidate(candidate, o.locatorParams));
    // A generated action can name a control by its operation ("mở dropdown
    // Danh mục") while the same real control is already known by its business
    // name ("Danh mục theo dõi"). Reuse same-screen candidates when the
    // meaningful phrase is contained in the sibling label. This is runtime
    // semantic discovery, not a hardcoded alias: the candidate still has to be
    // clickable and the executor still gates it by the action's outcome.
    const rawCandidates = declaredCandidates.length > 0
      ? declaredCandidates
      : this.sameControlCandidates(elementId, o.locatorParams);
    const authoredPrimary = rawCandidates[0];
    const excluded = new Set(o.excludeCandidateKeys ?? []);
    const candidates = this.prepareCandidates(
      this.withSemanticLabelFallback(
        rawCandidates,
        interpolateTemplate(elementDef.label, o.locatorParams),
        o.contextAnchor,
      ),
      cssScope,
    )
      .filter((candidate) => !excluded.has(candidateKey(candidate)));

    // Every locator the registry itself declares for this element, prepared the
    // same way so the keys line up with `candidates` above.
    //
    // The registry lists candidates in priority order on purpose: that ordering
    // *is* the fallback plan, written by whoever authored the element. Semantic
    // verification exists for locators nobody authored — ones discovery invents
    // mid-run — and applying it to the element's own second choice quietly
    // cancels the plan. It did: `role=combobox` is ambiguous on the mobile web
    // build (three of them on one screen), `label=Chuyển từ` found the right
    // control every time, and every time it was thrown away unverified-looking.
    const authoredKeys = new Set(
      this.prepareCandidates(rawCandidates, cssScope).map(candidateKey),
    );
    const deadline = Date.now() + o.timeoutMs;
    let attempts = 0;
    const startedAt = Date.now();
    let ticks = 0;
    /** Ứng viên do discovery tìm ra, có thể về sau vài tick. */
    let discovered: LocatorCandidate | null = null;
    let discoverySettled = false;
    let discoveryStartedAt = 0;
    let discoveryTask: Promise<LocatorCandidate | null> | null = null;
    let discoveryAttempted = false;
    // A discovery result only describes the exact UI snapshot from which it
    // was produced. Closing an overlay changes that UI, so any in-flight
    // result from the older generation must never be allowed to win later.
    let discoveryGeneration = 0;
    let lastUrl: string | undefined;
    /** Ứng viên đã thực sự đưa cho driver, để biết cái nào chưa từng được thử. */
    const daThu = new Set<string>();

    // Deliberately no popup sweep before the first look.
    //
    // Clearing first means the answer to "did the application respond?" is
    // asked of a page this code has already tidied. A validation dialog was
    // dismissed here — by clicking its own ĐÓNG button — and the assertion that
    // followed reported the message had never appeared. Three diagnoses were
    // drawn from the resulting blank screen and all three were wrong.
    //
    // The order is the whole fix: look, and only if nothing matched, clear and
    // look again (the miss path below). A nuisance overlay still costs one
    // candidate sweep before it is removed, which is the price of not
    // destroying the evidence in the common case. Protecting the overlay
    // instead was considered and rejected — it cannot tell the app's own answer
    // from a coach mark that happened to appear at the same moment.
    do {
      // Capture URL each tick — used for error diagnostics and urlPattern matching.
      if (this.driver.currentUrl) {
        lastUrl = await this.driver.currentUrl().catch(() => undefined);
        if (lastUrl && !discoveryAttempted && attempts === 0) {
          // Log the URL on the first tick so we can discover real route patterns.
          console.log(`[resolver] "${elementId}" screen="${elementDef.screen}" url="${lastUrl}"`);
        }
      }

      for (const candidate of candidates) {
        attempts += 1;
        daThu.add(candidateKey(candidate));
        const handle = await this.tryCandidate(candidate, o);
        if (!handle) continue;

        // `origin: healed` describes how a locator first entered the registry,
        // not whether it is still a fallback today. Once an operation has
        // verified and persisted that locator it may become the highest-ranked
        // candidate. Treating it as a fallback forever re-runs label matching
        // on every use and rejects valid structural locators whose live text is
        // dynamic (for example the generic "first search result" element whose
        // current text is a stock code such as "ADS-HOSE").
        //
        // A candidate is a fallback only when it is not the registry's current
        // primary candidate. A locator discovered during this resolve is not in
        // `rawCandidates`, so it remains a fallback and still receives semantic
        // verification before an action can use it.
        // Two different questions, previously answered by one flag.
        //
        // `isFallback` is for the record: anything other than the primary won,
        // which is worth reporting whether or not it was authored.
        //
        // `unauthored` is the gate: only a locator the registry never declared
        // has to prove itself. Conflating them meant an authored fallback was
        // treated as if discovery had invented it.
        const isFallback =
          !authoredPrimary || candidateKey(candidate) !== candidateKey(authoredPrimary);
        const unauthored = !authoredKeys.has(candidateKey(candidate));
        if (
          unauthored &&
          o.verifyHealedMatch &&
          !(await this.verifySemantically(elementId, handle, o.locatorParams, o.semanticText, o.discoveryAction))
        ) {
          continue;
        }

        this.reportLearnedReuse(elementId, candidate, authoredKeys.has(candidateKey(candidate)));
        return {
          handle,
          candidate,
          healed: isFallback,
          ...(isFallback && authoredPrimary ? { previous: authoredPrimary } : {}),
          attempts,
        };
      }

      ticks += 1;

      // The first candidate sweep above is deliberately observational. Once it
      // missed, however, remove a blocking overlay BEFORE taking the discovery
      // snapshot. Starting discovery first captured the permission dialog,
      // dismissed it a moment later, then kept ranking the stale 400-node tree
      // for the rest of the step. Vision correctly reported that the requested
      // control was absent from the screenshot we had given it.
      if (this.driver.dismissOverlay) {
        const dismissed = await this.driver
          .dismissOverlay(protectedSelectors(candidates))
          .catch(() => false);
        if (dismissed) {
          if (discoveryAttempted || discoveryTask) {
            discoveryGeneration += 1;
            discovered = null;
            discoveryTask = null;
            discoverySettled = false;
            discoveryStartedAt = 0;
            discoveryAttempted = false;
            console.log(
              `[discovery] "${elementId}": overlay vừa thay đổi màn hình — bỏ ảnh/XML cũ và quan sát lại.`,
            );
          }
          continue;
        }
      }

      // Give authored/previously verified locators several cheap polling ticks
      // before invoking discovery. A normal route transition can take a few
      // seconds; starting a full DOM observation after the very first miss used
      // to consume almost the entire post-click budget and leave a known-good
      // locator with only one attempt.
      // Khởi động theo THỜI GIAN, không chỉ theo số vòng.
      //
      // "Vòng thứ ba" ngầm giả định mỗi vòng rẻ — đúng với Playwright và CDP,
      // sai hẳn với Appium trong WebView. Đo trên máy thật ngày 2026-09-10: một
      // lệnh tìm element không khớp tốn trung bình 3,4 GIÂY, nên trong ngân sách
      // 10 giây resolver chỉ kịp 3 vòng và discovery gần như không bao giờ tới
      // lượt — đúng chuỗi ba phép thử liên tiếp không thấy dòng [discovery] nào.
      //
      // Mốc thời gian nói đúng thứ cần nói: đã chờ đủ lâu để tin rằng các
      // locator đã biết sẽ không cứu được nữa.
      const waitedLongEnough = Date.now() - startedAt >= DISCOVERY_AFTER_MS;
      if (this.elementDiscovery && !discoveryAttempted && (ticks >= 3 || waitedLongEnough)) {
        discoveryAttempted = true;
        discoveryStartedAt = Date.now();
        // Chạy nền, KHÔNG đua với đồng hồ rồi vứt kết quả.
        //
        // Bản cũ đặt discovery vào Promise.race với sleep(2s). Trên iOS, một lần
        // lấy cây giao diện đã mất ~900ms (đo thật, có lần 11–12 giây), cộng
        // parse, chấm điểm và có thể một lượt gọi model — nên nó gần như luôn
        // thua cuộc đua. Thua thì kết quả bị bỏ, và tệ hơn: câu giải thích "vì
        // sao không tìm được" nằm bên trong chính lời hứa bị bỏ đó, nên một
        // discovery thất bại trông y hệt một discovery chưa từng chạy.
        //
        // Chạy nền thì mỗi vòng lặp sau chỉ việc hỏi "có kết quả chưa" — không
        // tick nào bị chặn, và kết quả về muộn vẫn kịp dùng trong cùng lần
        // resolve này.
        const generation = discoveryGeneration;
        const task = this.tryDiscovery(
          elementId,
          o.discoveryAction,
          o.locatorParams,
          o.semanticContext,
          o.semanticText,
          o.allowAmbiguousDiscovery ?? isReadOnlyDiscovery(o.discoveryAction),
          excluded,
          o,
        );
        discoveryTask = task;
        void task
          .then((c) => {
            if (generation === discoveryGeneration) discovered = c;
          })
          .catch(() => {
            if (generation === discoveryGeneration) discovered = null;
          })
          .finally(() => {
            if (generation === discoveryGeneration) discoverySettled = true;
          });
      }
      if (discovered && !excluded.has(candidateKey(discovered))) {
        candidates.unshift(discovered);
        discovered = null;
      }

      // Nothing matched this tick. If the UI is still moving, that is a reason to
      // keep waiting rather than to fail.
      await this.driver.isIdle().catch(() => false);
      await sleep(o.pollMs);
    } while (Date.now() < deadline);

    // Hết giờ mà discovery còn đang chạy thì CHỜ THÊM một nhịp, đừng hỏng ngay.
    //
    // Hỏng ở đây là hỏng cả bước, và bước hỏng thì cả kịch bản dừng — nên vài
    // giây chờ thêm rẻ hơn nhiều so với thứ nó đánh đổi. Chỉ trả giá đúng lúc
    // sắp hỏng: đường đi bình thường không bao giờ chạm tới đoạn này.
    //
    // Đo trên máy thật ngày 2026-09-10: tầng AI trả về đúng locator đã bị xoá
    // (placeholder="Email / Số tài khoản / Điện thoại", tin cậy 95) nhưng về
    // sau hạn resolve, nên câu trả lời đúng bị vứt đi.
    // Ứng viên chưa từng đưa cho driver thì phải được thử, dù đã hết giờ.
    //
    // Năm lượt chạy thật ngày 11/09 báo `Tried: placeholder=Mã cổ phiếu` trong
    // khi dòng ngay trên là tầng AI trả về ĐÚNG ô nhập. Câu trả lời ấy rơi vào
    // một khe giữa hai nhánh, theo hai biến thể của cùng một chuyện:
    //
    //   - về trong nhịp `sleep` của vòng cuối: đã settled nên nhánh "chờ thêm"
    //     bỏ qua, mà cũng chưa kịp vào `candidates` nên vòng lặp không thấy;
    //   - vào được `candidates` bằng `unshift` ở CUỐI vòng chót, rồi vòng lặp
    //     hết hạn trước khi duyệt tới — nằm trong danh sách "đã thử" mà chưa
    //     từng được đưa cho driver một lần nào.
    //
    // Cả hai đều kết thúc bằng một thông báo lỗi khai rằng locator đúng chưa
    // từng được thử, nên ba buổi chẩn đoán đã đi tìm lý do model "bỏ qua" một
    // câu trả lời mà nó vẫn luôn đưa ra. Hỏi theo "đã đưa cho driver chưa" thì
    // cả hai biến thể cùng được trả lời, và biến thể thứ ba sau này cũng vậy.
    let late: LocatorCandidate | null = discovered;
    discovered = null;
    if (!late && discoveryTask && !discoverySettled) {
      late = await Promise.race([
        discoveryTask,
        sleep(DISCOVERY_GRACE_MS).then(() => null),
      ]);
    }
    if (late && !excluded.has(candidateKey(late)) && !candidates.some((c) => candidateKey(c) === candidateKey(late!))) {
      candidates.push(late);
    }

    for (const candidate of candidates) {
      if (daThu.has(candidateKey(candidate)) || excluded.has(candidateKey(candidate))) continue;
      attempts += 1;
      daThu.add(candidateKey(candidate));
      const handle = await this.tryCandidate(candidate, o);
      const verified = handle
        && (!o.verifyHealedMatch
          || (await this.verifySemantically(elementId, handle, o.locatorParams, o.semanticText, o.discoveryAction)));
      if (handle && verified) {
        console.log(`[discovery] "${elementId}": tìm được sau khi chờ thêm — ${candidate.strategy}=${candidate.value}`);
        return { handle, candidate, healed: true, attempts };
      }
      // Trượt ở đây thì phải nói ra trượt Ở ĐÂU.
      //
      // Nhánh này vốn im lặng hoàn toàn, nên "AI không trả lời", "locator không
      // khớp gì trên màn hình" và "khớp nhưng bị kiểm tra ngữ nghĩa từ chối" để
      // lại cùng một dấu vết: không dấu vết nào.
      console.warn(
        `[discovery] "${elementId}": ${candidate.strategy}="${candidate.value}" về sau hạn và `
        + (handle
          ? 'khớp được phần tử nhưng kiểm tra ngữ nghĩa từ chối.'
          : 'không khớp phần tử nào trên màn hình lúc đó.'),
      );
    }

    // Discovery vẫn đang chạy khi hết giờ là một câu trả lời, không phải im
    // lặng. Trước đây trường hợp này không để lại dấu vết nào, nên "discovery
    // không tìm ra" và "discovery chưa kịp chạy xong" trông giống hệt nhau —
    // và người đi truy phải đoán. Trên iOS nó là trường hợp thường gặp: riêng
    // một lần lấy cây giao diện đã tốn khoảng 900ms.
    if (discoveryAttempted && !discoverySettled) {
      console.warn(
        `[discovery] "${elementId}": chưa trả lời xong sau ${Date.now() - discoveryStartedAt}ms `
        + '— hết hạn resolve trước. Tăng resolve.timeoutMs nếu màn hình này vốn chậm.',
      );
    }

    // Build URL mismatch hint when the app ended up on a different screen.
    const urlMismatch =
      lastUrl !== undefined && screenDef?.urlPattern && !lastUrl.includes(screenDef.urlPattern)
        ? { expected: screenDef.urlPattern, actual: lastUrl }
        : undefined;

    throw new ElementNotFoundError(elementId, this.driver.platform, candidates, attempts, urlMismatch);
  }

  /**
   * Runs the discovery pipeline for one element.  Returns a LocatorCandidate
   * suitable for prepending to the active candidate list, or null on any failure.
   *
   * Errors from discovery (observation timeout, driver offline, etc.) are
   * swallowed: discovery is a best-effort enhancement, not a hard dependency.
   */
  /** Element ids whose discovery failure has already been explained this run. */
  private readonly discoveryReported = new Set<string>();
  /** Element ids already proposed by the AI tier — one call each per run. */
  /**
   * Element đã hỏi AI rồi, kèm dấu vân tay màn hình lúc hỏi.
   *
   * Chặn hỏi lặp trên CÙNG một màn hình — hỏi lại khi không có gì đổi chỉ tốn
   * tiền và thời gian cho đúng câu trả lời cũ. Nhưng màn hình đổi thì câu hỏi
   * cũng là câu khác: cùng một element có thể vắng mặt ở bước này và xuất hiện
   * ở bước sau. Khoá cũ chỉ dùng elementId nên mỗi element chỉ được hỏi đúng
   * một lần cho cả lượt chạy — quá chặt.
   */
  private readonly aiProposals = new Map<string, Promise<LocatorCandidate[]>>();

  /**
   * Asks the AI tier what the deterministic pipeline could not find.
   *
   * The result may participate in this run, but it is still only a candidate:
   * driver.find() must resolve it against the live DOM, semantic verification
   * must accept the element, and a tap is persisted only after its observable
   * postcondition succeeds. This gives new natural-language steps a useful
   * first run without treating model output as execution proof.
   */
  private async proposeViaAi(
    intent: ElementIntent,
    observation: UiObservation,
    elementId: string,
    allowOutcomeValidation = false,
    resolveOptions: ResolveOptions = this.opts,
    forceVision = false,
  ): Promise<LocatorCandidate[]> {
    if (!this.semanticDiscovery && !this.visionDiscovery) return [];
    // Chỉ dùng trạng thái màn hình mang nghĩa nghiệp vụ. Số node và sáu nhãn
    // đầu thay đổi theo animation/virtual list, khiến cùng một màn hình ở
    // scenario sau bị coi là câu hỏi mới và lại gọi AI từ đầu.
    const screenState = stableScreenState(observation, this.registry.element(elementId).screen);
    const key = [
      elementId,
      intent.action,
      intent.label ?? intent.text ?? '',
      intent.context?.join('|') ?? '',
      screenState,
      allowOutcomeValidation ? 'bounded' : 'strict',
      forceVision ? 'vision' : 'semantic-first',
    ].join('::');
    const cached = this.aiProposals.get(key);
    if (cached) return cached;

    const task = (async (): Promise<LocatorCandidate[]> => {
      // Capture close to the structured observation. The image is uploaded to
      // Gemini only if semantic AI also fails, but it must describe the same UI.
      const visionAvailable = this.canUseVisionNow();
      const screenshotTask = visionAvailable && this.screenshotProvider
        ? this.screenshotProvider.screenshot().catch((err: Error) => {
            console.warn(`[discovery:vision] không chụp được màn hình: ${err.message.slice(0, 160)}`);
            return '';
          })
        : undefined;

      if (this.semanticDiscovery && !forceVision) {
        try {
          const semantic = await this.semanticDiscovery.discover(intent, observation, {
            minConfidence: this.aiMinConfidence,
            persistSuggestedLocator: false,
            allowExactTextProxy: allowOutcomeValidation,
          });
          const candidates = this.runtimeCandidatesFromResult(semantic, intent, elementId, 'semantic-ai');
          const usable = await this.usableAiCandidates(
            candidates,
            elementId,
            resolveOptions,
          );
          if (usable.length > 0) return usable;
          if (candidates.length > 0) {
            console.warn(
              `[discovery:vision] "${elementId}" — toàn bộ ${candidates.length} ứng viên semantic ` +
              'không resolve hoặc không qua xác minh; chuyển sang Gemini.',
            );
          }
          const why = semantic.evidence.slice(-2).join(' | ');
          console.warn(`[discovery:ai] "${elementId}" chưa có ứng viên dùng được: ${why.slice(0, 200)}`);
        } catch (err) {
          console.warn(`[discovery:ai] "${elementId}" lỗi semantic: ${(err as Error).message.slice(0, 200)}`);
        }
      }

      if (!this.visionDiscovery || !screenshotTask) return [];
      const screenshot = await screenshotTask;
      if (!screenshot) return [];
      try {
        console.warn(
          `[discovery:vision] "${elementId}" — semantic không có ứng viên dùng được; ` +
          'đang đối chiếu screenshot bằng Gemini.',
        );
        const vision = await this.visionDiscovery.discover(intent, screenshot, observation, {
          minConfidence: this.aiMinConfidence,
          platform: this.driver.platform,
          persistSuggestedLocator: false,
          allowExactTextProxy: allowOutcomeValidation,
        });
        // VisionElementDiscovery intentionally converts provider exceptions to
        // evidence instead of rethrowing. Feed those failures into the same
        // run-level circuit breaker; otherwise every new element retries a
        // quota that is already known to be exhausted.
        const providerFailure = vision.evidence.find((item) =>
          /\b429\b|resource[_ -]?exhausted|quota|\b503\b|unavailable|overload/i.test(item));
        if (providerFailure) this.tripVisionCircuit(providerFailure);
        for (const item of vision.evidence) {
          console.warn(`[discovery:vision] "${elementId}" ${item.replace(/^\[vision\]\s*/, '')}`);
        }
        const candidates = this.runtimeCandidatesFromResult(vision, intent, elementId, 'vision');
        if (candidates.length === 0) {
          console.warn(`[discovery:vision] "${elementId}" — không có locator đã xác minh để thử.`);
        }
        return this.usableAiCandidates(candidates, elementId, resolveOptions);
      } catch (err) {
        const message = (err as Error).message;
        this.tripVisionCircuit(message);
        console.warn(`[discovery:vision] "${elementId}" lỗi Gemini: ${message.slice(0, 200)}`);
        return [];
      }
    })();
    this.aiProposals.set(key, task);
    return task;
  }

  /**
   * A model proposal is not a usable fallback merely because it parsed into a
   * locator. Prove it against the live driver and the same semantic gate used
   * by the main resolver before allowing the cheaper tier to stop the chain.
   *
   * This is deliberately read-only. Persistence still happens only after the
   * executor observes the requested action's postcondition.
   */
  private async usableAiCandidates(
    candidates: LocatorCandidate[],
    elementId: string,
    o: ResolveOptions,
  ): Promise<LocatorCandidate[]> {
    const usable: LocatorCandidate[] = [];
    for (const candidate of candidates) {
      const handle = await this.tryCandidate(candidate, o);
      if (!handle) {
        console.warn(
          `[discovery:ai-check] "${elementId}" loại ${candidate.strategy}="${candidate.value}": ` +
          'không khớp phần tử đang hiển thị.',
        );
        continue;
      }
      if (
        o.verifyHealedMatch &&
        !(await this.verifySemantically(elementId, handle, o.locatorParams, o.semanticText, o.discoveryAction))
      ) {
        console.warn(
          `[discovery:ai-check] "${elementId}" loại ${candidate.strategy}="${candidate.value}": ` +
          'khớp DOM nhưng sai ngữ nghĩa control.',
        );
        continue;
      }
      usable.push(candidate);
    }
    return usable;
  }

  private runtimeCandidatesFromResult(
    result: DiscoveryResult,
    intent: ElementIntent,
    elementId: string,
    tier: 'semantic-ai' | 'vision',
  ): LocatorCandidate[] {
    if (result.method === 'failed' || !result.locator) return [];
    const semanticText = intent.text?.trim();
    // New providers attach a locator to every ranked match. Older adapters put
    // the sole locator on DiscoveryResult, so retain that contract as fallback.
    const rankedMatches = [
      result.match
        ? { ...result.match, locator: result.match.locator ?? result.locator }
        : undefined,
      ...(result.alternatives ?? []),
    ];
    return rankedMatches
      .filter((match): match is NonNullable<typeof match> => Boolean(match?.locator))
      .flatMap((match) => {
        const locator = match.locator!;
        const textLocatorOnWeb = this.driver.platform === 'web'
          && Boolean(semanticText)
          && locator.strategy === 'xpath';
        const proposed: LocatorCandidate = {
          strategy: textLocatorOnWeb ? 'label' : mapDiscoveryStrategy(locator.strategy),
          value: textLocatorOnWeb ? semanticText! : locator.value,
          weight: Math.min(0.9, match.confidence / 100),
          origin: 'healed',
        };
        if (!assessLocatorQuality(proposed).persistable) return [];
        console.warn(
          `[discovery:${tier}] "${elementId}" → ${proposed.strategy}="${proposed.value}" ` +
            `(tin cậy ${match.confidence}) — ứng viên runtime; chỉ lưu sau khi action tạo đúng trạng thái.`,
        );
        return [proposed];
      })
      .filter((candidate, index, all) =>
        all.findIndex((other) => candidateKey(other) === candidateKey(candidate)) === index);
  }

  private async tryDiscovery(
    elementId: string,
    action: ActionKind = 'assert-visible',
    locatorParams?: Record<string, string>,
    semanticContext?: string[],
    semanticText?: string,
    allowAmbiguousCandidates = false,
    excluded: ReadonlySet<string> = new Set(),
    resolveOptions: ResolveOptions = this.opts,
  ): Promise<LocatorCandidate | null> {
    /** Lời hứa của tầng AI, khởi động ngay khi có ảnh chụp. */
    let aiTask: Promise<LocatorCandidate[]> | null = null;
    try {
      const elementDef = this.registry.element(elementId);
      const intent = buildElementIntent(elementId, {
        ...elementDef,
        label: interpolateTemplate(elementDef.label, locatorParams),
      }, action, semanticContext);
      if (semanticText) intent.text = semanticText;
      // Lower threshold than the standard 60: this is a fallback after all known
      // locators have already failed.  The resolver's own plausible() guard still
      // catches completely unrelated matches when verifyHealedMatch is on.
      // context:'healing' bypasses G01 so the fallback never re-uses a stale
      // registry locator — it must observe the live UI fresh.
      const result = await this.elementDiscovery!.discover(intent, {
        minConfidence: 40,
        context: 'healing',
        platform: this.driver.platform,
        screen: elementDef.screen,
        // Identity verification makes this candidate safe to try, but only the
        // executor can prove that the requested action had the intended effect.
        persistVerifiedLocator: false,
        allowAmbiguousCandidates,
        // Khởi động tầng AI NGAY khi có ảnh chụp, song song với phần còn lại.
        //
        // Ảnh chụp là phần đắt nhất và cả hai tầng dùng chung nó. Trước đây AI
        // chỉ chạy sau khi tầng tất định thất bại, mà phần sau ảnh chụp — chấm
        // điểm, cổng chống mập mờ, xác minh — còn hỏi lại thiết bị nên mất thêm
        // hàng giây. Đo ngày 2026-09-10: AI trả đúng locator với tin cậy 95
        // nhưng về sau hạn resolve và bị vứt đi.
        onObservation: (obs) => {
          aiTask = this.proposeViaAi(
            intent,
            obs,
            elementId,
            allowAmbiguousCandidates,
            resolveOptions,
          ).catch(() => []);
        },
      });
      if (result.method === 'failed' || !result.locator) {
        // Say why, once per element. discover() collects an evidence trail and
        // this threw it away, so a failed discovery looked identical to one
        // that never ran — and diagnosing an unfindable element meant guessing
        // from the outside for an afternoon.
        // Tầng AI đã chạy từ lúc có ảnh chụp; ở đây chỉ việc lấy kết quả.
        // Nhánh dự phòng dành cho trường hợp discover() thất bại TRƯỚC khi kịp
        // quan sát, khi đó chưa có gì để khởi động.
        const proposals = aiTask
          ? await aiTask
          : result.observation
            ? await this.proposeViaAi(
                intent,
                result.observation,
                elementId,
                allowAmbiguousCandidates,
                resolveOptions,
              ).catch(() => [])
            : [];
        const proposed = proposals.find((candidate) => !excluded.has(candidateKey(candidate)));
        if (proposed) return proposed;
        // The executor may have disproved every semantic candidate by its
        // postcondition on earlier attempts. They remain cached so the model is
        // not billed twice, but they must not prevent the final visual tier.
        if (proposals.length > 0 && result.observation && this.visionDiscovery) {
          const visual = await this.proposeViaAi(
            intent,
            result.observation,
            elementId,
            allowAmbiguousCandidates,
            resolveOptions,
            true,
          ).catch(() => []);
          const visualCandidate = visual.find(
            (candidate) => !excluded.has(candidateKey(candidate)),
          );
          if (visualCandidate) return visualCandidate;
        }
        if (!this.discoveryReported.has(elementId)) {
          this.discoveryReported.add(elementId);
          console.warn(
            `[discovery] "${elementId}" không tìm được: ${result.evidence.slice(-3).join(' | ')}`,
          );
        }
        return null;
      }
      const discoveredMatches = [result.match, ...(result.alternatives ?? [])]
        .filter((match): match is NonNullable<typeof match> => Boolean(match?.locator));
      for (const match of discoveredMatches) {
        const textLocatorOnWeb = this.driver.platform === 'web'
          && Boolean(semanticText?.trim())
          && match.locator!.strategy === 'xpath';
        const candidate: LocatorCandidate = {
          strategy: textLocatorOnWeb ? 'label' : mapDiscoveryStrategy(match.locator!.strategy),
          value: textLocatorOnWeb ? semanticText!.trim() : match.locator!.value,
          // Clamp weight at 0.95 — a runtime-observed locator is never as certain
          // as one explicitly authored, but ranks above unverified fallbacks.
          weight: Math.min(0.95, match.confidence / 100),
          origin: 'healed',
        };
        if (!excluded.has(candidateKey(candidate))) {
          console.warn(
            `[discovery:deterministic] "${elementId}" → ${candidate.strategy}="${candidate.value}" ` +
              `(tin cậy ${match.confidence}) — chờ action chứng minh kết quả.`,
          );
          return candidate;
        }
      }
      return null;
    } catch (err) {
      // Discovery is non-critical; warn but do not propagate.
      console.warn(`[discovery] "${elementId}": ${(err as Error).message}`);
      return null;
    }
  }

  /** Waits until the element is gone. Used by assertNotVisible. */
  async resolveAbsent(elementId: string, override: Partial<ResolveOptions> = {}): Promise<void> {
    const o = { ...this.opts, ...override };
    const elementDef = this.registry.element(elementId);
    const screenDef = elementDef.screen ? this.registry.screen(elementDef.screen) : undefined;
    const candidates = this.prepareCandidates(
      this.withSemanticLabelFallback(
        this.registry.candidates(elementId, this.driver.platform)
          .map((candidate) => instantiateCandidate(candidate, o.locatorParams)),
        interpolateTemplate(elementDef.label, o.locatorParams),
      ),
      screenDef?.cssScope,
    );
    const deadline = Date.now() + o.timeoutMs;

    do {
      let anyVisible = false;
      for (const candidate of candidates) {
        if (await this.tryCandidate(candidate, o)) {
          anyVisible = true;
          break;
        }
      }
      if (!anyVisible) return;
      await sleep(o.pollMs);
    } while (Date.now() < deadline);

    throw new Error(`Element "${elementId}" was still visible after ${o.timeoutMs}ms.`);
  }

  /** One-shot visibility probe. It never discovers, waits, records, or persists. */
  async isVisibleNow(
    elementId: string,
    override: Partial<ResolveOptions> = {},
  ): Promise<boolean> {
    return Boolean(await this.visibleResolutionNow(elementId, override));
  }

  /**
   * Read-only proof that the screen owning an element is currently open.
   *
   * A brand-new screen often has no locator yet for its first business action.
   * Using that action as the sole navigation landmark creates a deadlock: the
   * executor refuses to enter the action step, so normal discovery never gets
   * a chance to learn it. The authored screen title is independent evidence
   * and is intentionally never recorded as the action's locator.
   */
  async visibleScreenTitleForElement(
    elementId: string,
    override: Partial<ResolveOptions> = {},
  ): Promise<string | undefined> {
    const element = this.registry.element(elementId);
    if (!element.screen) return undefined;
    const screen = this.registry.screen(element.screen);
    const title = screen?.title?.trim();
    if (!title) return undefined;

    // Do not use a plain text/label lookup. SPAs commonly keep navigation
    // drawers mounted off-screen; TCInvest's Home toolbox contains the text
    // "Báo cáo của tôi" even while the report dialog is closed. Requiring the
    // title node itself to carry heading/title semantics prevents that stale
    // menu item from proving a destination it did not open.
    const titleLiteral = xpathLiteral(title);
    const candidate: LocatorCandidate = {
      strategy: 'xpath',
      value: `//*[normalize-space(.)=${titleLiteral} and (`
        + `self::h1 or self::h2 or self::h3 or self::h4 or self::h5 or self::h6 `
        + `or @role='heading' `
        + `or contains(concat(' ', normalize-space(@class), ' '), ' title ') `
        + `or contains(concat(' ', normalize-space(@class), ' '), ' page-title ') `
        + `or contains(concat(' ', normalize-space(@class), ' '), ' screen-title ') `
        + `or contains(concat(' ', normalize-space(@class), ' '), ' dialog-title ') `
        + `or ancestor::*[contains(@class,'common-header') `
        + `or contains(concat(' ', normalize-space(@class), ' '), ' toolbar ') `
        + `or contains(concat(' ', normalize-space(@class), ' '), ' app-bar ') `
        + `or contains(concat(' ', normalize-space(@class), ' '), ' page-header ') `
        + `or contains(concat(' ', normalize-space(@class), ' '), ' dialog-header ')])]`,
      weight: 0.5,
      origin: 'healed',
    };
    const prepared = this.prepareCandidates([candidate], screen?.cssScope)[0];
    if (!prepared) return undefined;
    const handle = await this.tryCandidate(prepared, {
      ...this.opts,
      ...override,
      requireVisible: true,
    });
    return handle ? title : undefined;
  }

  /**
   * `isVisibleNow` with the winning handle kept instead of thrown away.
   *
   * Callers that need to compare an element's contents before and after an
   * action would otherwise have to resolve it twice — once to learn it is on
   * screen and once to read it. The probe already has the handle in hand.
   */
  async visibleResolutionNow(
    elementId: string,
    override: Partial<ResolveOptions> = {},
  ): Promise<{ candidate: LocatorCandidate; handle: UiHandle } | undefined> {
    return this.visibleResolutionUsing(elementId, override);
  }

  /**
   * `visibleResolutionNow` với quyền lọc bớt ứng viên trước khi thử.
   *
   * Tách ra vì cùng một element được hỏi theo hai câu hỏi khác nhau: "bấm được
   * cái này không" chấp nhận mọi locator từng chứng minh được, còn "màn hình
   * nào đang mở" thì không — xem `visibleLandmarkOnScreen`.
   */
  private async visibleResolutionUsing(
    elementId: string,
    override: Partial<ResolveOptions> = {},
    keep?: (candidate: LocatorCandidate) => boolean,
  ): Promise<{ candidate: LocatorCandidate; handle: UiHandle } | undefined> {
    const o = { ...this.opts, ...override };
    const elementDef = this.registry.element(elementId);
    const screenDef = elementDef.screen ? this.registry.screen(elementDef.screen) : undefined;
    const candidates = this.prepareCandidates(
      this.withSemanticLabelFallback(
        this.registry.candidates(elementId, this.driver.platform)
          .map((candidate) => instantiateCandidate(candidate, o.locatorParams)),
        interpolateTemplate(elementDef.label, o.locatorParams),
      ),
      screenDef?.cssScope,
    ).filter((candidate) => keep?.(candidate) ?? true);
    for (const candidate of candidates) {
      const handle = await this.tryCandidate(candidate, { ...o, requireVisible: true });
      if (handle) return { candidate, handle };
    }
    return undefined;
  }

  /**
   * Find a proven, currently visible landmark belonging to a screen.
   *
   * Opening a feature must not use the first business assertion as the screen
   * identity: its value may legitimately differ before the scenario starts.
   * A screen-level landmark is weaker than the requested assertion but strong
   * enough to establish where the runner is, and it works for newly authored
   * steps before those steps have their own locator.
   */
  async visibleLandmarkOnScreen(
    screenId: string,
    excludeElementIds: readonly string[] = [],
  ): Promise<{ elementId: string; label: string } | undefined> {
    const excluded = new Set(excludeElementIds);
    const elements = Object.values(this.registry.raw.elements)
      .filter((element) =>
        element.screen === screenId
        && !excluded.has(element.id)
        && (element.candidates[this.driver.platform]?.length ?? 0) > 0)
      .sort((a, b) =>
        (b.health?.resolutions ?? 0) - (a.health?.resolutions ?? 0));

    // Screen identity should be cheap. The most frequently proven locators are
    // the best landmarks; if none of the first few are visible, normal search
    // navigation and full discovery remain the authority.
    //
    // Nhưng CHỈ bằng những locator định danh chính xác, theo hai luật:
    //
    //  - matchesByContainment: khớp theo chuỗi con trả lời được câu "bấm cái
    //    nào" mà không trả lời được câu "đang ở màn nào" — mọi câu văn chứa cụm
    //    từ đều thành bằng chứng, kể cả câu nằm trong menu của màn hình khác.
    //  - matchesByShape: locator chỉ mô tả hình dạng (`role:dialog`, một class
    //    dùng chung) thì còn lỏng hơn nữa — nó không nhắc tới nội dung nào cả,
    //    nên đúng trên mọi màn hình có cùng hình dạng ấy.
    //
    // Cả hai luật chỉ quan trọng ở ĐÂY; xem hai hàm đó để biết vì sao.
    //
    // Lọc hết ứng viên thì element đó thôi làm landmark, không phải cả lượt
    // chạy hỏng: bỏ qua landmark chỉ có nghĩa là đi đường điều hướng bình
    // thường, vốn lặp lại được và không phá trạng thái.
    for (const element of elements.slice(0, 8)) {
      const seen = await this
        .visibleResolutionUsing(
          element.id,
          {},
          (c) => !matchesByContainment(c) && !matchesByShape(c),
        )
        .catch(() => undefined);
      if (seen) return { elementId: element.id, label: element.label };
    }
    return undefined;
  }

  /** Candidates owned by a same-screen element whose business name contains this one. */
  private sameControlCandidates(
    elementId: string,
    locatorParams?: Record<string, string>,
  ): LocatorCandidate[] {
    const siblings = sameScreenSemanticElements(this.registry, elementId, locatorParams)
      .sort((a, b) => (b.health?.resolutions ?? 0) - (a.health?.resolutions ?? 0));

    const candidates = siblings.flatMap((sibling) =>
      (sibling.candidates[this.driver.platform] ?? []).map((candidate) => ({
        ...instantiateCandidate(candidate, locatorParams),
        weight: Math.min(candidate.weight, 0.69),
        origin: 'healed' as const,
      })));
    if (candidates.length > 0) {
      console.log(
        `[discovery] "${elementId}" chưa có locator ${this.driver.platform}; `
        + `thử control cùng nghĩa "${siblings[0]!.label}" trên cùng màn hình.`,
      );
    }
    return candidates;
  }

  /**
   * Commit health and healed locator data after the operation (and, for taps,
   * its postcondition) has succeeded. Resolve alone is intentionally read-only.
   */
  confirmResolution(elementId: string, resolution: Resolution): void {
    const candidate = resolution.candidate;
    this.registry.recordResolution(elementId, this.driver.platform, candidate);
    if (candidate.origin !== 'healed') return;

    const {
      runtimeScope: _runtimeScope,
      runtimeTemplateValue: _runtimeTemplateValue,
      runtimeText: _runtimeText,
      ...persisted
    } = candidate;
    const quality = assessLocatorQuality(persisted);
    if (!quality.persistable) return;

    const learningKey = this.learningKey(elementId, persisted);
    const alreadyKnown = this.registry.candidates(elementId, this.driver.platform)
      .some((known) => candidateKey(known) === candidateKey(persisted));

    const elementDef = this.registry.element(elementId);
    this.registry.upsertElement({
      ...elementDef,
      candidates: {
        [this.driver.platform]: [asUnapprovedFallback(persisted)],
      },
    });
    this.elementDiscovery?.confirmLocator(
      elementId,
      { strategy: candidate.strategy, value: candidate.value },
      this.driver.platform,
      candidate.weight,
    );
    this.learnedThisRun.add(learningKey);
    if (!alreadyKnown) {
      console.log(
        `[learn:new] "${elementId}" — ${persisted.strategy}=${persisted.value}; `
        + 'đã chứng minh bằng kết quả action.',
      );
      try {
        this.onVerifiedLearning?.({
          elementId,
          platform: this.driver.platform,
          candidate: persisted,
        });
      } catch (err) {
        console.warn(`[learn:checkpoint] không thể xếp lịch lưu: ${(err as Error).message}`);
      }
    }
    if (resolution.previous) this.lanBaiHoc(elementId, resolution.previous, persisted);
  }

  private learningKey(elementId: string, candidate: LocatorCandidate): string {
    return `${elementId}::${this.driver.platform}::${candidateKey(candidate)}`;
  }

  private reportLearnedReuse(
    elementId: string,
    candidate: LocatorCandidate,
    declaredByRegistry: boolean,
  ): void {
    if (candidate.origin !== 'healed' || !declaredByRegistry) return;
    const learningKey = this.learningKey(elementId, candidate);
    const source = this.learnedThisRun.has(learningKey) ? 'reuse-session' : 'reuse-registry';
    const reportKey = `${source}::${learningKey}`;
    if (this.reuseReported.has(reportKey)) return;
    this.reuseReported.add(reportKey);
    console.log(`[learn:${source}] "${elementId}" — ${candidate.strategy}=${candidate.value}`);
  }

  private canUseVisionNow(): boolean {
    if (!this.visionDiscovery || this.visionDisabledForRun) return false;
    return Date.now() >= this.visionUnavailableUntil;
  }

  private tripVisionCircuit(message: string): void {
    if (/\b429\b|resource[_ -]?exhausted|quota/i.test(message)) {
      this.visionDisabledForRun = true;
      if (!this.visionCircuitReported) {
        this.visionCircuitReported = true;
        console.warn('[discovery:vision] hết quota — tắt Gemini Vision cho phần còn lại của run.');
      }
      return;
    }
    if (/\b503\b|unavailable|overload/i.test(message)) {
      this.visionUnavailableUntil = Date.now() + 60_000;
      if (!this.visionCircuitReported) {
        this.visionCircuitReported = true;
        console.warn('[discovery:vision] dịch vụ tạm lỗi — nghỉ gọi Vision 60 giây, vẫn tiếp tục các tầng khác.');
      }
    }
  }

  /**
   * Chữa được một bản ghi thì chia bài học cho những bản ghi cùng chỉ một control.
   *
   * Healing vốn chữa một BẢN GHI, không chữa một control. Candidate lưu theo
   * `elementId`, nên hai id cùng trỏ vào một ô nhập ngoài đời thì mỗi lần giao
   * diện đổi phải học lại từ đầu ở từng id — và lần thứ hai thường khó hơn lần
   * đầu. Đo trên máy thật 11/09: cùng một ô `mat-autocomplete-trigger` được
   * đăng ký hai lần,
   *
   *   priceBoard.oMaCoPhieu      nhãn "Ô mã cổ phiếu"
   *   addStockModal.searchInput  nhãn "Ô tìm kiếm mã cổ phiếu"
   *
   * và cả hai cùng giữ locator chết `placeholder="Mã cổ phiếu"`. Bản ghi thứ
   * nhất chữa được sang `placeholder="TCB,VNM,FPT..."`; bản ghi thứ hai thì
   * không, vì nhãn của nó đẩy model sang ô tìm kiếm toàn cục đang hiển thị trên
   * cùng màn hình — một ô có thật, sai thật, và bị luật head-word gạt đúng. Nó
   * không có đường nào đi tới ô đúng, dù câu trả lời đã nằm sẵn trong registry.
   *
   * Khoá nối gồm TOÀN BỘ locator vừa chết (kể cả accessible name) và nhãn
   * semantic tương thích. `role=menuitem` không đủ nhận dạng một control: cả
   * "Thêm vào danh mục" và "Xóa khỏi danh mục" đều mang role đó. Bỏ `name`
   * khỏi phép so sánh đã từng lan locator Xóa sang element Thêm — một lỗi có
   * thể click sai nghiệp vụ dù từng candidate riêng lẻ đều hợp lệ.
   *
   * Chép sang dưới dạng ứng viên chưa duyệt, trọng số thấp — nó vẫn phải tự
   * chứng minh qua confirmResolution như mọi locator khác, nên một lần chữa sai
   * không thể lan ra cả registry.
   */
  private lanBaiHoc(
    healedId: string,
    dead: LocatorCandidate,
    fresh: LocatorCandidate,
  ): void {
    const platform = this.driver.platform;
    const healed = this.registry.element(healedId);
    const screen = healed.screen;
    for (const other of Object.values(this.registry.raw.elements)) {
      if (other.id === healedId || other.screen !== screen) continue;
      if (!sameControlSemantics(healed, other)) continue;
      const list = other.candidates?.[platform] ?? [];
      const omLocatorChet = list.some(
        (candidate) => sameLocatorIdentity(candidate, dead),
      );
      if (!omLocatorChet) continue;
      if (list.some((c) => c.strategy === fresh.strategy && c.value === fresh.value)) continue;
      this.registry.upsertElement({
        ...other,
        candidates: { [platform]: [asUnapprovedFallback(fresh)] },
      });
      console.log(
        `[healing] "${other.id}" cùng giữ locator đã chết ${dead.strategy}="${dead.value}" `
        + `với "${healedId}" — chép sang ${fresh.strategy}="${fresh.value}" để thử, chưa duyệt.`,
      );
    }
  }

  /** Mark an outcome-invalid runtime candidate so it cannot silently win later. */
  rejectResolution(elementId: string, resolution: Resolution): void {
    if (resolution.candidate.origin !== 'healed') return;
    this.elementDiscovery?.rejectLocator(elementId, resolution.candidate);
    const removed = this.registry.rejectCandidate(
      elementId,
      this.driver.platform,
      resolution.candidate,
    );
    if (!removed) return;
    this.learnedThisRun.delete(this.learningKey(elementId, resolution.candidate));
    console.warn(
      `[learn:rejected] "${elementId}" — ${resolution.candidate.strategy}=${resolution.candidate.value}; `
      + 'kết quả action chứng minh locator sai, đã thu hồi khỏi registry.',
    );
    try {
      this.onVerifiedLearning?.({
        elementId,
        platform: this.driver.platform,
        candidate: resolution.candidate,
        kind: 'rejected',
      });
    } catch (err) {
      console.warn(`[learn:checkpoint] không thể xếp lịch lưu thu hồi: ${(err as Error).message}`);
    }
  }

  private prepareCandidates(
    raw: LocatorCandidate[],
    cssScope?: string,
  ): LocatorCandidate[] {
    const expanded: LocatorCandidate[] = [];
    for (const candidate of raw) {
      if (this.driver.platform === 'web' && candidate.strategy === 'label') {
        contextualRowActionCandidates(candidate.value).forEach((contextual) => {
          expanded.push({
            ...contextual,
            ...(candidate.noScope ? { noScope: true } : {}),
          });
        });
      }
      expanded.push(candidate);
    }

    // Apply cssScope to every locator strategy by chaining in the driver.
    return expanded.map((candidate) =>
      cssScope && !candidate.noScope
        ? { ...candidate, runtimeScope: cssScope }
        : candidate,
    ).sort((a, b) => b.weight - a.weight);
  }

  /**
   * Natural-language scenarios may intentionally enter the registry without a
   * selector. On web, Playwright's semantic text engine is the cheapest and
   * most reliable first discovery step; a full observation crawl remains the
   * fallback when this candidate does not exist or is ambiguous.
   */
  private withSemanticLabelFallback(
    candidates: LocatorCandidate[],
    label?: string,
    contextAnchor?: string,
  ): LocatorCandidate[] {
    if (candidates.length > 0 || !label?.trim()) {
      return candidates;
    }
    const full = label.trim();
    const compact = compactOptionFromLabel(full);
    const contextual = this.driver.platform === 'web' && compact && contextAnchor
      ? contextualCompactXPath(contextAnchor, compact)
      : undefined;
    return [
      ...(contextual
        ? [{
            strategy: 'xpath' as const,
            value: contextual,
            weight: 0.86,
            origin: 'healed' as const,
          }]
        : []),
      ...(this.driver.platform === 'web' && compact
        && !contextual
        ? [{
            strategy: 'xpath' as const,
            value: `//*[not(*) and normalize-space(.)=${xpathLiteral(compact)}]`,
            weight: 0.74,
            origin: 'healed' as const,
          }]
        : []),
      { strategy: 'label', value: full, weight: 0.7, origin: 'healed' },
    ];
  }

  private async tryCandidate(
    candidate: LocatorCandidate,
    o: ResolveOptions,
  ): Promise<UiHandle | null> {
    try {
      const handle = await this.driver.find(candidate);
      if (!handle) return null;
      if (o.requireVisible && !(await handle.isVisible())) return null;
      return handle;
    } catch {
      // A driver-level error (stale node, strategy unsupported on this platform)
      // is treated as "this candidate did not match", not as a test failure.
      return null;
    }
  }

  /**
   * Semantic verification for healed matches — G04.
   *
   * Replaces the old `plausible()` text-only heuristic with a call to the
   * authoritative StandardElementVerifier so there is ONE verification engine
   * across the entire discovery + resolver stack.
   *
   * Builds a minimal ObservedElement from the live UiHandle properties and
   * delegates to StandardElementVerifier.verify(). Permissive on unreadable
   * text (icon buttons) — if text() throws, we cannot disprove the match, so
   * we allow it (same as before, but now explicit and documented).
   */
  private async verifySemantically(
    elementId: string,
    handle: UiHandle,
    locatorParams?: Record<string, string>,
    semanticText?: string,
    action: ActionKind = 'assert-visible',
  ): Promise<boolean> {
    const elementDef = this.registry.element(elementId);
    const intent = buildElementIntent(elementId, {
      ...elementDef,
      label: interpolateTemplate(elementDef.label, locatorParams),
    }, action);
    // For a read-only assertion the live value is stronger identity evidence
    // than the abstract registry label. A custom category control is named
    // "Danh mục theo dõi" in Gherkin but renders its selected value
    // "Following Cate". Rejecting that exact value for not containing the
    // abstract name throws away the candidate discovery just proved.
    if (semanticText?.trim()) {
      intent.text = semanticText.trim();
      delete intent.label;
    }

    // Build a minimal ObservedElement from the runtime handle (G04)
    const el: ObservedElement = {
      id: handle.candidate.value,
      visible: true, // already verified by tryCandidate via requireVisible
      enabled: undefined,
      interactive: undefined,
    };

    // A control is verified against its name before its contents.
    //
    // `text()` on a combobox, a select or a filled text field returns the
    // *value*: `<mat-select>` for "Chuyển từ" reads back "TK Thường", the
    // account someone picked. Checking that against the expected label rejects
    // the correct element every single time, which is what it did — the right
    // control was found, was visible, opened its list when clicked, and was
    // thrown away on each of three attempts.
    //
    // Tried first and only ever used to *accept*: if the name does not match we
    // fall through to the original text check, so this can admit matches it
    // previously refused but can never refuse one it previously admitted.
    const name = await handle.accessibleName?.().catch(() => undefined);
    if (name) {
      if (this.verifier.verify(intent, { ...el, text: name }, []).checks.labelMatch !== false) {
        return true;
      }
    }

    try {
      el.text = await handle.text();
    } catch {
      // Cannot read text (icon button, SVG, etc.) — cannot disprove match, allow
      return true;
    }

    if (!el.text) {
      // Empty text — cannot verify label, allow (same historical behaviour)
      return true;
    }

    // Material icon ligatures are the accessible vocabulary of many icon-only
    // controls. Discovery may correctly identify `add`, `delete`, `save`, …
    // from a business label; the live-handle gate must apply the same generic
    // semantic mapping instead of rejecting the very candidate discovery just
    // proved.
    const wanted = intent.text ?? intent.label;
    if (action === 'tap' && wanted && iconMeaningMatches(el.text, wanted)) return true;

    // G04: delegate to StandardElementVerifier — single authoritative engine
    const result = this.verifier.verify(intent, el, []);
    // labelMatch=undefined means intent has no label → allow
    // labelMatch=true → element text matches → allow
    // labelMatch=false → wrong element — reject
    return result.checks.labelMatch !== false;
  }
}

function isReadOnlyDiscovery(action?: ActionKind): boolean {
  return action?.startsWith('assert-') ?? false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function candidateKey(candidate: LocatorCandidate): string {
  return `${candidate.strategy}\u0000${candidate.value}\u0000${candidate.name ?? ''}`;
}

/** Locator identity includes the accessible name; role alone is not identity. */
function sameLocatorIdentity(a: LocatorCandidate, b: LocatorCandidate): boolean {
  return a.strategy === b.strategy
    && a.value === b.value
    && normalizeHumanText(a.name ?? '') === normalizeHumanText(b.name ?? '');
}

/**
 * Conservative proof that two registry records describe the same control.
 *
 * Exact label/alias equality is strongest. A token-subset relation covers the
 * historical duplicate "Ô mã cổ phiếu" / "Ô tìm kiếm mã cổ phiếu" without
 * equating siblings that merely share their control type, such as "Thêm vào
 * danh mục" and "Xóa khỏi danh mục".
 */
function sameControlSemantics(a: ElementDef, b: ElementDef): boolean {
  if (a.controlType && b.controlType && a.controlType !== b.controlType) return false;
  if (a.template && b.template && a.template.kind !== b.template.kind) return false;

  const namesA = new Set([a.label, ...(a.aliases ?? [])].map(normalizeHumanText));
  const namesB = new Set([b.label, ...(b.aliases ?? [])].map(normalizeHumanText));
  if ([...namesA].some((name) => namesB.has(name))) return true;

  const tokensA = new Set(semanticControlTokens(a.label));
  const tokensB = new Set(semanticControlTokens(b.label));
  const smaller = tokensA.size <= tokensB.size ? tokensA : tokensB;
  const larger = smaller === tokensA ? tokensB : tokensA;
  return smaller.size >= 2 && [...smaller].every((token) => larger.has(token));
}

function instantiateCandidate(
  candidate: LocatorCandidate,
  params?: Record<string, string>,
): LocatorCandidate {
  if (!params || Object.keys(params).length === 0) return candidate;
  if (candidate.strategy === 'relative') {
    const spec = parseRelativeRowLocator(candidate.value);
    if (spec) {
      return {
        ...candidate,
        runtimeTemplateValue: candidate.value,
        value: formatRelativeRowLocator({
          ...spec,
          rowText: interpolateTemplate(spec.rowText, params),
          action: interpolateTemplate(spec.action, params),
        }),
      };
    }
  }
  return {
    ...candidate,
    runtimeTemplateValue: candidate.value,
    value: interpolateTemplate(candidate.value, params),
    ...(candidate.name ? { name: interpolateTemplate(candidate.name, params) } : {}),
  };
}

function interpolateTemplate(value: string, params?: Record<string, string>): string {
  if (!params) return value;
  return value.replace(/\{\{([A-Za-z][\w]*)\}\}/g, (whole, key: string) =>
    params[key] ?? whole,
  );
}

/**
 * Stable enough to share an AI answer across scenario resets, specific enough
 * not to carry it into another dialog/state of the same feature.
 *
 * Deliberately excludes node count, order, selected/focused flags and ordinary
 * list rows: all of those change during animation and virtual scrolling. Page
 * identity plus headings/dialog landmarks are the parts a user would use to
 * answer "am I still on the same screen?".
 */
function stableScreenState(observation: UiObservation, declaredScreen?: string): string {
  const context = [
    declaredScreen,
    observation.screen?.name,
    observation.context.activity,
    observation.context.webContext,
  ]
    .filter((part): part is string => Boolean(part?.trim()))
    .map(normalizeHumanText);

  const landmarks = observation.elements
    .filter((element) => element.visible)
    .filter((element) => {
      const role = normalizeHumanText(element.role ?? '');
      const cls = normalizeHumanText(element.attributes?.class ?? '');
      return /heading|dialog|alert|navigation|toolbar|title|header|modal/.test(`${role} ${cls}`);
    })
    .map((element) => normalizeHumanText(element.accessibilityLabel ?? element.text ?? ''))
    .filter(Boolean);

  return [...new Set([...context, ...landmarks])].sort().slice(0, 12).join('|') || 'same-element-screen';
}

function sameScreenSemanticElements(
  registry: Registry,
  elementId: string,
  locatorParams?: Record<string, string>,
) {
  const target = registry.element(elementId);
  if (!target.screen) return [];
  const wanted = semanticControlTokens(interpolateTemplate(target.label, locatorParams));
  if (wanted.length < 2) return [];
  return Object.values(registry.raw.elements)
    .filter((element) => element.id !== elementId && element.screen === target.screen)
    .filter((element) => {
      const available = new Set(semanticControlTokens(element.label));
      return wanted.every((token) => available.has(token));
    });
}

/** Used by preflight so it does not call a discoverable alias a certain failure. */
export function hasSameScreenSemanticCandidate(
  registry: Registry,
  elementId: string,
  platform: Platform,
  hybrid = false,
): boolean {
  return sameScreenSemanticElements(registry, elementId).some((element) => {
    const direct = element.candidates[platform] ?? [];
    const web = hybrid ? element.candidates.web ?? [] : [];
    return direct.length + web.length > 0;
  });
}

/** `Giá 1M` → `1M`, `Kỳ YTD` → `YTD`; ordinary words are never shortened. */
function compactOptionFromLabel(label: string): string | undefined {
  const tokens = label.match(/\b(?:\d+[A-Za-z%]+|[A-Za-z]+\d+[A-Za-z%]*|YTD|MTD|QTD|ALL)\b/gi) ?? [];
  return tokens.length === 1 && tokens[0]!.length < label.trim().length
    ? tokens[0]
    : undefined;
}

/**
 * Locates a compact control inside the business region asserted immediately
 * before it. Example:
 *
 *   "Các quỹ có thể bạn quan tâm" -> "Giá 1M"
 *
 * The live DOM renders `Giá` and `1M` as sibling spans in one table header.
 * Anchoring at the previous heading prevents the identically named `1M` chart
 * period elsewhere on the page from winning. If the descriptive prefix exists
 * as a sibling, click that prefix (the tooltip trigger); otherwise click the
 * compact option's parent control.
 */
function contextualCompactXPath(context: string, compact: string): string {
  const contextLit = xpathLiteral(context.trim());
  const compactLit = xpathLiteral(compact);
  const anchor = `//*[normalize-space(text())=${contextLit} or normalize-space(string(.))=${contextLit}]`;
  const region = `(${anchor})[1]/ancestor::*[` +
    `self::section or self::article or self::fieldset or starts-with(local-name(),'app-') or ` +
    `contains(translate(@class,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'table') or ` +
    `contains(translate(@class,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'card') or ` +
    `contains(translate(@class,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'panel') or ` +
    `contains(translate(@class,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'section')` +
    `][1]`;
  const optionParent = `${region}//*[not(*) and normalize-space(.)=${compactLit}]/parent::*`;
  return `(${optionParent})[1]`;
}
