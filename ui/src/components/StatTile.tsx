import type { ElementType } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Ô số của dải thống kê đầu trang.
 *
 * Theo khuôn `StatsStrip` của sen/frontend: nhãn viết hoa nhỏ ở trên, số lớn
 * tabular-nums ở dưới, icon tròn có tint ở góc phải. Tabular-nums là chi tiết
 * quan trọng — số cùng bề rộng thì cả hàng ô không nhảy khi giá trị đổi.
 */
export function StatTile({
  label,
  value,
  icon: Icon,
  tint,
  loading = false,
}: {
  label: string;
  value: number;
  icon: ElementType;
  /** Cặp text/bg cho icon, theo bảng màu tint của sen. */
  tint: string;
  loading?: boolean;
}) {
  return (
    <div data-slot="stat-tile" className="bg-card rounded-xl border px-4 py-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-2">
          <span className="text-muted-foreground text-[10px] leading-tight font-medium tracking-[0.08em] uppercase">
            {label}
          </span>
          {loading ? (
            <Skeleton className="h-6 w-10" />
          ) : (
            <span className="text-2xl leading-none font-semibold tabular-nums">{value}</span>
          )}
        </div>
        {/* Không bọc vòng tròn: icon đứng trần và cao xấp xỉ cả cột nhãn +
            số bên trái, nên nó chiếm trọn phần phải của ô. */}
        <Icon className={cn('size-11 shrink-0 stroke-[1.5]', tint)} />
      </div>
    </div>
  );
}
