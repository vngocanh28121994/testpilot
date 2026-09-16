import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { RunReport } from '../../core/types.js';
import { REPORT_RENDER_MARKER } from '../html.js';
import { refreshHtmlReportIfStale } from '../refresh.js';

describe('nâng phiên bản report lịch sử', () => {
  it('dựng lại HTML cũ, giữ JSON và phân loại known issue theo đúng content hash', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'testpilot-refresh-report-'));
    const report = {
      runId: 'old-run', startedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:01:00Z',
      status: 'completed', healSuggestions: [], quarantined: [],
      results: [{
        scenario: {
          id: 'known-case', name: 'Case đã biết', tags: [], platforms: ['web'], contentHash: 'hash-1', steps: [],
        },
        platform: 'web', device: 'Pixel', verdict: 'failed',
        runs: [{ attempt: 1, status: 'failed', startedAt: '2026-01-01T00:00:01Z', durationMs: 1, steps: [] }],
      }],
    } as unknown as RunReport;
    const stored = JSON.stringify({ report, verdicts: [] }, null, 2);
    await writeFile(path.join(dir, 'report.json'), stored);
    await writeFile(path.join(dir, 'index.html'), '<html><body>report cũ</body></html>');

    const changed = await refreshHtmlReportIfStale(dir, {
      active: (id, hash) => id === 'known-case' && hash === 'hash-1' ? { note: 'Chưa hỗ trợ' } : undefined,
    });
    const html = await readFile(path.join(dir, 'index.html'), 'utf8');

    assert.equal(changed, true);
    assert.match(html, new RegExp(REPORT_RENDER_MARKER));
    assert.match(html, /class="v-known">known issue<\/td>/);
    assert.equal(await readFile(path.join(dir, 'report.json'), 'utf8'), stored);
    assert.equal(await refreshHtmlReportIfStale(dir, { active: () => undefined }), false);
  });
});
