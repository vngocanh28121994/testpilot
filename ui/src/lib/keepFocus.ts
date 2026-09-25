import type { PointerEvent } from 'react';

/**
 * Chạm vào một mục trong danh sách mở dưới ô nhập thì GIỮ focus ở ô nhập.
 *
 * Trên iPad và iPhone (Safari), chạm vào một `<button>` KHÔNG làm nút nhận
 * focus. Ô nhập mất focus với `relatedTarget` rỗng, cụm hiểu là "người dùng
 * bấm ra ngoài" và đóng danh sách — trước khi cú chạm kịp thành `click`. Kết
 * quả: không chọn được tag nào trên điện thoại, còn trên máy tính thì vẫn được
 * (Chrome cho nút nhận focus). Chặn hành vi mặc định của `pointerdown` giữ
 * nguyên focus mà KHÔNG chặn `click`, cũng không chặn cuộn danh sách.
 *
 * Bỏ qua chính các ô nhập: chặn ở đó là không đặt được con trỏ vào ô.
 */
export function keepFocusInside(event: PointerEvent<HTMLElement>): void {
  const target = event.target as HTMLElement | null;
  if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
  event.preventDefault();
}
