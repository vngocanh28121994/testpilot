import type { UiDriver } from '../drivers/driver.js';
import { Resolver, type ResolveOptions } from '../runtime/resolver.js';
import type { Registry } from '../core/registry.js';
import {
  assertCapabilitySupported,
  UnsupportedActionCapabilityError,
} from '../runtime/capabilities.js';
import { sameDate } from '../drivers/datePicker.js';
import { performAdaptiveInput } from '../drivers/controlClassifier.js';

/**
 * Cross-platform base context for generated Page Objects.
 *
 * Page Objects receive one `BasePage` instance and delegate every interaction
 * here. The driver can be web (Playwright CDP), Android (Appium), or iOS —
 * Page Objects stay identical across platforms because they only name elements,
 * never selectors.
 */
export class BasePage {
  private contextAnchor?: string;

  private inBusinessContext(options: Partial<ResolveOptions>): Partial<ResolveOptions> {
    return this.contextAnchor ? { ...options, contextAnchor: this.contextAnchor } : options;
  }

  constructor(
    readonly driver: UiDriver,
    readonly resolver: Resolver,
    readonly registry: Registry,
    private readonly finalize?: () => Promise<void>,
    /** Account values for the active environment, keyed `account.<role>.<field>`. */
    private readonly variables: Record<string, string> = {},
  ) {}

  /**
   * The value a `{{...}}` placeholder stands for — the same table the CLI
   * runner substitutes with, so a generated spec logs in as the same user.
   *
   * Throws rather than returning an empty string: an empty password reaches the
   * app as a failed login, and the report then blames the login screen for a
   * configuration mistake made three layers away.
   */
  variable(name: string): string {
    const value = this.variables[name];
    if (value === undefined || value === '') {
      throw new Error(
        `Không có giá trị cho {{${name}}}.\n` +
          'Account lấy từ testpilot.config.json + .testpilot.secrets.json; ' +
          'kiểm tra Scenario Studio → Test Accounts, và TESTPILOT_ENV nếu đang chạy môi trường khác.',
      );
    }
    return value;
  }

  async launch(target?: string): Promise<void> {
    this.contextAnchor = undefined;
    await this.driver.launch(target);
  }

  /** Reusable authenticated precondition emitted by generated POM specs. */
  async ensureLoggedIn(account: string): Promise<void> {
    const homeId = 'home.totalAssets';
    if (await this.resolver.isVisibleNow(homeId).catch(() => false)) return;

    const restored = await this.driver.restoreAuthenticatedSession?.(account).catch(() => false);
    if (restored) {
      try {
        await this.waitFor(homeId, 8_000);
        return;
      } catch {
        await this.driver.invalidateAuthenticatedSession?.(account).catch(() => {});
      }
    }

    await this.input('login.usernameField', this.variable(`account.${account}.username`));
    await this.input('login.passwordField', this.variable(`account.${account}.password`));
    await this.tap('login.submitButton');
    await this.waitFor(homeId, 20_000);
    await this.driver.saveAuthenticatedSession?.(account).catch(() => {});
  }

  /** Opens the exact named business feature instead of clicking result #1. */
  /**
   * Opens a feature by searching for it and taking the first result.
   *
   * The result is clicked through the same locator this waits on, not by
   * looking for the query text. Searching "Chuyển tiền" leaves that phrase in
   * seven visible places — the header, the home grid behind the dialog, the
   * screen title — and a text lookup returned all seven, clicking whichever
   * happened to come first in the DOM. It worked only for as long as that was
   * the right one; a change to the home screen behind the dialog was enough to
   * break it. `home.searchFirstResult` matches exactly one node.
   */
  async openFeatureFromSearch(query: string): Promise<void> {
    this.contextAnchor = undefined;
    await this.tap('home.searchBox');
    await this.input('home.searchInput', query);
    await this.waitFor('home.searchFirstResult');
    await this.tap('home.searchFirstResult');
  }

  async tap(elementId: string, locatorParams?: Record<string, string>): Promise<void> {
    const r = await this.resolver.resolve(elementId, this.inBusinessContext({
      discoveryAction: 'tap', locatorParams,
    }));
    await this.driver.tap(r.handle);
    await this.driver.isIdle().catch(() => {});
    this.resolver.confirmResolution(elementId, r);
  }

