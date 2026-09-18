import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

const VERDICT = /^\[run:(passed|failed|flaky|skip|running|unapproved|abort)\]\s*(.*)$/;
const SUMMARY =
  /^\[run:summary\]\s*(\d+)✓\s*(\d+)✗\s*(\d+)~\s*(\d+)⊘(?:\s*(\d+)✎)?(?:\s*(\d+)⚠)?$/;
const URL_PART = /(https?:\/\/\S+)/g;
const ACTIVE_WORDS = /(đang|chờ|đợi|tải|upload|download|đóng gói|chuẩn bị|khởi tạo|kết nối|scheduling|running|waiting|loading)/iu;
const FINISHED_WORDS = /(đã xong|hoàn tất|hoàn thành|complete|completed|failed|thất bại|lỗi|✓|✗)/iu;
const TRAILING_DOTS = /(?:\s*(?:\.{1,3}|…))\s*$/u;

const TONE: Record<string, string> = {
  passed: 'text-status-pass',
  failed: 'text-status-fail',
  flaky: 'text-status-flaky',
  running: 'text-status-running',
  skip: 'text-(--log-muted)',
  unapproved: 'text-status-flaky',
  abort: 'text-status-fail',
};

const CASE_ROW_TONE: Record<string, string> = {
  passed: 'border-status-pass/35 bg-(--tint-pass)',
  failed: 'border-status-fail/35 bg-(--tint-fail)',
  flaky: 'border-status-flaky/35 bg-(--tint-warn)',
  running: 'border-status-running/35 bg-background/75',
  skip: 'border-border bg-background/60',
  unapproved: 'border-status-flaky/35 bg-(--tint-warn)',
  abort: 'border-status-fail/35 bg-(--tint-fail)',
};

/**
 * Tiền tố nền tảng mà workflow gói quanh từng dòng của run con.
 *
 * Workflow chạy nhiều nền tảng SONG SONG và trộn dòng của chúng vào một luồng,
 * nên `server.ts` ghi `[android] …` để biết dòng nào của ai. Hữu ích — nhưng mọi
 * luật ở file này đều neo `^`, nên tiền tố ấy đẩy chúng ra khỏi mỏ neo và cả bộ
 * nhận diện chết một lượt: dòng ✓/✗ mất màu, `[run:dir]` lẽ ra bị ẩn thì hiện
 * ra, cảnh báo mất nhấn mạnh, dòng tổng kết không dựng được thành bảng đếm.
 * Trớ trêu nhất là WORKFLOW_MILESTONE — luật viết riêng cho workflow — cũng
 * chết ngay trong màn workflow.
 *
 * Liệt kê đúng ba nền tảng thay vì `\[[^\]]+\]` tổng quát: `[run:dir]`,
 * `[flow]`, `[cdp]` cũng là ngoặc vuông đầu dòng, và bóc nhầm chúng thì hỏng
 * đúng những luật đang muốn cứu.
 */
const PLATFORM_PREFIX = /^\[(android|ios|web)\]\s+/;

const NEEDS_ATTENTION = /^(?:❓|⚠️?|Còn thiếu testcase|Cảnh báo thiếu testcase)/iu;
const WORKFLOW_MILESTONE = /^(?:Workflow\s|Bind OK\b|\d+\/\d+ testcase\b|Đã bao phủ đầy đủ\b)/iu;

/** Một dòng sau khi đã gộp: dòng "đang chạy" biến mất khi có kết quả. */
interface Row {
  key: string;
  kind: string | null;
  text: string;
  /** Nền tảng đã bóc khỏi đầu dòng, giữ lại để hiện thành nhãn. */
  platform?: string;
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
    // Bóc tiền tố MỘT LẦN, ngay đầu vào: từ đây trở xuống mọi luật lại được so
    // với dòng gốc, đúng như khi Local Runner đưa vào.
    const prefix = PLATFORM_PREFIX.exec(line);
    const platform = prefix?.[1];
    const body = prefix ? line.slice(prefix[0].length) : line;

    const verdict = VERDICT.exec(body);
    if (!verdict) {
      rows.push({ key: `l${i}`, kind: null, text: humanizeLogText(body), platform });
      return;
    }
    const [, kind, rawText] = verdict;
    const text = humanizeLogText(rawText!);
    // Icon nằm trong chính phần text và khác nhau giữa hai lần in, nên khoá
    // theo tên đã bỏ icon — nếu không thì không cặp nào khớp và mọi kịch bản
    // vẫn hiện hai lần.
    //
    // Khoá kèm nền tảng: workflow chạy song song, và hai nền tảng chạy CÙNG một
    // kịch bản thì tên trùng nhau. Không tách ra thì dòng ✓ của android ghi đè
    // lên dòng "đang chạy" của web, và web mất luôn kết quả của mình.
    const name = `${platform ?? ''}\u0000${text!.replace(/^[…✓✗~⊘✎]\s*/, '')}`;
    if (kind === 'running') {
      runningAt.set(name, rows.length);
      rows.push({ key: `l${i}`, kind, text: text!, platform });
      return;
    }
    const at = runningAt.get(name);
    if (at !== undefined) {
      rows[at] = { key: rows[at]!.key, kind: kind!, text: text!, platform };
      runningAt.delete(name);
      return;
    }
    rows.push({ key: `l${i}`, kind: kind!, text: text!, platform });
  });

  return rows;
}

