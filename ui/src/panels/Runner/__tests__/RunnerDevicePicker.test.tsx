import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { renderWithRouter, chooseFromDropdown } from '@/test/utils';
import { server } from '@/test/mocks/server';
import { sse } from '@/test/mocks/sse';
import { ROUTES, STREAM_ROUTES } from '@/api/routes';
import RunnerPanel from '../index';

/**
 * Danh sách máy đến từ SỔ MÁY (`/api/device/targets`), không từ preflight.
 *
 * Preflight đo chiếc máy tính đang chạy server; `candidates` của nó là `id`
 * trong config của máy chủ. Từ lúc điện thoại có thể cắm ở laptop người khác,
 * những `id` ấy không trỏ tới được chiếc máy người dùng đang nhìn — nên chỗ
 * chọn máy đọc sổ, và thứ gửi đi là `udid`.
 */
const twoDevices = () => [
  http.get(ROUTES.deviceTargets, () =>
    HttpResponse.json({
      devices: [
        {
          platform: 'android', udid: 'emulator-5554', label: 'pixel',
          runnerName: 'máy chủ', ready: true,
        },
        {
          platform: 'android', udid: 'R5CT10', label: 'samsung',
          runnerName: 'laptop của Bình', ready: true,
        },
      ],
    })),
  http.get(ROUTES.preflight, () =>
    HttpResponse.json({
      platform: 'android',
      ok: true,
      checks: [{ name: 'Thiết bị Android', ok: true, detail: 'Hai máy đang cắm.' }],
    })),
];

async function chooseAndroid() {
  await chooseFromDropdown('Platform', 'android — Appium');
}

/**
 * Runner mắc đúng lỗi Studio đã mắc: đọc `device` mà preflight tự suy ra, rồi
 * bỏ qua danh sách máy. Cắm hai máy là preflight từ chối đoán, và không có ô nào
 * để trả lời — lượt chạy bị chặn cứng ngay trên màn hình biết rõ câu hỏi là gì.
 */
describe('Runner — chọn máy', () => {
  it('hiện ô chọn máy khi nhiều máy cùng cắm', async () => {
    server.use(...twoDevices());
    await renderWithRouter(<RunnerPanel />, { path: '/runner' });
    await chooseAndroid();
    // Kèm tên máy tính: "samsung" một mình không nói được nó nằm ở đâu, mà đó
    // là câu phải trả lời trước khi bấm chạy.
    expect(await screen.findByRole('radio', { name: 'samsung — laptop của Bình' }))
      .toBeInTheDocument();
  });

  it('lượt chạy đi đúng máy vừa chọn, gọi theo udid', async () => {
    let started: unknown = null;
    server.use(
      ...twoDevices(),
      http.post(STREAM_ROUTES.run, async ({ request }) => {
        started = await request.json();
        return sse([['done', { ok: true }]]);
      }),
    );
    await renderWithRouter(<RunnerPanel />, { path: '/runner' });
    await chooseAndroid();
    await userEvent.click(
      await screen.findByRole('radio', { name: 'samsung — laptop của Bình' }),
    );
    const run = screen.getByRole('button', { name: 'Chạy test' });
    await waitFor(() => expect(run).toBeEnabled());
    await userEvent.click(run);
    await waitFor(() =>
      expect((started as { devices?: string[] })?.devices).toEqual(['android:R5CT10']),
    );
  });
});
