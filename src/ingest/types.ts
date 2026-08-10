/**
 * Document ingestion.
 *
 * Confluence and Figma are read through MCP servers the user already has
 * connected, so TestPilot does not own any API credentials. It only knows how
 * to ask: `call(toolName, args) -> text | json`. Swapping in a different MCP
 * server, or a plain HTTP client, is a one-file change.
 */

export interface SourceDoc {
  kind: 'confluence' | 'figma';
  /** The original link, kept for traceability in the report. */
  ref: string;
  title: string;
  /** Plain text for Confluence; a flattened node tree for Figma. */
  text: string;
  /** Figma only: image URLs or node ids that a vision pass can look at. */
  images?: string[];
  fetchedAt: string;
}

/** Minimal MCP surface: whatever the host provides, reduced to one call. */
export type McpCall = (tool: string, args: Record<string, unknown>) => Promise<unknown>;

export interface McpToolNames {
  /** e.g. 'confluence_get_page' — set to whatever your MCP server exposes. */
  confluencePage: string;
  /** e.g. 'figma_get_file' / 'get_figma_data'. */
  figmaFile: string;
}

export interface IngestConfig {
  call: McpCall;
  tools: McpToolNames;
}
