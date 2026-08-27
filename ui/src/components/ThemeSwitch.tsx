import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemeChoice } from '@/hooks/useTheme';
import { cn } from '@/lib/utils';

const OPTIONS: { value: ThemeChoice; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Sáng', Icon: Sun },
  { value: 'dark', label: 'Tối', Icon: Moon },
  { value: 'system', label: 'Theo hệ thống', Icon: Monitor },
];

export function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="border-border inline-flex items-center gap-0.5 rounded-md border p-0.5" role="group" aria-label="Giao diện">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={theme === value}
          onClick={() => setTheme(value)}
          className={cn(
            'rounded-sm p-1.5 transition-colors',
            theme === value
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent/50',
          )}
        >
          <Icon className="size-4" />
        </button>
      ))}
    </div>
  );
}
