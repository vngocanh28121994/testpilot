import { useEffect, useMemo, useRef, useState } from 'react';
import { endOfDay, startOfDay } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { AppShell } from '@/components/layout/AppShell';
import { DateRangePicker } from '@/components/DateRangePicker';
import { Pagination } from '@/components/Pagination';
import { StatusPill } from '@/components/StatusPill';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAppState } from '@/hooks/useAppState';
import { when } from '@/lib/datetime';

const PAGE_SIZE = 10;

export default function HistoryPanel({ focusId }: { focusId?: string }) {
  const state = useAppState((s) => ({ runs: s.runs, reports: s.reports }));
  const focus = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<DateRange>();
  const [page, setPage] = useState(1);

  useEffect(() => focus.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), [focusId]);

  const runs = useMemo(
    () => (state.data?.runs ?? [])
      .filter((run) => inRange(run.startedAt, range))
      .sort((a, b) => Date.parse(b.startedAt ?? '') - Date.parse(a.startedAt ?? '')),
    [range, state.data?.runs],
  );
  const pageCount = Math.max(1, Math.ceil(runs.length / PAGE_SIZE));
  const shownRuns = runs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const reports = state.data?.reports ?? [];

  return (
    <AppShell
      title="Workflow History"
      description="Theo dõi tiến độ và kết quả các workflow đã chạy."
    >
      <section className="flex max-w-5xl flex-col gap-6" aria-label="Workflow History">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Bộ lọc lịch sử</CardTitle>
            <CardDescription>Giới hạn các workflow theo thời điểm bắt đầu chạy.</CardDescription>
          </CardHeader>
          <CardContent>
            <label className="block max-w-sm text-sm font-medium">
              Khoảng thời gian
              <DateRangePicker
                value={range}
                onChange={(nextRange) => {
                  setRange(nextRange);
                  setPage(1);
                }}
              />
            </label>
          </CardContent>
        </Card>

        {state.isError && (
          <div role="alert" className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-4 py-3 text-sm">
            {(state.error as Error).message}
          </div>
        )}

        {state.isPending && (
          <Card>
            <CardContent className="text-muted-foreground p-6 text-sm">Đang tải lịch sử…</CardContent>
          </Card>
        )}

        {!state.isPending && runs.length === 0 && (
          <Card>
            <CardContent className="text-muted-foreground p-6 text-sm">
              Không có lần chạy nào trong khoảng đã chọn.
            </CardContent>
          </Card>
        )}

        {shownRuns.map((run) => {
          const runReports = reports.filter((report) => Boolean(run.runDirs?.includes(report.id)));

          return (
            <Card key={run.id} ref={run.id === focusId ? focus : undefined}>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base">{run.feature}</CardTitle>
                  <StatusPill status={run.status} />
                  <span className="text-muted-foreground text-xs">
                    {run.stagesDone}/{run.stages.length} stages · {when(run.startedAt)}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {run.stages.some((stage) => stage.status !== 'pending') && (
                  <p className="text-muted-foreground text-sm">
                    {run.stages
                      .filter((stage) => stage.status !== 'pending')
                      .map((stage) => `${stage.status === 'done' ? '✓' : stage.status === 'failed' ? '✕' : '…'} ${stage.name}`)
                      .join(' · ')}
                  </p>
                )}
                {run.generatedFile && <p className="font-mono text-xs">{run.generatedFile}</p>}
                {runReports.map((report) => report.url ? (
                  <a key={report.id} href={report.url} target="_blank" rel="noreferrer" className="inline-block text-sm underline">
                    Xem report {report.platform ?? ''}
                  </a>
                ) : null)}
                {run.error && <p className="text-destructive text-sm">{run.error}</p>}
                {run.log.length > 0 && (
                  <details>
                    <summary className="cursor-pointer text-sm font-medium">Log ({run.log.length} dòng)</summary>
                    <pre className="bg-muted mt-2 max-h-80 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
                      {run.log.join('\n')}
                    </pre>
                  </details>
                )}
              </CardContent>
            </Card>
          );
        })}

        <Pagination page={Math.min(page, pageCount)} pageCount={pageCount} onPageChange={setPage} />
      </section>
    </AppShell>
  );
}

function inRange(iso: string | undefined, range: DateRange | undefined): boolean {
  if (!range?.from) return true;
  const time = Date.parse(iso ?? '');
  if (Number.isNaN(time)) return false;
  return time >= startOfDay(range.from).getTime()
    && time <= endOfDay(range.to ?? range.from).getTime();
}
