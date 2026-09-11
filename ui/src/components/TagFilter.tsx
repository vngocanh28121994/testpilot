import { useMemo, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

/**
 * Chọn nhiều tag để thu hẹp phạm vi một lượt chạy.
 *
 * Một dropdown chọn-một không diễn đạt được nhu cầu thường gặp nhất: "chạy đúng
 * các case positive của MỘT chức năng". Trước đây phải chọn `@feature-x` rồi
 * ngồi nhìn cả negative chạy theo, hoặc chọn `@positive` rồi nhận positive của
 * mọi chức năng.
 *
 * Nhiều tag ở đây nghĩa là VÀ: kịch bản phải mang đủ tất cả. Đó là hướng người
 * ta dùng bộ lọc — mỗi lần chọn thêm là hẹp lại, không phải rộng ra. Muốn HOẶC
 * thì gõ thẳng `@a,@b` vào đây, dấu phẩy vẫn giữ nghĩa cũ ở tầng dưới.
 *
 * Danh sách dự án này có hàng chục tag, nên có ô tìm: cuộn tay tìm
 * `@feature-chuyen-tien-noi-bo` giữa một rừng thẻ là việc không ai muốn làm lần
 * thứ hai.
 */
/** Bao nhiêu thẻ hiện nguyên hình trong ô trước khi gom phần còn lại thành "+N". */
const VISIBLE_TAGS = 2;

export function TagFilter({
  all,
  value,
  onChange,
}: {
  all: string[];
  /** Đã chọn, theo thứ tự người dùng chọn. */
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const clean = query.trim().toLowerCase();
  const shown = useMemo(
    () => all.filter((tag) => !clean || tag.toLowerCase().includes(clean)),
    [all, clean],
  );

  const toggle = (tag: string) => {
    onChange(value.includes(tag) ? value.filter((t) => t !== tag) : [...value, tag]);
    setQuery('');
  };

  return (
    <div
      ref={box}
      className="relative flex flex-col gap-1"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      {/* Một dòng, không cuộn ngang, không xếp chồng.
          Xếp chồng thì mỗi thẻ đẩy ô cao thêm một dòng và cả hàng lưới lệch
          theo. Cuộn ngang thì thanh cuộn ăn mất gần một nửa trong 36px chiều
          cao, cắt đôi chính những cái thẻ nó cho cuộn. Nên: hiện hai thẻ đầu,
          còn lại gom thành "+N" — bấm vào là mở đúng bảng dùng để bỏ chọn. */}
      <div className="border-input bg-background flex h-9 items-center gap-1 overflow-hidden rounded-md border px-2">
        {value.slice(0, VISIBLE_TAGS).map((tag) => (
          <Badge key={tag} variant="secondary" className="min-w-0 max-w-44 shrink gap-1">
            <span className="truncate">{tag}</span>
            <button
              type="button"
              aria-label={`Bỏ ${tag}`}
              onClick={() => onChange(value.filter((t) => t !== tag))}
            >
              <X className="size-3" />
            </button>
          </Badge>
        ))}
        {value.length > VISIBLE_TAGS && (
          <button
            type="button"
            className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 text-xs"
            aria-label={`Còn ${value.length - VISIBLE_TAGS} tag nữa`}
            onClick={() => setOpen(true)}
          >
            +{value.length - VISIBLE_TAGS}
          </button>
        )}
        {/* `shrink-0`: thẻ co được, ô nhập thì không.
            Để cả hai cùng co thì hai thẻ dài chiếm hết bề ngang và ô "Thêm
            tag…" bị `overflow-hidden` xén mất — nhìn vào tưởng không thêm được
            tag nào nữa. Thẻ cắt bớt chữ còn hơn mất chỗ gõ. */}
        <input
          className="w-20 shrink-0 grow bg-transparent text-sm outline-none"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
            // Enter chọn mục đầu tiên đang lọc: gõ "posi" rồi Enter là xong,
            // không phải rời tay khỏi bàn phím để đi bấm chuột.
            if (event.key === 'Enter' && shown[0]) {
              event.preventDefault();
              toggle(shown[0]);
            }
            // Backspace ở ô rỗng gỡ thẻ cuối, như mọi ô chọn nhiều khác.
            if (event.key === 'Backspace' && query === '' && value.length > 0) {
              onChange(value.slice(0, -1));
            }
          }}
          placeholder={value.length > 0 ? 'Thêm tag…' : 'Tất cả tag'}
          aria-label="Lọc theo tag"
          aria-expanded={open}
        />
      </div>
      {(open || clean.length > 0) && (
        <div className="bg-popover absolute top-full right-0 left-0 z-20 mt-1 flex max-h-64 flex-col overflow-auto rounded-md border p-1 shadow-lg">
          {/* Nói nghĩa "và" ở đây thay vì dưới ô: một dòng chữ hiện ra rồi
              biến mất theo số thẻ cũng làm hàng lưới nhảy. */}
          <span className="text-muted-foreground px-2 py-1 text-xs">
            {value.length > 1
              ? `Chỉ lấy kịch bản mang đủ ${value.length} tag đã chọn.`
              : 'Chọn nhiều tag: chỉ lấy kịch bản mang đủ tất cả.'}
          </span>
          {shown.length === 0 && (
            <span className="text-muted-foreground px-2 py-1 text-xs">
              Không có tag nào khớp “{query}”.
            </span>
          )}
          {shown.map((tag) => (
            <button
              key={tag}
              type="button"
              className="hover:bg-muted flex items-center gap-2 rounded px-2 py-1 text-left text-sm"
              onClick={() => toggle(tag)}
            >
              <Check
                className={value.includes(tag) ? 'size-3.5' : 'size-3.5 opacity-0'}
                aria-hidden
              />
              {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
