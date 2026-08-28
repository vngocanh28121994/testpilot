import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from '@/test/mocks/server';
import { renderWithRouter } from '@/test/utils';
import { ROUTES } from '@/api/routes';
import { gateQuestions, gateState } from '@/test/mocks/fixtures';
import ScenarioReviewPanel from '@/panels/ScenarioReview';

/** Đè /api/state bằng một state có workflow đang dừng ở gate. */
function withState(state: ReturnType<typeof gateState>) {
  server.use(http.get(ROUTES.state, () => HttpResponse.json(state)));
}

const render = () =>
  renderWithRouter(<ScenarioReviewPanel search={{ runId: 'wf-1' }} />, { path: '/scenarios' });

const gate = () => screen.getByRole('region', { name: 'Workflow đang chờ review' });
/** Riêng danh sách stage: khối coverage bên dưới cũng là <li>. */
const stageList = () => screen.getByRole('list', { name: 'Tiến trình workflow' });

describe('WorkflowGate — hiện diện', () => {
  /**
   * Đây là khác biệt lớn nhất giữa bản cũ và bản React trước đợt này: workflow
   * dừng ở `waiting_review` và KHÔNG có nút nào cho nó chạy tiếp, nên cả
   * pipeline đứt ở giữa.
   */
  it('hiện gate kèm tóm tắt kết quả sinh', async () => {
    withState(gateState());
    await render();

    await screen.findByText('Workflow đang chờ review');
    // Landmark có tên, không chỉ là một dòng chữ: gate phải nhảy thẳng tới được.
    expect(gate()).toBeInTheDocument();
    expect(
      within(gate()).getByText(/2 testcase · 7 bước · 3 ảnh\/design đã phân tích/),
    ).toBeInTheDocument();
    expect(screen.getByText(/2\/3 yêu cầu bắt buộc đã có testcase/)).toBeInTheDocument();
  });

  it('vắng mặt khi không có workflow nào đang chờ', async () => {
    // stateFixture mặc định không có run nào `kind: 'workflow'`.
    await renderWithRouter(<ScenarioReviewPanel search={{}} />, { path: '/scenarios' });
    await screen.findByText('Đăng nhập thành công');

    expect(screen.queryByText('Workflow đang chờ review')).not.toBeInTheDocument();
  });

  it('vẽ đủ 11 stage, với bước đang chạy được đánh dấu', async () => {
    withState(gateState());
    await render();
    await screen.findByText('Workflow đang chờ review');

    const items = within(stageList()).getAllByRole('listitem');
    expect(items).toHaveLength(11);
    expect(within(stageList()).getAllByLabelText('xong')).toHaveLength(5);
    expect(within(stageList()).getAllByLabelText('đang chạy')).toHaveLength(1);
  });
});

describe('WorkflowGate — coverage', () => {
  it('liệt kê quy tắc chưa có testcase', async () => {
    withState(gateState());
    await render();
    await screen.findByText('Coverage cần bổ sung trước khi chạy');

    expect(screen.getByText('RQ-03')).toBeInTheDocument();
    expect(screen.getByText('Khoá tài khoản sau 5 lần sai')).toBeInTheDocument();
    expect(screen.getByText('1 quy tắc')).toBeInTheDocument();
  });

  it('không hiện khối coverage khi không thiếu gì', async () => {
    withState(gateState({ missing: null }));
    await render();
    await screen.findByText('Workflow đang chờ review');

    expect(screen.queryByText('Coverage cần bổ sung trước khi chạy')).not.toBeInTheDocument();
  });
});

