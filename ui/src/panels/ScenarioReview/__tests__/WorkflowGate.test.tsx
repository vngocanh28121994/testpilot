import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { renderWithRouter } from '@/test/utils';
import { server } from '@/test/mocks/server';
import { sse } from '@/test/mocks/sse';
import { ROUTES, STREAM_ROUTES } from '@/api/routes';
import { WorkflowGate } from '../WorkflowGate';
import type { RunHistoryEntry } from '@core/ui/contracts.js';

const run = (over: Partial<RunHistoryEntry>) =>
  ({ id: 'wf-1', status: 'waiting_review', stages: [], stagesDone: 0, ...over }) as RunHistoryEntry;

const questions = (pending: number, extra: unknown[] = []) =>
  http.get(ROUTES.workflowQuestions, () =>
    HttpResponse.json({ status: 'waiting_input', pending, questions: extra }),
  );

/**
 * Cổng này là thứ khiến một workflow đã dừng có thể chạy tiếp. Thiếu nó thì V2
 * bắt đầu được workflow nhưng không kết thúc được — bản React đầu tiên đúng là
 * đã thiếu, và một lượt chạy dừng ở cổng duyệt nằm đó vĩnh viễn.
 */
describe('WorkflowGate', () => {
  it('không hiện gì khi không có lượt chạy nào đang dừng', async () => {
    await renderWithRouter(<WorkflowGate runs={[run({ status: 'passed' })]} />);
    expect(screen.queryByText('Workflow đang chờ bạn')).not.toBeInTheDocument();
  });

  it('hiện câu hỏi kèm lý do khi workflow đang chờ trả lời', async () => {
    server.use(
      questions(1, [
        {
          id: 'q1',
          kind: 'radio',
          prompt: 'Chuyển tiền từ tiểu khoản nào?',
          rationale: 'Tài liệu không nói rõ.',
          options: ['TK Thường', 'TK Ký quỹ'],
          source: 'generation',
        },
      ]),
    );
    await renderWithRouter(<WorkflowGate runs={[run({ status: 'waiting_input' })]} />);
    expect(await screen.findByText('Chuyển tiền từ tiểu khoản nào?')).toBeInTheDocument();
    expect(screen.getByText('Tài liệu không nói rõ.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'TK Ký quỹ' })).toBeInTheDocument();
  });

  it('gửi câu trả lời kèm đúng id và giá trị', async () => {
    let sent: unknown = null;
    server.use(
      questions(1, [
        { id: 'q1', kind: 'radio', prompt: 'Tiểu khoản?', options: ['A', 'B'], source: 'generation' },
      ]),
      http.post(ROUTES.workflowAnswers, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ remaining: 0, status: 'running' });
      }),
    );
    await renderWithRouter(<WorkflowGate runs={[run({ status: 'waiting_input' })]} />);
    await userEvent.click(await screen.findByRole('radio', { name: 'B' }));
    await userEvent.click(screen.getByRole('button', { name: 'Gửi câu trả lời' }));
    await waitFor(() =>
      expect(sent).toEqual({ runId: 'wf-1', answers: [{ id: 'q1', values: ['B'] }] }),
    );
  });

  /**
   * Còn câu bỏ ngỏ thì không được mở đường chạy tiếp: workflow chạy lại trên
   * một quyết định mới làm được nửa là kiểu hỏng âm thầm nhất.
   */
  it('chưa cho chạy tiếp khi còn câu chưa trả lời', async () => {
    server.use(
      questions(1, [{ id: 'q1', kind: 'text', prompt: 'Số tiền?', source: 'generation' }]),
    );
    await renderWithRouter(<WorkflowGate runs={[run({ status: 'waiting_input' })]} />);
    await screen.findByText('Số tiền?');
    expect(
      screen.queryByRole('button', { name: /Hoàn thành kịch bản/ }),
    ).not.toBeInTheDocument();
  });

  it('cho chạy tiếp khi kịch bản đã duyệt xong và gửi đúng runId', async () => {
    let sent: unknown = null;
    server.use(
      questions(0),
      http.post(STREAM_ROUTES.workflowComplete, async ({ request }) => {
        sent = await request.json();
        return sse([['log', 'Đang chạy các testcase đã duyệt…'], ['done', { ok: true }]]);
      }),
    );
    await renderWithRouter(<WorkflowGate runs={[run({ status: 'waiting_review' })]} />);
    const button = await screen.findByRole('button', { name: /Hoàn thành kịch bản/ });
    await userEvent.click(button);
    await waitFor(() => expect(sent).toEqual({ runId: 'wf-1' }));
    expect(await screen.findByText(/Đang chạy các testcase đã duyệt/)).toBeInTheDocument();
  });
});

/**
 * Chạy xong thì phải có kết cục, không phải đứng im.
 *
 * Trước đây bấm "Hoàn thành kịch bản" xong là log chạy hết rồi dừng, và mọi thứ
 * khác giữ nguyên: thẻ này vẫn nằm đó như thể còn đang chờ duyệt, không ai nói
 * kết quả ra sao, không có đường nào tới report.
 */
describe('WorkflowGate — sau khi chạy xong', () => {
  const finishes = (status: string) =>
    http.post(STREAM_ROUTES.workflowComplete, () =>
      sse([
        ['log', '[run:summary] 8✓ 1✗ 0~ 0⊘'],
        ['run', { id: 'run-1', status, stages: [] }],
        ['done', { ok: true }],
      ]),
    );

  const runTo = async (status: string) => {
    server.use(finishes(status));
    const user = userEvent.setup();
    await renderWithRouter(<WorkflowGate runs={[run({ status: 'waiting_review' })]} />);
    await user.click(
      await screen.findByRole('button', { name: /Hoàn thành kịch bản và tiếp tục chạy/ }),
    );
  };

  it('nói đã hoàn tất và chỉ đường tới report', async () => {
    await runTo('passed');
    expect(await screen.findByText('Workflow đã hoàn tất')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Xem report' })).toBeInTheDocument();
  });

  it('có testcase fail thì nói ra, không báo xanh', async () => {
    await runTo('failed');
    expect(
      await screen.findByText('Workflow hoàn tất nhưng có testcase fail'),
    ).toBeInTheDocument();
  });
});
