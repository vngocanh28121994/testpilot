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
  trangThaiBuoc: 'passed' | 'failed' | 'unverified' = status,
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
        status: trangThaiBuoc,
        durationMs: 10,
        attempts: 1,
        ...(status === 'failed' ? { error: { message: 'hỏng' } } : {}),
      }],
    }],
  } as unknown as ScenarioResult;
}

async function dungBaoCao(
  results: ScenarioResult[],
  knownIssues: ReadonlyMap<string, string> = new Map(),
): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), 'testpilot-report-'));
  const report: RunReport = {
    runId: 'thu',
    startedAt: '2026-09-12T00:00:00.000Z',
    finishedAt: '2026-09-12T00:01:00.000Z',
    results,
    healSuggestions: [],
    quarantined: [],
  };
  await writeHtmlReport(report, [], dir, knownIssues);
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
   * Ca xanh trơn — không video, không gì cả — vẫn phải dẫn đi đâu đó.
   *
   * Bản đầu của mục này để ca xanh không có khối chi tiết nào, nên tên nó là
   * chữ thường và bảy trong mười một dòng của một lượt chạy thật không bấm được.
   * Từ khi có mục "Bằng chứng kịch bản xanh" thì mọi dòng đều có đích.
   */
  it('ca xanh trơn vẫn dẫn tới khối bằng chứng của nó', async () => {
    const html = await dungBaoCao([kichBan('x', 'Ca xanh trơn', 'passed')]);
    const chet = [...lienKet(html)].filter((href) => !neo(html).has(href));
    assert.deepEqual(chet, [], `liên kết không có đích: ${chet.join(', ')}`);
    assert.equal(lienKet(html).size, 1, 'dòng nào cũng phải bấm được');
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

  /**
   * `verdictOf` chỉ nhìn passed/failed, nên một lượt chạy chứa bước
   * `unverified` vẫn ra verdict "passed". Sự thật nằm ở một mục khác tít bên
   * dưới trang, mà người đọc bảng không có lý do gì để cuộn xuống tìm — trên
   * thực tế đó là một dòng xanh không ai chất vấn.
   */
  it('dòng xanh có bước chưa chứng minh được thì phải nói ra ngay tại dòng', async () => {
    const result = kichBan('u', 'Ca xanh nhưng có bước mù', 'passed', undefined, 'unverified');
    result.runs[0]!.steps[0]!.unverifiedReason =
      'Điều kiện đã đúng trước thao tác và trạng thái quan sát được không đổi.';
    const html = await dungBaoCao([result]);
    assert.match(html, /hành động chưa có bằng chứng thay đổi/, 'dòng bảng phải mang cảnh báo');
    assert.match(html, /Điều kiện đã đúng trước thao tác/, 'khối bằng chứng phải giải thích nguyên nhân');
  });

  it('bung <details> đang đóng rồi mới cuộn', async () => {
    const html = await dungBaoCao([kichBan('a', 'Ca đỏ', 'failed')]);
    assert.match(html, /dich\.tagName === 'DETAILS'[\s\S]{0,80}dich\.open = true/);
    assert.match(html, /scrollIntoView/);
  });

  it('dùng cùng nhãn FAIL/PASS và xếp chi tiết theo thời gian chạy', async () => {
    const failSau = kichBan('late-fail', 'Fail chạy sau', 'failed');
    failSau.runs[0]!.startedAt = '2026-09-12T00:00:30.000Z';
    const failTruoc = kichBan('early-fail', 'Fail chạy trước', 'failed');
    failTruoc.runs[0]!.startedAt = '2026-09-12T00:00:10.000Z';
    const pass = kichBan('pass', 'Case xanh', 'passed');
    const html = await dungBaoCao([failSau, pass, failTruoc]);

    assert.match(html, /evidence-badge failed">FAIL</);
    assert.match(html, /evidence-badge passed">PASS</);
    assert.ok(
      html.indexOf('Fail chạy trước</strong>') < html.indexOf('Fail chạy sau</strong>'),
      'case chạy trước phải đứng trước dù kết quả đầu vào đang lộn xộn',
    );
  });

  it('mọi case trong report gốc đều nói rõ header có thể mở chi tiết', async () => {
    const html = await dungBaoCao([
      kichBan('fail', 'Ca đỏ', 'failed'),
      kichBan('pass', 'Ca xanh', 'passed'),
    ]);

    assert.equal(
      [...html.matchAll(/class="evidence-action">Xem\/ẩn chi tiết/g)].length,
      2,
      'cả case pass và fail đều phải có affordance mở chi tiết',
    );
    assert.match(html, /details\[open\] > \.evidence-head \.evidence-chevron/);
  });

  it('tách Known issue khỏi failed nhưng vẫn giữ chi tiết và lý do', async () => {
    const html = await dungBaoCao([
      kichBan('known', 'Sản phẩm chưa đáp ứng', 'failed'),
      kichBan('real', 'Test hỏng thật', 'failed'),
      kichBan('pass', 'Case xanh', 'passed'),
    ], new Map([['known', 'Chưa nằm trong kế hoạch sản phẩm']]));

    assert.match(html, /class="tile failed"><b>1<\/b>failed/);
    assert.match(html, /class="tile known"><b>1<\/b>known issue/);
    assert.match(html, /class="v-known">known issue<\/td>/);
    const failSection = html.slice(html.indexOf('<h2>Case fail</h2>'), html.indexOf('<h2>Known issue</h2>'));
    const knownSection = html.slice(html.indexOf('<h2>Known issue</h2>'), html.indexOf('<h2>Case pass</h2>'));
    assert.match(failSection, /Test hỏng thật/);
    assert.doesNotMatch(failSection, /Sản phẩm chưa đáp ứng/);
    assert.match(knownSection, /KNOWN ISSUE/);
    assert.match(knownSection, /Sản phẩm chưa đáp ứng/);
    assert.match(knownSection, /Lý do:<\/strong> Chưa nằm trong kế hoạch sản phẩm/);
  });

  it('đặt video testcase trong chính case và chỉ để video toàn thiết bị ở mục riêng', async () => {
    const html = await dungBaoCao([
      kichBan('pass-video', 'Case xanh có video', 'passed', 'video/case-xanh.webm'),
    ]);
    const caseSection = html.slice(
      html.indexOf('<h2>Case pass</h2>'),
      html.indexOf('<h2>Bản ghi toàn bộ thiết bị</h2>'),
    );
    const wholeRunSection = html.slice(
      html.indexOf('<h2>Bản ghi toàn bộ thiết bị</h2>'),
      html.indexOf('<h2>Locator healing'),
    );
    assert.match(caseSection, /case-xanh\.webm/);
    assert.doesNotMatch(wholeRunSection, /case-xanh\.webm/);
    assert.match(wholeRunSection, /<!--device-recordings-->/);
  });
});
