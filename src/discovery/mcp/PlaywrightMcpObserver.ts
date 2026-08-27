import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { BrowserContext } from 'playwright';
import type { Observed } from '../../crawl/observe.js';
import type { ControlType } from '../../core/types.js';

/** In-process transport: MCP observes TestPilot's existing BrowserContext. */
class MemoryTransport implements Transport {
  peer?: MemoryTransport;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  async start(): Promise<void> {}

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.peer) throw new Error('Playwright MCP memory transport is not linked.');
    const peer = this.peer;
    queueMicrotask(() => peer.onmessage?.(structuredClone(message)));
  }

  async close(): Promise<void> {
    this.onclose?.();
  }
}

function linkedTransports(): [MemoryTransport, MemoryTransport] {
  const client = new MemoryTransport();
  const server = new MemoryTransport();
  client.peer = server;
  server.peer = client;
  return [client, server];
}

interface McpServerConnection {
  connect(transport: Transport): Promise<void>;
  close(): Promise<void>;
}

/**
 * Read-only Playwright MCP accessibility observer.
 *
 * It calls only `browser_snapshot`. Actions never leave UiDriver/Executor, so
 * MCP cannot bypass safety checks, postconditions, or healing approval.
 */
export class PlaywrightMcpObserver {
  private context?: BrowserContext;
  private client?: Client;
  private server?: McpServerConnection;

  constructor(private readonly contextGetter: () => BrowserContext | undefined) {}

  async observe(): Promise<Observed[]> {
    return parsePlaywrightMcpSnapshot(await this.snapshotText());
  }


  /**
   * Supporting semantic evidence from MCP. DOM inspection still decides which
   * exact element is being acted on; the accessibility snapshot confirms how
   * the control is exposed to a user/assistive client.
   */
  async controlHints(type: ControlType): Promise<string[]> {
    return controlHintsFromObservation(await this.observe(), type);
  }

  private async snapshotText(): Promise<string> {
    const context = this.contextGetter();
    if (!context) return '';
    if (!this.client || this.context !== context) await this.attach(context);

    const result = await withTimeout(
      this.client!.callTool({ name: 'browser_snapshot', arguments: {} }),
      5_000,
      'Playwright MCP snapshot timeout',
    );
    const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
    const text = content
      .filter((item) => item.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text!)
      .join('\n');
    return text;
  }

  async close(): Promise<void> {
    const client = this.client;
    const server = this.server;
    this.client = undefined;
    this.server = undefined;
    this.context = undefined;
    await client?.close().catch(() => {});
    await server?.close().catch(() => {});
  }

  private async attach(context: BrowserContext): Promise<void> {
    await this.close();
    const { createConnection } = await import('@playwright/mcp');
    const server = await createConnection(
      { snapshot: { mode: 'full' }, codegen: 'none' },
      async () => context as never,
    );
    const client = new Client({ name: 'testpilot-playwright-observer', version: '0.1.0' });
    const [clientTransport, serverTransport] = linkedTransports();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    this.context = context;
    this.server = server;
    this.client = client;
  }
}

export function controlHintsFromObservation(observed: Observed[], type: ControlType): string[] {
  if (type !== 'date') return [];
  const calendarButton = observed.find((item) =>
    item.role === 'button' && /(?:open|choose|select).*calendar|calendar|lịch/iu.test(item.name ?? item.text ?? ''),
  );
  const textbox = observed.find((item) => item.role === 'textbox');
  return [
    ...(textbox ? ['playwright-mcp: textbox exposed'] : []),
    ...(calendarButton ? [`playwright-mcp: calendar button "${calendarButton.name ?? calendarButton.text}"`] : []),
  ];
}

const INTERACTIVE_ROLES = new Set([
  'button', 'checkbox', 'combobox', 'link', 'listbox', 'menuitem', 'option',
  'radio', 'searchbox', 'slider', 'spinbutton', 'switch', 'tab', 'textbox',
]);

