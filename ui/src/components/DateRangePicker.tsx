import { useState } from 'react';
import { format } from 'date-fns';
import { DayPicker, type DateRange } from 'react-day-picker';
import { ChevronDownIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface DateRangePickerProps {
  value: DateRange | undefined;
  onChange: (range: DateRange | undefined) => void;
}

/**
 * Chọn khoảng ngày bằng react-day-picker, thay thế flatpickr của UI cũ.
 *
 * Lịch nằm trong một Popover chứ không phải một <div> tự bật/tắt. Bản tự dựng
 * chỉ đóng khi bấm đúng cái nút đã mở nó: bấm ra ngoài, bấm Escape, hay chuyển
 * tiêu điểm sang chỗ khác đều không đóng, nên nó che mất phần bảng ngay bên
 * dưới và người dùng phải quay lại tìm đúng cái nút. Popover lo cả ba việc đó,
 * cộng với định vị khi lịch chạm mép màn hình.
 */
export function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const label = value?.from
    ? `${format(value.from, 'dd/MM/yyyy')}${value.to ? ` — ${format(value.to, 'dd/MM/yyyy')}` : ''}`
    : 'Tất cả ngày';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* Trông như một Dropdown, vì nó đứng CẠNH các Dropdown và làm cùng
            một việc: thu hẹp danh sách bên dưới. Trước đây nó mang class
            `.button` cũ — không mũi tên, chữ đậm hơn — nên trong cùng một hàng
            bộ lọc có hai thứ nhìn khác nhau mà bấm vào đều xổ ra một bảng. */}
        <Button
          type="button"
          variant="outline"
          aria-label="Lọc theo ngày"
          className="mt-1 w-full justify-between px-3 font-normal"
        >
          {label}
          <ChevronDownIcon className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent>
          <DayPicker
            mode="range"
            selected={value}
            onSelect={(range) => onChange(range)}
            showOutsideDays
            classNames={{
              months: 'flex flex-col gap-3',
              month_caption: 'mb-2 text-center text-sm font-medium',
              nav: 'flex items-center justify-between',
              button_previous: 'hover:bg-accent rounded-md p-1',
              button_next: 'hover:bg-accent rounded-md p-1',
              month_grid: 'w-full border-collapse',
              weekdays: 'text-muted-foreground text-xs',
              weekday: 'w-9 h-8 text-center font-normal',
              week: 'h-9',
              day: 'p-0 text-center',
              day_button: 'hover:bg-accent size-8 rounded text-sm',
              selected: 'bg-primary text-primary-foreground rounded',
              range_middle: 'bg-accent rounded-none',
              range_start: 'bg-primary text-primary-foreground rounded-s',
              range_end: 'bg-primary text-primary-foreground rounded-e',
              today: 'font-bold',
              outside: 'text-muted-foreground opacity-50',
            }}
          />
        <div className="mt-2 flex justify-between gap-4">
          <button className="text-sm underline" type="button" onClick={() => onChange(undefined)}>
            Xoá lọc
          </button>
          <button className="text-sm underline" type="button" onClick={() => setOpen(false)}>
            Xong
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
