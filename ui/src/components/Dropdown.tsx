import { useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

/**
 * Chỗ đứng cho lựa chọn có giá trị rỗng.
 *
 * Radix ném lỗi nếu một mục mang value="" — nó dành chuỗi rỗng để biểu thị
 * "chưa chọn gì". Nhưng nhiều bộ lọc của trang lại dùng đúng chuỗi rỗng làm một
 * lựa chọn thật: "Tất cả tag", "Mặc định". Quy đổi ở đây một lần, để 22 chỗ gọi
 * vẫn nói bằng ngôn ngữ của chúng thay vì mỗi chỗ tự bịa một hằng riêng.
 */
const EMPTY = '\u0000empty';

/** Dài hơn chừng này thì cuộn tay bắt đầu tốn công hơn là gõ vài chữ. */
const SEARCH_FROM = 8;

const toInner = (value: string) => (value === '' ? EMPTY : value);
const fromInner = (value: string) => (value === EMPTY ? '' : value);

export interface DropdownOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/**
 * Dropdown dùng chung cho mọi trang.
 *
 * Trước đây mỗi chỗ là một `<select className="input">` trần: danh sách xổ ra
 * là popup của hệ điều hành, không theo theme, không theo bo góc, và mũi tên do
 * hệ điều hành vẽ nên nằm lệch khỏi lề phải của ô. Không có cách nào tô kiểu
 * cái popup đó — đấy là giới hạn của trình duyệt, không phải chuyện CSS chưa
 * viết tới. Nên phải là một dropdown tự dựng.
 *
 * API cố ý giữ hình dáng của `<select>` — `value`, `onChange(value)`,
 * `options` — để 22 chỗ đang dùng đổi sang mà không phải viết lại logic.
 */
export function Dropdown({
  value,
  onChange,
  defaultValue,
  name,
  options,
  placeholder,
  disabled,
  className,
  id,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  searchable,
}: {
  /** Bỏ trống để dropdown tự giữ giá trị — dùng khi nó nằm trong một form. */
  value?: string;
  onChange?: (value: string) => void;
  defaultValue?: string;
  /**
   * Tên trường khi nằm trong form. Giá trị được gửi qua một input ẩn do chính
   * component này dựng, mang giá trị THẬT — mã nội bộ thay cho chuỗi rỗng không
   * được phép lọt ra ngoài và thành một bộ lọc mà server không hiểu.
   */
  name?: string;
  options: DropdownOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  /**
   * Có ô tìm ở đầu danh sách. Mặc định bật khi danh sách dài.
   *
   * Danh sách feature file của dự án này đã hơn chục mục và còn dài ra; cuộn
   * tay tìm `kiem-tra-hieu-qua-dau-tu-phai-sinh.feature` giữa chúng là việc
   * không ai muốn làm lần thứ hai. Ngưỡng thay vì bắt từng chỗ gọi tự khai:
   * danh sách nào dài thì tự có, không phải sửa 22 chỗ.
   */
  searchable?: boolean;
}) {
  const [own, setOwn] = useState(defaultValue ?? '');
  const [query, setQuery] = useState('');
  const current = value ?? own;
  const withSearch = searchable ?? options.length > SEARCH_FROM;
  const clean = query.trim().toLowerCase();
  const shown = clean
    ? options.filter((option) => option.label.toLowerCase().includes(clean))
    : options;

  return (
    <Select
      value={toInner(current)}
      onValueChange={(next) => {
        const real = fromInner(next);
        if (value === undefined) setOwn(real);
        onChange?.(real);
      }}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className={cn('mt-1 w-full', className)}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      {name && <input type="hidden" name={name} value={current} />}
      <SelectContent>
        {withSearch && (
          <div className="p-1">
            <input
              className="border-input w-full rounded border px-2 py-1 text-sm outline-none"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              // Radix có sẵn typeahead: gõ chữ là nó nhảy tới mục khớp và nuốt
              // luôn phím. Không chặn thì ô này gõ được đúng một ký tự.
              onKeyDown={(event) => event.stopPropagation()}
              placeholder="Tìm…"
              aria-label="Tìm trong danh sách"
            />
          </div>
        )}
        {shown.length === 0 && (
          <div className="text-muted-foreground px-2 py-1.5 text-sm">Không có mục nào khớp.</div>
        )}
        {shown.map((option) => (
          <SelectItem key={option.value} value={toInner(option.value)} disabled={option.disabled}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
