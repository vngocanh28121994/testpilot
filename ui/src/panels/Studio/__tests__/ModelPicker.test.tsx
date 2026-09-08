import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '@/test/utils';
import { server } from '@/test/mocks/server';
import { stateFixture } from '@/test/mocks/fixtures';
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
    await userEvent.setup().click(select);
    expect(await screen.findByRole('option', { name: 'Claude Opus 5' })).toBeInTheDocument();
    expect(screen.getByText(/auto = claude-opus-5/)).toBeInTheDocument();
    expect(screen.getByText(/lấy trực tiếp từ nhà cung cấp/)).toBeInTheDocument();
  });

  it('nói rõ khi đang đoán vì không gọi được nhà cung cấp', async () => {
    server.use(
      http.get(ROUTES.models, () =>
        HttpResponse.json({
          models: [{ id: 'claude-opus-5' }],
          live: false,
          reason: 'connect ETIMEDOUT',
          auto: 'claude-opus-5',
        }),
      ),
    );
    await renderWithRouter(<StudioPanel />, { path: '/studio' });
    expect(
      await screen.findByText(/đang đoán — connect ETIMEDOUT/),
    ).toBeInTheDocument();
  });

  /**
   * Không có key nào thì đừng dựng <select>: một danh sách Anthropic hiện ra
   * cho người đang chạy DeepSeek là sai theo cả hai chiều, và một <select> chỉ
   * có mỗi "auto" thì khoá họ khỏi chính model họ đang dùng. Gõ tay, kèm lý do.
   */
  it('quay về ô gõ tay và nói thiếu key khi không hỏi được model nào', async () => {
    server.use(
      http.get(ROUTES.models, () =>
        HttpResponse.json({
          models: [],
          live: false,
          reason: 'Server chưa có DEEPSEEK_API_KEY hoặc ANTHROPIC_API_KEY.',
          auto: 'deepseek-chat',
        }),
      ),
    );
    await renderWithRouter(<StudioPanel />, { path: '/studio' });
    expect(
      await screen.findByText(/Chưa hỏi được model nào — Server chưa có DEEPSEEK_API_KEY/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Model' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Model' })).toBeInTheDocument();
  });

  /**
   * Model đang lưu mà biến mất khỏi danh sách vẫn phải hiện ra. Một dropdown
   * không chứa giá trị hiện tại sẽ hiện ra trống hoặc nhảy về mục đầu, và cú
   * lưu kế tiếp ghi đè cấu hình bằng thứ người dùng chưa từng chọn.
   */
  it('giữ lại model đang lưu dù nó không còn trong danh sách', async () => {
    server.use(
      http.get(ROUTES.models, () =>
        HttpResponse.json({ models: [{ id: 'claude-sonnet-5' }], live: true, auto: 'claude-opus-5' }),
      ),
      // Ghim một model KHÔNG có trong danh sách trả về ở trên — đó chính là
      // tình huống cần kiểm, và fixture mặc định ('auto') không dựng ra được nó.
      http.get(ROUTES.state, () =>
        HttpResponse.json({
          ...stateFixture,
          config: { ...stateFixture.config, llm: { model: 'deepseek-chat', note: '' } },
        }),
      ),
    );
    await renderWithRouter(<StudioPanel />, { path: '/studio' });
    const select = await screen.findByRole('combobox', { name: 'Model' });
    expect(select).toHaveTextContent('deepseek-chat (không còn trong danh sách)');
  });
});
