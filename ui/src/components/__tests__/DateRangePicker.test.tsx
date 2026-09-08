import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import { DateRangePicker } from '../DateRangePicker';

/**
 * Lịch từng là một <div> tự bật/tắt, chỉ đóng khi bấm đúng cái nút đã mở nó.
 * Bấm ra ngoài hay bấm Escape đều không đóng, nên nó che mất phần bảng ngay bên
 * dưới và người dùng phải quay lại tìm đúng cái nút để thoát.
 */
describe('DateRangePicker', () => {
  const open = async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button type="button">bên ngoài</button>
        <DateRangePicker value={undefined} onChange={vi.fn()} />
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'Lọc theo ngày' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    return user;
  };

  it('mở lịch khi bấm nút', async () => {
    await open();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('đóng khi bấm ra ngoài', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'bên ngoài' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('đóng khi bấm Escape', async () => {
    const user = await open();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('nhãn nút nói rõ đang lọc gì', () => {
    render(
      <DateRangePicker
        value={{ from: new Date('2026-09-01'), to: new Date('2026-09-08') }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Lọc theo ngày' })).toHaveTextContent(
      '01/09/2026 — 08/09/2026',
    );
  });

  it('chưa chọn gì thì nói "Tất cả ngày", không để trống', () => {
    render(<DateRangePicker value={undefined} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Lọc theo ngày' })).toHaveTextContent('Tất cả ngày');
  });
});