  /** Reusable row action, e.g. open the overflow menu for ADS/FPT/TCB. */
  async tapRowAction(elementId: string, rowText: string, action = '...'): Promise<void> {
    await this.tap(elementId, { rowText, action });
  }

  async hover(elementId: string, locatorParams?: Record<string, string>): Promise<void> {
    assertCapabilitySupported('hover', this.driver.platform);
    if (!this.driver.hover) {
      throw new UnsupportedActionCapabilityError('hover', this.driver.platform);
    }
    const r = await this.resolver.resolve(elementId, this.inBusinessContext({
      discoveryAction: 'hover', locatorParams,
    }));
    await this.driver.hover(r.handle);
    this.resolver.confirmResolution(elementId, r);
  }

  async dragDrop(
    sourceId: string,
    targetId: string,
    sourceLocatorParams?: Record<string, string>,
    targetLocatorParams?: Record<string, string>,
  ): Promise<void> {
    assertCapabilitySupported('dragDrop', this.driver.platform);
    if (!this.driver.dragDrop) {
      throw new UnsupportedActionCapabilityError('dragDrop', this.driver.platform);
    }
    const source = await this.resolver.resolve(sourceId, this.inBusinessContext({
      discoveryAction: 'drag', locatorParams: sourceLocatorParams,
    }));
    const target = await this.resolver.resolve(targetId, this.inBusinessContext({
      discoveryAction: 'assert-visible', locatorParams: targetLocatorParams,
    }));
    await this.driver.dragDrop(source.handle, target.handle);
    this.resolver.confirmResolution(sourceId, source);
    this.resolver.confirmResolution(targetId, target);
  }

  async longPress(
    elementId: string,
    ms = 1000,
    locatorParams?: Record<string, string>,
  ): Promise<void> {
    const r = await this.resolver.resolve(elementId, this.inBusinessContext({
      discoveryAction: 'tap', locatorParams,
    }));
    await this.driver.longPress(r.handle, ms);
    this.resolver.confirmResolution(elementId, r);
  }

  async input(
    elementId: string,
    text: string,
    locatorParams?: Record<string, string>,
  ): Promise<void> {
    const r = await this.resolver.resolve(elementId, this.inBusinessContext({
      discoveryAction: 'input', locatorParams,
    }));
    const element = this.registry.element(elementId);
    const routed = await performAdaptiveInput(
      this.driver,
      r.handle,
      text,
      element.typeDelay,
      element.controlType,
    );
    if (routed.action === 'selectDate') {
      this.registry.recordControlType(elementId, 'date', routed.inspection?.evidence ?? []);
      const actual = await r.handle.value?.();
      if (actual !== undefined && actual !== null && !sameDate(actual, text)) {
        throw new Error(`Date assertion failed on "${elementId}": expected "${text}", got "${actual}".`);
      }
    }
    this.resolver.confirmResolution(elementId, r);
  }

  async selectDate(
    elementId: string,
    date: string,
    locatorParams?: Record<string, string>,
  ): Promise<void> {
    if (!this.driver.selectDate) {
      throw new Error(`Nền tảng ${this.driver.platform} chưa hỗ trợ thao tác chọn ngày.`);
    }
    const r = await this.resolver.resolve(elementId, this.inBusinessContext({
      discoveryAction: 'input', locatorParams,
    }));
    const inspection = await this.driver.inspectControl?.(r.handle).catch(() => undefined);
    await this.driver.selectDate(r.handle, date);
    const actual = await r.handle.value?.();
    if (actual !== undefined && actual !== null && !sameDate(actual, date)) {
      throw new Error(`Date assertion failed on "${elementId}": expected "${date}", got "${actual}".`);
    }
    if (inspection?.type === 'date') {
      this.registry.recordControlType(elementId, 'date', inspection.evidence);
    }
    this.resolver.confirmResolution(elementId, r);
  }

