import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { server } from '@/test/mocks/server';
import { ROUTES } from '@/api/routes';
import { AuthGate } from '../AuthGate';

/**
 * Máy chủ ở chế độ server từng mở ra một băng đỏ "Máy chủ đang lỗi … Cần đăng
 * nhập." và không có nút nào để bấm. Người mở lần đầu tưởng máy chủ hỏng.
 */
describe('AuthGate', () => {
  it('chế độ server, chưa đăng nhập: hiện màn đăng nhập thay cho app', async () => {
    server.use(http.get(ROUTES.authMe, () =>
      HttpResponse.json({ mode: 'server', authenticated: false, identity: null })));
    renderWithProviders(<AuthGate><p>nội dung app</p></AuthGate>);

    expect(await screen.findByRole('button', { name: /Đăng nhập/ })).toBeInTheDocument();
    expect(screen.queryByText('nội dung app')).not.toBeInTheDocument();
  });

  it('đã đăng nhập: hiện app', async () => {
    server.use(http.get(ROUTES.authMe, () => HttpResponse.json({
      mode: 'server', authenticated: true,
      identity: { userId: 'u1', email: 'a@b.c', role: 'admin', orgId: 'default' },
    })));
    renderWithProviders(<AuthGate><p>nội dung app</p></AuthGate>);

    expect(await screen.findByText('nội dung app')).toBeInTheDocument();
  });

  it('chế độ embedded: không bao giờ hỏi đăng nhập', async () => {
    renderWithProviders(<AuthGate><p>nội dung app</p></AuthGate>);
    expect(await screen.findByText('nội dung app')).toBeInTheDocument();
  });

  it('không liên lạc được máy chủ: nói ra và cho thử lại, không trắng màn', async () => {
    server.use(http.get(ROUTES.authMe, () => HttpResponse.json({}, { status: 502 })));
    renderWithProviders(<AuthGate><p>nội dung app</p></AuthGate>);

    expect(await screen.findByText(/Chưa liên lạc được với máy chủ/, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Thử lại/ })).toBeInTheDocument();
  });
});
