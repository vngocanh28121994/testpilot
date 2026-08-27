import type { IngestConfig, SourceDoc, SourceVisual } from './types.js';
import { asText, stripHtml } from './text.js';
import {
  confluenceAuthHeader, listImageAttachments, parseMediaNodes,
} from './confluenceMedia.js';

/**
 * Turn a list of Confluence / Figma links into normalized documents.
 *
 * Everything here is deliberately defensive: MCP servers differ in what shape
 * they return, and a broken ingest should produce a clear message rather than a
 * mysterious empty spec three steps later.
 */
export async function fetchDocs(links: string[], cfg: IngestConfig): Promise<SourceDoc[]> {
  const docs: SourceDoc[] = [];
  const queue = [...links];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const link = queue.shift()!;
    const key = canonicalSourceUrl(link);
    if (seen.has(key)) continue;
    seen.add(key);
    const doc = await fetchDoc(link, cfg);
    docs.push(doc);
    for (const nested of doc.linkedSources ?? []) {
      if (!seen.has(canonicalSourceUrl(nested))) queue.push(nested);
    }
  }
  return docs;
}

export async function fetchDoc(link: string, cfg: IngestConfig): Promise<SourceDoc> {
  const kind = classify(link);
  const now = new Date().toISOString();

  if (kind === 'confluence') {
    if (!cfg.tools.confluencePage) throw new Error('Chưa cấu hình MCP tool đọc trang Confluence.');
    const pageId = confluencePageId(link);
    const pageArgs = await confluencePageArgs(link, pageId, cfg);
    const raw = await cfg.call(cfg.tools.confluencePage, pageArgs);
    const attachments = cfg.tools.confluenceAttachments
      ? await cfg.call(cfg.tools.confluenceAttachments, { pageId, url: link })
      : undefined;
    const { title, text, visuals, linkedSources } = flattenConfluence(
      attachments === undefined ? raw : mergePayloads(raw, attachments),
      link,
    );
    const uploaded = await uploadedImages(raw, link, pageId);
    const all = [...visuals, ...uploaded.visuals];
    return {
      kind,
      ref: link,
      title: title || link,
      text,
      ...(all.length > 0 ? { visuals: all } : {}),
      ...(uploaded.notes.length > 0 ? { visualNotes: uploaded.notes } : {}),
      ...(linkedSources.length > 0 ? { linkedSources } : {}),
      fetchedAt: now,
    };
  }

  if (!cfg.tools.figmaFile) {
    throw new Error(
      `Tìm thấy link Figma trong tài liệu nhưng chưa cấu hình MCP tool đọc Figma: ${safeRef(link)}`,
    );
  }
  const { fileKey, nodeId } = figmaIds(link);
  const raw = await cfg.call(cfg.tools.figmaFile, { fileKey, nodeId, url: link });
  const rendered = cfg.tools.figmaImage
    ? await cfg.call(cfg.tools.figmaImage, { fileKey, nodeId, url: link })
    : undefined;
  const { title, text, visuals } = flattenFigma(
    rendered === undefined ? raw : mergePayloads(raw, rendered),
    link,
  );
  return {
    kind,
    ref: link,
    title: title || fileKey,
    text,
    ...(visuals.length > 0 ? { visuals } : {}),
    fetchedAt: now,
  };
}

/**
 * Atlassian's official Rovo MCP tool identifies a site by `cloudId`, not by
 * the human-facing Confluence URL. Resolve that technical id automatically so
 * end users only ever have to paste the document link in Studio.
 *
 * Other MCP servers keep receiving the legacy `{ pageId, url }` payload. This
 * makes the official adapter precise without imposing Atlassian-specific
 * arguments on custom Confluence connectors.
 */
/**
 * Images the page owns, which the body cites by file id and never by URL.
 *
 * Kept apart from `collectVisuals` because resolving one costs a REST round
 * trip and a credential, while everything that tier finds is already a URL.
 * A missing credential is reported, not thrown: images are evidence that
 * improves a generated spec, and a workflow that produced specs yesterday
 * without them must not start failing today because a token is absent.
 */
