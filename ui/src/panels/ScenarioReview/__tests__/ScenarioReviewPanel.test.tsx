import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '@/test/utils';
import ScenarioReviewPanel, { type ScenarioSearch } from '@/panels/ScenarioReview';

const editButtons = () => screen.getAllByRole('button', { name: 'Sửa kịch bản' });

/** `noUncheckedIndexedAccess` bật, nên chỉ số phải được thu hẹp kiểu ở đây. */
function editButtonAt(index: number): HTMLElement {
  const button = editButtons()[index];
  if (!button) throw new Error(`Không có nút "Sửa kịch bản" thứ ${index}`);
  return button;
}

const render = () => renderWithRouter(<ScenarioReviewPanel search={{}} />, { path: '/scenarios' });

/**
 * Render với router VÀ prop `search` khớp nhau.
 *
 * Panel nhận `search` qua prop (route thật truyền `Route.useSearch()`), còn các
 * hàm sửa bộ lọc lại merge trên state MỚI NHẤT của router. Test nào chỉ đặt
 * prop mà không đặt URL sẽ để hai nguồn đó lệch nhau, và phép merge bị đo sai.
 */
function renderAt(search: ScenarioSearch) {
  const params = new URLSearchParams();
  if (search.q) params.set('q', search.q);
  if (search.file) params.set('file', search.file);
  if (search.status) params.set('status', search.status);
  if (search.tags) params.set('tags', JSON.stringify(search.tags));
  if (search.runId) params.set('runId', search.runId);
  return renderWithRouter(<ScenarioReviewPanel search={search} />, {
    path: '/scenarios',
    initialEntry: `/scenarios?${params.toString()}`,
  });
}

describe('ScenarioReviewPanel — thanh lọc', () => {
  /**
   * Bộ lọc áp NGAY, không qua nút "Lọc".
   *
   * Trước đây thanh lọc là một <form> phải submit: chọn xong vẫn chưa có gì xảy
   * ra cho tới khi bấm nút thứ hai. Ba test cũ khoá đúng thiết kế đó (kể cả một
   * test khẳng định nút "Lọc" phải là primary) nên chúng được viết lại chứ
   * không sửa vặt — nút đó không còn tồn tại.
   */
  it('đổi trạng thái là áp ngay vào URL, không cần bấm nút nào', async () => {
    const user = userEvent.setup();
    const { router } = await render();
    await screen.findByText('Đăng nhập thành công');

    expect(screen.getByLabelText('Lọc theo trạng thái duyệt')).toHaveClass('bg-white');
    await user.click(screen.getByLabelText('Lọc theo trạng thái duyệt'));
    await user.click(await screen.findByRole('option', { name: 'Đã duyệt' }));

    expect(router.state.location.search).toMatchObject({ status: 'approved' });
    expect(screen.queryByRole('button', { name: 'Lọc' })).not.toBeInTheDocument();
  });

  it('từ khoá áp khi rời ô, và Escape xoá nó', async () => {
    const user = userEvent.setup();
    const { router } = await render();
    await screen.findByText('Đăng nhập thành công');

    const box = screen.getByLabelText('Tìm kịch bản');
    expect(box).toHaveClass('bg-white');
    await user.type(box, 'Sai mật khẩu');
    await user.tab();
    expect(router.state.location.search).toMatchObject({ q: 'Sai mật khẩu' });

    await user.type(box, '{Escape}');
    expect(router.state.location.search).not.toHaveProperty('q');
  });

  /**
   * Danh sách tag nằm sau một nút, không đổ thẳng ra thanh lọc. Đây là lý do
   * TagFilter tồn tại tách khỏi TagPicker — xem chú thích đầu TagFilter.tsx.
   */
  it('tag nằm trong popover và chọn được nhiều tag', async () => {
    const user = userEvent.setup();
    const { router } = await render();
    await screen.findByText('Đăng nhập thành công');

    // Đóng thì panel không tồn tại. Không đếm role=option: ba <select> gốc
    // cũng sinh ra role đó, nên phép đếm sẽ đo nhầm thứ khác.
    expect(screen.queryByLabelText('Tìm tag')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Tag' }));
    await user.click(await screen.findByRole('option', { name: /@web/ }));
    await user.click(screen.getByRole('option', { name: /@smoke/ }));

    expect(router.state.location.search).toMatchObject({ tags: ['@web', '@smoke'] });
  });

  /** Bộ lọc đang bật phải trông khác bộ lọc đang tắt, ngay trên cái nút. */
  it('nút tag đếm số tag đang lọc', async () => {
    await renderAt({ tags: ['@web', '@smoke'] });
    await screen.findByText('Đăng nhập thành công');

    expect(screen.getByRole('button', { name: /đang chọn 2/ })).toBeInTheDocument();
  });

  it('mỗi điều kiện đang bật là một chip bỏ được riêng', async () => {
    const user = userEvent.setup();
    const { router } = await renderAt({ q: 'Đăng nhập', tags: ['@web'] });
    await screen.findByText('Đăng nhập thành công');

    expect(screen.getByRole('button', { name: 'Xoá lọc (2)' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Bỏ lọc @web' }));
    expect(router.state.location.search).not.toHaveProperty('tags');
    // Bỏ một điều kiện KHÔNG được cuốn theo điều kiện còn lại.
    expect(router.state.location.search).toMatchObject({ q: 'Đăng nhập' });
  });

  /** `runId` là tham số của Workflow Gate, không phải một bộ lọc. */
  it('xoá hết bộ lọc vẫn giữ runId để gate không biến mất', async () => {
    const user = userEvent.setup();
    const { router } = await renderAt({ tags: ['@web'], runId: 'wf-1' });
    await screen.findByText('Đăng nhập thành công');

    await user.click(screen.getByRole('button', { name: /Xoá lọc/ }));

    expect(router.state.location.search).toEqual({ runId: 'wf-1' });
  });
});

describe('ScenarioReviewPanel — sheet sửa một kịch bản', () => {
  /**
   * Bảng liệt kê theo KỊCH BẢN, nên nhiều hàng cùng trỏ về một feature file.
   * Trạng thái `editing` từng lưu tên file, khiến một cú click mở ô soạn thảo ở
   * mọi hàng của file đó. Nó phải được khoá theo hàng.
   */
  it('mở sheet cho đúng kịch bản được click', async () => {
    const user = userEvent.setup();
    await render();
    await screen.findByText('Đăng nhập thành công');

    // Hai kịch bản này thuộc cùng dang-nhap.feature.
    expect(editButtons()).toHaveLength(2);
    await user.click(editButtonAt(0));

    expect(screen.getByRole('dialog')).toHaveTextContent('Đăng nhập thành công');
    expect(screen.getByLabelText('Nội dung kịch bản')).toBeInTheDocument();
  });

  it('nút Thêm kịch bản mở sheet tạo mới', async () => {
    const user = userEvent.setup();
    await render();
    await screen.findByText('Sai mật khẩu');
    await user.click(screen.getByRole('button', { name: 'Thêm kịch bản' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Thêm kịch bản');
    expect(screen.getByRole('combobox', { name: /Feature đích/i })).toBeInTheDocument();
  });

  it('Huỷ đóng sheet', async () => {
    const user = userEvent.setup();
    await render();
    await screen.findByText('Đăng nhập thành công');

    await user.click(editButtonAt(0));
    await user.click(screen.getByRole('button', { name: 'Huỷ' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
