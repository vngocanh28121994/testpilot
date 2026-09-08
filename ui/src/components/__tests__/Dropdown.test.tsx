import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import { Dropdown } from '../Dropdown';

const OPTIONS = [
  { value: 'android', label: 'android' },
  { value: 'ios', label: 'ios' },
];

describe('Dropdown', () => {
  it('hiện giá trị đang chọn', () => {
    render(<Dropdown value="ios" onChange={vi.fn()} options={OPTIONS} aria-label="Hệ điều hành" />);
    expect(screen.getByRole('combobox', { name: 'Hệ điều hành' })).toHaveTextContent('ios');
  });

  /**
   * Danh sách phải là DOM của trang, không phải popup của hệ điều hành: đó là
   * lý do tồn tại của component này. Test đọc được các mục nghĩa là chúng nằm
   * trong tài liệu và tô kiểu được — điều không đúng với <select> gốc.
   */
  it('xổ danh sách nằm trong trang và chọn được', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Dropdown value="ios" onChange={onChange} options={OPTIONS} aria-label="Hệ điều hành" />);

    await user.click(screen.getByRole('combobox', { name: 'Hệ điều hành' }));
    await user.click(await screen.findByRole('option', { name: 'android' }));

    expect(onChange).toHaveBeenCalledWith('android');
  });

  it('không mở khi bị vô hiệu hoá', async () => {
    const user = userEvent.setup();
    render(<Dropdown value="ios" onChange={vi.fn()} options={OPTIONS} disabled aria-label="Hệ điều hành" />);
    await user.click(screen.getByRole('combobox', { name: 'Hệ điều hành' }));
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });
});

/**
 * Radix dành chuỗi rỗng cho "chưa chọn gì" và ném lỗi nếu một mục mang value="".
 * Nhưng các bộ lọc của trang dùng đúng chuỗi rỗng làm một lựa chọn thật, nên
 * việc quy đổi phải nằm trong component — không thì mỗi trang tự bịa một hằng.
 */
describe('Dropdown — lựa chọn mang giá trị rỗng', () => {
  const WITH_EMPTY = [
    { value: '', label: 'Tất cả tag' },
    { value: '@web', label: '@web' },
  ];

  it('hiện được lựa chọn có giá trị rỗng mà không nổ', () => {
    render(<Dropdown value="" onChange={vi.fn()} options={WITH_EMPTY} aria-label="Lọc theo tag" />);
    expect(screen.getByRole('combobox', { name: 'Lọc theo tag' })).toHaveTextContent('Tất cả tag');
  });

  it('trả lại đúng chuỗi rỗng cho chỗ gọi, không phải giá trị nội bộ', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Dropdown value="@web" onChange={onChange} options={WITH_EMPTY} aria-label="Lọc theo tag" />);

    await user.click(screen.getByRole('combobox', { name: 'Lọc theo tag' }));
    await user.click(await screen.findByRole('option', { name: 'Tất cả tag' }));

    expect(onChange).toHaveBeenCalledWith('');
  });
});
