/**
 * Hàng chờ duyệt đề xuất.
 *
 * Hai điều được canh ở đây, và cả hai đều là quyết định chứ không phải cách
 * trình bày. Thứ nhất: bấm "Đồng ý" KHÔNG ghi ngay — nó hỏi lại, vì đây là
 * lệnh ghi vào dữ liệu của cả đội, cùng hình dạng với bảng healing bên cạnh.
 * Thứ hai: danh sách kể TÊN element chứ không kể số lượng; "3 thay đổi" không
 * giúp ai quyết định được gì.
 */
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { screen, within } from '@testing-library/react';
import { server } from '@/test/mocks/server';
import { renderWithRouter } from '@/test/utils';
import { ROUTES } from '@/api/routes';
import { ProposalQueue } from '@/panels/Healing/ProposalQueue';

const proposal = {
  id: 'p-1',
  kind: 'elements',
  key: 'default',
  state: 'pending' as const,
  createdBy: 'an',
  createdAt: '2026-09-23T02:00:00.000Z',
  sourceJobId: 'job-abcdef123456',
  summary: { added: ['otp_field'], removed: [], changed: ['login_btn'] },
};

function withProposals(...items: unknown[]) {
  server.use(http.get(ROUTES.proposals, () => HttpResponse.json({ proposals: items })));
}

describe('Đề xuất chờ duyệt', () => {
  it('kể tên element đã thêm và đã sửa, kèm lượt chạy sinh ra nó', async () => {
    withProposals(proposal);
    await renderWithRouter(<ProposalQueue />);

    const row = (await screen.findByText('otp_field')).closest<HTMLElement>('tr');
    expect(row).not.toBeNull();
    expect(within(row!).getByText('thêm')).toBeInTheDocument();
    expect(within(row!).getByText('login_btn')).toBeInTheDocument();
    expect(within(row!).getByText('sửa')).toBeInTheDocument();
    expect(within(row!).getByText('an')).toBeInTheDocument();
    // Tám ký tự đầu của job id: đủ để nối với dòng trong lịch sử, không dài
    // tới mức đẩy các cột khác ra khỏi màn hình.
    expect(within(row!).getByText('job-abcd')).toBeInTheDocument();
  });

  it('bấm Đồng ý thì hỏi lại trước khi ghi', async () => {
    withProposals(proposal);
    const posted = vi.fn();
    server.use(http.post(ROUTES.proposalReview, async ({ request }) => {
      posted(await request.json());
      return HttpResponse.json({ ok: true });
    }));

    const user = userEvent.setup();
    await renderWithRouter(<ProposalQueue />);
    await user.click(await screen.findByRole('button', { name: 'Đồng ý' }));

    expect(screen.getByText('Ghi vào registry?')).toBeInTheDocument();
    expect(posted).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Chắc chắn' }));
    expect(posted).toHaveBeenCalledWith({ id: 'p-1', decision: 'accept' });
  });

  it('bấm Thôi thì không gửi gì cả', async () => {
    withProposals(proposal);
    const posted = vi.fn();
    server.use(http.post(ROUTES.proposalReview, async () => {
      posted();
      return HttpResponse.json({ ok: true });
    }));

    const user = userEvent.setup();
    await renderWithRouter(<ProposalQueue />);
    await user.click(await screen.findByRole('button', { name: 'Từ chối' }));
    await user.click(screen.getByRole('button', { name: 'Thôi' }));

    expect(screen.queryByText('Bỏ đề xuất này?')).not.toBeInTheDocument();
    expect(posted).not.toHaveBeenCalled();
  });

  it('không có gì chờ thì nói thế, không để bảng trống', async () => {
    withProposals();
    await renderWithRouter(<ProposalQueue />);
    expect(await screen.findByText('Không có đề xuất nào đang chờ.')).toBeInTheDocument();
  });
});
