import { Link } from '@tanstack/react-router';
import { FailureBanner } from '@/components/FailureBanner';
import { AppShell } from '@/components/layout/AppShell';
import { RunVideo } from '@/components/RunVideo';
import { RunShots } from '@/components/RunShots';
import { LazyLog } from '@/components/LazyLog';
import { ROUTES, STREAM_ROUTES } from '@/api/routes';
import { LogView } from '@/components/LogView';
import { StatusPill } from '@/components/StatusPill';
import { useAppState } from '@/hooks/useAppState';
import { useStreamJob } from '@/hooks/useStreamJob';
import { Button } from '@/components/ui/button';
import { when } from '@/lib/datetime';
import type { ReportView } from '@core/ui/contracts.js';

export default function FarmDetailPanel({ runId }: { runId: string }) {
  const state = useAppState((s) => ({ runs: s.runs, reports: s.reports }));
  const run = state.data?.runs.find((item) => item.id === runId);
  if (!run) return <AppShell title="Device Farm"><Link to="/farm" className="text-sm underline">← Quay lại</Link><p className="text-muted-foreground mt-4">{state.isPending ? 'Đang tải…' : 'Không tìm thấy lần chạy.'}</p></AppShell>;
  const reports = (state.data?.reports ?? []).filter((item): item is ReportView => typeof item === 'object' && item !== null && 'id' in item && Boolean(run.runDirs?.includes(String((item as { id: unknown }).id))));
  const missingReportIds = (run.runDirs ?? []).filter(
    (id) => !reports.some((report) => report.id === id),
  );
  const farmArn = run.log
    .map((line) => line.match(/arn:aws:devicefarm:[^\s]+/)?.[0])
    .find(Boolean);
  return <AppShell title="Device Farm"><Link to="/farm" className="text-sm underline">← Quay lại</Link><div className="mt-4 flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold">{run.feature}</h2><StatusPill status={run.status}/><span className="text-muted-foreground text-sm">{when(run.startedAt)}</span></div>{run.error && <div className="mt-3"><FailureBanner error={run.error}/></div>}<section className="border-border bg-card mt-4 rounded-lg border p-4"><h3 className="font-medium">Tiến trình</h3><ul className="mt-3 space-y-2 text-sm">{run.stages.map((stage) => <li key={stage.name}><span className="me-2">{stage.status === 'done' ? '✓' : stage.status === 'failed' ? '✕' : stage.status === 'running' ? '…' : '·'}</span>{stage.name}</li>)}</ul></section>{reports.map((report) => <ReportCard key={report.id} report={report}/>) }{missingReportIds.length > 0 && <MissingReports runId={run.id} ids={missingReportIds} farmArn={farmArn}/>} {!run.runDirs?.length && run.status !== 'running' && <section className="border-border bg-card mt-4 rounded-lg border p-4 text-sm"><b>Không có report cục bộ</b><p className="text-muted-foreground mt-1">Lượt chạy dừng trước khi sinh được report, ảnh và video.</p></section>}{run.log.length > 0 && <details className="mt-4" open><summary>Log ({run.log.length} dòng)</summary><LogView logs={run.log} className="mt-2 max-h-96" label="Log lượt chạy farm" /></details>}</AppShell>;
}

/**
 * Lịch sử còn, thư mục artifact thì không.
 *
 * Trước đây chỗ này in ra một câu lệnh CLI khôi phục và coi như xong. Người
 * chạy TestPilot là QA, không phải người dựng dự án: họ mở trình duyệt, không
 * mở terminal trong đúng thư mục repo có Node đã cài. Câu lệnh ấy cũng đổ lỗi
 * sai chỗ — file mất là do chính sách dọn dẹp của TestPilot xoá, không phải
 * AWS đánh rơi. Nên: nói ra lý do, rồi đưa một cái nút làm hộ.
 *
 * Không có ARN trong log thì không tự lấy lại được: run trên AWS chỉ định danh
 * bằng ARN đó. Nói thẳng điều này thay vì hiện một cái nút bấm vào không chạy.
 */
function MissingReports({ runId, ids, farmArn }: { runId: string; ids: string[]; farmArn?: string }) {
  const job = useStreamJob(`farm-pull-${runId}`, STREAM_ROUTES.farmPull);
  const pulling = job.status === 'running';
  return <section className="border-s-status-flaky bg-(--tint-warn) mt-4 rounded-lg border border-s-[3px] p-4 text-sm"><b>Report, ảnh và video đã bị dọn khỏi máy chủ này</b><p className="text-muted-foreground mt-1">Lượt chạy trên Device Farm đã xong và artifact đã được thu về, nhưng {ids.length} thư mục report sau đó bị chính sách lưu trữ của TestPilot xoá đi để nhường chỗ cho các lượt chạy mới hơn. Device Farm giữ kết quả trên AWS khoảng 30 ngày, nên lượt chạy này thường vẫn lấy lại được.</p><details className="mt-2"><summary className="cursor-pointer">Các thư mục bị thiếu</summary><code className="mt-1 block whitespace-pre-wrap">{ids.join('\n')}</code></details>{farmArn ? <><div className="mt-3 flex flex-wrap items-center gap-2"><Button disabled={pulling} onClick={() => job.start({ arn: farmArn, runId })}>{pulling ? 'Đang tải lại từ AWS…' : 'Tải lại từ AWS'}</Button>{job.status === 'done' && <span className="text-muted-foreground">Đã tải xong — tải lại trang để xem report.</span>}</div>{job.error && <p className="text-status-failed mt-2">{job.error}</p>}{job.logs.length > 0 && <LogView logs={job.logs} className="mt-2 max-h-64" label="Log tải lại artifact" active={pulling}/>}</> : <p className="mt-3">Log của lượt chạy này không còn ARN của run trên Device Farm, nên TestPilot không biết phải hỏi AWS về lượt nào. Cách duy nhất còn lại là chạy lại feature này trên Device Farm.</p>}</section>;
}

function ReportCard({ report }: { report: ReportView }) { return <section className="border-border bg-card mt-4 rounded-lg border p-4"><div className="flex flex-wrap gap-2"><b>{report.device ?? report.id}</b><StatusPill status={report.status}/>{report.counters && <span className="text-muted-foreground text-sm">{report.counters.passed} passed · {report.counters.failed} failed</span>}<a className="text-sm underline" href={report.url} target="_blank" rel="noreferrer">Báo cáo</a></div>{report.videoUrls?.map((url) => <RunVideo key={url} url={url} report={report}/>) }<RunShots report={report}/>{report.networkLogUrl && <LazyLog url={report.networkLogUrl} summary="Network log" label="Network log" className="max-h-72"/>}{report.hasLog && <LazyLog url={`${ROUTES.runLog}?id=${encodeURIComponent(report.id)}`} label={`Log ${report.device ?? report.id}`} className="max-h-64"/>}</section>; }
