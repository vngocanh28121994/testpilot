import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { renderWithRouter , chooseFromDropdown } from '@/test/utils';
import { server } from '@/test/mocks/server';
import { sse } from '@/test/mocks/sse';
import { ROUTES, STREAM_ROUTES } from '@/api/routes';
import RunnerPanel from '../index';

const twoDevices = () =>
  http.get(ROUTES.preflight, ({ request }) => {
    const device = new URL(request.url).searchParams.get('device');
    return HttpResponse.json({
      platform: 'android',
      ok: Boolean(device),
      checks: [{ name: 'Thiết bị Android', ok: Boolean(device), detail: 'Hai máy đang cắm.' }],
      candidates: [
        { id: 'pixel', label: 'pixel (emulator-5554)' },
        { id: 'samsung', label: 'samsung (R5CT10)' },
      ],
    });
  });

async function chooseAndroid() {
  await chooseFromDropdown('Platform', 'android — Appium');
}

/**
 * Runner mắc đúng lỗi Studio đã mắc: đọc `device` mà preflight tự suy ra, rồi
 * bỏ qua `candidates`. Cắm hai máy là preflight từ chối đoán, và không có ô nào
 * để trả lời — lượt chạy bị chặn cứng ngay trên màn hình biết rõ câu hỏi là gì.
 */
describe('Runner — chọn máy', () => {
  it('hiện ô chọn máy khi nhiều máy cùng cắm', async () => {
    server.use(twoDevices());
    await renderWithRouter(<RunnerPanel />, { path: '/runner' });
    await chooseAndroid();
    expect(await screen.findByRole('radio', { name: 'samsung (R5CT10)' })).toBeInTheDocument();
  });

  it('dò lại kèm máy vừa chọn, và lượt chạy đi đúng máy đó', async () => {
    let started: unknown = null;
    server.use(
      twoDevices(),
      http.post(STREAM_ROUTES.run, async ({ request }) => {
        started = await request.json();
        return sse([['done', { ok: true }]]);
      }),
    );
    await renderWithRouter(<RunnerPanel />, { path: '/runner' });
    await chooseAndroid();
    await userEvent.click(await screen.findByRole('radio', { name: 'samsung (R5CT10)' }));
    // Chọn xong preflight mới chuyển xanh, và chỉ khi xanh nút mới bấm được.
    const run = screen.getByRole('button', { name: 'Chạy test' });
    await waitFor(() => expect(run).toBeEnabled());
    await userEvent.click(run);
    await waitFor(() =>
      expect((started as { devices?: string[] })?.devices).toEqual(['android:samsung']),
    );
  });
});
