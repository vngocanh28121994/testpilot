/**
 * Bảng màu tint cho icon của ô số, lấy từ StatsStrip của sen/frontend.
 *
 * Nằm riêng khỏi StatTile.tsx vì react-refresh yêu cầu file component chỉ
 * export component — export lẫn hằng số vào đó thì Fast Refresh mất tác dụng
 * cho cả file.
 */
export const TINTS = {
  sky: 'text-sky-600 bg-sky-500/10 dark:text-sky-400',
  violet: 'text-violet-600 bg-violet-500/10 dark:text-violet-400',
  slate: 'text-slate-600 bg-slate-500/10 dark:text-slate-400',
  emerald: 'text-emerald-600 bg-emerald-500/10 dark:text-emerald-400',
  amber: 'text-amber-600 bg-amber-500/10 dark:text-amber-400',
  destructive: 'text-destructive bg-destructive/10',
} as const;
