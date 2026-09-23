/**
 * Cho mượn máy: hộp nhỏ ở cuối một dòng thiết bị.
 *
 * Hai điều được canh. Thứ nhất: danh sách người đang mượn hiện NGAY ở đây —
 * thứ người ta quên là thứ mình đã cho mượn, và một quyền bị quên thì không
 * bao giờ được thu lại. Thứ hai: chỉ hỏi server khi hộp được mở, vì một phòng
 * máy hai mươi chiếc mà mỗi chiếc một lời gọi là hai mươi lời gọi cho một thứ
 * hiếm khi đổi.
 */
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { server } from '@/test/mocks/server';
import { renderWithRouter } from '@/test/utils';
import { ROUTES } from '@/api/routes';
import { ShareDevice } from '@/panels/Devices/ShareDevice';

function withShares(...grants: unknown[]) {
  server.use(http.get(ROUTES.deviceShares, () => HttpResponse.json({ grants })));
}

describe('Chia sẻ máy', () => {
  it('chưa mở thì KHÔNG hỏi server', async () => {
    const asked = vi.fn();
    server.use(http.get(ROUTES.deviceShares, () => {
      asked();
      return HttpResponse.json({ grants: [] });
    }));

    await renderWithRouter(<ShareDevice udid="iphone-12" />);
    expect(await screen.findByRole('button', { name: 'Chia sẻ' })).toBeInTheDocument();
    expect(asked).not.toHaveBeenCalled();
  });

  it('mở ra thì thấy ai đang mượn', async () => {
    withShares({ udid: 'iphone-12', userId: 'binh', grantedBy: 'an', createdAt: 'now' });
    const user = userEvent.setup();
    await renderWithRouter(<ShareDevice udid="iphone-12" />);

    await user.click(screen.getByRole('button', { name: 'Chia sẻ' }));
    expect(await screen.findByText('binh')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'thu lại' })).toBeInTheDocument();
  });

  it('gửi đúng udid và tên người được mượn', async () => {
    withShares();
    const posted = vi.fn();
    server.use(http.post(ROUTES.deviceShare, async ({ request }) => {
      posted(await request.json());
      return HttpResponse.json({ grant: {} });
    }));

    const user = userEvent.setup();
    await renderWithRouter(<ShareDevice udid="iphone-12" />);
    await user.click(screen.getByRole('button', { name: 'Chia sẻ' }));
    await user.type(await screen.findByLabelText('Cho ai mượn iphone-12'), '  binh  ');
    await user.click(screen.getByRole('button', { name: 'Cho mượn' }));

    // Khoảng trắng bị cắt: một mã người dùng có dấu cách ở đầu là một quyền
    // không bao giờ khớp với ai, và không ai hiểu vì sao.
    expect(posted).toHaveBeenCalledWith({ udid: 'iphone-12', userId: 'binh' });
  });

  it('chưa gõ tên thì nút không bấm được', async () => {
    withShares();
    const user = userEvent.setup();
    await renderWithRouter(<ShareDevice udid="iphone-12" />);
    await user.click(screen.getByRole('button', { name: 'Chia sẻ' }));
    expect(await screen.findByRole('button', { name: 'Cho mượn' })).toBeDisabled();
  });

  it('chưa cho ai mượn thì nói thế', async () => {
    withShares();
    const user = userEvent.setup();
    await renderWithRouter(<ShareDevice udid="iphone-12" />);
    await user.click(screen.getByRole('button', { name: 'Chia sẻ' }));
    expect(await screen.findByText('Chưa cho ai mượn.')).toBeInTheDocument();
  });
});
