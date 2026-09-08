import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/server';
import { LazyLog } from '../LazyLog';

/**
 * Log là thứ dài nhất mà lại ít được xem nhất. Trước đây mọi lượt chạy mang
 * trọn log của mình trong mỗi lần gọi /api/state — trả giá sau mỗi thao tác
 * trên trang, cho một thứ chỉ được mở khi có chuyện.
 */
describe('LazyLog', () => {
  const url = '/api/run/log?id=r-1';

  it('chưa bung ra thì chưa gọi mạng', async () => {
    let calls = 0;
    server.use(http.get('/api/run/log', () => { calls += 1; return HttpResponse.text('xong'); }));
    render(<LazyLog url={url} label="Log" />);
    expect(calls).toBe(0);
  });

  it('bung ra thì tải và hiện nội dung', async () => {
    server.use(http.get('/api/run/log', () => HttpResponse.text('[run:passed] ✓ Đăng nhập')));
    const user = userEvent.setup();
    render(<LazyLog url={url} label="Log" />);

    await user.click(screen.getByText('Log'));
    expect(await screen.findByText('✓ Đăng nhập')).toBeInTheDocument();
  });

  /** `<details>` bắn onToggle cả khi đóng, mà người ta đóng mở vài lần là thường. */
  it('chỉ tải đúng một lần dù đóng mở nhiều lần', async () => {
    let calls = 0;
    server.use(http.get('/api/run/log', () => { calls += 1; return HttpResponse.text('nội dung'); }));
    const user = userEvent.setup();
    render(<LazyLog url={url} label="Log" />);

    await user.click(screen.getByText('Log'));
    await screen.findByText('nội dung');
    await user.click(screen.getByText('Log'));
    await user.click(screen.getByText('Log'));

    expect(calls).toBe(1);
  });

  /**
   * Một khung rỗng đọc như "lượt chạy này không có log gì" — chuyện khác hẳn
   * với "không đọc được".
   */
  it('nói ra lỗi ở đúng chỗ log lẽ ra phải nằm', async () => {
    server.use(http.get('/api/run/log', () => HttpResponse.json({ error: 'hỏng' }, { status: 500 })));
    const user = userEvent.setup();
    render(<LazyLog url={url} label="Log" />);

    await user.click(screen.getByText('Log'));
    expect(await screen.findByText(/Không đọc được log/)).toBeInTheDocument();
  });
});
