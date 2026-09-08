import { useState } from 'react';
import { LogView } from '@/components/LogView';
import { api } from '@/api/client';

/**
 * Log chỉ được tải khi người dùng bung nó ra.
 *
 * Log là thứ dài nhất mà lại ít được xem nhất: trước đây mọi lượt chạy mang
 * trọn log của mình trong mỗi lần gọi /api/state — tức là trả giá cho nó sau
 * mỗi thao tác trên trang, cho một thứ chỉ được mở khi có chuyện.
 *
 * Tải đúng MỘT lần: `<details>` bắn onToggle cả khi đóng lại, và người ta đóng
 * mở vài lần là chuyện thường.
 */
export function LazyLog({
  url,
  summary = 'Log',
  label,
  className,
}: {
  url: string;
  summary?: string;
  label: string;
  className?: string;
}) {
  const [text, setText] = useState<string | null>(null);

  return (
    <details
      className="mt-3"
      onToggle={(event) => {
        if (!(event.currentTarget as HTMLDetailsElement).open || text !== null) return;
        void api
          .getText(url)
          // Lỗi hiện ra ở đúng chỗ log lẽ ra phải nằm; một khung rỗng đọc như
          // "lượt chạy này không có log gì", vốn là chuyện khác hẳn.
          .then(setText)
          .catch((err: Error) => setText(`Không đọc được log: ${err.message}`));
      }}
    >
      <summary className="cursor-pointer text-sm">{summary}</summary>
      <LogView logs={text ?? 'Đang tải…'} label={label} className={className} />
    </details>
  );
}
