import { useEffect, useMemo, useRef, useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { AppShell } from '@/components/layout/AppShell';
import { LogView } from '@/components/LogView';
import { DateRangePicker } from '@/components/DateRangePicker';
import { Pagination } from '@/components/Pagination';
import { StatusPill } from '@/components/StatusPill';
import { useAppState } from '@/hooks/useAppState';
import { inRange, when } from '@/lib/datetime';

const PAGE_SIZE = 10;

export default function HistoryPanel({ focusId }: { focusId?: string }) {
  const state = useAppState((s) => ({ runs: s.runs, reports: s.reports }));
  const focus = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<DateRange>();
  const [page, setPage] = useState(1);
  useEffect(() => focus.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), [focusId]);
  const runs = useMemo(() => (state.data?.runs ?? [])
    .filter((run) => inRange(run.startedAt, range))
    .sort((a, b) => Date.parse(b.startedAt ?? '') - Date.parse(a.startedAt ?? '')), [range, state.data?.runs]);
  const pageCount = Math.max(1, Math.ceil(runs.length / PAGE_SIZE));
  const shownRuns = runs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const reports = state.data?.reports ?? [];

  return (
    <AppShell title="Workflow History">
      <div className="border-border mb-4 max-w-sm rounded-lg border p-3">
        <label className="text-sm">Khoảng thời gian<DateRangePicker value={range} onChange={(nextRange) => { setRange(nextRange); setPage(1); }} /></label>
      </div>
      {state.isError && <p role="alert" className="text-destructive text-sm">{(state.error as Error).message}</p>}
      {state.isPending && <p className="text-muted-foreground text-sm">Đang tải lịch sử…</p>}
      {!state.isPending && runs.length === 0 && <p className="text-muted-foreground text-sm">Không có lần chạy nào trong khoảng đã chọn.</p>}
      <div className="flex max-w-5xl flex-col gap-3">
        {shownRuns.map((run) => {
          const runReports = reports.filter((report) => Boolean(run.runDirs?.includes(report.id)));
          return <div key={run.id} ref={run.id === focusId ? focus : undefined} className="border-border rounded-lg border p-4">
            <div className="flex flex-wrap items-center gap-2"><b>{run.feature}</b><StatusPill status={run.status}/><span className="text-muted-foreground text-xs">{run.stagesDone}/{run.stages.length} stages · {when(run.startedAt)}</span></div>
            {run.stages.some((s) => s.status !== 'pending') && <p className="text-muted-foreground mt-2 text-sm">{run.stages.filter((s) => s.status !== 'pending').map((s) => `${s.status === 'done' ? '✓' : s.status === 'failed' ? '✕' : '…'} ${s.name}`).join(' · ')}</p>}
            {run.generatedFile && <p className="mt-2 font-mono text-xs">{run.generatedFile}</p>}
            {runReports.map((report) => report.url ? <a key={report.id} href={report.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm underline">Xem report {report.platform ?? ''}</a> : null)}
            {run.error && <p className="text-destructive mt-2 text-sm">{run.error}</p>}
            {run.log.length > 0 && <details className="mt-2"><summary className="cursor-pointer text-sm">Log ({run.log.length} dòng)</summary><LogView logs={run.log} className="mt-2 max-h-80" label="Log lượt chạy" /></details>}
          </div>;
        })}
      </div>
      <Pagination page={Math.min(page, pageCount)} pageCount={pageCount} onPageChange={setPage} />
    </AppShell>
  );
}

