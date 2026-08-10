import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { SourceDoc } from './types.js';

/**
 * Fallback ingest: read documents that were exported to `docs/` by hand or by an
 * MCP client running elsewhere.
 *
 * This exists because MCP servers live in the developer's editor, not in a CI
 * container. Local files keep spec generation reproducible in CI, where fetching
 * live Confluence would make yesterday's build unreproducible anyway.
 */
export async function readLocalDocs(dir: string): Promise<SourceDoc[]> {
  if (!existsSync(dir)) {
    throw new Error(
      `No documents found. Either set "mcp" in the config to read Confluence/Figma ` +
        `directly, or export the pages into ${path.resolve(dir)} as .md / .txt / .json.`,
    );
  }
  const entries = (await readdir(dir)).filter((f) => /\.(md|txt|json)$/i.test(f)).sort();
  const docs: SourceDoc[] = [];

  for (const name of entries) {
    const file = path.join(dir, name);
    const raw = await readFile(file, 'utf8');
    if (name.endsWith('.json')) {
      // A JSON export keeps its own metadata (a Figma node dump, usually).
      const o = JSON.parse(raw) as Partial<SourceDoc> & Record<string, unknown>;
      docs.push({
        kind: o.kind === 'figma' ? 'figma' : 'confluence',
        ref: typeof o.ref === 'string' ? o.ref : file,
        title: typeof o.title === 'string' ? o.title : name,
        text: typeof o.text === 'string' ? o.text : JSON.stringify(o, null, 2),
        fetchedAt: new Date().toISOString(),
      });
      continue;
    }
    docs.push({
      kind: 'confluence',
      ref: file,
      title: firstHeading(raw) ?? name,
      text: raw,
      fetchedAt: new Date().toISOString(),
    });
  }

  if (docs.length === 0) throw new Error(`${path.resolve(dir)} has no .md / .txt / .json files.`);
  return docs;
}

function firstHeading(md: string): string | undefined {
  return /^#\s+(.+)$/m.exec(md)?.[1]?.trim();
}
