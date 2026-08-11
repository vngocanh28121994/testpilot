import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AppiumMcpResponseAdapter } from '../AppiumMcpResponseAdapter.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function textResponse(text: string) {
  return { content: [{ type: 'text', text }] };
}

function imageResponse(data: string) {
  return { content: [{ type: 'image', data, mimeType: 'image/png' }] };
}

// ── extractPageSource ─────────────────────────────────────────────────────────

describe('AppiumMcpResponseAdapter.extractPageSource', () => {
  it('strips xml code fence', () => {
    const res = textResponse(
      'Page source retrieved successfully:\n```xml\n<hierarchy><node/></hierarchy>\n```',
    );
    assert.equal(
      AppiumMcpResponseAdapter.extractPageSource(res),
      '<hierarchy><node/></hierarchy>',
    );
  });

  it('strips html code fence', () => {
    const res = textResponse(
      'Page source retrieved successfully:\n```html\n<html><body></body></html>\n```',
    );
    assert.equal(
      AppiumMcpResponseAdapter.extractPageSource(res),
      '<html><body></body></html>',
    );
  });

  it('strips XML uppercase fence marker', () => {
    const res = textResponse('```XML\n<root/>\n```');
    assert.equal(AppiumMcpResponseAdapter.extractPageSource(res), '<root/>');
  });

  it('throws on missing code fence', () => {
    const res = textResponse('Page source retrieved successfully: no fence here');
    assert.throws(() => AppiumMcpResponseAdapter.extractPageSource(res), /no code fence/);
  });

  it('throws on empty response content', () => {
    assert.throws(
      () => AppiumMcpResponseAdapter.extractPageSource({ content: [] }),
      Error,
    );
  });
});

// ── extractElementUuid ────────────────────────────────────────────────────────

describe('AppiumMcpResponseAdapter.extractElementUuid', () => {
  it('extracts UUID from single-quoted format', () => {
    const res = textResponse("elementId '00000000-1111-2222-3333-444444444444'\nSuccessfully found element");
    assert.equal(
      AppiumMcpResponseAdapter.extractElementUuid(res),
      '00000000-1111-2222-3333-444444444444',
    );
  });

  it('extracts UUID from double-quoted format', () => {
    const res = textResponse('elementId "abc-def-ghi"\nFound.');
    assert.equal(AppiumMcpResponseAdapter.extractElementUuid(res), 'abc-def-ghi');
  });

  it('throws when no UUID present', () => {
    const res = textResponse('No such element found.');
    assert.throws(() => AppiumMcpResponseAdapter.extractElementUuid(res), /UUID not found/);
  });

  it('throws on empty response', () => {
    assert.throws(() => AppiumMcpResponseAdapter.extractElementUuid({ content: [] }), Error);
  });
});

// ── extractScreenshotBase64 ───────────────────────────────────────────────────

describe('AppiumMcpResponseAdapter.extractScreenshotBase64', () => {
  it('extracts data from image content block', () => {
    const res = imageResponse('aGVsbG8=');
    assert.equal(AppiumMcpResponseAdapter.extractScreenshotBase64(res), 'aGVsbG8=');
  });

  it('throws when no image block present', () => {
    const res = textResponse('no image here');
    assert.throws(
      () => AppiumMcpResponseAdapter.extractScreenshotBase64(res),
      /no image content/,
    );
  });

  it('throws on empty content array', () => {
    assert.throws(
      () => AppiumMcpResponseAdapter.extractScreenshotBase64({ content: [] }),
      Error,
    );
  });
});

// ── extractTextValue ──────────────────────────────────────────────────────────

describe('AppiumMcpResponseAdapter.extractTextValue', () => {
  it('returns text for non-empty response', () => {
    assert.equal(
      AppiumMcpResponseAdapter.extractTextValue(textResponse('Hello World')),
      'Hello World',
    );
  });

  it('returns null for empty text (Capacitor WebView field)', () => {
    assert.equal(AppiumMcpResponseAdapter.extractTextValue(textResponse('')), null);
  });

  it('returns null for whitespace-only text', () => {
    assert.equal(AppiumMcpResponseAdapter.extractTextValue(textResponse('   ')), null);
  });

  it('returns null on missing content', () => {
    assert.equal(AppiumMcpResponseAdapter.extractTextValue({ content: [] }), null);
  });
});

// ── extractContextList ────────────────────────────────────────────────────────

describe('AppiumMcpResponseAdapter.extractContextList', () => {
  it('parses plain context listing', () => {
    const res = textResponse('NATIVE_APP\nWEBVIEW_com.fss.tcbs.mobiletrading\n');
    const list = AppiumMcpResponseAdapter.extractContextList(res);
    assert.ok(list.includes('NATIVE_APP'));
    assert.ok(list.includes('WEBVIEW_com.fss.tcbs.mobiletrading'));
  });

  it('strips header lines', () => {
    const res = textResponse(
      'Available contexts:\nNATIVE_APP\nWEBVIEW_com.example\n',
    );
    const list = AppiumMcpResponseAdapter.extractContextList(res);
    assert.ok(!list.some((l) => l.toLowerCase().startsWith('available context')));
    assert.ok(list.includes('NATIVE_APP'));
  });

  it('returns empty array for empty response', () => {
    assert.deepEqual(
      AppiumMcpResponseAdapter.extractContextList(textResponse('')),
      [],
    );
  });
});

// ── isStaleElementError ───────────────────────────────────────────────────────

describe('AppiumMcpResponseAdapter.isStaleElementError', () => {
  const stalePatterns = [
    'StaleObjectReferenceException: object is stale',
    'stale element reference: Element is stale',
    'StaleElementReferenceError',
    'element is stale',
    'STALE ELEMENT REFERENCE',           // case-insensitive
    'StaleObjectReferenceException',
  ];

  for (const pattern of stalePatterns) {
    it(`returns true for: "${pattern.slice(0, 50)}"`, () => {
      assert.equal(AppiumMcpResponseAdapter.isStaleElementError(pattern), true);
    });
  }

  const nonStaleMessages = [
    'An element could not be located on the screen using the given search parameters',
    'no such element',
    'element not found',
    'timeout waiting for element',
    'invalid session id',
    'driver offline',
  ];

  for (const msg of nonStaleMessages) {
    it(`returns false for generic: "${msg.slice(0, 50)}"`, () => {
      assert.equal(AppiumMcpResponseAdapter.isStaleElementError(msg), false);
    });
  }

  it('returns false for null', () => {
    assert.equal(AppiumMcpResponseAdapter.isStaleElementError(null), false);
  });

  it('returns false for undefined', () => {
    assert.equal(AppiumMcpResponseAdapter.isStaleElementError(undefined), false);
  });

  it('returns false for empty string', () => {
    assert.equal(AppiumMcpResponseAdapter.isStaleElementError(''), false);
  });

  it('accepts Error object via .message property', () => {
    const err = new Error('StaleObjectReferenceException: element stale');
    assert.equal(AppiumMcpResponseAdapter.isStaleElementError(err), true);
  });

  it('accepts MCP response object with text content', () => {
    const res = { content: [{ type: 'text', text: 'StaleObjectReferenceException occurred' }] };
    assert.equal(AppiumMcpResponseAdapter.isStaleElementError(res), true);
  });
});
