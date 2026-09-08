import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '@/test/utils';
import ScenarioReviewPanel from '@/panels/ScenarioReview';

const editButtons = () => screen.getAllByRole('button', { name: 'Sửa' });

/** `noUncheckedIndexedAccess` bật, nên chỉ số phải được thu hẹp kiểu ở đây. */
function editButtonAt(index: number): HTMLElement {
  const button = editButtons()[index];
  if (!button) throw new Error(`Không có nút "Sửa" thứ ${index}`);
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

describe('ScenarioReviewPanel — sửa kịch bản', () => {
  const editor = () =>
    screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Nội dung kịch bản' });

  /**
   * Bảng liệt kê theo KỊCH BẢN, nên nhiều hàng cùng trỏ về một feature file.
   * Bản đầu tiên đưa cả nội dung file vào ô soạn: sửa một kịch bản thì kịch bản
   * bên cạnh cũng nằm trong tầm tay, và một lần chọn-rồi-gõ nhầm là mất nó.
   * Panel chỉ được nạp khối của đúng kịch bản đã bấm.
   */
  it('chỉ đưa ra kịch bản được bấm, không phải cả file', async () => {
    const user = userEvent.setup();
    await render();
    await screen.findByText('Đăng nhập thành công');

    expect(editButtons()).toHaveLength(2);
    expect(screen.queryByRole('textbox', { name: 'Nội dung kịch bản' })).not.toBeInTheDocument();

    await user.click(editButtonAt(0));

    expect(editor()).toHaveValue(
      ['@web', '  Scenario: Đăng nhập thành công', '    Given I open the app', '    Then I see "Trang chủ"'].join('\n'),
    );
    // Kịch bản bên cạnh không đi theo. So trên `.value` chứ không dùng
    // toHaveValue(stringContaining(…)): toHaveValue không nhận matcher bất đối
    // xứng, nên phủ định của nó đúng một cách vô nghĩa và test không kiểm gì cả.
    expect(editor().value).not.toContain('Sai mật khẩu');
  });

  it('bấm hàng khác thì panel chuyển sang kịch bản đó', async () => {
    const user = userEvent.setup();
    await render();
    await screen.findByText('Sai mật khẩu');

    await user.click(editButtonAt(0));
    await user.click(screen.getByRole('button', { name: 'Huỷ' }));
    await user.click(editButtonAt(1));

    expect(editor().value).toContain('Scenario: Sai mật khẩu');
    expect(editor().value).not.toContain('Trang chủ');
  });

  it('Huỷ đóng panel', async () => {
    const user = userEvent.setup();
    await render();
    await screen.findByText('Đăng nhập thành công');

    await user.click(editButtonAt(0));
    await user.click(screen.getByRole('button', { name: 'Huỷ' }));

    expect(screen.queryByRole('textbox', { name: 'Nội dung kịch bản' })).not.toBeInTheDocument();
  });
});
