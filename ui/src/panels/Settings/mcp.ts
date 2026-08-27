import type { TestPilotConfig } from '@core/ui/contracts.js';

export type McpConfig = NonNullable<TestPilotConfig['mcp']>;
export type Transport = McpConfig['transport'] | '';

export interface McpForm {
  transport: Transport;
  url: string;
  command: string;
  args: string;
  confluencePage: string;
  figmaFile: string;
  confluenceAttachments: string;
  figmaImage: string;
}

export const EMPTY_MCP_FORM: McpForm = {
  transport: '',
  url: '',
  command: '',
  args: '',
  confluencePage: '',
  figmaFile: '',
  confluenceAttachments: '',
  figmaImage: '',
};

export function mcpToForm(mcp: TestPilotConfig['mcp']): McpForm {
  if (!mcp) return EMPTY_MCP_FORM;
  const m = mcp as McpConfig & { url?: string; command?: string; args?: string[] };
  return {
    transport: m.transport,
    url: m.url ?? '',
    command: m.command ?? '',
    args: (m.args ?? []).join(' '),
    confluencePage: m.tools?.confluencePage ?? '',
    figmaFile: m.tools?.figmaFile ?? '',
    confluenceAttachments: m.tools?.confluenceAttachments ?? '',
    figmaImage: m.tools?.figmaImage ?? '',
  };
}

/**
 * Dựng lại khối `mcp` của config từ form — port của `mcpFromForm()` ở app.js:5602.
 *
 * Trả về `undefined` khi chưa chọn transport, và đó là hành vi có ý nghĩa: nó
 * XOÁ khối mcp khỏi config, tức là "không dùng MCP", chứ không phải "để nguyên
 * cái cũ".
 *
 * `stdio` và `http` mang hai bộ trường loại trừ nhau; gửi cả hai lên sẽ bị
 * ConfigSchema ở server từ chối.
 */
export function mcpFromForm(form: McpForm): McpConfig | undefined {
  if (!form.transport) return undefined;
  return {
    transport: form.transport,
    ...(form.transport === 'stdio'
      ? { command: form.command.trim(), args: form.args.trim().split(/\s+/).filter(Boolean) }
      : { url: form.url.trim() }),
    env: {},
    headers: {},
    tools: {
      confluencePage: form.confluencePage.trim(),
      figmaFile: form.figmaFile.trim(),
      confluenceAttachments: form.confluenceAttachments.trim(),
      figmaImage: form.figmaImage.trim(),
    },
  } as McpConfig;
}

/** Dòng trạng thái vision key — ba trường hợp, ba câu khác nhau (app.js:5520). */
export function visionKeyStatus(modelKeys: { gemini: boolean; anthropic: boolean }): {
  text: string;
  ok: boolean;
} {
  if (modelKeys.gemini) {
    return { text: 'Gemini sẵn sàng phân tích ảnh Confluence/Figma.', ok: true };
  }
  if (modelKeys.anthropic) {
    return {
      text: 'Đang dùng Anthropic dự phòng. Thêm Gemini key để dùng provider mặc định.',
      ok: true,
    };
  }
  return { text: 'Chưa có vision key — workflow sẽ dừng nếu tài liệu chứa ảnh.', ok: false };
}
