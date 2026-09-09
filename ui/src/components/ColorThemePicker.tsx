import { Check } from 'lucide-react';
import { useTheme, type ColorThemeChoice } from '@/hooks/useTheme';
import { cn } from '@/lib/utils';

const OPTIONS: { value: ColorThemeChoice; name: string; description: string; swatches: string[] }[] = [
  {
    value: 'green',
    name: 'Xanh lá',
    description: 'Màu thương hiệu hiện tại',
    swatches: ['#2d8a56', '#dcefe4', '#143b28'],
  },
  {
    value: 'techcombank',
    name: 'Đỏ Techcombank',
    description: 'Primary #ed1c24',
    swatches: ['#ed1c24', '#ffebec', '#751117'],
  },
];

/** Chọn bảng màu thương hiệu; chế độ sáng/tối được điều khiển riêng ở header. */
export function ColorThemePicker() {
  const { colorTheme, setColorTheme } = useTheme();

  return (
    <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Chọn theme màu">
      {OPTIONS.map(({ value, name, description, swatches }) => {
        const selected = colorTheme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setColorTheme(value)}
            className={cn(
              'border-border hover:border-primary/60 focus-visible:ring-ring/50 flex items-center gap-3 rounded-lg border p-3 text-left transition-colors outline-none focus-visible:ring-[3px]',
              selected && 'border-primary bg-primary/5',
            )}
          >
            <span className="flex -space-x-1" aria-hidden="true">
              {swatches.map((swatch) => (
                <span
                  key={swatch}
                  className="border-card size-6 rounded-full border-2"
                  style={{ backgroundColor: swatch }}
                />
              ))}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{name}</span>
              <span className="text-muted-foreground block text-xs">{description}</span>
            </span>
            {selected && <Check className="text-primary size-4 shrink-0" aria-label="Đang chọn" />}
          </button>
        );
      })}
    </div>
  );
}