/** Hide internal prioritisation jargon from business-facing progress logs. */
function humanizeLogText(text: string): string {
  return text
    .replace(
      'Đang kiểm tra lại coverage P0/P1 trên nội dung đã duyệt/chỉnh sửa…',
      'Đang đối chiếu testcase đã duyệt với các yêu cầu nghiệp vụ quan trọng…',
    )
    .replace(/Cảnh báo coverage:/giu, 'Cảnh báo thiếu testcase:')
    .replace(/Coverage PASS/giu, 'Đã bao phủ đầy đủ')
    .replace(/Coverage còn thiếu/giu, 'Còn thiếu testcase cho')
    .replace(/quy tắc P0\/P1/giu, 'yêu cầu nghiệp vụ quan trọng');
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
  active = false,
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
  /** The producer is still working; animate its latest wait/progress line. */
  active?: boolean;
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
  let lastVisible = -1;
  rows.forEach((row, index) => {
    if (!row.text.startsWith('[run:dir]')) lastVisible = index;
  });

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
        {rows.map((row, index) => (
          <Line
            key={row.key}
            kind={row.kind}
            text={row.text}
            platform={row.platform}
            animated={
              !error && (
                row.kind === 'running'
                || (active && index === lastVisible && isActiveLine(row.text))
              )
            }
          />
        ))}
        {error && <span className="text-status-fail block">{error}</span>}
      </pre>
    </div>
  );
}

function Line({
  kind,
  text,
  animated,
  platform,
}: {
  kind: string | null;
  text: string;
  animated: boolean;
  platform?: string;
}) {
  // Giữ lại chứ không vứt đi: workflow trộn dòng của nhiều nền tảng vào một
  // luồng, nên "dòng này của ai" là thông tin thật. Chỉ là nó thuộc về một cái
  // nhãn, không thuộc về đầu câu.
  const tag = platform ? (
    <span className="text-muted-foreground me-1.5 rounded bg-black/5 px-1 text-[0.85em] dark:bg-white/10">
      {platform}
    </span>
  ) : null;

  if (kind) {
    return (
      <span
        data-log-row="testcase"
        className={cn(
          'my-1 block rounded-md border px-2.5 py-1.5 font-sans font-semibold shadow-xs',
          TONE[kind],
          CASE_ROW_TONE[kind],
        )}
      >
        {tag}
        {animated ? <ProgressText text={text} /> : text}
      </span>
    );
  }

  const summary = SUMMARY.exec(text);
  if (summary) return <Summary counts={summary} />;

  // `[run:dir]` là đường dẫn nội bộ — tín hiệu cho máy đọc, không phải câu cho
  // người. `[run]` và các tiền tố khác vẫn hiện nguyên văn: chúng là câu tiếng
  // Việt viết cho người đọc.
  if (text.startsWith('[run:dir]')) return null;

  if (NEEDS_ATTENTION.test(text)) {
    return (
      <span
        data-log-row="attention"
        className="border-status-flaky/40 bg-(--tint-warn) my-1 block rounded-md border-s-[3px] px-2.5 py-1.5 font-sans font-medium text-status-flaky"
      >
        {tag}
        {animated ? <ProgressText text={text} /> : (linkify(text) ?? ' ')}
      </span>
    );
  }

  if (WORKFLOW_MILESTONE.test(text)) {
    return (
      <span
        data-log-row="milestone"
        className="border-border bg-background/70 my-1 block rounded-md border px-2.5 py-1.5 font-sans font-medium"
      >
        {tag}
        {animated ? <ProgressText text={text} /> : (linkify(text) ?? ' ')}
      </span>
    );
  }

  return (
    <span className="block">
      {tag}
      {animated ? <ProgressText text={text} /> : (linkify(text) ?? ' ')}
    </span>
  );
}

function isActiveLine(text: string): boolean {
  return ACTIVE_WORDS.test(text) && !FINISHED_WORDS.test(text);
}

/** Keep the stored log immutable; only the rendered suffix moves. */
function ProgressText({ text }: { text: string }) {
  const base = text.replace(TRAILING_DOTS, '');
  return (
    <>
      {linkify(base)}
      <span className="log-progress-dots" aria-hidden="true">
        <span>.</span><span>.</span><span>.</span>
      </span>
    </>
  );
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