async function uploadedImages(
  raw: unknown,
  link: string,
  pageId: string | undefined,
): Promise<{ visuals: SourceVisual[]; notes: string[] }> {
  const nodes = parseMediaNodes(JSON.stringify(raw) ?? '');
  if (nodes.length === 0 || !pageId) return { visuals: [], notes: [] };

  const auth = confluenceAuthHeader();
  if (!auth) {
    return {
      visuals: [],
      notes: [
        `Trang có ${nodes.length} ảnh tải lên nhưng chưa tải về được: `
        + 'Confluence yêu cầu xác thực riêng. Đặt CONFLUENCE_EMAIL và '
        + 'CONFLUENCE_API_TOKEN (tạo token tại id.atlassian.com) để dùng ảnh làm bằng chứng.',
      ],
    };
  }

  let attachments;
  try {
    attachments = await listImageAttachments(sourceOrigin(link), pageId, auth);
  } catch (error) {
    return { visuals: [], notes: [`Không tra được file đính kèm: ${(error as Error).message}`] };
  }

  const byFileId = new Map(attachments.map((a) => [a.fileId, a]));
  const visuals: SourceVisual[] = [];
  const missing: string[] = [];
  for (const node of nodes) {
    const found = byFileId.get(node.fileId);
    if (!found) {
      missing.push(node.alt ?? node.fileId);
      continue;
    }
    visuals.push({
      ref: found.url,
      mimeType: found.mediaType,
      title: node.alt ?? found.title,
    });
  }
  const notes = missing.length > 0
    ? [`${missing.length} ảnh trong trang không có file đính kèm tương ứng: ${missing.slice(0, 3).join(', ')}`]
    : [];
  return { visuals, notes };
}

async function confluencePageArgs(
  link: string,
  pageId: string | undefined,
  cfg: IngestConfig,
): Promise<Record<string, unknown>> {
  if (cfg.tools.confluencePage !== 'getConfluencePage') return { pageId, url: link };
  if (!pageId) {
    throw new Error(`Không đọc được pageId từ link Confluence: ${safeRef(link)}`);
  }

  const origin = sourceOrigin(link);
  const cloudId = await resolveAtlassianCloudId(origin, cfg);
  return { cloudId, pageId, contentFormat: 'html' };
}

const cloudIdCache = new WeakMap<IngestConfig['call'], Map<string, string>>();

async function resolveAtlassianCloudId(origin: string, cfg: IngestConfig): Promise<string> {
  let byOrigin = cloudIdCache.get(cfg.call);
  if (!byOrigin) {
    byOrigin = new Map();
    cloudIdCache.set(cfg.call, byOrigin);
  }
  const cached = byOrigin.get(origin);
  if (cached) return cached;

  const raw = await cfg.call('getAccessibleAtlassianResources', {});
  const resources = extractAtlassianResources(raw);
  const match = resources.find((resource) => sourceOrigin(resource.url) === origin);
  if (!match) {
    const available = resources.map((resource) => resource.url).filter(Boolean).join(', ');
    throw new Error(
      `Tài khoản Atlassian hiện tại chưa được cấp quyền vào ${origin}.` +
      (available ? ` Site đang truy cập được: ${available}.` : ''),
    );
  }
  byOrigin.set(origin, match.id);
  return match.id;
}

function extractAtlassianResources(raw: unknown): Array<{ id: string; url: string }> {
  const direct = resourceArray(raw);
  if (direct.length > 0) return direct;

  const text = asText(raw).trim();
  if (text.startsWith('[') || text.startsWith('{')) {
    try { return resourceArray(JSON.parse(text)); } catch { /* malformed MCP text */ }
  }
  throw new Error('MCP Atlassian không trả về danh sách site hợp lệ. Hãy đăng nhập lại Atlassian.');
}

