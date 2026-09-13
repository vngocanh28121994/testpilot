import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter, chooseFromDropdown } from '@/test/utils';
import { server } from '@/test/mocks/server';
import { sse } from '@/test/mocks/sse';
import { ROUTES, STREAM_ROUTES } from '@/api/routes';
import RunnerPanel from '../index';

describe('Runner — Native Regression', () => {
  it('chuyển khỏi web, khóa đúng scope và giải thích giới hạn thiết bị', async () => {
    await renderWithRouter(<RunnerPanel />, { path: '/runner' });

    await chooseFromDropdown('Loại bộ test', 'Native Regression');

    expect(screen.getByText('@native')).toBeInTheDocument();
    expect(screen.getByText('@regression')).toBeInTheDocument();
    expect(screen.getByText('Khả năng native trên Android')).toBeInTheDocument();
    expect(screen.getByText(/Inject ảnh QR chỉ hỗ trợ Android Emulator/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Lọc theo tag')).not.toBeInTheDocument();
  });

  it('gửi @native+@regression và platform mobile xuống runner', async () => {
    let started: Record<string, unknown> | undefined;
    server.use(
      http.get(ROUTES.preflight, ({ request }) => {
        const platform = new URL(request.url).searchParams.get('platform') ?? 'web';
        return HttpResponse.json({
          platform,
          ok: true,
          checks: [{ name: 'Runner', ok: true, detail: 'Sẵn sàng.' }],
          device: platform === 'web' ? undefined : 'android',
        });
      }),
      http.post(STREAM_ROUTES.run, async ({ request }) => {
        started = await request.json() as Record<string, unknown>;
        return sse([['done', { ok: true }]]);
      }),
    );
    await renderWithRouter(<RunnerPanel />, { path: '/runner' });
    await chooseFromDropdown('Loại bộ test', 'Native Regression');

    const button = screen.getByRole('button', { name: 'Chạy Native Regression' });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);

    await waitFor(() => expect(started).toMatchObject({
      platform: 'android',
      tag: '@native+@regression',
    }));
  });

  it('hiện đúng capability khi chọn iOS', async () => {
    await renderWithRouter(<RunnerPanel />, { path: '/runner' });
    await chooseFromDropdown('Loại bộ test', 'Native Regression');
    await chooseFromDropdown('Platform', 'ios — Appium');

    expect(screen.getByText('Khả năng native trên iOS')).toBeInTheDocument();
    expect(screen.getByText(/iOS Simulator hỗ trợ Touch ID và Face ID/)).toBeInTheDocument();
    expect(screen.getByText(/iOS không inject ảnh camera/)).toBeInTheDocument();
  });
});
