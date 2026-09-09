import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { http, HttpResponse, delay } from 'msw';
import { server } from '@/test/mocks/server';
import { ROUTES } from '@/api/routes';
import { renderWithRouter } from '@/test/utils';
import RunnerPanel from '@/panels/Runner';

/**
 * Nút "Kiểm tra lại" phải cho thấy nó đã làm gì.
 *
 * Kết quả preflight thường KHÔNG đổi sau khi bấm — máy vẫn thế, Appium vẫn thế
 * — nên nếu màn hình đứng im thì người dùng không phân biệt được "đã kiểm rồi,
 * vẫn vậy" với "nút hỏng". Trước đây dòng "Đang kiểm tra…" chỉ gắn với
 * `isPending`, mà cờ đó chỉ đúng ở lần tải ĐẦU: mọi lần bấm sau đều im lặng.
 */
const render = () => renderWithRouter(<RunnerPanel />, { path: '/runner' });

describe('Kiểm tra lại', () => {
  it('để lại dấu thời gian, kể cả khi kết quả không đổi', async () => {
    await render();
    expect(await screen.findByText(/đã kiểm lúc \d/)).toBeInTheDocument();
  });

  it('bấm thì nút tự khoá và nói đang chạy', async () => {
    // Mock trả lời tức thì thì trạng thái "đang chạy" nháy qua trong một frame.
    // Thêm độ trễ để test đo được đúng thứ người dùng nhìn thấy trên máy thật,
    // nơi mỗi lần dò mất khoảng 150ms.
    server.use(
      http.get(ROUTES.preflight, async () => {
        await delay(120);
        return HttpResponse.json({ platform: 'web', ok: true, checks: [] });
      }),
    );
    const user = userEvent.setup();
    await render();
    const button = await screen.findByRole('button', { name: 'Kiểm tra lại' });
    await user.click(button);
    // Ngay sau khi bấm, nút đổi nhãn và không bấm chồng được.
    const busy = await screen.findByRole('button', { name: 'Đang kiểm tra…' });
    expect(busy).toBeDisabled();
  });

  it('xong thì trở lại nhãn cũ', async () => {
    const user = userEvent.setup();
    await render();
    await user.click(await screen.findByRole('button', { name: 'Kiểm tra lại' }));
    expect(await screen.findByRole('button', { name: 'Kiểm tra lại' })).toBeEnabled();
  });
});
