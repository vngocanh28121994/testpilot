import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithRouter, chooseFromDropdown } from '@/test/utils';
import { server } from '@/test/mocks/server';
import { ROUTES } from '@/api/routes';
import { stateFixture } from '@/test/mocks/fixtures';
import RunnerPanel from '@/panels/Runner';

/**
 * Lịch sử chạy local dài dần theo từng ngày làm việc. Không có bộ lọc thì tìm
 * lại một lượt chạy hôm qua nghĩa là cuộn — và bản cũ đã có lọc theo ngày lẫn
 * theo platform, nên đây là tính năng bị mất chứ không phải tính năng mới.
 */
const reports = [
  { id: 'r-web', platform: 'web', tag: '@smoke', status: 'passed', startedAt: '2026-09-08T03:00:00.000Z', counters: { passed: 3, failed: 0 } },
  { id: 'r-android', platform: 'android', tag: '@feature-x', status: 'failed', startedAt: '2026-09-08T04:00:00.000Z', counters: { passed: 1, failed: 2 } },
];

const render = async () => {
  server.use(
    http.get(ROUTES.state, () => HttpResponse.json({ ...stateFixture, reports })),
  );
  return renderWithRouter(<RunnerPanel />, { path: '/runner' });
};

describe('Lịch sử chạy local — bộ lọc', () => {
  it('mặc định hiện mọi lượt chạy', async () => {
    await render();
    expect(await screen.findByText('@feature-x')).toBeInTheDocument();
    expect(screen.getByText('@smoke')).toBeInTheDocument();
  });

  it('lọc theo platform', async () => {
    await render();
    await screen.findByText('@feature-x');

    await chooseFromDropdown('Lọc theo platform', 'android');

    expect(screen.getByText('@feature-x')).toBeInTheDocument();
    expect(screen.queryByText('@smoke')).not.toBeInTheDocument();
  });

  /**
   * "Không có kết quả" phải nói rõ đang lọc gì, nếu không nó bị đọc thành "chưa
   * chạy bao giờ" — hai chuyện khác hẳn nhau.
   */
  it('khi không khớp thì nói rõ đang lọc theo gì', async () => {
    await render();
    await screen.findByText('@feature-x');

    await chooseFromDropdown('Lọc theo platform', 'ios');

    expect(screen.getByText(/Không có lần chạy nào khớp platform ios/)).toBeInTheDocument();
    expect(screen.queryByText('Chưa có lần chạy local nào.')).not.toBeInTheDocument();
  });

  it('có nút xoá bộ lọc, và chỉ hiện khi đang lọc', async () => {
    const user = userEvent.setup();
    await render();
    await screen.findByText('@feature-x');
    expect(screen.queryByRole('button', { name: 'Xoá bộ lọc' })).not.toBeInTheDocument();

    await chooseFromDropdown('Lọc theo platform', 'android');
    await user.click(screen.getByRole('button', { name: 'Xoá bộ lọc' }));

    expect(screen.getByText('@smoke')).toBeInTheDocument();
  });

  it('không lượt chạy nào thì vẫn nói "chưa chạy bao giờ", không phải "không khớp"', async () => {
    server.use(http.get(ROUTES.state, () => HttpResponse.json({ ...stateFixture, reports: [] })));
    await renderWithRouter(<RunnerPanel />, { path: '/runner' });
    expect(await screen.findByText('Chưa có lần chạy local nào.')).toBeInTheDocument();
  });
});
