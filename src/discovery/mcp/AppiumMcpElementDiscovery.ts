/**
 * Appium MCP adapter — item 18 (plan §12, §11).
 *
 * Wraps a raw McpClient into the standard AiElementDiscovery interface so
 * business logic never depends on MCP specifics.
 *
 * Also implements ObservationProvider so it can plug directly into ElementDiscovery
 * as a drop-in provider (MCP inspection replaces native/web page source parsing).
 *
 * Called ONLY when deterministic discovery has failed — never on every action.
 */

import type { ElementIntent } from '../ElementIntent.js';
import type { UiObservation, ObservedElement } from '../UiObservation.js';
import type { ObservationProvider } from '../ElementDiscovery.js';
import type {
  McpClient,
  AiElementDiscovery,
  AiElementCandidate,
} from '../ai/AiDiscoveryTypes.js';

// ── raw MCP inspection types ──────────────────────────────────────────────────

/** Minimal shape that Appium MCP inspection JSON is expected to follow. */
interface McpElement {
  id?: string;
  type?: string;
  label?: string;
  name?: string;
  value?: string;
  text?: string;
  resourceId?: string;
  testId?: string;
  xpath?: string;
  bounds?: { x: number; y: number; width: number; height: number } | string;
  visible?: boolean;
  enabled?: boolean;
  interactable?: boolean;
  selected?: boolean;
  checked?: boolean;
  focused?: boolean;
  children?: McpElement[];
  attributes?: Record<string, string>;
}

interface McpInspectionResult {
  platform?: string;
  context?: {
    appPackage?: string;
    activity?: string;
    bundleId?: string;
  };
  source?: string;
  elements?: McpElement[];
  /** Root element when the response is a tree rather than a flat list. */
  root?: McpElement;
}

interface McpFindResult {
  /** The MCP-assigned element id. */
  elementId?: string;
  /** Locator the MCP AI suggests. */
  locator?: { strategy: string; value: string };
  confidence?: number;
  reasoning?: string;
}

// ── adapter ───────────────────────────────────────────────────────────────────

export class AppiumMcpElementDiscovery implements AiElementDiscovery, ObservationProvider {
  constructor(private readonly client: McpClient) {}

  // ── AiElementDiscovery ────────────────────────────────────────────────────

  async inspect(): Promise<UiObservation> {
    const raw = await this.client.inspect();
    return convertInspection(raw as McpInspectionResult);
  }

  async findElement(intent: ElementIntent): Promise<AiElementCandidate | undefined> {
    const description = buildDescription(intent);
    const raw = await this.client.findElement(description);
    return convertFindResult(raw as McpFindResult, intent);
  }

  async screenshot(): Promise<string> {
    return this.client.screenshot();
  }

  // ── ObservationProvider ───────────────────────────────────────────────────

  /** Allows this adapter to be used directly as an ObservationProvider. */
  async observe(): Promise<UiObservation> {
    return this.inspect();
  }
}

// ── conversion helpers ────────────────────────────────────────────────────────

function convertInspection(raw: McpInspectionResult): UiObservation {
  const elements: ObservedElement[] = [];
  let idCounter = 0;

  const platform = (raw.platform?.toLowerCase() ?? 'android') as 'android' | 'ios' | 'web';

  function visit(el: McpElement, parentId?: string): string {
    const id = `mcp-el-${idCounter++}`;
    const childIds: string[] = [];

    for (const child of el.children ?? []) {
      childIds.push(visit(child, id));
    }

    elements.push({
      id,
      role: el.type,
      text: el.text ?? el.value,
      accessibilityLabel: el.label ?? el.name,
      resourceId: el.resourceId,
      testId: el.testId,
      xpath: el.xpath,
      bounds: parseBounds(el.bounds),
      visible: el.visible ?? true,
      enabled: el.enabled,
      interactive: el.interactable,
      selected: el.selected,
      checked: el.checked,
      focused: el.focused,
      parentId,
      childIds: childIds.length > 0 ? childIds : undefined,
      attributes: el.attributes,
    });

    return id;
  }

  // Flat list or tree — handle both shapes
  if (raw.root) {
    visit(raw.root);
  } else {
    for (const el of raw.elements ?? []) {
      visit(el);
    }
  }

  return {
    id: `mcp-obs-${Date.now().toString(36)}`,
    timestamp: new Date().toISOString(),
    platform,
    source: 'appium-mcp',
    context: {
      appPackage: raw.context?.appPackage,
      activity: raw.context?.activity,
      bundleId: raw.context?.bundleId,
    },
    elements,
    rawSource: raw.source,
  };
}

function convertFindResult(
  raw: McpFindResult,
  intent: ElementIntent,
): AiElementCandidate | undefined {
  if (!raw.elementId) return undefined;

  return {
    observedElementId: raw.elementId,
    confidence: raw.confidence ?? 70,
    reasoning: raw.reasoning ?? `Appium MCP identified element for intent "${intent.id}"`,
    suggestedLocator: raw.locator,
  };
}

/**
 * Build a natural-language description of the intent for the MCP find call.
 * More context → better MCP results.
 */
function buildDescription(intent: ElementIntent): string {
  const parts: string[] = [];

  if (intent.label) parts.push(`label "${intent.label}"`);
  if (intent.text) parts.push(`text "${intent.text}"`);
  if (intent.semanticRole) parts.push(`role "${intent.semanticRole}"`);
  if (intent.screen) parts.push(`on screen "${intent.screen}"`);
  if (intent.description) parts.push(intent.description);
  if (intent.placeholder) parts.push(`placeholder "${intent.placeholder}"`);
  if (intent.action !== 'assert-visible') parts.push(`action: ${intent.action}`);

  return parts.length > 0
    ? `Find element: ${parts.join(', ')}`
    : `Find element with id "${intent.id}"`;
}

/** Parse Appium bounds from either an object or a string like "[x,y][w,h]". */
function parseBounds(
  raw: McpElement['bounds'],
): { x: number; y: number; width: number; height: number } | undefined {
  if (!raw) return undefined;
  if (typeof raw === 'object') return raw;

  // Handle Appium string format "[left,top][right,bottom]"
  const m = String(raw).match(/\[(\d+),(\d+)]\[(\d+),(\d+)]/);
  if (m) {
    const [, left, top, right, bottom] = m.map(Number);
    return { x: left!, y: top!, width: right! - left!, height: bottom! - top! };
  }
  return undefined;
}
