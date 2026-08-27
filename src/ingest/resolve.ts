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
 *   no sources                           -> read paths.docs
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

  if (links.length > 0 && !mcp) {
    throw new Error(
      `Đã nhận ${links.length} link tài liệu nhưng chưa có kết nối Confluence/Figma. ` +
      'Workflow đã dừng để tránh âm thầm sinh testcase từ tài liệu local khác nguồn.',
    );
  }

  if (links.length === 0) {
    const docs = await readLocalDocs(cfg.paths.docs);
    log(`Read ${docs.length} document(s) from ${cfg.paths.docs}.`);
    return docs;
  }

  // Narrow for TypeScript and fail closed if this function is changed later.
  if (!mcp) throw new Error('Thiếu cấu hình MCP cho link tài liệu.');

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
      tools: {
        confluencePage: mcp.tools.confluencePage,
        figmaFile: mcp.tools.figmaFile,
        confluenceAttachments: mcp.tools.confluenceAttachments,
        figmaImage: mcp.tools.figmaImage,
      },
    });
    log(`Fetched ${docs.length} document(s): ${docs.map((d) => d.title).join(', ')}`);
    return docs;
  } finally {
    await bridge.close().catch(() => {});
  }
}
