import { useMemo, useState } from 'react';
import { Check, ChevronDown, Tags } from 'lucide-react';
import type { StateResponse } from '@core/ui/contracts.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * Lọc theo tag — một nút mở panel, KHÔNG phải một danh sách luôn mở.
 *
 * Khác `TagPicker` ở chỗ này, và khác có chủ đích. `TagPicker` là ô SOẠN tag
 * cho một kịch bản: ở đó danh sách mở sẵn là đúng, vì gán tag chính là việc
 * đang làm. Còn trên thanh lọc, cùng control đó đổ ~15 chip ra giữa toolbar,
 * cao gấp bốn lần các ô bên cạnh và tràn ra ngoài thẻ — nó phá vỡ hàng ngang
 * thay vì nằm trong đó.
 *
 * Đây cũng chính là hình dạng của bản cũ: `#rvTagFilterBtn` mở
 * `#rvTagFilterPanel` có ô tìm và chân panel đếm số tag đã chọn
 * (index.html:227-241).
 */
export function TagFilter({
  value,
  onChange,
  taxonomy,
  options,
  label = 'Tag',
  className,
}: {
  value: string[];
  /**
   * Nhận HÀM CẬP NHẬT, không nhận mảng kết quả.
   *
   * Nếu component này tự tính mảng mới từ `value` rồi đẩy lên, hai cú tick
   * nhanh hơn một lượt điều hướng sẽ cùng đọc một `value` cũ và cú sau ghi đè
   * cú trước — mất một tag. Trả về hàm để bên nhận chạy nó trên state mới nhất.
   */
  onChange: (update: (prev: string[]) => string[]) => void;
  taxonomy: StateResponse['tagTaxonomy'] | undefined;
  /** Tag có thật trong dữ liệu. Lọc chỉ nên chào những tag lọc ra được thứ gì đó. */
  options: string[];
  label?: string;
  /** Bề rộng do nơi gọi quyết định: toolbar cần `w-auto`, ô trong lưới cần `w-full`. */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const definitions = taxonomy?.definitions;

  const all = useMemo(
    () => [...new Set([...options, ...value])].sort(),
    [options, value],
  );
  const labelFor = (tag: string) => definitions?.find((item) => item.name === tag)?.label ?? tag;
  const needle = query.trim().toLowerCase().replace(/^@/, '');
  const shown = needle
    ? all.filter((tag) => `${tag} ${labelFor(tag)}`.toLowerCase().includes(needle))
    : all;

  const toggle = (tag: string) =>
    onChange((prev) => (prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag]));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          // Nút phải nói ra ĐANG lọc mấy tag. "Tag ⌄" trơ ra thì bộ lọc đang bật
          // trông y hệt bộ lọc đang tắt, và người dùng không hiểu vì sao bảng
          // trống.
          aria-label={`${label}${value.length ? `, đang chọn ${value.length}` : ''}`}
          className={cn(
            'h-9 justify-between gap-2 font-normal',
            value.length > 0 && 'border-primary/50',
            className,
          )}
        >
          <span className="flex items-center gap-2">
            <Tags className="size-4 shrink-0 opacity-60" />
            {value.length === 0 ? label : `${value.length} tag`}
          </span>
          <ChevronDown className="size-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>

      {/* `align="end"`: nút này đứng cuối thanh lọc, nên panel phải thả về
          phía TRÁI. Với align="start" nó chạy quá mép phải khung nhìn và Radix
          phải đẩy ngược lại, khiến panel lệch khỏi nút đã mở nó. */}
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b p-2">
          <Input
            className="h-8"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tìm tag…"
            aria-label="Tìm tag"
          />
        </div>

        <div className="max-h-64 overflow-auto p-1">
          {shown.length === 0 && (
            <p className="text-muted-foreground px-2 py-6 text-center text-sm">
              Không có tag nào khớp.
            </p>
          )}
          {shown.map((tag) => {
            const on = value.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => toggle(tag)}
                className="hover:bg-accent flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-start text-sm"
              >
                {/* Ô tick giữ chỗ cả khi chưa chọn: thiếu nó thì nhãn nhảy sang
                    ngang 16px mỗi lần bấm, và cả danh sách rung theo. */}
                <span
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded-[4px] border',
                    on ? 'bg-primary border-primary text-primary-foreground' : 'border-input',
                  )}
                >
                  {on && <Check className="size-3" />}
                </span>
                <span className="min-w-0 flex-1 truncate">{labelFor(tag)}</span>
                {/* Tên thân thiện dùng để đọc, mã thô dùng để tra: hàng chip
                    tóm tắt và URL đều mang mã thô, nên giấu nó đi là bắt người
                    dùng đoán hai thứ đó là một. */}
                {labelFor(tag) !== tag && (
                  <code className="text-muted-foreground max-w-36 shrink-0 truncate font-mono text-[11px]">
                    {tag}
                  </code>
                )}
              </button>
            );
          })}
        </div>

        <div className="text-muted-foreground flex items-center gap-2 border-t px-3 py-2 text-xs">
          <span>{value.length === 0 ? 'Chưa chọn tag nào' : `Đã chọn ${value.length}`}</span>
          {value.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ms-auto h-7"
              onClick={() => onChange(() => [])}
            >
              Bỏ chọn hết
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
