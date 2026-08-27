/**
 * Document ingestion.
 *
 * Confluence and Figma are read through MCP servers the user already has
 * connected, so TestPilot does not own any API credentials. It only knows how
 * to ask: `call(toolName, args) -> text | json`. Swapping in a different MCP
 * server, or a plain HTTP client, is a one-file change.
 */

export interface SourceVisual {
  /** URL/data URI or an MCP-local identifier, kept for traceability only. */
  ref: string;
  /** Inline base64 returned by MCP. Preferred for private Confluence/Figma assets. */
  data?: string;
  mimeType?: string;
  title?: string;
}

export interface SourceDoc {
  kind: 'confluence' | 'figma';
  /** The original link, kept for traceability in the report. */
  ref: string;
  title: string;
  /** Plain text for Confluence; a flattened node tree for Figma. */
  text: string;
  /** Screenshots, attachments or rendered frames available to the vision pass. */
  visuals?: SourceVisual[];
  /** Figma links discovered inside a Confluence page. */
  linkedSources?: string[];
  /** Why images that exist on the page did not reach the vision pass. */
  visualNotes?: string[];
  /** Textual evidence produced by the vision pass; included in both AI passes. */
  visualEvidence?: string;
  fetchedAt: string;
}

/** Minimal MCP surface: whatever the host provides, reduced to one call. */
export type McpCall = (tool: string, args: Record<string, unknown>) => Promise<unknown>;

export interface McpToolNames {
  /** e.g. 'confluence_get_page' — set to whatever your MCP server exposes. */
  confluencePage: string;
  /** e.g. 'figma_get_file' / 'get_figma_data'. */
  figmaFile: string;
  /** Optional tool that returns Confluence attachment image blocks/URLs. */
  confluenceAttachments?: string;
  /** Optional tool that renders the selected Figma node/frame as an image. */
  figmaImage?: string;
}

export interface IngestConfig {
  call: McpCall;
  tools: McpToolNames;
}
