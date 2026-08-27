import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '@/test/utils';
import ScenarioReviewPanel from '@/panels/ScenarioReview';

const editButtons = () => screen.getAllByRole('button', { name: 'Sửa file' });

/** `noUncheckedIndexedAccess` bật, nên chỉ số phải được thu hẹp kiểu ở đây. */
function editButtonAt(index: number): HTMLElement {
  const button = editButtons()[index];
  if (!button) throw new Error(`Không có nút "Sửa file" thứ ${index}`);
  return button;
}

const render = () => renderWithRouter(<ScenarioReviewPanel search={{}} />, { path: '/scenarios' });

describe('ScenarioReviewPanel — bộ lọc', () => {
  /**
   * Trước đây là `<select multiple>` xổ hết mọi tag ra màn hình. Giờ là dropdown
   * chọn một, cùng hình dáng với hai bộ lọc bên cạnh.
   */
  it('tag là dropdown chọn một, không phải multi-select', async () => {
    await render();
    await screen.findByText('Đăng nhập thành công');

    const tagSelect = screen.getByLabelText<HTMLSelectElement>('Lọc theo tag');
    expect(tagSelect.multiple).toBe(false);
    expect(tagSelect.value).toBe(''); // mặc định: Tất cả tag
  });

  it('chọn tag rồi bấm Lọc thì đẩy tag vào URL và lọc bảng', async () => {
    const user = userEvent.setup();
    const { router } = await render();
    await screen.findByText('Đăng nhập thành công');
    expect(screen.getAllByRole('row')).toHaveLength(3); // tiêu đề + 2 kịch bản

    await user.selectOptions(screen.getByLabelText('Lọc theo tag'), '@web');
    await user.click(screen.getByRole('button', { name: 'Lọc' }));

    expect(router.state.location.search).toMatchObject({ tags: ['@web'] });
  });

  it('nút Lọc là primary, không phải nút chìm', async () => {
    await render();
    await screen.findByText('Đăng nhập thành công');

    expect(screen.getByRole('button', { name: 'Lọc' })).toHaveClass('bg-primary');
  });
});

describe('ScenarioReviewPanel — ô sửa file', () => {
  /**
   * Bảng liệt kê theo KỊCH BẢN, nên nhiều hàng cùng trỏ về một feature file.
   * Trạng thái `editing` từng lưu tên file, khiến một cú click mở ô soạn thảo ở
   * mọi hàng của file đó. Nó phải được khoá theo hàng.
   */
  it('chỉ mở ô soạn thảo ở đúng hàng được click', async () => {
    const user = userEvent.setup();
    const { container } = await render();
    await screen.findByText('Đăng nhập thành công');

    // Hai kịch bản này thuộc cùng dang-nhap.feature.
    expect(editButtons()).toHaveLength(2);
    expect(container.querySelectorAll('textarea')).toHaveLength(0);

    const first = editButtonAt(0);
    await user.click(first);

    expect(container.querySelectorAll('textarea')).toHaveLength(1);
    // Ô soạn thảo nằm ngay dưới hàng vừa click, không phải hàng kia.
    expect(first.closest('tr')?.nextElementSibling).toContainElement(
      container.querySelector('textarea'),
    );
  });

  it('click hàng khác thì chuyển ô soạn thảo sang hàng đó', async () => {
    const user = userEvent.setup();
    const { container } = await render();
    await screen.findByText('Sai mật khẩu');

    await user.click(editButtonAt(0));
    const second = editButtonAt(1);
    await user.click(second);

    expect(container.querySelectorAll('textarea')).toHaveLength(1);
    expect(second.closest('tr')?.nextElementSibling).toContainElement(
      container.querySelector('textarea'),
    );
  });

  it('Huỷ đóng ô soạn thảo', async () => {
    const user = userEvent.setup();
    const { container } = await render();
    await screen.findByText('Đăng nhập thành công');

    await user.click(editButtonAt(0));
    await user.click(screen.getByRole('button', { name: 'Huỷ' }));

    expect(container.querySelectorAll('textarea')).toHaveLength(0);
  });
});