function resourceArray(raw: unknown): Array<{ id: string; url: string }> {
  const values = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? [
          ...arrayValue((raw as Record<string, unknown>).resources),
          ...arrayValue((raw as Record<string, unknown>).data),
          ...arrayValue((raw as Record<string, unknown>).results),
        ]
      : [];
  return values.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const item = value as Record<string, unknown>;
    return typeof item.id === 'string' && typeof item.url === 'string'
      ? [{ id: item.id, url: item.url }]
      : [];
  });
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function sourceOrigin(ref: string): string {
  try { return new URL(ref).origin; } catch { return ref; }
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

function flattenConfluence(
  raw: unknown,
  baseUrl: string,
): { title: string; text: string; visuals: SourceVisual[]; linkedSources: string[] } {
  const o = unwrap(raw);
  const title = typeof o.title === 'string' ? o.title : '';
  const body = asText(o.body ?? o.content ?? o.text ?? raw);
  return {
    title,
    text: stripHtml(body),
    visuals: collectVisuals(raw, baseUrl),
    linkedSources: extractFigmaLinks(raw),
  };
}

function flattenFigma(
  raw: unknown,
  baseUrl: string,
): { title: string; text: string; visuals: SourceVisual[] } {
  const o = unwrap(raw);
  const title = typeof o.name === 'string' ? o.name : '';
  // The node tree matters more than the raw JSON: layer names are where the
  // element labels (and often the future test ids) actually live.
  const names = collectNames(o.document ?? o.nodes ?? o);
  const text = names.length > 0 ? names.join('\n') : asText(raw);
  return { title, text, visuals: collectVisuals(raw, baseUrl) };
}

/** Collect MCP image blocks, HTML images and image URL maps without logging data. */
export function collectVisuals(raw: unknown, baseUrl: string): SourceVisual[] {
  const found: SourceVisual[] = [];
  const seenObjects = new WeakSet<object>();
  const add = (visual: SourceVisual): void => {
    const ref = visual.ref.trim();
    if (!ref && !visual.data) return;
    const resolved = ref && !ref.startsWith('data:')
      ? resolveRef(ref, baseUrl)
      : ref;
    const key = visual.data
      ? `data:${visual.mimeType ?? ''}:${visual.data.slice(0, 48)}`
      : resolved;
    if (!key || found.some((item) =>
      item.data
        ? `data:${item.mimeType ?? ''}:${item.data.slice(0, 48)}` === key
        : item.ref === resolved)) return;
    found.push({ ...visual, ref: resolved || `inline-image-${found.length + 1}` });
  };

  const visitString = (value: string, keyHint: string): void => {
    for (const match of value.matchAll(/<img\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi)) {
      add({ ref: decodeHtml(match[1]!), title: keyHint });
    }
    for (const match of value.matchAll(/!\[[^\]]*]\(([^)\s]+)[^)]*\)/g)) {
      add({ ref: decodeHtml(match[1]!), title: keyHint });
    }
    if (/^data:image\//i.test(value)) {
      const match = /^data:([^;,]+);base64,(.+)$/is.exec(value);
      if (match) add({ ref: `inline-${found.length + 1}`, mimeType: match[1], data: match[2] });
      return;
    }
    const imageContext = /(image|images|screenshot|attachment|thumbnail|render|preview|download|src|url)/i
      .test(keyHint);
    if (imageContext && (/^https?:\/\//i.test(value) || /^\//.test(value))) {
      add({ ref: decodeHtml(value), title: keyHint });
    }
  };

  const walk = (node: unknown, keyHint = 'root', depth = 0): void => {
    if (depth > 14 || node == null) return;
    if (typeof node === 'string') {
      visitString(node, keyHint);
      return;
    }
    if (typeof node !== 'object') return;
    if (seenObjects.has(node)) return;
    seenObjects.add(node);
    if (Array.isArray(node)) {
      for (const child of node) walk(child, keyHint, depth + 1);
      return;
    }
    const o = node as Record<string, unknown>;
    const blockType = String(o.type ?? '').toLowerCase();
    const data = typeof o.data === 'string' ? o.data : undefined;
    const mimeType = typeof o.mimeType === 'string'
      ? o.mimeType
      : typeof o.mime_type === 'string'
        ? o.mime_type
        : undefined;
    if (data && (blockType === 'image' || mimeType?.startsWith('image/'))) {
      add({
        ref: typeof o.url === 'string' ? o.url : `mcp-image-${found.length + 1}`,
        data,
        ...(mimeType ? { mimeType } : {}),
        ...(typeof o.name === 'string' ? { title: o.name } : {}),
      });
    }
    for (const [key, value] of Object.entries(o)) walk(value, `${keyHint}.${key}`, depth + 1);
  };

  walk(raw);
  return found;
}

export function extractFigmaLinks(raw: unknown): string[] {
  const serialized = decodeHtml(asText(raw)).replace(/\\u0026/gi, '&').replace(/\\\//g, '/');
  const found = new Set<string>();
  const pattern = /https?:\/\/(?:www\.)?figma\.com\/(?:file|design|board)\/[A-Za-z0-9]+[^\s"'<>)]*/gi;
  for (const match of serialized.matchAll(pattern)) {
    found.add(match[0]!.replace(/[\\.,;]+$/, ''));
  }
  return [...found];
}

function resolveRef(ref: string, baseUrl: string): string {
  try { return new URL(ref, baseUrl).toString(); } catch { return ref; }
}

function canonicalSourceUrl(ref: string): string {
  try {
    const url = new URL(ref);
    url.hash = '';
    return url.toString();
  } catch {
    return ref;
  }
}

function decodeHtml(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function safeRef(ref: string): string {
  try {
    const url = new URL(ref);
    url.search = '';
    return url.toString();
  } catch {
    return ref;
  }
}

function mergePayloads(primary: unknown, visual: unknown): Record<string, unknown> {
  if (primary && typeof primary === 'object' && !Array.isArray(primary)) {
    return { ...(primary as Record<string, unknown>), _visual: visual };
  }
  return { text: asText(primary), _visual: visual };
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
