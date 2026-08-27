import { Link } from '@tanstack/react-router';
import {
  Activity,
  FileCode,
  ListChecks,
  Target,
  TriangleAlert,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { DataTable } from '@/components/data-table';
import { StatTile } from '@/components/StatTile';
import { TINTS } from '@/lib/tints';
import { StatusPill } from '@/components/StatusPill';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAppState } from '@/hooks/useAppState';
import { when } from '@/lib/datetime';
import { cn } from '@/lib/utils';
import { featureColumns } from './columns';

const PAGE_DESCRIPTION = 'Tình trạng bộ test: kịch bản, element và các lượt chạy gần đây.';

/** Số lượt chạy hiện ở thẻ "Lần chạy gần đây". Phần còn lại nằm ở trang History. */
const RECENT_RUNS = 6;

/**
 * Năm ô số của bản cũ, giữ nguyên thứ tự và nhãn (app.js:1569).
 *
 * Nhãn là hợp đồng với DashboardPanel.test.tsx — đổi chữ ở đây thì sửa test.
 */
function useTiles() {
  return useAppState((s) => {
    const scenarios = s.features.reduce((n, f) => n + f.scenarios.length, 0);
    return [
      { value: s.features.length, label: 'feature file', icon: FileCode, tint: TINTS.sky },
      { value: scenarios, label: 'scenario', icon: ListChecks, tint: TINTS.violet },
      { value: s.elements, label: 'element', icon: Target, tint: TINTS.slate },
      { value: s.runs.length, label: 'lần chạy', icon: Activity, tint: TINTS.emerald },
      {
        value: s.runs.filter((r) => r.status === 'failed').length,
        label: 'lần thất bại',
        icon: TriangleAlert,
        tint: TINTS.destructive,
      },
    ];
  });
}

/** Ba trạng thái duyệt, theo đúng thứ tự đọc từ trái sang phải của thanh tiến độ. */
const REVIEW_SEGMENTS = [
  { key: 'approved', label: 'Đã duyệt', bar: 'bg-status-pass' },
  // Amber = "đang chờ / đang tiến hành", đúng màu ô "Chờ duyệt" của Healing
  // Center (TINTS.amber). Cùng một khái niệm thì cùng một màu ở mọi màn.
  { key: 'pending', label: 'Chờ duyệt', bar: 'bg-amber-500 dark:bg-amber-400' },
  { key: 'rejected', label: 'Không duyệt', bar: 'bg-status-fail' },
] as const;

function useReviewProgress() {
  return useAppState((s) => {
    const counts = { approved: 0, pending: 0, rejected: 0 };
    for (const feature of s.features) {
      for (const scenario of feature.scenarios) {
        const status = scenario.review?.status ?? 'pending';
        if (status === 'approved' || status === 'rejected') counts[status] += 1;
        else counts.pending += 1;
      }
    }
    return { counts, total: counts.approved + counts.pending + counts.rejected };
  });
}

