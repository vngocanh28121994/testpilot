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
import { Clock, CircleCheckBig, CircleSlash, Eye } from 'lucide-react';
import { Field } from '@/components/Field';
import { DropdownSelect } from '@/components/DropdownSelect';
import { StatTile } from '@/components/StatTile';
import { TINTS } from '@/lib/tints';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

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

const PAGE_DESCRIPTION = 'Locator được Playwright/Appium phục hồi qua nhiều lần chạy.';

/** Bốn ô tổng hợp. Nhãn là hợp đồng với HealingPanel.test.tsx. */
const STATS = [
  { key: 'proposed', label: 'Chờ duyệt', icon: Clock, tint: TINTS.amber },
  { key: 'watching', label: 'Đang theo dõi', icon: Eye, tint: TINTS.sky },
  { key: 'applied', label: 'Đã áp dụng', icon: CircleCheckBig, tint: TINTS.emerald },
  { key: 'rejected', label: 'Đã từ chối', icon: CircleSlash, tint: TINTS.slate },
] as const;

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
    <AppShell title="Healing Center" description={PAGE_DESCRIPTION}>
      <section aria-label="Healing Center" className="flex flex-1 flex-col gap-6">
        {query.isError && (
          <p role="alert" className="text-destructive text-sm">
            {(query.error as Error).message}
          </p>
        )}

        {/* Nhóm lại để test (và trình đọc màn hình) phân biệt được ô thống kê
            "Chờ duyệt" với option cùng tên trong bộ lọc và với pill trong bảng. */}
        <div
          role="group"
          aria-label="Tổng hợp healing"
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        >
          {STATS.map(({ key, label, icon, tint }) => (
            <StatTile
              key={key}
              label={label}
              value={summary?.[key] ?? 0}
              icon={icon}
              tint={tint}
              loading={query.isPending}
            />
          ))}
        </div>

        <Card aria-labelledby="records-title">
          <CardHeader>
            <CardTitle id="records-title">Bản ghi healing</CardTitle>
            <CardDescription>
              Chỉ locator đủ bằng chứng mới được áp dụng làm primary.
            </CardDescription>
            {/* Câu policy đứng riêng một element: gộp vào CardDescription thì
                nó thành một mẩu trong câu dài hơn và không còn tra cứu được
                bằng đúng chuỗi đó nữa — cả cho test lẫn cho Ctrl+F. */}
            {policy && (
              <CardAction className="text-muted-foreground self-center text-xs">
                Đề xuất khi ≥ {policy.minSuccesses} lần heal qua ≥ {policy.minRuns} run
              </CardAction>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-4 sm:max-w-md sm:grid-cols-2">
              <Field label="Trạng thái">
                <DropdownSelect
                  ariaLabel="Trạng thái"
                  value={status}
                  onValueChange={(value) => setStatus(value as StatusFilter)}
                  options={STATUS_OPTIONS.map((option) => ({
                    value: option.value,
                    label: option.label,
                  }))}
                />
              </Field>
              <Field label="Platform">
                <DropdownSelect
                  ariaLabel="Platform"
                  value={platform}
                  onValueChange={(value) => setPlatform(value as PlatformFilter)}
                  options={PLATFORM_OPTIONS.map((option) => ({
                    value: option.value,
                    label: option.label,
                  }))}
                />
              </Field>
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground text-left text-xs">
                    {HEADERS.map((h, i) => (
                      <th
                        key={h || i}
                        className={`px-2 py-2 font-medium ${i >= 5 && i <= 7 ? 'text-right' : ''}`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {query.isPending && (
                    <tr>
                      <td
                        colSpan={HEADERS.length}
                        className="text-muted-foreground px-2 py-6 text-center"
                      >
                        Đang tải healing telemetry…
                      </td>
                    </tr>
                  )}
                  {!query.isPending && records.length === 0 && (
                    <tr>
                      <td
                        colSpan={HEADERS.length}
                        className="text-muted-foreground px-2 py-6 text-center"
                      >
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
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}
