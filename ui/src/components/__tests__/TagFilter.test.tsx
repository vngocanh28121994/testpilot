import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { TagFilter } from '../TagFilter';

/**
 * "Chạy đúng các case positive của MỘT chức năng" — nhu cầu thường gặp nhất mà
 * dropdown chọn-một không diễn đạt được. Chọn @feature-x thì cả negative chạy
 * theo; chọn @positive thì ra positive của mọi chức năng.
 */
const ALL = ['@feature-chuyen-tien', '@feature-them-ma', '@negative', '@p0', '@positive'];

describe('TagFilter', () => {
  it('tìm được trong danh sách dài', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TagFilter all={ALL} value={[]} onChange={vi.fn()} />);
    await user.type(screen.getByLabelText('Lọc theo tag'), 'chuyen');
    expect(screen.getByRole('button', { name: '@feature-chuyen-tien' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '@positive' })).not.toBeInTheDocument();
  });

  it('chọn thêm tag thứ hai chứ không thay tag thứ nhất', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(
      <TagFilter all={ALL} value={['@feature-chuyen-tien']} onChange={onChange} />,
    );
    await user.click(screen.getByLabelText('Lọc theo tag'));
    await user.click(screen.getByRole('button', { name: '@positive' }));
    expect(onChange).toHaveBeenCalledWith(['@feature-chuyen-tien', '@positive']);
  });

  it('bấm lại một tag đã chọn thì bỏ chọn', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<TagFilter all={ALL} value={['@positive']} onChange={onChange} />);
    await user.click(screen.getByLabelText('Lọc theo tag'));
    await user.click(screen.getByRole('button', { name: '@positive' }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  /** Nói ra ý nghĩa "và", vì bộ lọc nhiều giá trị dễ bị đọc thành "hoặc". */
  it('nói rõ nhiều tag nghĩa là phải có đủ', async () => {
    renderWithProviders(
      <TagFilter all={ALL} value={['@feature-chuyen-tien', '@positive']} onChange={vi.fn()} />,
    );
    // Câu này nằm trong bảng xổ ra, không nằm dưới ô: một dòng chữ hiện ra rồi
    // biến mất theo số thẻ cũng đủ làm hàng lưới nhảy.
    await userEvent.click(screen.getByLabelText('Lọc theo tag'));
    expect(screen.getByText(/đủ 2 tag/)).toBeInTheDocument();
  });

  it('gỡ được một tag đã chọn', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<TagFilter all={ALL} value={['@p0', '@positive']} onChange={onChange} />);
    await user.click(screen.getByLabelText('Bỏ @p0'));
    expect(onChange).toHaveBeenCalledWith(['@positive']);
  });
});

/**
 * Thẻ xếp chồng làm ô cao thêm mỗi dòng, và cả hàng lưới lệch theo: "Platform"
 * bên trái đứng yên còn cột tag trôi xuống. Tag chức năng dài tới ba chục ký tự
 * nên chuyện đó xảy ra ngay ở thẻ thứ hai.
 */
describe('TagFilter — chiều cao không đổi theo số thẻ', () => {
  it('ô giữ nguyên một dòng dù đã chọn nhiều tag', () => {
    const { container } = renderWithProviders(
      <TagFilter all={ALL} value={['@feature-chuyen-tien', '@positive']} onChange={vi.fn()} />,
    );
    // Ô là khối bao quanh chính cái input, không phải khung ngoài cùng.
    const box = container.querySelector('input')!.parentElement;
    expect(box?.className).toContain('h-9');
    // Cuộn ngang thì thanh cuộn ăn mất gần nửa chiều cao 36px và cắt đôi
    // chính những cái thẻ nó cho cuộn — đã thử và phải bỏ.
    expect(box?.className).toContain('overflow-hidden');
  });

  it('Backspace ở ô rỗng gỡ thẻ cuối', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<TagFilter all={ALL} value={['@p0', '@positive']} onChange={onChange} />);
    await user.click(screen.getByLabelText('Lọc theo tag'));
    await user.keyboard('{Backspace}');
    expect(onChange).toHaveBeenCalledWith(['@p0']);
  });
});

/** Nhiều thẻ quá thì gom lại, chứ không cuộn và cũng không xuống dòng. */
describe('TagFilter — nhiều thẻ', () => {
  it('hiện hai thẻ đầu, phần còn lại gom thành +N', () => {
    renderWithProviders(
      <TagFilter all={ALL} value={['@p0', '@positive', '@negative', '@feature-them-ma']} onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText('Bỏ @p0')).toBeInTheDocument();
    expect(screen.getByLabelText('Bỏ @positive')).toBeInTheDocument();
    expect(screen.queryByLabelText('Bỏ @negative')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Còn 2 tag nữa' })).toHaveTextContent('+2');
  });

  it('bấm +N mở bảng để bỏ chọn', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <TagFilter all={ALL} value={['@p0', '@positive', '@negative']} onChange={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: 'Còn 1 tag nữa' }));
    expect(screen.getByRole('button', { name: '@negative' })).toBeInTheDocument();
  });
});

/**
 * Hai thẻ tên dài chiếm hết bề ngang và ô "Thêm tag…" bị overflow-hidden xén
 * mất — nhìn vào tưởng không thêm được tag nào nữa. Ô nhập không được phép co;
 * thẻ cắt bớt chữ còn hơn mất chỗ gõ.
 */
describe('TagFilter — ô nhập không bị thẻ đẩy đi', () => {
  it('thẻ co được, ô nhập thì không', () => {
    const { container } = renderWithProviders(
      <TagFilter all={ALL} value={['@feature-chuyen-tien', '@feature-them-ma']} onChange={vi.fn()} />,
    );
    const input = container.querySelector('input')!;
    expect(input.className).toContain('shrink-0');
    const badge = screen.getByLabelText('Bỏ @feature-chuyen-tien').parentElement!;
    expect(badge.className).toContain('shrink');
    expect(badge.className).not.toContain('shrink-0');
  });
});
