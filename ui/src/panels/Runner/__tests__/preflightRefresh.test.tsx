import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
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
    const user = userEvent.setup();
    await render();
    const button = await screen.findByRole('button', { name: 'Kiểm tra lại' });

    // Cửa chặn do TEST mở, thay cho `delay(120)`.
    //
    // Trạng thái "đang chạy" chỉ tồn tại đúng bằng thời gian request. Với một
    // độ trễ cố định, test phải nhìn thấy nó trong 120ms tính bằng đồng hồ
    // thật — và khi cả suite chạy song song thì cửa sổ ấy đóng trước khi test
    // kịp nhìn. Đo ngày 2026-09-18: đỏ 2 trên 3 lần chạy đầy đủ, xanh mọi lần
    // chạy riêng. Giữ cửa mở cho tới khi đã khẳng định xong thì không còn gì
    // để đua: request kết thúc đúng lúc test cho phép.
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    server.use(
      http.get(ROUTES.preflight, async () => {
        await held;
        return HttpResponse.json({ platform: 'web', ok: true, checks: [] });
      }),
    );

    await user.click(button);
    // Ngay sau khi bấm, nút đổi nhãn và không bấm chồng được.
    const busy = await screen.findByRole('button', { name: 'Đang kiểm tra…' });
    expect(busy).toBeDisabled();

    // Trả lời nốt, để handler không treo sang ca sau.
    release();
    expect(await screen.findByRole('button', { name: 'Kiểm tra lại' })).toBeEnabled();
  });

  it('xong thì trở lại nhãn cũ', async () => {
    const user = userEvent.setup();
    await render();
    await user.click(await screen.findByRole('button', { name: 'Kiểm tra lại' }));
    expect(await screen.findByRole('button', { name: 'Kiểm tra lại' })).toBeEnabled();
  });
});
