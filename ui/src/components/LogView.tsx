import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * Khung log của một luồng đang chạy.
 *
 * Hai việc mà một <pre>{logs.join('\n')}</pre> không làm được, và bản trước
 * đúng là chỉ có thế:
 *
 * 1. Tự cuộn theo dòng mới. Một lượt chạy đổ log trong nhiều phút; không cuộn
 *    thì dòng mới nhất — thứ duy nhất đáng nhìn — nằm ngoài màn hình suốt.
 * 2. Phân biệt được dòng nào là kết quả gì. CLI đã đánh dấu sẵn `[run:passed]`,
 *    `[run:failed]`… nhưng dấu đó bị in ra nguyên văn như một chuỗi rác thay vì
 *    thành màu.
 */
export function LogView({
  logs,
  dropped = 0,
  error,
  className,
  label = 'Log',
}: {
  logs: string[];
  dropped?: number;
  error?: string | null;
  className?: string;
  label?: string;
}) {
  const box = useRef<HTMLPreElement>(null);
  // Người đọc đang ở cuối hay đã cuộn lên. Giữ ngoài state vì nó chỉ được đọc
  // trong effect; đưa vào state sẽ render lại mỗi lần cuộn mà không đổi gì.
  const pinned = useRef(true);

  useEffect(() => {
    const el = box.current;
    // Cuộn lên đọc lại đoạn trước KHÔNG được bị dòng mới kéo tuột xuống. Chỉ
    // bám đuôi khi người đọc vốn đã ở đuôi.
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [logs.length, error]);

  return (
    <div className="flex flex-col gap-1">
      {dropped > 0 && (
        <span className="text-muted-foreground text-xs">
          Đã ẩn {dropped} dòng đầu để giữ trang phản hồi.
        </span>
      )}
      <pre
        ref={box}
        aria-label={label}
        role="log"
        aria-live="polite"
        onScroll={(event) => {
          const el = event.currentTarget;
          // 24px dung sai: cuộn mượt và làm tròn phân số pixel hiếm khi dừng
          // đúng con số tuyệt đối, nên so bằng sẽ hiểu nhầm là đã rời đuôi.
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className={cn('console mt-0', className)}
      >
        {logs.map((line, i) => (
          <Line key={i} text={line} />
        ))}
        {error && <span className="text-status-fail block">{error}</span>}
      </pre>
    </div>
  );
}

/** Màu của một dòng, theo marker CLI in ra ở đầu dòng. */
const TONE: Record<string, string> = {
  passed: 'text-status-pass',
  failed: 'text-status-fail',
  flaky: 'text-status-flaky',
  running: 'text-status-running',
  skip: 'text-(--log-muted)',
  unapproved: 'text-status-flaky',
  abort: 'text-status-fail',
  summary: 'font-medium',
};

const MARKER = /^\[run:([a-z]+)\]\s*(.*)$/;

function Line({ text }: { text: string }) {
  const match = MARKER.exec(text);
  if (!match) return <span className="block">{text || ' '}</span>;

  const [, kind, rest] = match;
  // `[run:dir]` và `[run:env]` là tín hiệu cho máy đọc, không phải câu cho
  // người: dir là đường dẫn thư mục nội bộ, env là ghi chú cài lại app. Ẩn dir,
  // giữ env nhưng làm mờ.
  if (kind === 'dir') return null;
  return <span className={cn('block', TONE[kind!] ?? 'text-(--log-muted)')}>{rest}</span>;
}
