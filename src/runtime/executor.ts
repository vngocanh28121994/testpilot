import type {
  Intent,
  ScenarioResult,
  ScenarioSpec,
  StepResult,
  StepSpec,
} from '../core/types.js';
import type { UiDriver, UiHandle } from '../drivers/driver.js';
import { Resolver, type ResolveOptions } from './resolver.js';

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
}

export const DEFAULT_EXECUTOR: ExecutorOptions = {
  retries: 1,
  screenshotOnFailure: true,
};

export class Executor {
  private readonly resolver: Resolver;

  constructor(
    private readonly driver: UiDriver,
    resolver: Resolver,
    private readonly opts: ExecutorOptions = DEFAULT_EXECUTOR,
  ) {
    this.resolver = resolver;
  }

  async runScenario(scenario: ScenarioSpec, background: StepSpec[] = []): Promise<ScenarioResult> {
    const runs: ScenarioResult['runs'] = [];
    const steps = [...background, ...scenario.steps];

    for (let attempt = 1; attempt <= this.opts.retries + 1; attempt++) {
      const startedAt = new Date().toISOString();
      const t0 = Date.now();

      // One recording per attempt, not per scenario: when a retry passes, the
      // video worth watching is the one from the attempt that failed.
      await this.driver.beginScenario?.(`${scenario.id}-a${attempt}`);
      const stepResults = await this.runSteps(steps, scenario.id, attempt);
      const video = await this.driver.endScenario?.(`${scenario.id}-a${attempt}`);
      const failed = stepResults.some((s) => s.status === 'failed');

      runs.push({
        attempt,
        status: failed ? 'failed' : 'passed',
        steps: stepResults,
        startedAt,
        durationMs: Date.now() - t0,
        ...(video ? { video } : {}),
      });

      // A green first run needs no confirmation; only failures earn a retry.
      if (!failed) break;
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
      platform: this.driver.platform,
      device: this.driver.device,
      runs,
      verdict: verdictOf(runs),
    };
  }

  private async runSteps(
    steps: StepSpec[],
    scenarioId: string,
    attempt: number,
  ): Promise<StepResult[]> {
    const results: StepResult[] = [];
    let aborted = false;

    for (const step of steps) {
      if (aborted) {
        results.push({ step, status: 'skipped', durationMs: 0, attempts: 0 });
        continue;
      }
      const t0 = Date.now();
      try {
        const heal = await this.execute(step.intent);
        results.push({
          step,
          status: heal ? 'healed' : 'passed',
          durationMs: Date.now() - t0,
          attempts: 1,
          ...(heal ? { heal } : {}),
        });
      } catch (err) {
        const e = err as Error;
        const stem = `${scenarioId}-a${attempt}-l${step.line}-fail`;
        const shot = this.opts.screenshotOnFailure
          ? await this.driver.screenshot(stem).catch(() => undefined)
          : undefined;
        // Captured beside the screenshot, not instead of it: the picture shows
        // what the screen looked like, the tree shows what was matchable.
        if (this.opts.screenshotOnFailure) {
          await this.driver.dumpTree?.(stem).catch(() => undefined);
        }
        results.push({
          step,
          status: 'failed',
          durationMs: Date.now() - t0,
          attempts: 1,
          error: { message: e.message, stack: e.stack },
          ...(shot ? { screenshot: shot } : {}),
        });
        // Stop at the first failure: everything after it runs on an unknown state
        // and would only produce noise in the report.
        aborted = true;
      }
    }
    return results;
  }

  /** Returns heal info when the element resolved through a fallback locator. */
  private async execute(intent: Intent): Promise<StepResult['heal']> {
    const d = this.driver;

    const withElement = async (id: string, override?: Partial<ResolveOptions>) => {
      const r = await this.resolver.resolve(id, override ?? {});
      const heal =
        r.healed && r.previous
          ? { elementId: id, from: r.previous, to: r.candidate }
          : undefined;
      return { r, heal };
    };

    switch (intent.kind) {
      case 'launch':
        await d.launch(intent.target);
        return undefined;

      case 'tap': {
        const { r, heal } = await withElement(intent.element);
        await d.tap(r.handle);
        return heal;
      }

      case 'longPress': {
        const { r, heal } = await withElement(intent.element);
        await d.longPress(r.handle, intent.ms ?? 1000);
        return heal;
      }

      case 'input': {
        const { r, heal } = await withElement(intent.element);
        const text = this.expand(intent.text);
        await d.input(r.handle, text);
        if (this.opts.verifyInput !== false) {
          await this.verifyInput(r.handle, text, intent.text);
        }
        return heal;
      }

      case 'clear': {
        const { r, heal } = await withElement(intent.element);
        await d.clear(r.handle);
        return heal;
      }

      case 'select': {
        const { r, heal } = await withElement(intent.element);
        await d.selectOption(r.handle, intent.option);
        return heal;
      }

      case 'scrollTo': {
        // Resolve without the visibility requirement first: the element may be
        // in the tree but off-screen, which is exactly the case scrollTo exists for.
        const { r, heal } = await withElement(intent.element, { requireVisible: false });
        await d.scrollIntoView(r.handle);
        await this.resolver.resolve(intent.element, { timeoutMs: 3000 });
        return heal;
      }

      case 'swipe':
        await d.swipe(intent.direction);
        return undefined;

      case 'back':
        await d.back();
        return undefined;

      case 'waitFor': {
        const { heal } = await withElement(intent.element, {
          ...(intent.timeoutMs ? { timeoutMs: intent.timeoutMs } : {}),
        });
        return heal;
      }

      case 'assertVisible': {
        const { heal } = await withElement(intent.element);
        return heal;
      }

      case 'assertNotVisible':
        await this.resolver.resolveAbsent(intent.element);
        return undefined;

      case 'assertText': {
        const { r, heal } = await withElement(intent.element);
        const actual = (await r.handle.text()).trim();
        const expected = this.expand(intent.text).trim();
        const ok =
          intent.mode === 'equals' ? actual === expected : actual.includes(expected);
        if (!ok) {
          // Report the *unexpanded* text. A substituted secret must not end up
          // in an error message, and from there in the HTML report.
          throw new Error(
            `Text assertion failed on "${intent.element}": expected ` +
              `${intent.mode === 'equals' ? '' : 'to contain '}"${intent.text.trim()}", got "${actual}".`,
          );
        }
        return heal;
      }

      case 'screenshot':
        await d.screenshot(intent.name);
        return undefined;
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

/** How long a typed value gets to reach the field before the step is failed. */
const VERIFY_TIMEOUT_MS = 3000;
const VERIFY_POLL_MS = 150;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
