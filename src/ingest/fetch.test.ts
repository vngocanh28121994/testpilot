import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collectVisuals, extractFigmaLinks, fetchDocs } from './fetch.js';

describe('document visual ingestion', () => {
  it('collects inline MCP images, relative HTML attachments and Figma image maps', () => {
    const visuals = collectVisuals({
      body: '<p>Bước 1</p><img src="/download/attachments/1/login.png">',
      images: { frame: 'https://cdn.example/frame.png?token=private' },
      content: [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }],
    }, 'https://example.atlassian.net/wiki/pages/1');

    assert.equal(visuals.length, 3);
    assert.ok(visuals.some((item) => item.ref.includes('/download/attachments/1/login.png')));
    assert.ok(visuals.some((item) => item.ref.startsWith('https://cdn.example/frame.png')));
    assert.ok(visuals.some((item) => item.data === 'aGVsbG8='));
  });

  it('discovers embedded Figma design links in Confluence payloads', () => {
    const links = extractFigmaLinks({
      body: '<a href="https://www.figma.com/design/AbC123/My-Flow?node-id=1-2&amp;t=x">Design</a>',
    });
    assert.deepEqual(links, ['https://www.figma.com/design/AbC123/My-Flow?node-id=1-2&t=x']);
  });

  it('automatically follows a Figma link found in a Confluence page', async () => {
    const calls: string[] = [];
    const docs = await fetchDocs(['https://example.atlassian.net/wiki/pages/123'], {
      tools: { confluencePage: 'get_page', figmaFile: 'get_design' },
      call: async (tool) => {
        calls.push(tool);
        return tool === 'get_page'
          ? {
              title: 'Ticket',
              body: '<p>Xem https://www.figma.com/design/AbC123/My-Flow?node-id=1-2</p>',
            }
          : {
              name: 'My Flow',
              document: { type: 'FRAME', name: 'Login', children: [] },
            };
      },
    });

    assert.deepEqual(calls, ['get_page', 'get_design']);
    assert.deepEqual(docs.map((doc) => doc.kind), ['confluence', 'figma']);
  });

  it('auto-resolves Atlassian cloudId for the official Rovo page tool', async () => {
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const docs = await fetchDocs([
      'https://digital-horus.atlassian.net/wiki/spaces/SD/pages/196994/Test',
    ], {
      tools: { confluencePage: 'getConfluencePage', figmaFile: '' },
      call: async (tool, args) => {
        calls.push({ tool, args });
        if (tool === 'getAccessibleAtlassianResources') {
          return [{
            type: 'text',
            text: JSON.stringify([{ id: 'cloud-123', url: 'https://digital-horus.atlassian.net' }]),
          }];
        }
        return { title: 'Thêm mã cổ phiếu', body: '# Nội dung' };
      },
    });

    assert.equal(docs[0]?.title, 'Thêm mã cổ phiếu');
    assert.deepEqual(calls, [
      { tool: 'getAccessibleAtlassianResources', args: {} },
      {
        tool: 'getConfluencePage',
        // html, not markdown: a markdown body mentions the page's images
        // nowhere at all, so the vision pass had nothing to read.
        args: { cloudId: 'cloud-123', pageId: '196994', contentFormat: 'html' },
      },
    ]);
  });

  it('fails clearly when OAuth cannot access the Confluence site', async () => {
    await assert.rejects(
      fetchDocs(['https://missing.atlassian.net/wiki/pages/123'], {
        tools: { confluencePage: 'getConfluencePage', figmaFile: '' },
        call: async () => [{
          type: 'text',
          text: JSON.stringify([{ id: 'cloud-123', url: 'https://other.atlassian.net' }]),
        }],
      }),
      /chưa được cấp quyền vào https:\/\/missing\.atlassian\.net/,
    );
  });
});
