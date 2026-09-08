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
}) {
  const [own, setOwn] = useState(defaultValue ?? '');
  const current = value ?? own;

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
        {options.map((option) => (
          <SelectItem key={option.value} value={toInner(option.value)} disabled={option.disabled}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
