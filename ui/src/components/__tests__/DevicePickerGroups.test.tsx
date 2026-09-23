/**
 * Ô chọn máy của Studio nhóm theo MÁY TÍNH, giống Local Runner.
 *
 * Hai màn hỏi cùng một câu — "chạy trên máy nào" — nên chúng phải hỏi bằng
 * cùng một hình dạng. Trước đây Local Runner gom theo máy tính còn Studio là
 * một hàng radio phẳng không nói máy nằm ở đâu, và "Pixel 7" một mình không
 * trả lời được câu người dùng cần trả lời trước khi bấm chạy.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DevicePicker } from '@/components/DevicePicker';

describe('ô chọn máy theo nhóm máy tính', () => {
  it('nhiều máy tính thì hiện tiêu đề nhóm, máy của mình lên trước', () => {
    render(
      <DevicePicker
        name="android"
        candidates={[
          { id: 'a', label: 'Pixel 7', runnerName: 'phòng máy' },
          { id: 'b', label: 'SM-S918B', runnerName: 'laptop của Bình', mine: true },
        ]}
        onPick={vi.fn()}
      />,
    );
    const groups = screen.getAllByText(/phòng máy|laptop của Bình/);
    expect(groups[0]!.textContent).toBe('laptop của Bình');
    expect(screen.getByText('máy của bạn')).toBeInTheDocument();
  });

  it('chỉ một máy tính thì KHÔNG hiện tiêu đề nhóm', () => {
    // Một tiêu đề cho một nhóm duy nhất là một dòng chữ không nói thêm gì —
    // và màn Local Runner của phần lớn người dùng chỉ có đúng một máy tính.
    render(
      <DevicePicker
        name="android"
        candidates={[
          { id: 'a', label: 'Pixel 7', runnerName: 'máy chủ' },
          { id: 'b', label: 'SM-S918B', runnerName: 'máy chủ' },
        ]}
        onPick={vi.fn()}
      />,
    );
    expect(screen.queryByText('máy chủ')).toBeNull();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('chưa biết máy nằm ở đâu thì vẫn chọn được', () => {
    render(
      <DevicePicker
        name="android"
        candidates={[{ id: 'a', label: 'Pixel 7' }]}
        onPick={vi.fn()}
      />,
    );
    expect(screen.getByRole('radio', { name: 'Pixel 7' })).toBeInTheDocument();
  });
});
