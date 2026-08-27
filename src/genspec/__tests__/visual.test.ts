import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SourceDoc } from '../../ingest/types.js';
import { enrichDocsWithVisualEvidence } from '../visual.js';

const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('visual document enrichment', () => {
  it('turns an inline Confluence image into traceable text evidence', async () => {
    const docs: SourceDoc[] = [{
      kind: 'confluence',
      ref: 'https://example.atlassian.net/wiki/pages/1',
      title: 'Đăng nhập',
      text: 'Người dùng đăng nhập.',
      visuals: [{ ref: 'mcp-image-1', mimeType: 'image/png', data: PNG_1X1 }],
      fetchedAt: '2026-08-24T00:00:00.000Z',
    }];
    const client = {
      messages: {
        async create() {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                assets: [{
                  id: 'doc-1-image-1',
                  screen: 'Đăng nhập',
                  visibleText: ['Đăng nhập'],
                  components: ['Ô tài khoản', 'Ô mật khẩu'],
                  interactions: ['Nhập thông tin'],
                  states: [],
                  businessEvidence: [],
                  uncertainties: ['Không thấy trạng thái lỗi'],
                }],
              }),
            }],
          };
        },
      },
    };

    const result = await enrichDocsWithVisualEvidence(docs, { client, model: 'deepseek-chat' });

    assert.equal(result.discovered, 1);
    assert.equal(result.analyzed, 1);
    assert.match(result.docs[0]!.visualEvidence ?? '', /Màn hình: Đăng nhập/);
    assert.match(result.docs[0]!.visualEvidence ?? '', /Ô tài khoản/);
  });

  it('does not call vision when the source has no image', async () => {
    const docs: SourceDoc[] = [{
      kind: 'confluence', ref: 'doc', title: 'Text only', text: 'Yêu cầu',
      fetchedAt: '2026-08-24T00:00:00.000Z',
    }];
    const result = await enrichDocsWithVisualEvidence(docs);
    assert.equal(result.analyzed, 0);
    assert.equal(result.docs, docs);
  });

  it('analyzes every image across multiple batches instead of silently truncating them', async () => {
    const docs: SourceDoc[] = [{
      kind: 'confluence', ref: 'doc', title: 'Luồng nhiều bước', text: 'Yêu cầu',
      visuals: Array.from({ length: 7 }, (_, index) => ({
        ref: `mcp-image-${index + 1}`,
        mimeType: 'image/png',
        data: PNG_1X1,
      })),
      fetchedAt: '2026-08-24T00:00:00.000Z',
    }];
    let calls = 0;
    const client = {
      messages: {
        async create(params: unknown) {
          calls += 1;
          const prompt = JSON.stringify(params);
          const ids = [...prompt.matchAll(/doc-1-image-\d+/g)].map((match) => match[0]);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                assets: [...new Set(ids)].map((id) => ({
                  id,
                  screen: id,
                  visibleText: [],
                  components: [],
                  interactions: [],
                  states: [],
                  businessEvidence: [],
                  uncertainties: [],
                })),
              }),
            }],
          };
        },
      },
    };

    const result = await enrichDocsWithVisualEvidence(docs, { client, model: 'deepseek-chat' });

    assert.equal(calls, 2);
    assert.equal(result.discovered, 7);
    assert.equal(result.analyzed, 7);
    assert.match(result.docs[0]!.visualEvidence ?? '', /doc-1-image-7/);
  });

  it('uses Gemini first when a Gemini key is available', async () => {
    const previous = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'test-only-key';
    const docs: SourceDoc[] = [{
      kind: 'figma', ref: 'figma', title: 'Thiết kế', text: 'Luồng',
      visuals: [{ ref: 'render', mimeType: 'image/png', data: PNG_1X1 }],
      fetchedAt: '2026-08-24T00:00:00.000Z',
    }];
    let calledUrl = '';
    let sentKey = '';
    const geminiFetcher: typeof fetch = async (input, init) => {
      calledUrl = String(input);
      sentKey = String((init?.headers as Record<string, string>)?.['x-goog-api-key'] ?? '');
      return new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                assets: [{
                  id: 'doc-1-image-1', screen: 'Thiết kế', visibleText: [],
                  components: ['Nút tiếp tục'], interactions: [], states: [],
                  businessEvidence: [], uncertainties: [],
                }],
              }),
            }],
          },
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    try {
      const result = await enrichDocsWithVisualEvidence(docs, { geminiFetcher });
      assert.match(calledUrl, /gemini-3\.6-flash:generateContent$/);
      assert.equal(sentKey, 'test-only-key');
      assert.match(result.docs[0]!.visualEvidence ?? '', /Nút tiếp tục/);
    } finally {
      if (previous === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previous;
    }
  });
});
