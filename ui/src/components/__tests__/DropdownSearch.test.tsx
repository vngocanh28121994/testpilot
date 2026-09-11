import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { Dropdown } from '../Dropdown';

/**
 * Danh sách feature file đã hơn chục mục và còn dài ra. Cuộn tay tìm
 * `kiem-tra-hieu-qua-dau-tu-phai-sinh.feature` giữa chúng là việc không ai muốn
 * làm lần thứ hai.
 */
const files = Array.from({ length: 12 }, (_, i) => ({
  value: `f${i}`,
  label: `feature-${i}.feature`,
}));

describe('Dropdown — tìm trong danh sách', () => {
  it('danh sách ngắn thì không có ô tìm', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <Dropdown aria-label="Trạng thái" value="" onChange={vi.fn()} options={files.slice(0, 4)} />,
    );
    await user.click(screen.getByRole('combobox', { name: 'Trạng thái' }));
    expect(screen.queryByLabelText('Tìm trong danh sách')).not.toBeInTheDocument();
  });

  it('danh sách dài thì tự có ô tìm và lọc được', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <Dropdown aria-label="Feature file" value="" onChange={vi.fn()} options={files} />,
    );
    await user.click(screen.getByRole('combobox', { name: 'Feature file' }));

    const box = screen.getByLabelText('Tìm trong danh sách');
    await user.type(box, 'feature-11');
    expect(screen.getByText('feature-11.feature')).toBeInTheDocument();
    expect(screen.queryByText('feature-2.feature')).not.toBeInTheDocument();
  });

  /**
   * Radix có sẵn typeahead: gõ chữ là nó nhảy tới mục khớp và nuốt luôn phím.
   * Không chặn thì ô tìm gõ được đúng một ký tự.
   */
  it('gõ được nhiều ký tự, không bị typeahead nuốt', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <Dropdown aria-label="Feature file" value="" onChange={vi.fn()} options={files} />,
    );
    await user.click(screen.getByRole('combobox', { name: 'Feature file' }));
    const box = screen.getByLabelText('Tìm trong danh sách');
    await user.type(box, 'ature-1');
    expect(box).toHaveValue('ature-1');
  });

  it('không khớp gì thì nói ra, không để trống trơ', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <Dropdown aria-label="Feature file" value="" onChange={vi.fn()} options={files} />,
    );
    await user.click(screen.getByRole('combobox', { name: 'Feature file' }));
    await user.type(screen.getByLabelText('Tìm trong danh sách'), 'khong-co-dau');
    expect(screen.getByText('Không có mục nào khớp.')).toBeInTheDocument();
  });
});
