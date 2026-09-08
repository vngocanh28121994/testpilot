import { useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { tokenizeLine, type TokenKind } from '@/lib/gherkinTokens';
import { cn } from '@/lib/utils';

/**
 * Mọi thứ quyết định việc một ký tự rơi vào đâu trên màn hình.
 *
 * Đặt thành style nội tuyến dùng chung cho CẢ HAI lớp, không phải class tiện
 * ích: căn chữ của hai lớp chồng nhau không được phép phụ thuộc vào thứ tự các
 * class thắng nhau trong CSS. Đã lệch đúng kiểu đó một lần — `leading-5` có
 * trên cả hai lớp mà textarea vẫn nhận line-height 16px trong khi <pre> nhận
 * 20px, nên chữ tô màu trôi dần một dòng mỗi năm dòng.
 */
const METRICS = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.75rem',
  lineHeight: '1.25rem',
  padding: '0.5rem 0.75rem',
  tabSize: 2,
  // Không xuống dòng mềm, và cuộn ngang khi câu dài — đúng như một IDE.
  // Không phải chuyện thẩm mỹ: cột số dòng vẽ mỗi dòng lôgic một hàng, nên một
  // câu bị bẻ làm hai hàng là mọi số bên dưới nó lệch đi một hàng. Đã thấy đúng
  // như vậy trên màn hình trước khi đổi.
  whiteSpace: 'pre',
  overflowWrap: 'normal',
  wordBreak: 'normal',
} as const;

const COLOR: Record<TokenKind, string> = {
  heading: 'text-(--gk-heading) font-semibold',
  step: 'text-(--gk-step) font-semibold',
  tag: 'text-(--gk-tag)',
  string: 'text-(--gk-string)',
  param: 'text-(--gk-param)',
  comment: 'text-(--gk-comment) italic',
  number: 'text-(--gk-number)',
  table: 'text-(--gk-table)',
  text: '',
};

/**
 * Ô soạn Gherkin có tô màu từ khoá và số dòng.
 *
 * Dựng bằng một <textarea> trong suốt nằm CHỒNG lên một <pre> đã tô màu, chứ
 * không phải một contenteditable hay một thư viện soạn thảo. Lý do rất cụ thể:
 * máy này không ra được npm registry, nên CodeMirror hay Monaco là không cài
 * được. Nhưng đổi lại cũng được nhiều thứ — textarea thật giữ nguyên con trỏ
 * của hệ điều hành, chọn chữ, hoàn tác, gõ tiếng Việt bằng bộ gõ, đọc màn hình,
 * và toàn bộ code chèn-tại-con-trỏ cùng phím Tab đã viết trước đó không phải
 * đụng tới. Một contenteditable sẽ phá tất cả những thứ đó.
 *
 * Hai lớp phải khớp từng pixel: cùng font, cùng cỡ chữ, cùng line-height, cùng
 * padding, cùng cách xuống dòng. Lệch một chỗ nào trong số đó là chữ tô màu
 * trôi khỏi chữ đang gõ, càng xuống dưới càng lệch.
 */
export function GherkinEditor({
  value,
  onChange,
  onKeyDown,
  textareaRef,
  className,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  className?: string;
  'aria-label': string;
}) {
  const own = useRef<HTMLTextAreaElement>(null);
  const area = textareaRef ?? own;
  const highlight = useRef<HTMLPreElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(0);

  const lines = value.split('\n');

  // Cuộn textarea thì hai lớp kia phải cuộn theo đúng cùng lúc — đây là chỗ duy
  // nhất giữ ba lớp thẳng hàng khi nội dung dài hơn khung.
  const syncScroll = () => {
    const source = area.current;
    if (!source) return;
    if (highlight.current) {
      highlight.current.scrollTop = source.scrollTop;
      highlight.current.scrollLeft = source.scrollLeft;
    }
    if (gutter.current) gutter.current.scrollTop = source.scrollTop;
    setScrolled(source.scrollTop);
  };

  return (
    <div
      className={cn(
        'border-input bg-background focus-within:border-ring focus-within:ring-ring/50 relative flex overflow-hidden rounded-md border font-mono text-xs focus-within:ring-[3px]',
        className,
      )}
    >
      <div
        ref={gutter}
        aria-hidden="true"
        style={{
          ...METRICS,
          padding: '0.5rem 0',
          width: `${Math.max(2, String(lines.length).length) + 1.5}ch`,
        }}
        className="bg-muted/40 text-muted-foreground border-input shrink-0 overflow-hidden border-r text-right select-none"
      >
        <div style={{ transform: `translateY(-${scrolled}px)` }}>
          {lines.map((_, i) => (
            <div key={i} className="px-1.5">
              {i + 1}
            </div>
          ))}
        </div>
      </div>

      <div className="relative min-w-0 flex-1">
        <pre
          ref={highlight}
          aria-hidden="true"
          style={METRICS}
          className="pointer-events-none absolute inset-0 overflow-hidden"
        >
          {lines.map((line, i) => (
            <div key={i}>
              {/* Dòng rỗng vẫn phải chiếm một dòng, nếu không hai lớp lệch nhau
                  ngay từ dòng trống đầu tiên. */}
              {line === '' ? (
                '\n'
              ) : (
                tokenizeLine(line).map((token, j) => (
                  <span key={j} className={COLOR[token.kind]}>
                    {token.text}
                  </span>
                ))
              )}
            </div>
          ))}
        </pre>

        <textarea
          ref={area}
          aria-label={ariaLabel}
          spellCheck={false}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          onScroll={syncScroll}
          // `wrap="off"` là thứ thật sự tắt xuống dòng mềm trong textarea;
          // white-space ở trên chỉ lo phần hiển thị của lớp tô màu.
          wrap="off"
          style={METRICS}
          // caret-color riêng: chữ trong suốt thì con trỏ cũng trong suốt theo,
          // và một ô soạn không nhìn thấy con trỏ là một ô soạn không dùng được.
          className="caret-foreground relative h-full w-full resize-none overflow-auto bg-transparent text-transparent outline-none"
        />
      </div>
    </div>
  );
}
