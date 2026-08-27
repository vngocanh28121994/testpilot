/**
 * No source file may carry a byte that is not text.
 *
 * A scripted edit wrote two NUL bytes into `executor.ts` while replacing a
 * string. TypeScript compiled it, the tests passed, and the code ran — but
 * `grep` classifies a file containing NUL as binary and reports nothing, so a
 * search for a function that was sitting right there came back empty. Half an
 * hour went into concluding the edit had never applied.
 *
 * The failure mode is what makes this worth a permanent check: nothing broke
 * loudly. The file worked and the tools lied, which is the combination hardest
 * to reason about and cheapest to prevent.
 */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '../..');
const TEXT_EXTENSIONS = new Set(['.ts', '.js', '.mjs', '.cjs', '.json', '.css', '.html']);

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      out.push(...await sourceFiles(full));
    } else if (TEXT_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Control characters that never belong in source.
 *
 * Tab, newline and carriage return are excluded — they are ordinary
 * whitespace. Everything else in the C0 range, plus DEL, is either a scripted
 * edit gone wrong or a paste from somewhere it should not have come from.
 * Written as escapes on purpose: spelled literally, this line would be the
 * first thing the test caught.
 */
const FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;

describe('source files are text', () => {
  it('carries no NUL or stray control byte', async () => {
    const files = await sourceFiles(ROOT);
    assert.ok(files.length > 50, 'phải quét được toàn bộ src/, không phải vài file');

    const offenders: string[] = [];
    for (const file of files) {
      const content = await readFile(file, 'utf8');
      const match = FORBIDDEN.exec(content);
      if (!match) continue;
      const line = content.slice(0, match.index).split('\n').length;
      const code = match[0]!.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase();
      offenders.push(`${path.relative(ROOT, file)}:${line} — U+${code}`);
    }

    assert.deepEqual(
      offenders,
      [],
      'Ký tự điều khiển trong mã nguồn — gần như chắc chắn do một lần sửa bằng script.\n'
      + offenders.join('\n'),
    );
  });

  it('detects the byte it exists to catch', async () => {
    // Proves the check can fail. A guard that has never been seen to fire is
    // indistinguishable from one that cannot.
    assert.ok(FORBIDDEN.test('const a = 1;\u0000'), 'phải bắt được NUL');
    assert.ok(!FORBIDDEN.test('const a = 1;\n\t// chú thích\r\n'), 'khoảng trắng thường phải qua');
  });
});