  async clear(elementId: string, locatorParams?: Record<string, string>): Promise<void> {
    const r = await this.resolver.resolve(elementId, this.inBusinessContext({
      discoveryAction: 'input', locatorParams,
    }));
    await this.driver.clear(r.handle);
    this.resolver.confirmResolution(elementId, r);
  }

  async select(
    elementId: string,
    option: string,
    locatorParams?: Record<string, string>,
  ): Promise<void> {
    const r = await this.resolver.resolve(elementId, this.inBusinessContext({
      discoveryAction: 'select', locatorParams,
    }));
    await this.driver.selectOption(r.handle, option);
    this.resolver.confirmResolution(elementId, r);
  }

  async scrollTo(elementId: string, locatorParams?: Record<string, string>): Promise<void> {
    const r = await this.resolver.resolve(elementId, this.inBusinessContext({
      discoveryAction: 'scroll',
      requireVisible: false,
      locatorParams,
    }));
    await this.driver.scrollIntoView(r.handle);
    this.resolver.confirmResolution(elementId, r);
  }

  async scroll(direction: 'up' | 'down'): Promise<void> {
    assertCapabilitySupported('scroll', this.driver.platform);
    await this.driver.scroll(direction);
  }

  async waitFor(
    elementId: string,
    timeoutMs?: number,
    locatorParams?: Record<string, string>,
  ): Promise<void> {
    const r = await this.resolver.resolve(elementId, this.inBusinessContext({
      ...(timeoutMs ? { timeoutMs } : {}),
      discoveryAction: 'assert-visible',
      locatorParams,
    }));
    this.resolver.confirmResolution(elementId, r);
  }

  async assertVisible(elementId: string, locatorParams?: Record<string, string>): Promise<void> {
    const r = await this.resolver.resolve(elementId, this.inBusinessContext({
      discoveryAction: 'assert-visible',
      locatorParams,
    }));
    this.resolver.confirmResolution(elementId, r);
  }

  /**
   * Resolves a named business region and keeps it as context for following
   * generated POM actions. This is intentionally different from assertVisible:
   * an ordinary assertion must not silently change where later actions search.
   */
  async focusRegion(elementId: string, locatorParams?: Record<string, string>): Promise<void> {
    const r = await this.resolver.resolve(elementId, {
      discoveryAction: 'assert-visible',
      locatorParams,
    });
    this.resolver.confirmResolution(elementId, r);
    this.contextAnchor = this.registry.element(elementId).label;
  }

  async assertNotVisible(elementId: string, locatorParams?: Record<string, string>): Promise<void> {
    await this.resolver.resolveAbsent(elementId, this.inBusinessContext({ locatorParams }));
  }

  async assertText(
    elementId: string,
    expected: string,
    mode: 'equals' | 'contains' | 'notContains' = 'contains',
    locatorParams?: Record<string, string>,
  ): Promise<void> {
    // Absence satisfies the negative form, and only the negative form; the
    // positive ones must still fail loudly when the element is not there.
    if (mode === 'notContains') {
      const present = await this.resolver.isVisibleNow(
        elementId,
        this.inBusinessContext({ locatorParams }),
      );
      if (!present) return;
    }
    const r = await this.resolver.resolve(elementId, this.inBusinessContext({
      discoveryAction: 'assert-text', locatorParams,
    }));
    const actual = (await r.handle.text()).trim();
    const ok = mode === 'equals'
      ? actual === expected
      : mode === 'notContains'
        ? !actual.includes(expected)
        : actual.includes(expected);
    if (!ok) throw new Error(`Text assertion failed on "${elementId}".`);
    this.resolver.confirmResolution(elementId, r);
  }

  async assertNumber(
    elementId: string,
    operator: 'equals' | 'notEquals' | 'greaterThan' | 'atLeast' | 'atMost',
    expected: number,
    locatorParams?: Record<string, string>,
  ): Promise<void> {
    const r = await this.resolver.resolve(elementId, this.inBusinessContext({
      discoveryAction: 'assert-text', locatorParams,
    }));
    const actualText = (await r.handle.text()).trim();
    const actual = parseDisplayedNumber(actualText);
    const ok = operator === 'notEquals'
      ? actual !== expected
      : operator === 'greaterThan'
        ? actual > expected
        : operator === 'atLeast'
          ? actual >= expected
          : operator === 'atMost'
            ? actual <= expected
          : actual === expected;
    if (!ok) {
      throw new Error(
        `Numeric assertion failed on "${elementId}": value "${actualText}" ` +
          `does not satisfy ${operator} ${expected}.`,
      );
    }
    this.resolver.confirmResolution(elementId, r);
  }

