import { useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { useHealing, useReviewHealing } from './hooks/useHealing';
import {
  PLATFORM_OPTIONS,
  STATUS_OPTIONS,
  useFilteredRecords,
  type PlatformFilter,
  type StatusFilter,
} from './hooks/useHealingFilters';
import { HealingRow } from './HealingRow';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';

const HEADERS = [
  'Element',
  'Platform',
  'Primary hiện tại',
  'Locator đã fail',
  'Locator phục hồi',
  'Heals',
  'Runs',
  'Máy',
  'Lần cuối',
  'Trạng thái',
  '',
];

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <Card className="min-w-32 py-4">
      <CardContent className="px-4">
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        <div className="text-muted-foreground text-xs">{label}</div>
      </CardContent>
    </Card>
  );
}

export default function HealingPanel() {
  const [status, setStatus] = useState<StatusFilter>('all');
  const [platform, setPlatform] = useState<PlatformFilter>('all');
  // Bản ghi nào đang chờ xác nhận bước hai. Chỉ một tại một thời điểm, giống
  // biến `healingPending` của bản cũ (app.js:1078).
  const [pending, setPending] = useState<{ id: string; action: 'apply' | 'reject' } | null>(null);

  const query = useHealing();
  const review = useReviewHealing();
  const records = useFilteredRecords(query.data?.records, status, platform);
  const summary = query.data?.summary;
  const policy = query.data?.policy;

  return (
    <AppShell title="Healing Center">
      <p className="text-muted-foreground max-w-3xl text-sm">
        Tổng hợp locator được Playwright/Appium phục hồi qua nhiều lần chạy. Chỉ locator đủ bằng
        chứng mới có thể được áp dụng làm primary.
      </p>

      {/* Nhóm lại để test (và trình đọc màn hình) phân biệt được ô thống kê
          "Chờ duyệt" với option cùng tên trong bộ lọc và với pill trong bảng. */}
      <div role="group" aria-label="Tổng hợp healing" className="mt-4 flex flex-wrap gap-3">
        <Stat value={summary?.proposed ?? 0} label="Chờ duyệt" />
        <Stat value={summary?.watching ?? 0} label="Đang theo dõi" />
        <Stat value={summary?.applied ?? 0} label="Đã áp dụng" />
        <Stat value={summary?.rejected ?? 0} label="Đã từ chối" />
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="heal-status">Trạng thái</Label>
          <select
            id="heal-status"
            aria-label="Trạng thái"
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className="border-input bg-background focus-visible:ring-ring/50 rounded-md border px-2 py-1.5 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="heal-platform">Platform</Label>
          <select
            id="heal-platform"
            aria-label="Platform"
            value={platform}
            onChange={(e) => setPlatform(e.target.value as PlatformFilter)}
            className="border-input bg-background focus-visible:ring-ring/50 rounded-md border px-2 py-1.5 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
          >
            {PLATFORM_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {policy && (
          <span className="text-muted-foreground text-xs">
            Đề xuất khi ≥ {policy.minSuccesses} lần heal qua ≥ {policy.minRuns} run
          </span>
        )}
      </div>

      {query.isError && (
        <p role="alert" className="text-destructive mt-4 text-sm">
          {(query.error as Error).message}
        </p>
      )}

      <div className="border-border mt-4 overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground text-left text-xs">
              {HEADERS.map((h, i) => (
                <th key={h || i} className={`px-2 py-2 ${i >= 5 && i <= 7 ? 'text-right' : ''}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {query.isPending && (
              <tr>
                <td colSpan={HEADERS.length} className="text-muted-foreground px-2 py-6 text-center">
                  Đang tải healing telemetry…
                </td>
              </tr>
            )}
            {!query.isPending && records.length === 0 && (
              <tr>
                <td colSpan={HEADERS.length} className="text-muted-foreground px-2 py-6 text-center">
                  Không có healing record khớp bộ lọc.
                </td>
              </tr>
            )}
            {records.map((r) => (
              <HealingRow
                key={r.id}
                record={r}
                pending={pending?.id === r.id ? pending.action : null}
                busy={review.isPending && review.variables?.id === r.id}
                onRequest={(action) => setPending({ id: r.id, action })}
                onCancel={() => setPending(null)}
                onConfirm={(action) =>
                  review.mutate({ id: r.id, action }, { onSuccess: () => setPending(null) })
                }
              />
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