/** Parse the stable YAML-like accessibility snapshot from browser_snapshot. */
export function parsePlaywrightMcpSnapshot(source: string): Observed[] {
  const out: Observed[] = [];
  let last: { indent: number; element: Observed } | undefined;

  for (const line of source.split(/\r?\n/)) {
    const textMatch = line.match(/^(\s*)-\s+text:\s*(.+?)\s*$/i);
    if (textMatch) {
      const text = cleanSnapshotText(textMatch[2]);
      if (text) out.push({ text, interactive: false, index: out.length, container: false });
      continue;
    }

    const roleMatch = line.match(/^(\s*)-\s+([a-z][\w-]*)(?:\s+"((?:\\.|[^"])*)")?(?:\s+\[[^\]]+\])*(?::\s*(.*))?$/i);
    if (roleMatch) {
      const role = roleMatch[2]!.toLowerCase();
      const name = decodeQuoted(roleMatch[3]);
      const trailing = cleanSnapshotText(roleMatch[4]);
      if (!name && !trailing && ['generic', 'main', 'group', 'list'].includes(role)) {
        last = undefined;
        continue;
      }
      const element: Observed = {
        role,
        ...(name ? { name } : {}),
        ...(trailing ? { text: trailing } : {}),
        interactive: INTERACTIVE_ROLES.has(role),
        index: out.length,
        container: false,
      };
      out.push(element);
      last = { indent: roleMatch[1]!.length, element };
      continue;
    }

    const attrMatch = line.match(/^(\s*)-\s+\/(placeholder|value):\s*(.+?)\s*$/i);
    if (attrMatch && last && attrMatch[1]!.length > last.indent) {
      const value = cleanSnapshotText(attrMatch[3]);
      if (!value) continue;
      if (attrMatch[2]!.toLowerCase() === 'placeholder') last.element.placeholder = value;
      else last.element.text ??= value;
      continue;
    }

  }

  return out;
}

/** Merge MCP semantics into DOM observations without duplicate matches. */
export function mergeAccessibilityObservations(dom: Observed[], accessibility: Observed[]): Observed[] {
  const merged = dom.map((item) => ({ ...item }));
  for (const candidate of accessibility) {
    const match = merged.find((item) => sameSemanticElement(item, candidate));
    if (match) {
      // Role is the one field the snapshot knows better. The DOM scan reports
      // the tag it found — `input` for anything typeable — while the
      // accessibility tree reports what the control actually is to a user:
      // `combobox` for a field with a suggestion list. Filling only the gap
      // (`??=`) meant the weaker answer always won, because the DOM path had
      // already supplied one.
      if (isSemanticRole(candidate.role) && !isSemanticRole(match.role)) match.role = candidate.role;
      else match.role ??= candidate.role;
      match.name ??= candidate.name;
      match.text ??= candidate.text;
      match.placeholder ??= candidate.placeholder;
      match.interactive ||= candidate.interactive;
    } else {
      merged.push({ ...candidate, index: merged.length });
    }
  }
  return merged;
}

/**
 * Roles that say what a control *is*, as opposed to the tag it happens to use.
 *
 * Deliberately the same set the snapshot treats as interactive: those are the
 * roles a page has to opt into, so seeing one is evidence, while `generic` or a
 * bare tag name is the absence of evidence.
 */
function isSemanticRole(role: string | undefined): boolean {
  if (!role) return false;
  const normalized = role.toLowerCase();
  // A tag name is not a role, however role-shaped it looks: `input` says the
  // field can be typed into, `combobox` says it offers choices.
  if (normalized in IMPLICIT_ROLES) return false;
  return INTERACTIVE_ROLES.has(normalized);
}

/**
 * The ARIA roles a tag exposes by itself.
 *
 * The DOM scan reports tags, the snapshot reports roles, so the two describe
 * one control in two vocabularies. Without this the role check below vetoed
 * every pair it was meant to reconcile — `input` and `combobox` are the same
 * field — and the snapshot's better answer was filed as a separate element.
 */
const IMPLICIT_ROLES: Record<string, string[]> = {
  input: ['textbox', 'combobox', 'searchbox', 'spinbutton', 'checkbox', 'radio', 'slider', 'switch'],
  textarea: ['textbox'],
  select: ['combobox', 'listbox'],
  a: ['link'],
  button: ['button'],
  img: ['img'],
};

/** Whether two role names can describe one control. */
function rolesDescribeSameControl(left: string, right: string): boolean {
  if (left === right) return true;
  return (IMPLICIT_ROLES[left] ?? []).includes(right)
    || (IMPLICIT_ROLES[right] ?? []).includes(left);
}

function sameSemanticElement(a: Observed, b: Observed): boolean {
  if (a.role && b.role && !rolesDescribeSameControl(a.role, b.role)) return false;
  const left = new Set([a.name, a.text, a.placeholder].map(normalize).filter(Boolean));
  return [b.name, b.text, b.placeholder].map(normalize).some((value) => value && left.has(value));
}

function normalize(value: string | undefined): string {
  return (value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('vi');
}

function decodeQuoted(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim() || undefined;
}

function cleanSnapshotText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/\s+\[ref=[^\]]+\]\s*$/, '').trim();
  if (!cleaned) return undefined;
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) return decodeQuoted(cleaned.slice(1, -1));
  return cleaned;
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
