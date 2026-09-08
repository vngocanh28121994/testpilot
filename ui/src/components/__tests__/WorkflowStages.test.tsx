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
