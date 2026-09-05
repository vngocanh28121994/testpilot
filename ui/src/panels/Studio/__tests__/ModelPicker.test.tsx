import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '@/test/utils';
import { server } from '@/test/mocks/server';
import { ROUTES } from '@/api/routes';
import StudioPanel from '../index';

/**
 * Ô Model từng là ô gõ tay. Gõ sai tên model thì phải đợi tới lúc chạy — sau
 * khi đã đọc tài liệu và gọi model một lần — mới biết là sai.
 */
describe('Studio — chọn model', () => {
  it('đổ danh sách model và nói rõ auto là model nào', async () => {
    await renderWithRouter(<StudioPanel />, { path: '/studio' });
    // Cả tiêu đề thẻ lẫn nhãn ô đều là chữ "Model", nên hỏi theo vai trò.
    const select = await screen.findByRole('combobox', { name: 'Model' });
    expect(select.tagName).toBe('SELECT');
    expect(await screen.findByRole('option', { name: 'Claude Opus 5' })).toBeInTheDocument();
    expect(screen.getByText(/auto = claude-opus-5/)).toBeInTheDocument();
    expect(screen.getByText(/lấy trực tiếp từ nhà cung cấp/)).toBeInTheDocument();
  });

  it('nói rõ khi đang dùng danh sách mặc định và vì sao', async () => {
    server.use(
      http.get(ROUTES.models, () =>
        HttpResponse.json({
          models: [{ id: 'claude-opus-5' }],
          live: false,
          reason: 'Server chưa có ANTHROPIC_API_KEY.',
          auto: 'claude-opus-5',
        }),
      ),
    );
    await renderWithRouter(<StudioPanel />, { path: '/studio' });
    expect(
      await screen.findByText(/danh sách mặc định — Server chưa có ANTHROPIC_API_KEY./),
    ).toBeInTheDocument();
  });

  /**
   * Model đang lưu mà biến mất khỏi danh sách vẫn phải hiện ra: một <select>
   * không có giá trị hiện tại sẽ lặng lẽ nhảy về mục đầu, và cú lưu kế tiếp
   * ghi đè cấu hình bằng thứ người dùng chưa từng chọn.
   */
  it('giữ lại model đang lưu dù nó không còn trong danh sách', async () => {
    server.use(
      http.get(ROUTES.models, () =>
        HttpResponse.json({ models: [{ id: 'claude-sonnet-5' }], live: true, auto: 'claude-opus-5' }),
      ),
    );
    await renderWithRouter(<StudioPanel />, { path: '/studio' });
    const select = (await screen.findByRole('combobox', { name: 'Model' })) as HTMLSelectElement;
    const saved = select.value;
    expect([...select.options].some((o) => o.value === saved)).toBe(true);
  });
});
