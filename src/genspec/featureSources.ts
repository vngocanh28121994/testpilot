import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SourceDoc } from '../ingest/types.js';

export interface FeatureSourceEntry {
  sourceKey: string;
  refs: string[];
  file: string;
  featureId: string;
  displayName: string;
  updatedAt: string;
}

interface FeatureSourceDb {
  version: 1;
  entries: Record<string, FeatureSourceEntry>;
}

const emptyDb = (): FeatureSourceDb => ({ version: 1, entries: {} });

/**
 * Durable ownership of generated feature files.
 *
 * Model-written Feature names are presentation text. They must never decide
 * whether a regeneration overwrites the existing specification or creates a
 * second copy. Source keys are stable across wording changes, so one document
 * continues to own one canonical file.
 */
export class FeatureSourceStore {
  private dirty = false;

  private constructor(
    private readonly file: string,
    private readonly db: FeatureSourceDb,
  ) {}

  static async load(file: string): Promise<FeatureSourceStore> {
    if (!existsSync(file)) return new FeatureSourceStore(file, emptyDb());
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<FeatureSourceDb>;
      return new FeatureSourceStore(file, { version: 1, entries: parsed.entries ?? {} });
    } catch (error) {
      // Fail closed. Forgetting ownership on a corrupt registry is exactly how
      // the same document would start producing duplicate feature files again.
      throw new Error(`Không đọc được feature source registry ${file}: ${(error as Error).message}`);
    }
  }

  entry(docs: SourceDoc[]): FeatureSourceEntry | undefined {
    return this.db.entries[featureSourceKey(docs)];
  }

  bind(docs: SourceDoc[], file: string, displayName: string): FeatureSourceEntry {
    const sourceKey = featureSourceKey(docs);
    const existing = this.db.entries[sourceKey];
    const now = new Date().toISOString();
    const entry: FeatureSourceEntry = {
      sourceKey,
      refs: [...new Set(docs.map((doc) => canonicalSourceRef(doc.ref)))].sort(),
      file: path.basename(existing?.file ?? file),
      featureId: existing?.featureId ?? path.basename(file, '.feature'),
      displayName: displayName.trim() || existing?.displayName || path.basename(file, '.feature'),
      updatedAt: now,
    };
    this.db.entries[sourceKey] = entry;
    this.dirty = true;
    return entry;
  }

  async save(): Promise<void> {
    if (!this.dirty && existsSync(this.file)) return;
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(this.db, null, 2) + '\n', 'utf8');
    this.dirty = false;
  }
}

export function featureSourceKey(docs: SourceDoc[]): string {
  const primary = docs[0];
  if (!primary) return 'source:empty';
  // The first document is the generation root (the rest can be linked Figma
  // evidence). A newly discovered attachment must not change feature identity.
  return canonicalSourceRef(primary.ref);
}

/** Stable requirement identity even when source-unit numbering changes. */
export function requirementSourceKey(sourceRef: string, sourceQuote: string): string {
  const material = `${canonicalSourceRef(sourceRef)}\n${normaliseQuote(sourceQuote)}`;
  return `req:${createHash('sha256').update(material).digest('hex').slice(0, 20)}`;
}

export function canonicalSourceRef(raw: string): string {
  try {
    const url = new URL(raw);
    const confluence = url.pathname.match(/\/pages\/(\d+)(?:\/|$)/u);
    if (confluence?.[1]) return `confluence:${url.hostname.toLowerCase()}:${confluence[1]}`;
    const figma = url.pathname.match(/\/(?:file|design)\/([^/]+)/u);
    if (figma?.[1]) return `figma:${url.hostname.toLowerCase()}:${figma[1]}`;
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/+$/u, '') || '/';
    return url.toString();
  } catch {
    return raw.trim().replace(/\/+$/u, '');
  }
}

function normaliseQuote(value: string): string {
  return value
    .normalize('NFC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase('vi-VN');
}
