/**
 * Bảng màu cho icon của ô số, lấy từ StatsStrip của sen/frontend.
 *
 * Chỉ màu chữ, không có nền: icon đứng trần trong ô chứ không nằm trong vòng
 * tròn nữa, nên một class `bg-*` ở đây sẽ tô nền cho chính hình icon.
 *
 * Nằm riêng khỏi StatTile.tsx vì react-refresh yêu cầu file component chỉ
 * export component — export lẫn hằng số vào đó thì Fast Refresh mất tác dụng
 * cho cả file.
 */
export const TINTS = {
  sky: 'text-sky-600 dark:text-sky-400',
  violet: 'text-violet-600 dark:text-violet-400',
  slate: 'text-slate-600 dark:text-slate-400',
  emerald: 'text-emerald-600 dark:text-emerald-400',
  amber: 'text-amber-600 dark:text-amber-400',
  destructive: 'text-destructive',
} as const;
