import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Dấu chạm hiện NGAY chỗ người dùng vừa bấm hoặc vuốt trên màn hình máy.
 *
 * Màn hình thật đổi chậm hơn tay người: iPhone mất ~0,6 giây cho một cú chạm
 * (XCTest trên máy), và mọi cú vuốt chỉ bắt đầu sau khi nhả chuột. Không có
 * gì phản hồi ngay thì người ta tưởng bấm trượt và bấm lại — thành hai thao tác
 * xếp hàng, và độ trễ nhân đôi. Dấu này không làm máy nhanh hơn; nó nói "đã
 * nhận, đang làm".
 *
 * Toạ độ theo điểm ảnh CSS của khung vẽ, không theo toạ độ máy: dấu vẽ đè lên
 * đúng chỗ con trỏ, bất kể khung đang thu nhỏ bao nhiêu.
 */
export type TouchMark =
  | { kind: 'tap'; x: number; y: number }
  | { kind: 'swipe'; x: number; y: number; toX: number; toY: number };

const LIFETIME_MS = 900;

export function useTouchMarks(): {
  marks: Array<TouchMark & { id: number }>;
  add: (mark: TouchMark) => void;
} {
  const [marks, setMarks] = useState<Array<TouchMark & { id: number }>>([]);
  const next = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => { for (const timer of pending) clearTimeout(timer); };
  }, []);

  const add = useCallback((mark: TouchMark) => {
    next.current += 1;
    const id = next.current;
    setMarks((prev) => [...prev, { ...mark, id }]);
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setMarks((prev) => prev.filter((each) => each.id !== id));
    }, LIFETIME_MS);
    timers.current.add(timer);
  }, []);

  return { marks, add };
}