export default function DashboardPanel() {
  const tiles = useTiles();
  const features = useAppState((s) => s.features);
  const runs = useAppState((s) => s.runs);
  const review = useReviewProgress();

  const recent = [...(runs.data ?? [])]
    .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))
    .slice(0, RECENT_RUNS);

  return (
    <AppShell title="Dashboard" description={PAGE_DESCRIPTION}>
      <section aria-label="Dashboard" className="flex flex-1 flex-col gap-6">
        {tiles.isError && (
          <p role="alert" className="text-destructive text-sm">
            {(tiles.error as Error).message}
          </p>
        )}

        <div
          role="group"
          aria-label="Tổng quan"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
        >
          {(tiles.data ?? PLACEHOLDER_TILES).map((tile) => (
            <StatTile
              key={tile.label}
              label={tile.label}
              value={tile.value}
              icon={tile.icon}
              tint={tile.tint}
              loading={tiles.isPending}
            />
          ))}
        </div>

        {/* Không items-start: để hai thẻ stretch bằng chiều cao hàng. Thẻ nào
            ít nội dung hơn thì giãn ra, thay vì hai thẻ so le nhau. */}
        <div className="grid gap-6 lg:grid-cols-2">
          <Card aria-labelledby="review-title">
            <CardHeader>
              <CardTitle id="review-title">Tiến độ duyệt kịch bản</CardTitle>
              <CardDescription>
                Kịch bản chưa duyệt thì workflow không chạy tiếp sang bước sinh test.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <ReviewBar counts={review.data?.counts} total={review.data?.total ?? 0} />
              <Link to="/scenarios" search={{}} className="text-primary text-sm underline">
                Mở màn duyệt kịch bản →
              </Link>
            </CardContent>
          </Card>

          <Card aria-labelledby="recent-title">
            <CardHeader>
              <CardTitle id="recent-title">Lần chạy gần đây</CardTitle>
              <CardDescription>{RECENT_RUNS} lượt mới nhất, mới nhất ở trên.</CardDescription>
            </CardHeader>
            <CardContent>
              {recent.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Chưa có lượt chạy nào. Chạy từ{' '}
                  <Link to="/runner" className="text-primary underline">
                    Local Runner
                  </Link>{' '}
                  hoặc{' '}
                  <Link to="/farm" className="text-primary underline">
                    Device Farm
                  </Link>
                  .
                </p>
              ) : (
                <ul className="flex flex-col divide-y">
                  {recent.map((run) => (
                    <li
                      key={run.id}
                      className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-medium">{run.feature}</span>
                        <span className="text-muted-foreground text-xs">
                          {when(run.startedAt)}
                        </span>
                      </div>
                      <div className="ms-auto flex shrink-0 items-center gap-2">
                        <Badge variant="outline" className="text-muted-foreground">
                          {run.kind}
                        </Badge>
                        <StatusPill status={run.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <Card aria-labelledby="features-title">
          <CardHeader>
            <CardTitle id="features-title">Feature đã sinh</CardTitle>
            <CardDescription>
              File .feature trong repo. File không parse được vẫn hiện, kèm lỗi.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              data={features.data ?? []}
              columns={featureColumns}
              loading={features.isPending}
              empty="Chưa sinh feature nào."
              caption="Danh sách feature đã sinh"
              initialSorting={[{ id: 'name', desc: false }]}
            />
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}

/** Giữ khung 5 ô trong lúc tải để dải thống kê không bung ra rồi co lại. */
const PLACEHOLDER_TILES = [
  { value: 0, label: 'feature file', icon: FileCode, tint: TINTS.sky },
  { value: 0, label: 'scenario', icon: ListChecks, tint: TINTS.violet },
  { value: 0, label: 'element', icon: Target, tint: TINTS.slate },
  { value: 0, label: 'lần chạy', icon: Activity, tint: TINTS.emerald },
  { value: 0, label: 'lần thất bại', icon: TriangleAlert, tint: TINTS.destructive },
];

function ReviewBar({
  counts,
  total,
}: {
  counts: { approved: number; pending: number; rejected: number } | undefined;
  total: number;
}) {
  if (!counts || total === 0) {
    return <p className="text-muted-foreground text-sm">Chưa có kịch bản nào để duyệt.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Thanh gộp thay vì ba thanh rời: tỉ lệ giữa ba trạng thái mới là thứ
          cần đọc, và mắt so sánh độ dài trên cùng một trục nhanh hơn nhiều so
          với so ba con số. */}
      <div className="bg-muted flex h-2.5 overflow-hidden rounded-full">
        {REVIEW_SEGMENTS.map(({ key, label, bar }) =>
          counts[key] > 0 ? (
            <div
              key={key}
              className={cn('h-full', bar)}
              style={{ width: `${(counts[key] / total) * 100}%` }}
              title={`${label}: ${counts[key]}`}
            />
          ) : null,
        )}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-2">
        {REVIEW_SEGMENTS.map(({ key, label, bar }) => (
          <li key={key} className="flex items-center gap-1.5 text-sm">
            {/* Chấm đặc dùng đúng class nền của đoạn thanh tương ứng, nên chú
                giải và thanh không thể lệch màu nhau. */}
            <span aria-hidden className={cn('size-2.5 rounded-full', bar)} />
            <span className="text-muted-foreground">{label}</span>
            <span className="font-semibold tabular-nums">{counts[key]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
