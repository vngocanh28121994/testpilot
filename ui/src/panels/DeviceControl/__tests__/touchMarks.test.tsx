import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTouchMarks } from '@/hooks/useTouchMarks';
import { TouchMarks } from '../TouchMarks';

describe('dấu chạm trên màn hình máy', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('hiện ngay chỗ vừa chạm, rồi tự biến mất', () => {
    const { result } = renderHook(() => useTouchMarks());
    act(() => result.current.add({ kind: 'tap', x: 40, y: 80 }));
    const { rerender } = render(<TouchMarks marks={result.current.marks} />);
    const mark = screen.getByTestId('touch-mark');
    expect(mark.style.left).toBe('40px');
    expect(mark.style.top).toBe('80px');

    act(() => { vi.advanceTimersByTime(1_000); });
    rerender(<TouchMarks marks={result.current.marks} />);
    expect(screen.queryByTestId('touch-mark')).toBeNull();
  });

  it('vuốt thì vẽ vệt từ điểm đầu tới điểm cuối, dấu tròn ở điểm cuối', () => {
    const { result } = renderHook(() => useTouchMarks());
    act(() => result.current.add({ kind: 'swipe', x: 10, y: 200, toX: 10, toY: 50 }));
    render(<TouchMarks marks={result.current.marks} />);
    const trail = screen.getByTestId('touch-trail');
    expect(trail.getAttribute('y1')).toBe('200');
    expect(trail.getAttribute('y2')).toBe('50');
    expect(screen.getByTestId('touch-mark').style.top).toBe('50px');
  });

  it('nhiều cú chạm liền nhau đều hiện, mỗi cú một dấu', () => {
    const { result } = renderHook(() => useTouchMarks());
    act(() => {
      result.current.add({ kind: 'tap', x: 1, y: 1 });
      result.current.add({ kind: 'tap', x: 2, y: 2 });
    });
    render(<TouchMarks marks={result.current.marks} />);
    expect(screen.getAllByTestId('touch-mark')).toHaveLength(2);
  });
});
