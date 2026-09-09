import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, within } from '@testing-library/react';
import { renderWithRouter } from '@/test/utils';
import ScenarioReviewPanel from '@/panels/ScenarioReview';

/**
 * Hành động trên mỗi hàng phải khớp với trạng thái của chính hàng đó.
 *
 * Một kịch bản đã `approved` vẫn kèm nút "Duyệt". Bấm vào chẳng đổi gì, và
 * trước khi kịp bấm thì nó đã nói sai: cột Trạng thái ghi "approved" trong khi
 * hàng bên cạnh vẫn mời duyệt, nên hàng đã xong trông y hệt hàng còn phải xử
 * lý. Với bảng vài chục dòng thì đó là mất luôn khả năng quét bằng mắt.
 *
 * Sửa kịch bản làm đổi contentHash và syncFile() đưa entry về `pending` ngay
 * lúc đó, nên `approved` ở đây luôn nghĩa là "đã duyệt VÀ còn đúng nội dung
 * này" — không có ca nào cần duyệt lại mà vẫn hiện approved.
 */
const rowOf = (name: string) => {
  const cell = screen.getByText(name);
  const row = cell.closest('tr');
  if (!row) throw new Error(`Không tìm thấy hàng của "${name}"`);
  return within(row);
};

const render = () => renderWithRouter(<ScenarioReviewPanel search={{}} />, { path: '/scenarios' });

describe('hành động theo trạng thái của hàng', () => {
  it('hàng chờ duyệt vẫn có nút Duyệt', async () => {
    await render();
    await screen.findByText('Đăng nhập thành công');
    expect(rowOf('Đăng nhập thành công').getByRole('button', { name: 'Duyệt' })).toBeInTheDocument();
  });

  it('hàng đã duyệt thì không còn nút Duyệt', async () => {
    await render();
    await screen.findByText('Sai mật khẩu');
    expect(rowOf('Sai mật khẩu').queryByRole('button', { name: 'Duyệt' })).toBeNull();
  });

  /** Bỏ nút không được kéo theo mất đường đảo quyết định. */
  it('hàng đã duyệt vẫn đổi được ý qua menu', async () => {
    const user = userEvent.setup();
    await render();
    await screen.findByText('Sai mật khẩu');
    await user.click(rowOf('Sai mật khẩu').getByRole('button', { name: /Hành động khác/ }));
    expect(await screen.findByRole('menuitem', { name: /Không duyệt/ })).toBeInTheDocument();
  });

  it('hàng chờ duyệt có cả hai đường', async () => {
    const user = userEvent.setup();
    await render();
    await screen.findByText('Đăng nhập thành công');
    await user.click(rowOf('Đăng nhập thành công').getByRole('button', { name: /Hành động khác/ }));
    expect(await screen.findByRole('menuitem', { name: /Không duyệt/ })).toBeInTheDocument();
  });
});
