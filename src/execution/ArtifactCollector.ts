import { createHash } from 'node:crypto';
import { writeFile, mkdir, stat } from 'node:fs/promises';
import { join, resolve as resolvePath } from 'node:path';
import type { ArtifactRef } from './ExecutionTypes.js';

const DEFAULT_RETENTION_DAYS = 30;

/**
 * Storage back-end abstraction so the collector can be tested without
 * touching the real filesystem and later extended to S3 / GCS.
 */
export interface ArtifactStorage {
  save(path: string, content: Buffer): Promise<void>;
  size(path: string): Promise<number>;
}

/**
 * Collects and stores test artifacts (screenshots, page source, logs).
 *
 * DB stores only ArtifactRef metadata; the binary content goes to
 * `outputDir` via the configured storage back-end.  This matches the
 * plan's separation: never store large blobs directly in the database.
 */
export class ArtifactCollector {
  constructor(
    private readonly outputDir: string,
    private readonly storage: ArtifactStorage = new LocalArtifactStorage(),
    private readonly retentionDays: number = DEFAULT_RETENTION_DAYS,
  ) {}

  async saveScreenshot(name: string, data: string | Buffer): Promise<ArtifactRef> {
    const buf = typeof data === 'string' ? Buffer.from(data, 'base64') : data;
    return this.save(name, 'screenshot', buf, 'image/png', '.png');
  }

  async savePageSource(name: string, content: string): Promise<ArtifactRef> {
    return this.save(name, 'page-source', Buffer.from(content, 'utf-8'), 'text/xml', '.xml');
  }

  async saveDom(name: string, content: string): Promise<ArtifactRef> {
    return this.save(name, 'dom', Buffer.from(content, 'utf-8'), 'text/html', '.html');
  }

  async saveLog(name: string, content: string): Promise<ArtifactRef> {
    return this.save(name, 'log', Buffer.from(content, 'utf-8'), 'text/plain', '.txt');
  }

  // ── private ────────────────────────────────────────────────────────────────

  private async save(
    name: string,
    type: ArtifactRef['type'],
    content: Buffer,
    mimeType: string,
    ext: string,
  ): Promise<ArtifactRef> {
    const id = `${sanitize(name)}-${Date.now()}`;
    const filename = `${id}${ext}`;
    const path = join(this.outputDir, filename);

    await this.storage.save(path, content);
    const sizeBytes = await this.storage.size(path);
    const checksum = createHash('sha256').update(content).digest('hex');
    const retentionUntil = new Date(
      Date.now() + this.retentionDays * 86_400_000,
    ).toISOString();

    return {
      id,
      type,
      storageUri: `file://${resolvePath(path)}`,
      mimeType,
      sizeBytes,
      checksum,
      retentionUntil,
    };
  }
}

// ── storage back-ends ─────────────────────────────────────────────────────────

export class LocalArtifactStorage implements ArtifactStorage {
  async save(path: string, content: Buffer): Promise<void> {
    const dir = path.substring(0, path.lastIndexOf('/'));
    await mkdir(dir, { recursive: true });
    await writeFile(path, content);
  }

  async size(path: string): Promise<number> {
    const s = await stat(path);
    return s.size;
  }
}

/**
 * In-memory storage for tests — no disk I/O, no temp-file cleanup.
 */
export class InMemoryArtifactStorage implements ArtifactStorage {
  readonly files = new Map<string, Buffer>();

  async save(path: string, content: Buffer): Promise<void> {
    this.files.set(path, content);
  }

  async size(path: string): Promise<number> {
    return this.files.get(path)?.length ?? 0;
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}
