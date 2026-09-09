import { useEffect, useMemo, useRef, useState } from 'react';
import { FailureBanner } from '@/components/FailureBanner';
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
  // Thân KHỐI, không phải thân rút gọn — giá trị trả về của một effect là hàm
  // dọn dẹp, nên thân rút gọn lặng lẽ biến kết quả của biểu thức thành cleanup.
  //
  // `scrollIntoView` theo spec trả undefined, và trong nhiều trình duyệt đúng
  // là vậy, nên chỗ này chạy tốt suốt. Nhưng ở Chrome của người dùng nó trả về
  // một Promise; React giữ Promise ấy làm cleanup, rồi lúc rời màn hình gọi nó:
  //
  //   TypeError: destroy_ is not a function
  //
  // Cả trang lịch sử vỡ khi bấm sang màn khác — và stack chỉ có mã nội bộ
  // React, không một khung nào của ứng dụng, vì hàm ấy sinh ra từ một lần
  // render đã xong từ lâu.
  useEffect(() => {
    focus.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focusId]);
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
          // history.json đọc thẳng từ đĩa, không qua kiểm tra. Kiểu nói `stages`
          // là bắt buộc và history.start() luôn đặt, nhưng một bản ghi cũ thiếu
          // nó từng làm vỡ cả trang — cả danh sách lịch sử biến mất vì một dòng
          // dữ liệu, đúng lúc người ta vào đây để tìm hiểu chuyện gì đã hỏng.
          const stages = run.stages ?? [];
          const log = run.log ?? [];
          // Bước đang chạy nếu còn chạy, bước hỏng nếu đã hỏng. Lượt xong xuôi
          // không có gì để nói ở đây — trạng thái đã nói rồi.
          const stopped = stages.find((s) => s.status === 'running')?.name
            ?? stages.find((s) => s.status === 'failed')?.name;
          return <div key={run.id} ref={run.id === focusId ? focus : undefined} className="border-border rounded-lg border p-4">
            <div className="flex flex-wrap items-center gap-2"><b>{run.feature}</b><StatusPill status={run.status}/><span className="text-muted-foreground text-xs">{run.stagesDone ?? 0}/{stages.length} bước · {when(run.startedAt)}</span></div>
            {/* Bước dừng lại, ngay ở dòng đầu.
                Đây là câu trả lời cho câu hỏi người ta mang tới trang này —
                "lượt này đi tới đâu thì hỏng" — nên nó không được nằm sau một
                lần bấm, cũng không được bắt người đọc tự dò 11 dòng tìm dấu ✗. */}
            {stopped && (
              <p className="text-muted-foreground mt-1 text-sm">
                {run.status === 'running' ? 'Đang ở: ' : 'Dừng ở: '}
                <span className="text-foreground">{stopped}</span>
              </p>
            )}
            {/* Danh sách đầy đủ gấp lại.
                Mười một bước nhân với mỗi lượt chạy là hơn trăm dòng lặp đúng
                những cái tên ấy, và danh sách lịch sử mất khả năng quét bằng
                mắt. Mở ra thì vẫn dùng chung component với App Studio: cùng
                một dữ liệu thì không nên có hai cách đọc. */}
            {stages.length > 0 && (
              <details className="mt-2">
                <summary className="text-muted-foreground cursor-pointer text-sm select-none">
                  Tiến trình ({stages.length} bước)
                </summary>
                <div className="mt-2">
                  <WorkflowStages stages={stages} runStatus={run.status} />
                </div>
              </details>
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
            {run.error && <div className="mt-2"><FailureBanner error={run.error} /></div>}
            {log.length > 0 && <details className="mt-2"><summary className="cursor-pointer text-sm">Log ({log.length} dòng)</summary><LogView logs={log} className="mt-2 max-h-80" label="Log lượt chạy" /></details>}
          </div>;
        })}
      </div>
      <Pagination page={Math.min(page, pageCount)} pageCount={pageCount} onPageChange={setPage} />
    </AppShell>
  );
}

