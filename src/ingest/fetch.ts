import type { IngestConfig, SourceDoc } from './types.js';
import { asText, stripHtml } from './text.js';

/**
 * Turn a list of Confluence / Figma links into normalized documents.
 *
 * Everything here is deliberately defensive: MCP servers differ in what shape
 * they return, and a broken ingest should produce a clear message rather than a
 * mysterious empty spec three steps later.
 */
export async function fetchDocs(links: string[], cfg: IngestConfig): Promise<SourceDoc[]> {
  const docs: SourceDoc[] = [];
  for (const link of links) {
    docs.push(await fetchDoc(link, cfg));
  }
  return docs;
}

export async function fetchDoc(link: string, cfg: IngestConfig): Promise<SourceDoc> {
  const kind = classify(link);
  const now = new Date().toISOString();

  if (kind === 'confluence') {
    const pageId = confluencePageId(link);
    const raw = await cfg.call(cfg.tools.confluencePage, { pageId, url: link });
    const { title, text } = flattenConfluence(raw);
    return { kind, ref: link, title: title || link, text, fetchedAt: now };
  }

  const { fileKey, nodeId } = figmaIds(link);
  const raw = await cfg.call(cfg.tools.figmaFile, { fileKey, nodeId, url: link });
  const { title, text, images } = flattenFigma(raw);
  return { kind, ref: link, title: title || fileKey, text, images, fetchedAt: now };
}

function classify(link: string): SourceDoc['kind'] {
  if (/figma\.com/i.test(link)) return 'figma';
  if (/atlassian\.net|confluence/i.test(link)) return 'confluence';
  throw new Error(`Cannot tell whether "${link}" is Confluence or Figma. Pass a full URL.`);
}

function confluencePageId(link: string): string | undefined {
  return /\/pages\/(\d+)/.exec(link)?.[1];
}

function figmaIds(link: string): { fileKey: string; nodeId?: string } {
  const fileKey = /figma\.com\/(?:file|design|board)\/([A-Za-z0-9]+)/.exec(link)?.[1];
  if (!fileKey) throw new Error(`Could not parse a Figma file key out of "${link}".`);
  const nodeId = new URL(link).searchParams.get('node-id') ?? undefined;
  return { fileKey, ...(nodeId ? { nodeId } : {}) };
}

/**
 * Most MCP servers answer with an object, but plenty return a JSON *string*
 * inside a text content block. Unwrap that case rather than feeding the model a
 * page of escaped JSON.
 */
function unwrap(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  const text = asText(raw).trim();
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Not JSON after all — fall through and treat it as prose.
    }
  }
  return { text };
}

function flattenConfluence(raw: unknown): { title: string; text: string } {
  const o = unwrap(raw);
  const title = typeof o.title === 'string' ? o.title : '';
  const body = asText(o.body ?? o.content ?? o.text ?? raw);
  return { title, text: stripHtml(body) };
}

function flattenFigma(raw: unknown): { title: string; text: string; images?: string[] } {
  const o = unwrap(raw);
  const title = typeof o.name === 'string' ? o.name : '';
  const images = Array.isArray(o.images) ? (o.images as string[]) : undefined;
  // The node tree matters more than the raw JSON: layer names are where the
  // element labels (and often the future test ids) actually live.
  const names = collectNames(o.document ?? o.nodes ?? o);
  const text = names.length > 0 ? names.join('\n') : asText(raw);
  return { title, text, ...(images ? { images } : {}) };
}

function collectNames(node: unknown, depth = 0, out: string[] = []): string[] {
  if (depth > 12 || !node || typeof node !== 'object') return out;
  const o = node as Record<string, unknown>;
  if (typeof o.name === 'string') {
    const type = typeof o.type === 'string' ? o.type : 'NODE';
    out.push(`${'  '.repeat(depth)}${type}: ${o.name}`);
  }
  const kids = Array.isArray(o.children) ? o.children : Object.values(o);
  for (const child of kids) {
    if (child && typeof child === 'object') collectNames(child, depth + 1, out);
    if (out.length > 4000) break; // A whole design file is not a useful prompt.
  }
  return out;
}

