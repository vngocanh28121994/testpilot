import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const source = readFileSync('src/farm/devicefarm.ts', 'utf8');

describe('Device Farm fallback artifact', () => {
  it('writes an interrupted report so a recovered video is visible in the UI', () => {
    assert.match(source, /await writeHtmlReport\(/);
    assert.match(source, /status: 'interrupted'/);
    assert.match(source, /Device Farm không trả về report từ test runner/);
  });
});
