import { useMemo, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

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
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1">
              {tag}
              <button
                type="button"
                aria-label={`Bỏ ${tag}`}
                onClick={() => onChange(value.filter((t) => t !== tag))}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Input
        className="mt-0"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
          // Enter chọn mục đầu tiên đang lọc: gõ "posi" rồi Enter là xong, không
          // phải rời tay khỏi bàn phím để đi bấm chuột.
          if (event.key === 'Enter' && shown[0]) {
            event.preventDefault();
            toggle(shown[0]);
          }
        }}
        placeholder={value.length > 0 ? 'Thêm tag…' : 'Tất cả tag'}
        aria-label="Lọc theo tag"
        aria-expanded={open}
      />
      {(open || clean.length > 0) && (
        <div className="bg-popover absolute top-full right-0 left-0 z-20 mt-1 flex max-h-64 flex-col overflow-auto rounded-md border p-1 shadow-lg">
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
      {value.length > 1 && (
        <span className="text-muted-foreground text-xs">
          Chỉ chạy kịch bản mang đủ {value.length} tag trên.
        </span>
      )}
    </div>
  );
}
