import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '@/test/utils';
import { server } from '@/test/mocks/server';
import { ROUTES } from '@/api/routes';
import { stateFixture } from '@/test/mocks/fixtures';
import HistoryPanel from '@/panels/History';

/**
 * Trang lịch sử workflow chỉ có một link mở thẳng file HTML. Nhưng thứ người ta
 * cần khi đi tìm nguyên nhân là ảnh lúc fail, video, network log — tức trang chi
 * tiết trong app. Và phần lớn lượt chạy không có link nào cả, vì chúng không
 * sinh được report; khoảng trống đó bắt người đọc tự đoán là chưa có hay đã mất.
 */
const run = (over: Record<string, unknown> = {}) => ({
  id: 'wf-1',
  kind: 'workflow',
  feature: 'Chuyển tiền nội bộ',
  status: 'passed',
  startedAt: '2026-09-08T04:00:00.000Z',
  stages: [{ name: 'Sinh bộ testcase', status: 'done' }],
  stagesDone: 1,
  log: [],
  runDirs: ['rep-1'],
  ...over,
});

const render = async (over: Record<string, unknown> = {}) => {
  server.use(
    http.get(ROUTES.state, () =>
      HttpResponse.json({
        ...stateFixture,
        runs: [run(over)],
        reports: [
          { id: 'rep-1', platform: 'web', status: 'failed', url: '/runs/rep-1/index.html', startedAt: '2026-09-08T04:05:00.000Z' },
        ],
      }),
    ),
  );
  return renderWithRouter(<HistoryPanel />, { path: '/scenarios/history' });
};

describe('Lịch sử workflow — đường tới report', () => {
  it('có lối vào trang chi tiết trong app, đúng report của lượt đó', async () => {
    await render();
    const link = await screen.findByRole('link', { name: /Chi tiết \(web\)/ });
    expect(link.getAttribute('href')).toContain('runId=rep-1');
  });

  it('vẫn giữ lối mở file report gốc', async () => {
    await render();
    const raw = await screen.findByRole('link', { name: 'Report gốc' });
    expect(raw.getAttribute('href')).toBe('/runs/rep-1/index.html');
  });

  it('không sinh được report thì nói ra, không để trống', async () => {
    await render({ runDirs: [] });
    expect(await screen.findByText('Lượt chạy này không sinh được report.')).toBeInTheDocument();
  });

  /** Cùng một dữ liệu thì không nên có hai cách đọc. */
  it('dùng chung danh sách bước với App Studio', async () => {
    await render();
    const list = await screen.findByRole('list', { name: 'Các bước của workflow' });
    expect(within(list).getByText('Sinh bộ testcase')).toBeInTheDocument();
  });
});
