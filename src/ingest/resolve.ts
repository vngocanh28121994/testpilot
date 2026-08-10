import type { TestPilotConfig } from '../config.js';
import { fetchDocs } from './fetch.js';
import { readLocalDocs } from './local.js';
import { McpBridge } from './mcp.js';
import type { SourceDoc } from './types.js';

/**
 * One entry point for "give me the documents", so the CLI, the UI and CI all
 * follow the same rules:
 *
 *   sources[] + a configured MCP server -> fetch the links live
 *   otherwise                           -> read paths.docs
 *
 * The fallback is not a consolation prize: CI should read exported documents so
 * a rebuild of yesterday's commit produces yesterday's tests.
 */
export async function resolveDocs(
  cfg: TestPilotConfig,
  log: (line: string) => void = () => {},
): Promise<SourceDoc[]> {
  const mcp = cfg.mcp;
  const links = cfg.sources.filter((s) => /^https?:\/\//i.test(s));

  if (links.length === 0 || !mcp) {
    if (links.length > 0 && !mcp) {
      log(`No MCP server configured — ignoring ${links.length} link(s) and reading ${cfg.paths.docs}.`);
    }
    const docs = await readLocalDocs(cfg.paths.docs);
    log(`Read ${docs.length} document(s) from ${cfg.paths.docs}.`);
    return docs;
  }

  if (!mcp.tools.confluencePage && !mcp.tools.figmaFile) {
    throw new Error('The MCP server is configured but no tool names are mapped yet.');
  }

  log(`Connecting to MCP (${mcp.transport})…`);
  const bridge = await McpBridge.connect(mcp);
  try {
    const docs = await fetchDocs(links, {
      call: async (tool, args) => {
        log(`  → ${tool}(${Object.keys(args).filter((k) => args[k] != null).join(', ')})`);
        return bridge.call(tool, args);
      },
      tools: { confluencePage: mcp.tools.confluencePage, figmaFile: mcp.tools.figmaFile },
    });
    log(`Fetched ${docs.length} document(s): ${docs.map((d) => d.title).join(', ')}`);
    return docs;
  } finally {
    await bridge.close().catch(() => {});
  }
}
