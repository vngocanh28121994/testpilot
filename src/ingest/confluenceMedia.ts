/**
 * Confluence images, which the page body never hands over directly.
 *
 * Read as `markdown` a page mentions its images nowhere at all; read as `html`
 * an uploaded image arrives as a media node carrying a file id and no URL:
 *
 *   <img data-type="media" data-id="9b5bd57d-…" data-collection="contentId-196994"
 *        data-alt="image-20260824-083123.png" data-width="365">
 *
 * Turning that id into bytes takes two things this file provides: the REST v2
 * attachment listing, which is the only place the download link exists, and a
 * credential, because both the listing and the download are private. The MCP
 * OAuth token cannot stand in — the grant carries read:page and read:space but
 * no attachment scope at all — so this path deliberately runs outside MCP on a
 * Confluence API token the user creates themselves.
 *
 * Stock art pasted from Atlassian's own CDN is the exception: it comes through
 * as a plain `<img src>` on a public host, and needs none of this.
 */

/** A media node found in a page body — an image known only by its file id. */
export interface MediaNode {
  fileId: string;
  /** The original filename when Confluence kept one; used as the title. */
  alt?: string;
}

/** An attachment as REST v2 describes it, reduced to what a download needs. */
export interface ResolvedAttachment {
  fileId: string;
  title: string;
  mediaType: string;
  /** Absolute, on the Confluence origin, and private. */
  url: string;
}

const V2_PAGE_SIZE = 100;
const LIST_TIMEOUT_MS = 15_000;

/**
 * Media nodes in a page body.
 *
 * Bodies arrive escaped a variable number of times — MCP hands back content as
 * a JSON string that itself contains JSON — so every quote here tolerates any
 * run of backslashes in front of it. Attribute order is not guaranteed either,
 * so `data-id` is read from the whole tag
 * rather than from a fixed position, and tags without one are skipped: a media
 * node with no file id is not resolvable by any later step.
 */
export function parseMediaNodes(html: string): MediaNode[] {
  const found: MediaNode[] = [];
  const seen = new Set<string>();
  for (const tag of html.matchAll(/<[a-z:-]+\b[^>]*data-type=\\*["']media\\*["'][^>]*>/gi)) {
    const text = tag[0]!;
    const fileId = attr(text, 'data-id');
    if (!fileId || seen.has(fileId)) continue;
    seen.add(fileId);
    const alt = attr(text, 'data-alt');
    found.push({ fileId, ...(alt ? { alt } : {}) });
  }
  return found;
}

function attr(tag: string, name: string): string | undefined {
  const match = new RegExp(`${name}=\\\\*["']([^"'\\\\]+)`, 'i').exec(tag);
  return match?.[1];
}

/**
 * The Basic credential for a Confluence site, or nothing.
 *
 * Absent credentials are not an error here. A workflow whose documents happen
 * to carry no images must keep running, and the caller reports the gap in the
 * one place it matters — where images were found but could not be fetched.
 */
export function confluenceAuthHeader(env = process.env): string | undefined {
  const email = env.CONFLUENCE_EMAIL?.trim();
  const token = env.CONFLUENCE_API_TOKEN?.trim();
  if (!email || !token) return undefined;
  return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
}

/**
 * Every image attachment on a page, keyed by the file id media nodes cite.
 *
 * Paged through to the end rather than capped: a spec page with sixty
 * screenshots is normal, and a silently truncated list would drop exactly the
 * later evidence the vision pass was asked to read.
 */
export async function listImageAttachments(
  origin: string,
  pageId: string,
  auth: string,
  fetcher: typeof fetch = fetch,
): Promise<ResolvedAttachment[]> {
  const out: ResolvedAttachment[] = [];
  let next: string | undefined =
    `${origin}/wiki/api/v2/pages/${encodeURIComponent(pageId)}/attachments?limit=${V2_PAGE_SIZE}`;

  while (next) {
    const response = await fetcher(next, {
      headers: { authorization: auth, accept: 'application/json' },
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(
        response.status === 401 || response.status === 403
          ? `Confluence từ chối quyền đọc file đính kèm (HTTP ${response.status}). `
            + 'Kiểm tra CONFLUENCE_EMAIL và CONFLUENCE_API_TOKEN.'
          : `không đọc được danh sách file đính kèm (HTTP ${response.status})`,
      );
    }
    const body = await response.json() as {
      results?: Array<Record<string, unknown>>;
      _links?: { next?: string };
    };
    for (const item of body.results ?? []) {
      const mediaType = String(item.mediaType ?? '');
      if (!mediaType.startsWith('image/')) continue;
      const fileId = typeof item.fileId === 'string' ? item.fileId : undefined;
      const download = typeof item.downloadLink === 'string' ? item.downloadLink : undefined;
      if (!fileId || !download) continue;
      out.push({
        fileId,
        title: String(item.title ?? fileId),
        mediaType,
        url: absolute(download, origin),
      });
    }
    const link = body._links?.next;
    next = link ? absolute(link, origin) : undefined;
  }
  return out;
}

/**
 * Confluence's own links, made fetchable.
 *
 * REST v2 answers with paths relative to the product, not to the host:
 * `/rest/api/content/196994/child/attachment/att393230/download`. Joining that
 * to the origin alone drops `/wiki` and lands on the site's 404 page — which
 * returns HTML with a 200-shaped body, so it reads as a broken image rather
 * than as a broken URL. Paths that already carry the prefix are left as they
 * are, since paging links sometimes include it.
 */
function absolute(ref: string, origin: string): string {
  if (/^https?:\/\//i.test(ref)) return ref;
  const path = ref.startsWith('/') ? ref : `/${ref}`;
  return path.startsWith('/wiki/') ? `${origin}${path}` : `${origin}/wiki${path}`;
}

/**
 * A fetch that presents the Confluence credential to Confluence and to nobody
 * else.
 *
 * The host check is the whole point: page bodies routinely embed images from
 * third-party CDNs, and a wrapper that attached the header unconditionally
 * would hand the user's API token to whatever host an image happened to name.
 */
export function confluenceFetch(
  origins: Iterable<string>,
  auth = confluenceAuthHeader(),
  base: typeof fetch = fetch,
): typeof fetch {
  const allowed = new Set([...origins].filter(Boolean));
  if (!auth || allowed.size === 0) return base;
  return ((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    let origin: string;
    try { origin = new URL(url).origin; } catch { return base(input, init); }
    if (!allowed.has(origin)) return base(input, init);
    const headers = new Headers(init?.headers);
    headers.set('authorization', auth);
    return base(input, { ...init, headers });
  }) as typeof fetch;
}
