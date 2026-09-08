import { useEffect, useMemo, useRef, useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { AppShell } from '@/components/layout/AppShell';
import { Link } from '@tanstack/react-router';
import { LogView } from '@/components/LogView';
import { WorkflowStages } from '@/components/WorkflowStages';
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
            {/* Dùng chung danh sách bước với App Studio thay vì nối một dòng
                chữ: cùng một dữ liệu thì không nên có hai cách đọc. */}
            {run.stages.length > 0 && (
              <div className="mt-3">
                <WorkflowStages stages={run.stages} runStatus={run.status} />
              </div>
            )}
            {run.generatedFile && <p className="mt-2 font-mono text-xs">{run.generatedFile}</p>}
            {/*
              Hai lối khác nhau, không phải một.

              "Chi tiết" mở trang trong app: ảnh khi fail, video, network log,
              log lượt chạy — thứ người ta thật sự cần khi đi tìm nguyên nhân.
              "Report gốc" mở đúng file HTML, thứ để gửi đi hoặc lưu lại.

              Và khi lượt chạy không sinh được report nào thì NÓI ra, thay vì để
              một khoảng trống mà người đọc phải tự đoán là chưa có hay đã mất.
            */}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {runReports.length === 0 ? (
                <span className="text-muted-foreground text-sm">
                  Lượt chạy này không sinh được report.
                </span>
              ) : (
                runReports.map((report) => (
                  <span key={report.id} className="flex items-center gap-2 text-sm">
                    <Link
                      to="/runner/history"
                      search={{ runId: report.id }}
                      className="text-primary underline"
                    >
                      Chi tiết{report.platform ? ` (${report.platform})` : ''}
                    </Link>
                    {report.url && (
                      <a
                        href={report.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted-foreground underline"
                      >
                        Report gốc
                      </a>
                    )}
                  </span>
                ))
              )}
            </div>
            {run.error && <p className="text-destructive mt-2 text-sm">{run.error}</p>}
            {run.log.length > 0 && <details className="mt-2"><summary className="cursor-pointer text-sm">Log ({run.log.length} dòng)</summary><LogView logs={run.log} className="mt-2 max-h-80" label="Log lượt chạy" /></details>}
          </div>;
        })}
      </div>
      <Pagination page={Math.min(page, pageCount)} pageCount={pageCount} onPageChange={setPage} />
    </AppShell>
  );
}

