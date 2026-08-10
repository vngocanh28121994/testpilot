/** Shared normalization for whatever shape an MCP server or REST API returns. */

/** MCP tools return a string, an MCP content array, or a JSON object. */
export function asText(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((part) =>
        typeof part === 'string'
          ? part
          : typeof (part as { text?: string }).text === 'string'
            ? (part as { text: string }).text
            : '',
      )
      .filter(Boolean)
      .join('\n');
  }
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (typeof o.text === 'string') return o.text;
    if (Array.isArray(o.content)) return asText(o.content);
    return JSON.stringify(raw, null, 2);
  }
  return String(raw ?? '');
}

export function stripHtml(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
