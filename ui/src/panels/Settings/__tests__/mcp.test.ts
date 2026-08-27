import { describe, expect, it } from 'vitest';
import { mcpFromForm, mcpToForm, visionKeyStatus, EMPTY_MCP_FORM, type McpForm } from '../mcp';

const form = (over: Partial<McpForm> = {}): McpForm => ({ ...EMPTY_MCP_FORM, ...over });

describe('mcpFromForm', () => {
  /**
   * Không chọn transport ⇒ undefined, và điều đó có nghĩa: nó XOÁ khối mcp
   * khỏi config ("không dùng MCP"), chứ không phải "để nguyên cái cũ".
   */
  it('trả undefined khi chưa chọn transport', () => {
    expect(mcpFromForm(form())).toBeUndefined();
  });

  it('stdio mang command + args, KHÔNG mang url', () => {
    const m = mcpFromForm(form({ transport: 'stdio', command: ' npx ', args: '  a   b  ', url: 'http://bo-qua' }));
    expect(m).toMatchObject({ transport: 'stdio', command: 'npx', args: ['a', 'b'] });
    expect(m).not.toHaveProperty('url');
  });

  it('http mang url, KHÔNG mang command/args', () => {
    const m = mcpFromForm(form({ transport: 'http', url: ' http://x ', command: 'bo-qua' }));
    expect(m).toMatchObject({ transport: 'http', url: 'http://x' });
    expect(m).not.toHaveProperty('command');
  });

  it('args rỗng thành mảng rỗng, không phải mảng chứa chuỗi rỗng', () => {
    const m = mcpFromForm(form({ transport: 'stdio', command: 'x', args: '   ' }));
    expect(m).toMatchObject({ args: [] });
  });

  it('mcpToForm là nghịch đảo của mcpFromForm', () => {
    const original = form({ transport: 'stdio', command: 'npx', args: 'a b', confluencePage: 'cp' });
    expect(mcpToForm(mcpFromForm(original))).toMatchObject({
      transport: 'stdio',
      command: 'npx',
      args: 'a b',
      confluencePage: 'cp',
    });
  });

  it('mcpToForm chịu được config không có mcp', () => {
    expect(mcpToForm(undefined)).toEqual(EMPTY_MCP_FORM);
  });
});

describe('visionKeyStatus', () => {
  it('ba trường hợp, ba câu khác nhau', () => {
    expect(visionKeyStatus({ gemini: true, anthropic: false })).toEqual({
      text: 'Gemini sẵn sàng phân tích ảnh Confluence/Figma.',
      ok: true,
    });
    expect(visionKeyStatus({ gemini: false, anthropic: true }).text).toContain('Anthropic dự phòng');
    expect(visionKeyStatus({ gemini: false, anthropic: false })).toEqual({
      text: 'Chưa có vision key — workflow sẽ dừng nếu tài liệu chứa ảnh.',
      ok: false,
    });
  });
});
