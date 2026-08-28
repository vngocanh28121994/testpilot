import type { ReactNode } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export interface DropdownOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

// Radix dành value rỗng cho trạng thái chưa chọn, trong khi các form hiện có
// cần một option thật như “Mặc định”/“Tất cả”. Chuyển đổi nội bộ để API bên
// ngoài vẫn dùng chuỗi rỗng như `<select>` trước đây.
const EMPTY_VALUE = '__testpilot_dropdown_empty__';

/**
 * Dropdown dùng chung cho các giá trị đơn.
 *
 * Khác `<select>` native, trigger và danh sách của control này luôn dùng cùng
 * bề mặt, viền, chevron và trạng thái focus như TagFilter ở mọi trình duyệt.
 */
export function DropdownSelect({
  value,
  onValueChange,
  options,
  placeholder,
  ariaLabel,
  disabled = false,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: DropdownOption[];
  placeholder?: string;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Select
      value={value || EMPTY_VALUE}
      onValueChange={(nextValue) => onValueChange(nextValue === EMPTY_VALUE ? '' : nextValue)}
      disabled={disabled}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        className={cn('w-full justify-between bg-white font-normal dark:bg-card', className)}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value || EMPTY_VALUE}
            disabled={option.disabled}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
