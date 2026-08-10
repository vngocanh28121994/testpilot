/**
 * A stand-in Confluence/Figma MCP server, for trying the UI without real
 * credentials and for exercising the MCP path in CI.
 *
 * In the UI → Personal Settings → MCP server:
 *   transport = stdio
 *   command   = node_modules/.bin/tsx
 *   args      = scripts/mock-mcp.ts
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const PAGE = `# Đăng nhập

Màn hình đăng nhập có ô Email, ô Mật khẩu và nút "Đăng nhập".

- Email bắt buộc, phải đúng định dạng. Sai định dạng thì hiện lỗi
  "Email không hợp lệ" ngay dưới ô Email.
- Mật khẩu bắt buộc, tối thiểu 8 ký tự.
- Đăng nhập đúng thì chuyển sang màn Trang chủ và hiện lời chào
  "Xin chào, <tên người dùng>".
- Sai mật khẩu 5 lần liên tiếp thì khoá tài khoản 15 phút và hiện
  "Tài khoản tạm khoá".`;

const FIGMA = {
  name: 'App / Login',
  document: {
    name: 'Login',
    type: 'FRAME',
    children: [
      { name: 'input/email', type: 'INSTANCE' },
      { name: 'input/password', type: 'INSTANCE' },
      { name: 'button/primary — Đăng nhập', type: 'INSTANCE' },
      { name: 'text/error — Email không hợp lệ', type: 'TEXT' },
    ],
  },
};

const server = new McpServer({ name: 'mock-confluence-figma', version: '0.1.0' });

server.registerTool(
  'confluence_get_page',
  {
    description: 'Get a Confluence page by id or URL.',
    inputSchema: { pageId: z.string().optional(), url: z.string().optional() },
  },
  async () => ({ content: [{ type: 'text' as const, text: JSON.stringify({ title: 'Đăng nhập', body: PAGE }) }] }),
);

server.registerTool(
  'figma_get_file',
  {
    description: 'Get a Figma file or node tree.',
    inputSchema: { fileKey: z.string().optional(), nodeId: z.string().optional(), url: z.string().optional() },
  },
  async () => ({ content: [{ type: 'text' as const, text: JSON.stringify(FIGMA) }] }),
);

await server.connect(new StdioServerTransport());
