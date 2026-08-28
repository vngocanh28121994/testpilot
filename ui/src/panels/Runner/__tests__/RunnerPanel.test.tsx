import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '@/test/utils';
import { server } from '@/test/mocks/server';
import { stateFixture } from '@/test/mocks/fixtures';
import { sse } from '@/test/mocks/sse';
import { ROUTES, STREAM_ROUTES } from '@/api/routes';
import RunnerPanel from '..';
import type { StateResponse } from '@core/ui/contracts.js';

describe('RunnerPanel — nhiều thiết bị', () => {
  it('chọn hai máy thì gửi cả hai token qualified lên route chạy', async () => {
    const user = userEvent.setup();
    const state = structuredClone(stateFixture) as StateResponse;
    state.config = {
      ...state.config,
      android: {
        deviceName: 'Pixel 7',
        hybrid: false,
        isolation: 'none',
        devices: [
          { id: 'pixel-7', deviceName: 'Pixel 7', udid: 'android-7', systemPort: 8201 },
          { id: 'pixel-8', deviceName: 'Pixel 8', udid: 'android-8', systemPort: 8202 },
        ],
      },
    };
    let body: { devices?: string[] } | undefined;
    server.use(
      http.get(ROUTES.state, () => HttpResponse.json(state)),
      http.get(ROUTES.preflight, () => HttpResponse.json({ platform: 'android', ok: true, checks: [], candidates: [] })),
      http.post(STREAM_ROUTES.run, async ({ request }) => {
        body = await request.json() as { devices?: string[] };
        return sse([['done', { ok: true }]]);
      }),
    );
    await renderWithRouter(<RunnerPanel />, { path: '/runner' });
    await screen.findByText('Sẵn sàng chạy.');
    await user.selectOptions(screen.getByLabelText('Platform'), 'android');
    await screen.findByRole('checkbox', { name: 'Chọn Pixel 7' });
    await user.click(screen.getByRole('checkbox', { name: 'Chọn Pixel 7' }));
    await user.click(screen.getByRole('checkbox', { name: 'Chọn Pixel 8' }));
    await user.click(screen.getByRole('button', { name: 'Chạy test' }));
    await waitFor(() => expect(body?.devices).toEqual(['android:pixel-7', 'android:pixel-8']));
  });

  it('preflight Android fail vẫn hiện nút sửa prerequisite thay vì chỉ báo lỗi', async () => {
    const user = userEvent.setup();
    server.use(
      http.get(ROUTES.preflight, () => HttpResponse.json({
        platform: 'android', ok: false,
        checks: [{ name: 'Appium server', ok: false, detail: 'Chưa chạy.' }],
      })),
    );
    await renderWithRouter(<RunnerPanel />, { path: '/runner' });
    await user.selectOptions(screen.getByLabelText('Platform'), 'android');
    await screen.findByText('Chưa sẵn sàng chạy.');
    expect(screen.getByRole('button', { name: 'Khởi động Appium' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Chạy test' })).toBeDisabled();
  });
});

describe('RunnerPanel — chọn tag cho lượt chạy', () => {
  /**
   * Tag ở đây KHÔNG phải bộ lọc để xem, nó quyết định lượt chạy chạy những gì.
   * Chọn nhầm là chạy nhầm bộ test trên thiết bị thật, nên đường đi từ popover
   * tới body của `/api/run` phải được khoá lại.
   */
  it('tag đã chọn đi vào body của /api/run, ngăn cách bằng dấu phẩy', async () => {
    const user = userEvent.setup();
    server.use(
      http.get(ROUTES.preflight, () =>
        HttpResponse.json({ platform: 'web', ok: true, checks: [], device: 'chromium' }),
      ),
    );
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post(STREAM_ROUTES.run, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return sse([['done', { ok: true }]]);
      }),
    );

    await renderWithRouter(<RunnerPanel />, { path: '/runner' });
    await screen.findByText('Cấu hình lượt chạy');

    // Danh sách tag nằm SAU một nút, không đổ thẳng ra thẻ.
    expect(screen.queryByLabelText('Tìm tag')).not.toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: /^Tất cả tag/ }));
    await user.click(await screen.findByRole('option', { name: /@web/ }));
    await user.click(screen.getByRole('option', { name: /@smoke/ }));
    await user.keyboard('{Escape}');

    // Nút đếm được, và mỗi tag là một chip bỏ được riêng.
    expect(screen.getByRole('button', { name: /đang chọn 2/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bỏ lọc @web' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Chạy test' }));
    await waitFor(() => expect(body).toMatchObject({ platform: 'web', tag: '@web,@smoke' }));
  });

  it('bỏ một chip thì tag đó rời khỏi lượt chạy, tag còn lại giữ nguyên', async () => {
    const user = userEvent.setup();
    await renderWithRouter(<RunnerPanel />, { path: '/runner' });
    await screen.findByText('Cấu hình lượt chạy');

    await user.click(await screen.findByRole('button', { name: /^Tất cả tag/ }));
    await user.click(await screen.findByRole('option', { name: /@web/ }));
    await user.click(screen.getByRole('option', { name: /@smoke/ }));
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Bỏ lọc @web' }));

    expect(screen.queryByRole('button', { name: 'Bỏ lọc @web' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bỏ lọc @smoke' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /đang chọn 1/ })).toBeInTheDocument();
  });
});
