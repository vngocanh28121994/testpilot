import { useState } from 'react';
import { format } from 'date-fns';
import { DayPicker, type DateRange } from 'react-day-picker';

interface DateRangePickerProps {
  value: DateRange | undefined;
  onChange: (range: DateRange | undefined) => void;
}

/** Chọn khoảng ngày bằng react-day-picker, thay thế flatpickr của UI cũ. */
export function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const label = value?.from
    ? `${format(value.from, 'dd/MM/yyyy')}${value.to ? ` — ${format(value.to, 'dd/MM/yyyy')}` : ''}`
    : 'Tất cả ngày';

  return (
    <div className="relative">
      <button
        className="button mt-1 w-full text-left"
        type="button"
        aria-expanded={open}
        aria-label="Lọc theo ngày"
        onClick={() => setOpen((shown) => !shown)}
      >
        {label}
      </button>
      {open && (
        <div className="bg-popover border-border absolute z-10 mt-1 rounded-md border p-3 shadow-md">
          <DayPicker
            mode="range"
            selected={value}
            onSelect={(range) => onChange(range)}
            showOutsideDays
            classNames={{
              months: 'flex flex-col gap-3',
              month_caption: 'mb-2 text-center text-sm font-medium',
              nav: 'flex items-center justify-between',
              button_previous: 'button',
              button_next: 'button',
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
        </div>
      )}
    </div>
  );
}
