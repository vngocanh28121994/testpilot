import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { server } from '@/test/mocks/server';
import { renderWithRouter , chooseFromDropdown } from '@/test/utils';
import { stateFixture } from '@/test/mocks/fixtures';
import { ROUTES } from '@/api/routes';
import SettingsPanel from '@/panels/Settings';

const ready = () => screen.findByLabelText('Transport');

describe('SettingsPanel', () => {
  /**
   * R9 — bí mật không bao giờ quay lại trình duyệt.
   *
   * Cả hai ô phải BẮT ĐẦU RỖNG kể cả khi server đã có key/token, vì server chỉ
   * gửi cờ. Placeholder và dòng trạng thái là thứ duy nhất nói ra "đã có rồi".
   * Nếu một ngày ô này tự điền sẵn, nghĩa là ai đó đã bắt đầu gửi giá trị thật
   * qua dây — và test này phải đỏ trước khi điều đó lên production.
   */
  it('ô bí mật luôn rỗng, trạng thái nói qua placeholder', async () => {
    await renderWithRouter(<SettingsPanel />);
    await ready();

    const gemini = screen.getByLabelText('Gemini API key');
    expect(gemini).toHaveValue('');
    expect(gemini).toHaveAttribute('placeholder', 'Gemini API key'); // fixture: gemini=false

    const token = await screen.findByLabelText('API token');
    expect(token).toHaveValue('');
    expect(token).toHaveAttribute('placeholder', '•••••••• (token đã lưu)');
    expect(screen.getByText('(đã cấu hình)')).toBeInTheDocument();
    // Email KHÔNG phải bí mật nên được điền lại; token thì không.
    expect(await screen.findByLabelText('Email Atlassian')).toHaveValue('qa@example.com');
  });

  it('hiện đúng câu trạng thái vision key theo modelKeys', async () => {
    await renderWithRouter(<SettingsPanel />);
    await ready();
    // fixture: gemini=false, anthropic=true
    expect(screen.getByText(/Anthropic dự phòng/)).toBeInTheDocument();
  });

  it('đổi theme màu đỏ Techcombank ngay lập tức và lưu lựa chọn', async () => {
    const user = userEvent.setup();
    await renderWithRouter(<SettingsPanel />);
    await ready();

    const techcombank = screen.getByRole('radio', { name: /Đỏ Techcombank/ });
    expect(techcombank).toHaveAttribute('aria-checked', 'false');

    await user.click(techcombank);

    expect(techcombank).toHaveAttribute('aria-checked', 'true');
    expect(document.documentElement).toHaveAttribute('data-color-theme', 'techcombank');
    expect(localStorage.getItem('testpilot-color-theme')).toBe('techcombank');
  });

  it('chỉ hiện trường của transport đang chọn', async () => {
    await renderWithRouter(<SettingsPanel />);
    await ready();

    // Không dùng MCP ⇒ không có trường nào của MCP.
    expect(screen.queryByLabelText('Command')).toBeNull();
    expect(screen.queryByLabelText('URL')).toBeNull();

    await chooseFromDropdown('Transport', 'stdio');
    expect(screen.getByLabelText('Command')).toBeInTheDocument();
    expect(screen.queryByLabelText('URL')).toBeNull();

    await chooseFromDropdown('Transport', 'http');
    expect(screen.getByLabelText('URL')).toBeInTheDocument();
    expect(screen.queryByLabelText('Command')).toBeNull();
  });

  it('gửi config đã ghép lại khi bấm Lưu', async () => {
    const user = userEvent.setup();
    let sent: { paths?: Record<string, string>; mcp?: unknown } | null = null;
    server.use(
      http.put(ROUTES.config, async ({ request }) => {
        sent = (await request.json()) as typeof sent;
        return HttpResponse.json({ ok: true, config: stateFixture.config });
      }),
    );

    await renderWithRouter(<SettingsPanel />);
    await ready();
    await user.clear(screen.getByLabelText('Tài liệu'));
    await user.type(screen.getByLabelText('Tài liệu'), 'tai-lieu/');
    await user.click(screen.getByRole('button', { name: 'Lưu cài đặt' }));

    await waitFor(() => expect(sent).not.toBeNull());
    expect(sent!.paths).toMatchObject({ docs: 'tai-lieu/' });
    // Chưa chọn transport ⇒ mcp bị xoá khỏi config, không phải giữ nguyên.
    expect(sent!.mcp).toBeUndefined();
  });

  /**
   * Lỗi validate của PUT /api/config đến dưới dạng mảng `issues` từ zod. Đây là
   * chỗ nhánh đó thực sự được dùng cho việc gì — mất nó thì màn hình này chỉ
   * còn "Config không hợp lệ".
   */
  it('hiện từng dòng lỗi zod khi lưu hỏng', async () => {
    const user = userEvent.setup();
    server.use(
      http.put(ROUTES.config, () =>
        HttpResponse.json(
          { error: 'Config không hợp lệ', issues: ['paths.docs: không được rỗng'] },
          { status: 400 },
        ),
      ),
    );
    await renderWithRouter(<SettingsPanel />);
    await ready();
    await user.click(screen.getByRole('button', { name: 'Lưu cài đặt' }));
    expect(await screen.findByText('paths.docs: không được rỗng')).toBeInTheDocument();
  });

  it('probe MCP chỉ điền hộ ô còn trống', async () => {
    const user = userEvent.setup();
    await renderWithRouter(<SettingsPanel />);
    await chooseFromDropdown('Transport', 'stdio');

    const figma = screen.getByLabelText('Tool: Figma file');
    await user.type(figma, 'toi-tu-dien');

    await user.click(screen.getByRole('button', { name: 'Kiểm tra kết nối' }));
    await screen.findByText('2 tool khả dụng.');

    // Ô trống được điền từ guess…
    expect(screen.getByLabelText('Tool: Confluence page')).toHaveValue('confluence_get_page');
    // …còn ô người dùng đã gõ thì KHÔNG bị ghi đè.
    expect(figma).toHaveValue('toi-tu-dien');
  });

  it('không gửi model-key khi ô rỗng', async () => {
    const user = userEvent.setup();
    let called = false;
    server.use(
      http.post(ROUTES.modelKey, () => {
        called = true;
        return HttpResponse.json({ ok: true });
      }),
    );
    await renderWithRouter(<SettingsPanel />);
    await ready();
    await user.click(screen.getByRole('button', { name: 'Lưu vision key' }));
    expect(called).toBe(false);
    expect(screen.getByText('Nhập key mới hoặc giữ nguyên key đã lưu.')).toBeInTheDocument();
  });

  it('xoá ô key sau khi lưu thành công', async () => {
    const user = userEvent.setup();
    await renderWithRouter(<SettingsPanel />);
    await ready();
    const gemini = screen.getByLabelText('Gemini API key');
    await user.type(gemini, 'AIza-bi-mat');
    await user.click(screen.getByRole('button', { name: 'Lưu vision key' }));
    // Không giữ lại giá trị bí mật trong DOM sau khi đã gửi đi.
    await waitFor(() => expect(gemini).toHaveValue(''));
  });

  it('hiện lỗi config khi file config hỏng', async () => {
    server.use(
      http.get(ROUTES.state, () =>
        HttpResponse.json({ ...stateFixture, configError: 'thiếu web.baseUrl' }),
      ),
    );
    await renderWithRouter(<SettingsPanel />);
    expect(await screen.findByRole('alert')).toHaveTextContent('thiếu web.baseUrl');
  });
});