  async assertCollection(
    elementId: string,
    check:
      | { kind: 'count'; operator: 'equals' | 'notEquals' | 'greaterThan' | 'atLeast' | 'atMost'; value: number }
      | { kind: 'uniqueText' }
      | { kind: 'countMatching'; text: string; operator: 'equals' | 'notEquals' | 'greaterThan' | 'atLeast' | 'atMost'; value: number }
      | { kind: 'firstText'; text: string }
      | { kind: 'focused' },
    locatorParams?: Record<string, string>,
  ): Promise<void> {
    const r = await this.resolver.resolve(elementId, this.inBusinessContext({
      discoveryAction: 'assert-text', locatorParams,
    }));
    const snapshot = this.driver.inspectMatches
      ? await this.driver.inspectMatches(r.candidate)
      : { count: 1, texts: [(await r.handle.text()).trim()], focused: [] };
    const normalized = (value: string) => value.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('vi-VN');
    let ok = false;
    if (check.kind === 'count') {
      ok = check.operator === 'notEquals'
        ? snapshot.count !== check.value
        : check.operator === 'greaterThan'
          ? snapshot.count > check.value
          : check.operator === 'atLeast'
            ? snapshot.count >= check.value
            : check.operator === 'atMost'
              ? snapshot.count <= check.value
              : snapshot.count === check.value;
    } else if (check.kind === 'countMatching') {
      const wanted = normalized(check.text);
      const hits = snapshot.texts.filter((value) => normalized(value).includes(wanted)).length;
      ok = check.operator === 'notEquals'
        ? hits !== check.value
        : check.operator === 'greaterThan'
          ? hits > check.value
          : check.operator === 'atLeast'
            ? hits >= check.value
            : check.operator === 'atMost'
              ? hits <= check.value
              : hits === check.value;
    } else if (check.kind === 'uniqueText') {
      const values = snapshot.texts.map(normalized).filter(Boolean);
      ok = values.length === snapshot.count && new Set(values).size === values.length;
    } else if (check.kind === 'firstText') {
      ok = normalized(snapshot.texts[0] ?? '').includes(normalized(check.text));
    } else {
      ok = snapshot.focused.length > 0;
    }
    if (!ok) throw new Error(`Collection assertion failed on "${elementId}".`);
    this.resolver.confirmResolution(elementId, r);
  }

  async screenshot(name: string): Promise<string | undefined> {
    return this.driver.screenshot(name).catch(() => undefined);
  }

  /** Close the driver and persist locators learned while generated tests ran. */
  async close(): Promise<void> {
    if (this.finalize) {
      await this.finalize();
      return;
    }
    await this.driver.stop();
    await this.registry.save();
  }
}

function parseDisplayedNumber(text: string): number {
  const token = text.match(/-?\d[\d.,\s]*/u)?.[0]?.replace(/\s+/g, '');
  if (!token) throw new Error(`Không tìm thấy giá trị số trong "${text}".`);
  let normalized = token;
  if (token.includes(',') && token.includes('.')) {
    const decimal = token.lastIndexOf(',') > token.lastIndexOf('.') ? ',' : '.';
    normalized = token
      .replace(decimal === ',' ? /\./g : /,/g, '')
      .replace(decimal, '.');
  } else if (/^-?\d{1,3}(?:[.,]\d{3})+$/u.test(token)) {
    normalized = token.replace(/[.,]/g, '');
  } else {
    normalized = token.replace(',', '.');
  }
  const value = Number(normalized);
  if (!Number.isFinite(value)) throw new Error(`Giá trị "${text}" không phải số hợp lệ.`);
  return value;
}
