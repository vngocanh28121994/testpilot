/**
 * Bấm tên kịch bản trong bảng phải xuống đúng khối chi tiết của nó.
 *
 * Bảng Scenarios liệt kê mọi kịch bản, còn chi tiết nằm rải ở hai mục bên dưới.
 * Với một lượt chạy mười mấy kịch bản thì tìm khối của một dòng là cuộn và dò
 * bằng mắt, trong khi cái tên cần tìm đang nằm ngay dưới con trỏ.
 *
 * Dựng HTML thật thay vì soi regex trên mã nguồn: thứ hỏng được ở đây là một
 * liên kết trỏ vào cái neo không tồn tại, và chỉ có bản dựng mới nói ra điều đó.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { writeHtmlReport } from '../html.js';
import type { RunReport, ScenarioResult } from '../../core/types.js';

function kichBan(
  id: string,
  ten: string,
  status: 'passed' | 'failed',
  video?: string,
): ScenarioResult {
  return {
    scenario: { id, name: ten, tags: [], steps: [], platforms: ['android'] },
    platform: 'android',
    device: 'SM_S938B',
    verdict: status,
    runs: [{
      attempt: 1,
      status,
      startedAt: '2026-09-12T00:00:00.000Z',
      durationMs: 10,
      ...(video ? { video } : {}),
      steps: [{
        step: { text: 'I open the app', keyword: 'Given', intent: { kind: 'launch' }, line: 5 },
        status,
        durationMs: 10,
        attempts: 1,
        ...(status === 'failed' ? { error: { message: 'hỏng' } } : {}),
      }],
    }],
  } as unknown as ScenarioResult;
}

async function dungBaoCao(results: ScenarioResult[]): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), 'testpilot-report-'));
  const report: RunReport = {
    runId: 'thu',
    startedAt: '2026-09-12T00:00:00.000Z',
    finishedAt: '2026-09-12T00:01:00.000Z',
    results,
    healSuggestions: [],
    quarantined: [],
  };
  await writeHtmlReport(report, [], dir);
  return readFileSync(path.join(dir, 'index.html'), 'utf8');
}

const lienKet = (html: string) =>
  new Set([...html.matchAll(/class="sc-link" href="#([^"]+)"/g)].map((m) => m[1]!));
const neo = (html: string) =>
  new Set([...html.matchAll(/<details id="([^"]+)"/g)].map((m) => m[1]!));

describe('report — bấm kịch bản là xuống chi tiết', () => {
  it('mọi liên kết đều có neo tương ứng', async () => {
    const html = await dungBaoCao([
      kichBan('a', 'Ca đỏ thứ nhất', 'failed'),
      kichBan('b', 'Ca đỏ thứ hai', 'failed'),
      kichBan('c', 'Ca xanh có video', 'passed', 'video/c.mp4'),
    ]);
    const chet = [...lienKet(html)].filter((href) => !neo(html).has(href));
    assert.deepEqual(chet, [], `liên kết không có đích: ${chet.join(', ')}`);
    assert.equal(lienKet(html).size, 3, 'cả ba kịch bản có chi tiết đều phải bấm được');
  });

  /**
   * Một liên kết chết còn tệ hơn không có liên kết: nó hứa một chỗ để tới rồi
   * không đưa đi đâu cả. Kịch bản xanh không quay video thì không có khối chi
   * tiết nào, nên tên nó phải là chữ thường.
   */
  it('kịch bản không có chi tiết thì tên không phải liên kết', async () => {
    const html = await dungBaoCao([kichBan('x', 'Ca xanh trơn', 'passed')]);
    assert.equal(lienKet(html).size, 0);
    assert.match(html, /Ca xanh trơn/, 'tên vẫn phải hiện ra');
  });

  /**
   * Cùng một kịch bản chạy trên nhiều máy cho nhiều khối chi tiết khác nhau;
   * neo thiếu device thì hai dòng cùng trỏ về một chỗ và một trong hai sai.
   */
  it('cùng kịch bản trên hai máy cho hai neo khác nhau', async () => {
    const hai = kichBan('a', 'Ca đỏ', 'failed');
    const html = await dungBaoCao([
      hai,
      { ...hai, device: 'Pixel_8' } as ScenarioResult,
    ]);
    assert.equal(neo(html).size, 2, 'hai máy phải cho hai neo');
  });

  it('bung <details> đang đóng rồi mới cuộn', async () => {
    const html = await dungBaoCao([kichBan('a', 'Ca đỏ', 'failed')]);
    assert.match(html, /dich\.tagName === 'DETAILS'[\s\S]{0,80}dich\.open = true/);
    assert.match(html, /scrollIntoView/);
  });
});
