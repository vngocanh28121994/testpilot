/**
 * The two decisions in this module that fail quietly if wrong: which tags count
 * as images, and which hosts are shown the credential.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  confluenceAuthHeader, confluenceFetch, listImageAttachments, parseMediaNodes,
} from '../confluenceMedia.js';

/** Copied from a real page body, escaping included. */
const BODY = `<p>Mô tả</p>
<img data-type="media" data-media-type="file" data-id="9b5bd57d-b155-4f07-b891-c54d7e08f6a0"
     data-collection="contentId-196994" data-alt="image-20260824-083123.png" data-width="365">
<img data-type="media" data-id="37151485-374f-48c2-ae01-39604632a050" data-width="1070">
<img src="https://dam-cdn.atl.orangelogic.com/AssetLink/5mjuo.png" alt="spaces.png">`;

describe('parseMediaNodes', () => {
  it('reads uploaded images and leaves plain <img src> alone', () => {
    const nodes = parseMediaNodes(BODY);
    assert.deepEqual(nodes.map((n) => n.fileId), [
      '9b5bd57d-b155-4f07-b891-c54d7e08f6a0',
      '37151485-374f-48c2-ae01-39604632a050',
    ]);
    // The CDN image has a URL already; treating it as a media node would send
    // a doomed attachment lookup for a file that is not attached to anything.
    assert.equal(nodes.length, 2);
    assert.equal(nodes[0]!.alt, 'image-20260824-083123.png');
    assert.equal(nodes[1]!.alt, undefined, 'thiếu data-alt thì không bịa tên');
  });

  it('survives the escaped form MCP wraps bodies in', () => {
    const escaped = String.raw`<img data-type=\"media\" data-id=\"abc-123\" data-alt=\"a.png\">`;
    assert.deepEqual(parseMediaNodes(escaped), [{ fileId: 'abc-123', alt: 'a.png' }]);
  });

  it('survives double escaping, the form the real server actually returns', () => {
    // MCP hands back content as a JSON string that itself contains JSON, so the
    // body reaches this parser with two rounds of escaping. A regex allowing
    // only one backslash read the live page as having zero images.
    const twice = String.raw`<img data-type=\"media\" data-id=\"9b5bd57d\" data-alt=\"a.png\">`;
    assert.deepEqual(parseMediaNodes(twice), [{ fileId: '9b5bd57d', alt: 'a.png' }]);
  });

  it('ignores a media node with no file id, which nothing could resolve', () => {
    assert.deepEqual(parseMediaNodes('<img data-type="media" data-width="10">'), []);
  });
});

describe('confluenceFetch', () => {
  const auth = 'Basic secret';
  const seen: Array<{ url: string; auth: string | null }> = [];
  const spy = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({
      url: String(input),
      auth: new Headers(init?.headers).get('authorization'),
    });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  it('sends the token to Confluence and never to another host', async () => {
    seen.length = 0;
    const f = confluenceFetch(['https://digital-horus.atlassian.net'], auth, spy);
    await f('https://digital-horus.atlassian.net/wiki/download/x.png');
    await f('https://dam-cdn.atl.orangelogic.com/AssetLink/5mjuo.png');
    await f('https://evil.example.com/collect?u=1');

    assert.equal(seen[0]!.auth, auth);
    assert.equal(seen[1]!.auth, null, 'CDN công khai không cần và không được nhận token');
    assert.equal(seen[2]!.auth, null, 'host lạ tuyệt đối không được nhận token');
  });

  it('passes through untouched when no credential is configured', () => {
    const f = confluenceFetch(['https://x.atlassian.net'], undefined, spy);
    assert.equal(f, spy);
  });

  it('reads a credential only when both halves are present', () => {
    assert.equal(confluenceAuthHeader({ CONFLUENCE_EMAIL: 'a@b.c' } as NodeJS.ProcessEnv), undefined);
    assert.equal(confluenceAuthHeader({ CONFLUENCE_API_TOKEN: 't' } as NodeJS.ProcessEnv), undefined);
    assert.equal(
      confluenceAuthHeader({ CONFLUENCE_EMAIL: 'a@b.c', CONFLUENCE_API_TOKEN: 't' } as NodeJS.ProcessEnv),
      `Basic ${Buffer.from('a@b.c:t').toString('base64')}`,
    );
  });
});

describe('listImageAttachments', () => {
  const page = (results: unknown[], next?: string) => new Response(
    JSON.stringify({ results, ...(next ? { _links: { next } } : {}) }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

  it('keeps images, follows paging, and makes links absolute', async () => {
    const pages = [
      page([
        // The shape REST v2 actually returns: relative to /wiki, not to the host.
        { fileId: 'f1', title: 'a.png', mediaType: 'image/png', downloadLink: '/rest/api/content/1/child/attachment/att9/download' },
        { fileId: 'f2', title: 'spec.pdf', mediaType: 'application/pdf', downloadLink: '/wiki/x.pdf' },
      ], '/wiki/api/v2/pages/1/attachments?cursor=2'),
      page([
        { fileId: 'f3', title: 'b.png', mediaType: 'image/png', downloadLink: '/wiki/download/b.png' },
      ]),
    ];
    const fetcher = (async () => pages.shift()!) as typeof fetch;
    const out = await listImageAttachments('https://site.atlassian.net', '1', 'Basic x', fetcher);

    assert.deepEqual(out.map((a) => a.fileId), ['f1', 'f3'], 'chỉ lấy ảnh, và lấy hết mọi trang');
    assert.equal(
      out[0]!.url,
      'https://site.atlassian.net/wiki/rest/api/content/1/child/attachment/att9/download',
      'thiếu /wiki thì rơi vào trang 404 trả về HTML, trông như ảnh hỏng',
    );
    // A link that already carries the prefix must not get a second one.
    assert.equal(out[1]!.url, 'https://site.atlassian.net/wiki/download/b.png');
  });

  it('names the credential when Confluence refuses', async () => {
    const fetcher = (async () => new Response('', { status: 403 })) as typeof fetch;
    await assert.rejects(
      listImageAttachments('https://site.atlassian.net', '1', 'Basic x', fetcher),
      /CONFLUENCE_API_TOKEN/,
    );
  });
});
