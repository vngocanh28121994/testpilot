import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '@/test/utils';
import { server } from '@/test/mocks/server';
import { stateFixture } from '@/test/mocks/fixtures';
import { ROUTES } from '@/api/routes';
import { useJobStore } from '@/stores/jobStore';
import RunnerPanel from '@/panels/Runner';

describe('Runner — lượt local vừa hoàn tất', () => {
  it('giữ log và report khi cache active vẫn còn bản ghi cũ', async () => {
    const runId = '2026-09-13T10-00-00Z-web';
    let attachCalls = 0;
    useJobStore.setState({
      jobs: {
        'local-run': {
          logs: [
            `[run:dir] /tmp/runs/${runId}`,
            '[run:passed] ✓ Đăng nhập thành công',
            '1 pass  0 fail  0 flaky  0 bỏ qua  0 chưa duyệt  0 lỗi đã biết',
          ],
          run: null,
          status: 'done',
          error: null,
          dropped: 0,
          controller: null,
        },
      },
    });
    server.use(
      http.get(ROUTES.state, () =>
        HttpResponse.json({
          ...stateFixture,
          reports: [{
            id: runId,
            platform: 'web',
            status: 'passed',
            kind: 'local',
            startedAt: '2026-09-13T10:00:00.000Z',
            finishedAt: '2026-09-13T10:01:00.000Z',
            counters: { passed: 1, failed: 0, total: 1 },
            url: `/runs/${runId}/index.html`,
            hasLog: true,
            networkLogUrl: null,
          }],
        }),
      ),
      // React Query có thể còn giữ ảnh chụp active tối đa một nhịp refetch.
      http.get(ROUTES.runActive, () =>
        HttpResponse.json({
          runs: [{
            id: 'live-stale',
            label: 'web',
            kind: 'run',
            startedAt: '2026-09-13T10:00:00.000Z',
            lines: 3,
            dropped: 0,
            runDir: runId,
          }],
        }),
      ),
      http.get(ROUTES.runAttach, () => {
        attachCalls += 1;
        return HttpResponse.json({ error: 'Lượt chạy này không còn chạy nữa.' }, { status: 404 });
      }),
      http.get(ROUTES.prereqIosNames, () => HttpResponse.json({ names: {} })),
    );

    await renderWithRouter(<RunnerPanel />, { path: '/runner' });

    expect(await screen.findByText('Đã chạy xong')).toBeInTheDocument();
    expect(screen.getByText(/Đăng nhập thành công/)).toBeInTheDocument();
    expect(screen.queryByText('Lượt chạy này không còn chạy nữa.')).not.toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Xem report' })).toHaveAttribute(
      'href',
      `/runs/${runId}/index.html`,
    );
    await waitFor(() => expect(attachCalls).toBe(0));
  });
});
