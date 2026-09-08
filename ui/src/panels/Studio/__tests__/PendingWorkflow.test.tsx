import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '@/test/utils';
import { server } from '@/test/mocks/server';
import { ROUTES } from '@/api/routes';
import { stateFixture } from '@/test/mocks/fixtures';
import { PendingWorkflow } from '../PendingWorkflow';

/**
 * Workflow là MỘT việc liền mạch: khởi động ở Studio, dừng chờ duyệt, chạy tiếp.
 * Trước đây Studio không nói gì về lần dừng đó, nên sau khi log sinh kịch bản
 * chạy hết, màn hình chỉ còn một khung log đã chết.
 */
const waiting = (over: Record<string, unknown> = {}) => ({
  id: 'wf-1',
  status: 'waiting_review',
  startedAt: '2026-09-08T04:00:00.000Z',
  stages: [],
  stagesDone: 0,
  generatedFile: 'chuyen-tien-noi-bo.feature',
  generated: { scenarios: 8 },
  ...over,
});

const render = async (runs: unknown[]) => {
  server.use(http.get(ROUTES.state, () => HttpResponse.json({ ...stateFixture, runs })));
  return renderWithRouter(<PendingWorkflow />, { path: '/studio' });
};

describe('Studio — mục workflow đang chờ', () => {
  it('nói rõ bao nhiêu kịch bản đang chờ duyệt', async () => {
    await render([waiting()]);
    expect(await screen.findByText('Kịch bản chờ duyệt')).toBeInTheDocument();
    expect(screen.getByText(/8 kịch bản vừa sinh xong/)).toBeInTheDocument();
  });

  /** Mở ra mà không lọc thì kịch bản mới nằm lẫn giữa hàng chục cái đã duyệt. */
  it('lối vào màn duyệt lọc sẵn đúng file vừa sinh', async () => {
    await render([waiting()]);
    const link = await screen.findByRole('link', { name: /Mở màn duyệt để xem\/sửa/ });
    expect(link.getAttribute('href')).toContain('file=chuyen-tien-noi-bo.feature');
    expect(link.getAttribute('href')).toContain('status=pending');
  });

  it('chờ trả lời câu hỏi thì nói đúng việc đó, không nói là chờ duyệt', async () => {
    await render([waiting({ status: 'waiting_input' })]);
    expect(await screen.findByText('Workflow đang chờ bạn trả lời')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Mở màn duyệt để trả lời/ })).toBeInTheDocument();
  });

  it('không có gì đang chờ thì không chiếm chỗ', async () => {
    const { container } = await render([{ ...waiting(), status: 'passed' }]);
    await screen.findByText((_, el) => el?.tagName === 'BODY', { exact: false });
    expect(container.textContent).toBe('');
  });
});
