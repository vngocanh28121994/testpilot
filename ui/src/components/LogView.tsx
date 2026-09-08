import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

const VERDICT = /^\[run:(passed|failed|flaky|skip|running|unapproved|abort)\]\s*(.*)$/;
const SUMMARY =
  /^\[run:summary\]\s*(\d+)✓\s*(\d+)✗\s*(\d+)~\s*(\d+)⊘(?:\s*(\d+)✎)?(?:\s*(\d+)⚠)?$/;
const URL_PART = /(https?:\/\/\S+)/g;

const TONE: Record<string, string> = {
  passed: 'text-status-pass',
  failed: 'text-status-fail',
  flaky: 'text-status-flaky',
  running: 'text-status-running',
  skip: 'text-(--log-muted)',
  unapproved: 'text-status-flaky',
  abort: 'text-status-fail',
};

/** Một dòng sau khi đã gộp: dòng "đang chạy" biến mất khi có kết quả. */
interface Row {
  key: string;
  kind: string | null;
  text: string;
}

/**
 * Gộp log thành các dòng để hiển thị.
 *
 * CLI in tên kịch bản hai lần — "… tên" lúc bắt đầu, "✓ tên" lúc xong — vì lúc
 * bắt đầu nó chưa biết kết quả. Hiện cả hai thì một suite mười kịch bản đọc như
 * hai mươi, và mắt phải tự ghép cặp. Bản cũ thay dòng đang chạy bằng dòng kết
 * quả ngay tại chỗ nó đứng; đây là chỗ làm việc đó.
 */
function toRows(logs: string[]): Row[] {
  const rows: Row[] = [];
  const runningAt = new Map<string, number>();

  logs.forEach((line, i) => {
    const verdict = VERDICT.exec(line);
    if (!verdict) {
      rows.push({ key: `l${i}`, kind: null, text: line });
      return;
    }
    const [, kind, text] = verdict;
    // Icon nằm trong chính phần text và khác nhau giữa hai lần in, nên khoá
    // theo tên đã bỏ icon — nếu không thì không cặp nào khớp và mọi kịch bản
    // vẫn hiện hai lần.
    const name = text!.replace(/^[…✓✗~⊘✎]\s*/, '');
    if (kind === 'running') {
      runningAt.set(name, rows.length);
      rows.push({ key: `l${i}`, kind, text: text! });
      return;
    }
    const at = runningAt.get(name);
    if (at !== undefined) {
      rows[at] = { key: rows[at]!.key, kind: kind!, text: text! };
      runningAt.delete(name);
      return;
    }
    rows.push({ key: `l${i}`, kind: kind!, text: text! });
  });

  return rows;
}

/**
 * Khung log của một luồng đang chạy.
 *
 * Ba việc mà một <pre>{logs.join('\n')}</pre> không làm được:
 *
 * 1. Bám dòng mới nhất — cả trong khung LẪN ở cấp trang. Khung tự cuộn mà nó
 *    lại nằm dưới màn hình thì người dùng vẫn không thấy gì, và một lượt chạy
 *    kéo dài nhiều phút.
 * 2. Gộp "đang chạy" với kết quả của nó, và dựng dòng tổng kết cho ra hồn.
 * 3. Biến URL thành link. Device Farm in link artifact dài 500 ký tự; hiện nó
 *    dưới dạng chữ chết nghĩa là bắt người ta chép tay.
 */
export function LogView({
  logs,
  dropped = 0,
  error,
  className,
  label = 'Log',
}: {
  /**
   * Chuỗi cũng nhận được, không chỉ mảng.
   *
   * Log đến từ hai nguồn có hình dạng khác nhau — luồng đang chạy đưa từng dòng,
   * còn report đã lưu và network log là một khối chữ. Bắt mỗi chỗ gọi tự tách
   * dòng là cách để vài chỗ quên mất, rồi lại mọc ra một kiểu hiển thị log thứ hai.
   */
  logs: string[] | string;
  dropped?: number;
  error?: string | null;
  className?: string;
  label?: string;
}) {
  const lines = typeof logs === 'string' ? logs.split('\n') : logs;
  const rowCount = lines.length;
  const box = useRef<HTMLPreElement>(null);
  // Người đọc đang ở cuối hay đã cuộn lên. Giữ ngoài state vì nó chỉ được đọc
  // trong effect; đưa vào state sẽ render lại mỗi lần cuộn mà không đổi gì.
  const pinned = useRef(true);

  useEffect(() => {
    const el = box.current;
    // Cuộn lên đọc lại đoạn trước KHÔNG được bị dòng mới kéo tuột xuống. Chỉ
    // bám đuôi khi người đọc vốn đã ở đuôi.
    if (!el || !pinned.current) return;
    el.scrollTop = el.scrollHeight;
    // Và kéo cả trang theo, đúng bằng phần khung đang lòi ra khỏi màn hình.
    // Thiếu bước này thì khung cuộn đúng nhưng vẫn nằm ngoài tầm mắt.
    const overshoot = el.getBoundingClientRect().bottom - window.innerHeight + 8;
    if (overshoot > 0) window.scrollBy({ top: overshoot, behavior: 'instant' });
  }, [rowCount, error]);

  const rows = toRows(lines);

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
        {rows.map((row) => (
          <Line key={row.key} kind={row.kind} text={row.text} />
        ))}
        {error && <span className="text-status-fail block">{error}</span>}
      </pre>
    </div>
  );
}

function Line({ kind, text }: { kind: string | null; text: string }) {
  if (kind) return <span className={cn('block', TONE[kind])}>{text}</span>;

  const summary = SUMMARY.exec(text);
  if (summary) return <Summary counts={summary} />;

  // `[run:dir]` là đường dẫn nội bộ — tín hiệu cho máy đọc, không phải câu cho
  // người. `[run]` và các tiền tố khác vẫn hiện nguyên văn: chúng là câu tiếng
  // Việt viết cho người đọc.
  if (text.startsWith('[run:dir]')) return null;

  return <span className="block">{linkify(text) ?? ' '}</span>;
}

function Summary({ counts }: { counts: RegExpExecArray }) {
  const [, pass, fail, flaky, skip, unapproved, known] = counts;
  return (
    <>
      <span className="text-(--log-muted) block">{'─'.repeat(40)}</span>
      <span className="block font-medium">
        <span className="text-status-pass">{pass} pass</span>
        {'  '}
        <span className="text-status-fail">{fail} fail</span>
        {Number(flaky) > 0 && (
          <>
            {'  '}
            <span className="text-status-flaky">{flaky} flaky</span>
          </>
        )}
        {Number(skip) > 0 && (
          <>
            {'  '}
            <span className="text-(--log-muted)">{skip} bỏ qua</span>
          </>
        )}
        {Number(unapproved) > 0 && (
          <>
            {'  '}
            <span className="text-status-flaky">{unapproved} chưa duyệt</span>
          </>
        )}
        {Number(known) > 0 && (
          <>
            {'  '}
            {/* Đếm riêng khỏi fail: đây là chuyện của sản phẩm, không phải của test. */}
            <span className="text-status-flaky">{known} known issue</span>
          </>
        )}
      </span>
    </>
  );
}

/** URL thành link; phần còn lại giữ nguyên chữ. */
function linkify(text: string): ReactNode {
  if (!URL_PART.test(text)) return text;
  URL_PART.lastIndex = 0;
  return text.split(URL_PART).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noreferrer noopener" className="underline">
        {part}
      </a>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}
