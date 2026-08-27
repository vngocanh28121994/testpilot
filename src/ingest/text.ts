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

/**
 * Block-level tags, which end a line rather than sit inside one.
 *
 * A specification is a list of rules, and every downstream stage relies on
 * being able to see where one rule ends. Turning every tag into a space — the
 * behaviour this replaces — flattened a Confluence page of eight bulleted rules
 * into a single 875-character line: the coverage extractor found one "source
 * unit" in it, classified that one blob as one requirement, and reported
 * `1/1 covered` for a document whose reverse-direction rule had no test at all.
 * Nothing was broken enough to notice; the gate simply had nothing to check.
 */
const BLOCK_TAGS =
  'p|div|li|ul|ol|br|tr|td|th|h[1-6]|section|article|header|footer|blockquote|pre|table';

export function stripHtml(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    // Before the general rule, so a paragraph boundary survives as a boundary.
    .replace(new RegExp(`<\\/?(?:${BLOCK_TAGS})(?:\\s[^>]*)?\\/?>`, 'gi'), '\n')
    // Everything else is inline — <strong>, <span>, <a> — and splitting a word
    // across them would turn "Ký <b>Quỹ</b>" into two fragments.
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]{2,}/g, ' ')
    // Trailing spaces would otherwise survive as blank-looking lines that the
    // unit splitter has to filter out again.
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
