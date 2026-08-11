import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ArtifactCollector, InMemoryArtifactStorage } from '../ArtifactCollector.js';

function makeCollector(): { collector: ArtifactCollector; storage: InMemoryArtifactStorage } {
  const storage = new InMemoryArtifactStorage();
  const collector = new ArtifactCollector('/test/artifacts', storage, 7);
  return { collector, storage };
}

// ── screenshot ────────────────────────────────────────────────────────────────

describe('ArtifactCollector — saveScreenshot', () => {
  it('returns ref with correct type and mimeType', async () => {
    const { collector } = makeCollector();
    const ref = await collector.saveScreenshot('step-1-fail', Buffer.from('PNG'));
    assert.equal(ref.type, 'screenshot');
    assert.equal(ref.mimeType, 'image/png');
  });

  it('storageUri starts with file://', async () => {
    const { collector } = makeCollector();
    const ref = await collector.saveScreenshot('login-fail', Buffer.from('data'));
    assert.ok(ref.storageUri.startsWith('file://'));
  });

  it('id is derived from name', async () => {
    const { collector } = makeCollector();
    const ref = await collector.saveScreenshot('login-fail', Buffer.from('data'));
    assert.ok(ref.id.startsWith('login-fail'));
  });

  it('sizeBytes matches content length', async () => {
    const { collector } = makeCollector();
    const content = Buffer.from('PNG content here');
    const ref = await collector.saveScreenshot('s', content);
    assert.equal(ref.sizeBytes, content.length);
  });

  it('checksum is a hex SHA-256', async () => {
    const { collector } = makeCollector();
    const ref = await collector.saveScreenshot('s', Buffer.from('data'));
    assert.match(ref.checksum!, /^[0-9a-f]{64}$/);
  });

  it('checksum is deterministic for same content', async () => {
    const { collector } = makeCollector();
    const content = Buffer.from('same content');
    const r1 = await collector.saveScreenshot('a', content);
    const r2 = await collector.saveScreenshot('b', content);
    assert.equal(r1.checksum, r2.checksum);
  });

  it('different content → different checksum', async () => {
    const { collector } = makeCollector();
    const r1 = await collector.saveScreenshot('a', Buffer.from('AAA'));
    const r2 = await collector.saveScreenshot('b', Buffer.from('BBB'));
    assert.notEqual(r1.checksum, r2.checksum);
  });

  it('retentionUntil is a future ISO date', async () => {
    const { collector } = makeCollector();
    const ref = await collector.saveScreenshot('s', Buffer.from('data'));
    const until = new Date(ref.retentionUntil!).getTime();
    assert.ok(until > Date.now(), 'retentionUntil must be in the future');
  });

  it('accepts base64 string input', async () => {
    const { collector } = makeCollector();
    const ref = await collector.saveScreenshot('s', Buffer.from('hello').toString('base64'));
    assert.ok(ref.sizeBytes! > 0);
  });
});

// ── page source ───────────────────────────────────────────────────────────────

describe('ArtifactCollector — savePageSource', () => {
  it('returns page-source type with xml mimeType', async () => {
    const { collector } = makeCollector();
    const ref = await collector.savePageSource('source-1', '<hierarchy />');
    assert.equal(ref.type, 'page-source');
    assert.equal(ref.mimeType, 'text/xml');
  });

  it('stores content in storage', async () => {
    const { collector, storage } = makeCollector();
    const ref = await collector.savePageSource('src', '<root />');
    const stored = [...storage.files.values()][0]!;
    assert.equal(stored.toString('utf-8'), '<root />');
    assert.equal(ref.sizeBytes, 8);
  });
});

// ── log ───────────────────────────────────────────────────────────────────────

describe('ArtifactCollector — saveLog', () => {
  it('returns log type with text/plain mimeType', async () => {
    const { collector } = makeCollector();
    const ref = await collector.saveLog('driver-log', 'INFO: session started\n');
    assert.equal(ref.type, 'log');
    assert.equal(ref.mimeType, 'text/plain');
  });
});

// ── dom ───────────────────────────────────────────────────────────────────────

describe('ArtifactCollector — saveDom', () => {
  it('returns dom type with text/html mimeType', async () => {
    const { collector } = makeCollector();
    const ref = await collector.saveDom('dom-snap', '<html><body/></html>');
    assert.equal(ref.type, 'dom');
    assert.equal(ref.mimeType, 'text/html');
  });
});

// ── name sanitization ─────────────────────────────────────────────────────────

describe('ArtifactCollector — name sanitization', () => {
  it('sanitizes special characters in artifact name', async () => {
    const { collector } = makeCollector();
    const ref = await collector.saveLog('step/3::fail result!', 'log');
    assert.ok(!/[/!:]/.test(ref.id), `id must not contain special chars: ${ref.id}`);
  });

  it('truncates very long names to ≤64 chars (before timestamp)', async () => {
    const { collector } = makeCollector();
    const longName = 'a'.repeat(200);
    const ref = await collector.saveLog(longName, 'log');
    // id = sanitized_name + '-' + timestamp; sanitized part ≤64
    const sanitizedPart = ref.id.replace(/-\d+$/, '');
    assert.ok(sanitizedPart.length <= 64, `id too long: ${sanitizedPart.length}`);
  });
});

// ── InMemoryArtifactStorage ───────────────────────────────────────────────────

describe('InMemoryArtifactStorage', () => {
  it('stores and sizes correctly', async () => {
    const { storage } = makeCollector();
    await storage.save('/test/file.txt', Buffer.from('hello'));
    assert.equal(await storage.size('/test/file.txt'), 5);
  });

  it('overwrite replaces content', async () => {
    const { storage } = makeCollector();
    await storage.save('/f', Buffer.from('old'));
    await storage.save('/f', Buffer.from('new content'));
    assert.equal(await storage.size('/f'), 11);
  });

  it('returns 0 for unknown path', async () => {
    const { storage } = makeCollector();
    assert.equal(await storage.size('/nonexistent'), 0);
  });
});
