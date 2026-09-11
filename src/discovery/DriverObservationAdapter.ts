/**
 * Compatibility bridge between the existing UiDriver.observe() interface
 * and the discovery pipeline's ObservationProvider.
 *
 * The existing observe() returns Observed[] — the flat crawl-era model that
 * lacks bounds, enabled/focused state, and hierarchy.  This adapter converts
 * it to UiObservation so DeterministicMatcher can score candidates.
 *
 * For richer data (bounds, enabled, parent/child): use createNativeObservationProvider
 * from NativeObservationAdapter.ts once NativeUiDriver.getPageSource() is available.
 */

import type { Observed } from '../crawl/observe.js';
import type { UiDriver } from '../drivers/driver.js';
import type { ElementDef } from '../core/types.js';
import type { ObservedElement, UiObservation } from './UiObservation.js';
import type { ObservationProvider } from './ElementDiscovery.js';
import type { ActionKind, ElementIntent } from './ElementIntent.js';
import type { LocatorCandidate } from '../core/types.js';

// ── observation provider factory ──────────────────────────────────────────────

/**
 * Wraps any UiDriver that implements observe() into an ObservationProvider
 * compatible with ElementDiscovery.
 *
 * If the driver has no observe() method (some minimal test drivers), an empty
 * observation is returned — discovery will report no candidates.
 */
export function createDriverObservationProvider(
  driver: UiDriver,
): ObservationProvider {
  return {
    async observe(): Promise<UiObservation> {
      const observed: Observed[] = driver.observe ? await driver.observe() : [];
      return observedToUiObservation(observed, driver.platform as 'android' | 'ios' | 'web');
    },
  };
}

/**
 * Pure conversion: Observed[] → UiObservation.
 * Exported for testing without a live driver.
 */
export function observedToUiObservation(
  observed: Observed[],
  platform: 'android' | 'ios' | 'web',
): UiObservation {
  const elements: ObservedElement[] = observed.map(
    (o, i): ObservedElement => ({
      id: `obs-${i}`,
      role: o.role,
      text: o.text,
      accessibilityLabel: o.name,
      resourceId: o.resourceId,
      testId: o.testId,
      placeholder: o.placeholder,
      css: o.css,
      attributes: o.context?.length ? { region: o.context.join(' > ') } : undefined,
      // observe() only returns elements that exist and are visible.
      // enabled/focused/selected are not tracked in Observed.
      visible: true,
      enabled: true,
      interactive: o.interactive,
      index: o.index,
      childIds: o.container ? [] : undefined,
    }),
  );

  return {
    id: `obs-${Date.now().toString(36)}`,
    timestamp: new Date().toISOString(),
    platform,
    source: platform === 'web' ? 'browser' : 'native',
    context: {},
    elements,
  };
}

// ── intent builder ────────────────────────────────────────────────────────────

/**
 * Build a minimal ElementIntent from a Registry element definition.
 *
 * The caller supplies the runtime action whenever possible. That lets the
 * verifier reject a merely visible node when the scenario needs an input,
 * button, or other interactive element. Read-only callers retain the safe
 * `assert-visible` default.
 */
export function buildElementIntent(
  elementId: string,
  elementDef: ElementDef,
  action: ActionKind = 'assert-visible',
  context?: string[],
): ElementIntent {
  const inputPlaceholder = action === 'input' && elementDef.label
    ? inferInputPlaceholder(elementDef.label)
    : undefined;
  return {
    id: elementId,
    action,
    ...(elementDef.label ? { label: elementDef.label } : {}),
    ...(elementDef.screen ? { screen: elementDef.screen } : {}),
    ...(action === 'input' ? { semanticRole: 'textbox' } : {}),
    ...(inputPlaceholder ? { placeholder: inputPlaceholder } : {}),
    ...(context?.length ? { context } : {}),
  };
}

/**
 * Natural-language feature authors say "Ô mã cổ phiếu" while the HTML input
 * exposes placeholder="Mã cổ phiếu". Strip only explicit field nouns; the
 * remaining phrase is still runtime-verified, so this does not turn arbitrary
 * labels into permissive substring matches.
 */
function inferInputPlaceholder(label: string): string | undefined {
  const inferred = label
    .trim()
    .replace(/^(?:ô|trường|input)\s+/iu, '')
    .trim();
  return inferred && inferred !== label.trim() ? inferred : undefined;
}

// ── strategy mapping ──────────────────────────────────────────────────────────

/**
 * Maps a discovery locator strategy to the LocatorCandidate strategy enum.
 *
 * Discovery uses richer names (resourceId, accessibility); LocatorCandidate
 * uses driver-oriented names (testId, label).  The mapping errs on the side of
 * stability: resourceId is treated as testId because both are developer-written,
 * stable identifiers.
 */
export function mapDiscoveryStrategy(
  strategy: string,
): LocatorCandidate['strategy'] {
  const MAP: Record<string, LocatorCandidate['strategy']> = {
    testId: 'testId',
    resourceId: 'testId',     // stable ID, semantically equivalent to testId
    accessibility: 'label',   // accessibility label → label strategy
    // `label` trong tập locator là "chữ nhìn thấy HOẶC nhãn trợ năng", nên cả
    // hai tên này đều về đó. Thiếu chúng thì một đề xuất hợp lệ bị dán nhãn
    // xpath và không bao giờ khớp được gì.
    label: 'label',
    text: 'label',
    role: 'role',
    relative: 'relative',
    predicate: 'predicate',
    placeholder: 'placeholder',
    css: 'css',
    xpath: 'xpath',
  };
  const mapped = MAP[strategy];
  if (mapped) return mapped;
  // KHÔNG bịa ra xpath cho một chiến lược lạ.
  //
  // Nhánh mặc định cũ trả 'xpath' cho mọi thứ không có trong bảng, mà giá trị
  // thì giữ nguyên — nên `{strategy:'text', value:'TCB,VNM,FPT...'}` biến thành
  // `xpath="TCB,VNM,FPT..."`: một locator không bao giờ khớp, mang vẻ ngoài của
  // một locator hợp lệ. Đo trên máy thật: AI tìm ĐÚNG ô nhập với tin cậy 90,
  // rồi đề xuất bị hỏng ngay ở bước dán nhãn, và cả kịch bản đỏ.
  //
  // Nói ra rồi dùng 'label' — chữ là thứ duy nhất còn lại khi không biết nó
  // thuộc loại gì, và 'label' là chiến lược khớp theo chữ.
  console.warn(
    `[discovery] chiến lược "${strategy}" không có trong bảng ánh xạ; hiểu như "label".`,
  );
  return 'label';
}
