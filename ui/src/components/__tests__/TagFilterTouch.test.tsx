import { describe, expect, it, vi } from 'vitest';
import { createEvent, fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { TagFilter } from '../TagFilter';

/**
 * Trên iPad/iPhone không chọn được tag: Safari không cho nút nhận focus khi
 * chạm, nên ô nhập mất focus với `relatedTarget` rỗng và danh sách đóng lại
 * TRƯỚC khi cú chạm thành `click`. Bài test mô phỏng đúng trình tự ấy: nếu
 * `pointerdown` không bị chặn thì có một cú blur "đi đâu cũng không phải".
 */
function tapLikeSafari(target: HTMLElement, input: HTMLElement) {
  const down = createEvent.pointerDown(target);
  fireEvent(target, down);
  if (!down.defaultPrevented) fireEvent.blur(input, { relatedTarget: null });
  fireEvent.click(target);
}

describe('TagFilter trên màn cảm ứng', () => {
  it('chạm vào một tag là chọn được, danh sách không đóng giữa chừng', () => {
    const onChange = vi.fn();
    renderWithProviders(<TagFilter all={['@boundary', '@smoke']} value={[]} onChange={onChange} />);
    const input = screen.getByRole('searchbox', { name: 'Lọc theo tag' });
    fireEvent.focus(input);

    tapLikeSafari(screen.getByRole('checkbox', { name: '@boundary' }), input);

    expect(onChange).toHaveBeenCalledWith(['@boundary']);
  });

  it('chạm vào chính ô nhập vẫn đặt được con trỏ (không chặn)', () => {
    renderWithProviders(<TagFilter all={['@smoke']} value={[]} onChange={() => {}} />);
    const input = screen.getByRole('searchbox', { name: 'Lọc theo tag' });
    const down = createEvent.pointerDown(input);
    fireEvent(input, down);
    expect(down.defaultPrevented).toBe(false);
  });
});