describe('WorkflowGate — câu hỏi', () => {
  it('render đúng kiểu cho radio và text, kèm lý do và vị trí phát sinh', async () => {
    withState(gateState({ status: 'waiting_input', questions: gateQuestions }));
    await render();
    await screen.findByText('Cần bạn quyết định');

    expect(screen.getByText('2 câu')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(
      screen.getByLabelText('Số tài khoản dùng để kiểm thử chuyển tiền?'),
    ).toBeInTheDocument();

    // Không có `rationale` thì người trả lời không biết mình đang quyết gì.
    expect(
      screen.getByText('Tài liệu nhắc tới hai danh mục mà không nói cái nào mở sẵn.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Phát sinh tại: Chuyển tiền nội bộ, dòng 12')).toBeInTheDocument();
  });

  it('gửi đúng shape { runId, answers } lên /api/workflow/answers', async () => {
    const user = userEvent.setup();
    withState(gateState({ status: 'waiting_input', questions: gateQuestions }));

    let body: unknown;
    server.use(
      http.post(ROUTES.workflowAnswers, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ remaining: 0, status: 'running' });
      }),
    );

    await render();
    await screen.findByText('Cần bạn quyết định');

    await user.click(screen.getByRole('radio', { name: 'Danh mục của tôi' }));
    await user.type(
      screen.getByLabelText('Số tài khoản dùng để kiểm thử chuyển tiền?'),
      '19001234',
    );
    await user.click(screen.getByRole('button', { name: 'Bổ sung thông tin và chạy tiếp' }));

    await waitFor(() =>
      expect(body).toEqual({
        runId: 'wf-1',
        answers: [
          { id: 'wf-1-q1', values: ['Danh mục của tôi'] },
          { id: 'wf-1-q2', values: ['19001234'] },
        ],
      }),
    );
  });

  /**
   * `remaining > 0` không phải lỗi — server ghi từng đợt xuống đĩa. Nhưng nó
   * cũng KHÔNG phải thành công: còn câu chưa trả lời thì workflow vẫn đứng im.
   */
  it('nói rõ còn bao nhiêu câu khi trả lời thiếu', async () => {
    const user = userEvent.setup();
    withState(gateState({ status: 'waiting_input', questions: gateQuestions }));
    server.use(
      http.post(ROUTES.workflowAnswers, () =>
        HttpResponse.json({ remaining: 1, status: 'waiting_input' }),
      ),
    );

    await render();
    await screen.findByText('Cần bạn quyết định');
    await user.click(screen.getByRole('button', { name: 'Bổ sung thông tin và chạy tiếp' }));

    expect(await screen.findByText('Đã lưu. Còn 1 câu chưa trả lời.')).toBeInTheDocument();
  });

  it('không hiện khối câu hỏi khi mọi câu đã được trả lời', async () => {
    withState(
      gateState({
        questions: gateQuestions.map((q) => ({
          ...q,
          answer: ['x'],
          answeredAt: '2026-08-27T10:00:00.000Z',
        })),
      }),
    );
    await render();
    await screen.findByText('Workflow đang chờ review');

    expect(screen.queryByText('Cần bạn quyết định')).not.toBeInTheDocument();
  });
});

describe('WorkflowGate — nút hoàn thành', () => {
  const completeButton = () =>
    screen.getByRole('button', { name: /Hoàn thành kịch bản và tiếp tục chạy/ });

  it('khoá khi còn kịch bản chờ duyệt, và nói ra con số', async () => {
    withState(gateState({ reviews: ['pending', 'approved'] }));
    await render();
    await screen.findByText('Workflow đang chờ review');

    expect(completeButton()).toBeDisabled();
    expect(screen.getByText('Còn 1 chờ duyệt · 1 đã duyệt · 0 không duyệt')).toBeInTheDocument();
  });

  /** Duyệt hết nhưng từ chối hết = bộ test rỗng. Chạy tiếp là chạy vào hư không. */
  it('khoá khi không còn pending nhưng cũng không có kịch bản nào được duyệt', async () => {
    withState(gateState({ reviews: ['rejected', 'rejected'] }));
    await render();
    await screen.findByText('Workflow đang chờ review');

    expect(completeButton()).toBeDisabled();
    expect(screen.getByText('Cần duyệt ít nhất một testcase để tiếp tục.')).toBeInTheDocument();
  });

  it('mở khoá khi đã duyệt hết, và nói bao nhiêu testcase sẽ chạy', async () => {
    withState(gateState({ reviews: ['approved', 'rejected'] }));
    await render();
    await screen.findByText('Workflow đang chờ review');

    expect(completeButton()).toBeEnabled();
    expect(
      screen.getByText(/1 testcase sẽ được chạy · 1 testcase bị loại/),
    ).toBeInTheDocument();
  });

  it('bấm thì stream /api/workflow/complete và cập nhật stage từ khung run', async () => {
    const user = userEvent.setup();
    withState(gateState({ reviews: ['approved', 'approved'] }));
    await render();
    await screen.findByText('Workflow đang chờ review');

    await user.click(completeButton());

    // Log nằm chung một <pre>, nên khớp theo chuỗi con chứ không khớp cả node.
    expect(await screen.findByText(/✓ Đã chạy 2 testcase\./)).toBeInTheDocument();
    // Khung `run` của stream thắng snapshot trong /api/state: 2 stage, không phải 11.
    await waitFor(() => expect(within(stageList()).getAllByRole('listitem')).toHaveLength(2));
    expect(within(stageList()).getByText('Chuẩn bị môi trường automation')).toBeInTheDocument();
  });

  it('ẩn nút khi workflow đã kết thúc', async () => {
    withState(gateState({ status: 'passed', reviews: ['approved', 'approved'] }));
    await render();
    await screen.findByText('Workflow đang chờ review');

    expect(
      screen.queryByRole('button', { name: /Hoàn thành kịch bản/ }),
    ).not.toBeInTheDocument();
  });
});
