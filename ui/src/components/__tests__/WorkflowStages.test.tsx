import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { WorkflowStages } from '../WorkflowStages';

/**
 * Một khung log trả lời được "nó đang nói gì", nhưng không trả lời được hai câu
 * người ta thật sự hỏi khi ngồi đợi: đang ở bước nào, và còn mấy bước nữa.
 */
const stages = [
  { name: 'Đọc và xác thực tài liệu', status: 'done' as const },
  { name: 'Sinh bộ testcase', status: 'running' as const },
  { name: 'Chuẩn hoá và bind step', status: 'pending' as const },
];

describe('WorkflowStages', () => {
  it('liệt kê đủ bước đã xong, đang chạy và còn chờ', () => {
    render(<WorkflowStages stages={stages} />);
    const list = screen.getByRole('list', { name: 'Các bước của workflow' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
  });

  it('phân biệt trạng thái bằng nhãn, không chỉ bằng màu', () => {
    render(<WorkflowStages stages={stages} />);
    expect(screen.getByLabelText('đã xong')).toBeInTheDocument();
    expect(screen.getByLabelText('đang chạy')).toBeInTheDocument();
    expect(screen.getByLabelText('chờ')).toBeInTheDocument();
  });

  it('đếm số bước đã xong để biết còn bao xa', () => {
    render(<WorkflowStages stages={stages} />);
    expect(screen.getByText('1/3 bước')).toBeInTheDocument();
  });

  /** Bỏ qua cũng là đã qua: nó không được tính là còn phải làm. */
  it('bước bỏ qua được tính là đã qua', () => {
    render(
      <WorkflowStages
        stages={[{ name: 'a', status: 'skipped' }, { name: 'b', status: 'pending' }]}
      />,
    );
    expect(screen.getByText('1/2 bước')).toBeInTheDocument();
    expect(screen.getByLabelText('bỏ qua')).toBeInTheDocument();
  });

  it('bước hỏng hiện rõ là hỏng', () => {
    render(<WorkflowStages stages={[{ name: 'a', status: 'failed' }]} />);
    expect(screen.getByLabelText('hỏng')).toBeInTheDocument();
  });

  it('không có bước nào thì không chiếm chỗ', () => {
    const { container } = render(<WorkflowStages stages={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

/**
 * Server đánh dấu bước hiện tại là `running` kể cả khi nó đang chờ người duyệt
 * — với server thì đó vẫn là bước đang mở. Nhưng vòng quay nghĩa là "đang xử
 * lý, cứ đợi", nên nó quay mãi ở một bước sẽ không bao giờ tự xong: người dùng
 * ngồi đợi một thứ đang đợi chính họ.
 */
describe('WorkflowStages — chờ máy hay chờ người', () => {
  const atReview = [
    { name: 'Sinh bộ testcase', status: 'done' as const },
    { name: 'Chờ duyệt / chỉnh sửa testcase', status: 'running' as const },
    { name: 'Chạy các kịch bản đã duyệt', status: 'pending' as const },
  ];

  it('workflow chờ người thì bước đó nói "đang chờ bạn", không quay', () => {
    render(<WorkflowStages stages={atReview} runStatus="waiting_review" />);
    expect(screen.getByLabelText('đang chờ bạn')).toBeInTheDocument();
    expect(screen.queryByLabelText('đang chạy')).not.toBeInTheDocument();
  });

  it('workflow đang chạy thật thì vẫn quay như cũ', () => {
    render(<WorkflowStages stages={atReview} runStatus="running" />);
    expect(screen.getByLabelText('đang chạy')).toBeInTheDocument();
    expect(screen.queryByLabelText('đang chờ bạn')).not.toBeInTheDocument();
  });

  it('chờ trả lời câu hỏi cũng là chờ người', () => {
    render(<WorkflowStages stages={atReview} runStatus="waiting_input" />);
    expect(screen.getByLabelText('đang chờ bạn')).toBeInTheDocument();
  });

  it('không biết trạng thái lượt chạy thì giữ nguyên cách cũ', () => {
    render(<WorkflowStages stages={atReview} />);
    expect(screen.getByLabelText('đang chạy')).toBeInTheDocument();
  });
});
