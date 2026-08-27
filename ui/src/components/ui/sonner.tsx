import { Toaster as Sonner, type ToasterProps } from 'sonner';

/**
 * Bọc mỏng quanh sonner để Toaster theo theme của app.
 *
 * Đây là chỗ shadcn CLI sẽ ghi đè nếu ai đó chạy `npx shadcn add sonner`.
 * Bản shadcn gốc đọc theme từ next-themes; TestPilot chưa có ThemeProvider
 * (Phase 2), nên tạm đọc thẳng class `dark` trên <html>.
 */
export function Toaster(props: ToasterProps) {
  const theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  );
}
