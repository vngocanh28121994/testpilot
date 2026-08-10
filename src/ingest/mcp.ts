import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpCall } from './types.js';
import { asText } from './text.js';

/**
 * Bridge to the user's existing Confluence / Figma MCP servers.
 *
 * TestPilot never holds an API token: it launches (or dials) the MCP server the
 * developer already trusts and calls the tool by name. The tool *names* are
 * config rather than constants because every MCP server spells them differently
 * — the UI lists them so nobody has to guess.
 */

export interface McpServerConfig {
  /** stdio: a local process. http: a Streamable HTTP endpoint. */
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
}

export interface McpToolInfo {
  name: string;
  description: string;
}

export class McpBridge {
  private constructor(private readonly client: Client) {}

  static async connect(cfg: McpServerConfig): Promise<McpBridge> {
    const client = new Client({ name: 'testpilot', version: '0.1.0' }, { capabilities: {} });

    if (cfg.transport === 'stdio') {
      if (!cfg.command) throw new Error('A stdio MCP server needs a "command".');
      await client.connect(
        new StdioClientTransport({
          command: cfg.command,
          args: cfg.args ?? [],
          // Inherit nothing by default; secrets are passed in explicitly.
          ...(cfg.env ? { env: { ...process.env as Record<string, string>, ...cfg.env } } : {}),
          ...(cfg.cwd ? { cwd: cfg.cwd } : {}),
          stderr: 'pipe',
        }),
      );
    } else {
      if (!cfg.url) throw new Error('An http MCP server needs a "url".');
      await client.connect(
        new StreamableHTTPClientTransport(new URL(cfg.url), {
          ...(cfg.headers ? { requestInit: { headers: cfg.headers } } : {}),
        }),
      );
    }
    return new McpBridge(client);
  }

  async listTools(): Promise<McpToolInfo[]> {
    const { tools } = await this.client.listTools();
    return tools.map((t) => ({ name: t.name, description: t.description ?? '' }));
  }

  /** Matches the `McpCall` signature the ingest layer expects. */
  call: McpCall = async (tool, args) => {
    const res = await this.client.callTool({ name: tool, arguments: args });
    if ((res as { isError?: boolean }).isError) {
      throw new Error(`MCP tool "${tool}" failed: ${asText((res as { content?: unknown }).content)}`);
    }
    return (res as { structuredContent?: unknown; content?: unknown }).structuredContent
      ?? (res as { content?: unknown }).content;
  };

  async close(): Promise<void> {
    await this.client.close();
  }
}

/**
 * Guesses which of a server's tools reads a Confluence page and which reads a
 * Figma file. Only a starting point for the UI dropdowns — the user confirms.
 */
export function guessToolNames(tools: McpToolInfo[]): {
  confluencePage?: string;
  figmaFile?: string;
} {
  const score = (t: McpToolInfo, words: string[]): number => {
    const hay = `${t.name} ${t.description}`.toLowerCase();
    return words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0);
  };
  const best = (words: string[]): string | undefined => {
    const ranked = tools
      .map((t) => ({ t, s: score(t, words) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s);
    return ranked[0]?.t.name;
  };
  return {
    ...(best(['confluence', 'page', 'get']) ? { confluencePage: best(['confluence', 'page', 'get'])! } : {}),
    ...(best(['figma', 'file', 'data']) ? { figmaFile: best(['figma', 'file', 'data'])! } : {}),
  };
}
