import { Link } from '@tanstack/react-router';
import { AppShell } from '@/components/layout/AppShell';
import { LazyLog } from '@/components/LazyLog';
import { ROUTES } from '@/api/routes';
import { LogView } from '@/components/LogView';
import { StatusPill } from '@/components/StatusPill';
import { useAppState } from '@/hooks/useAppState';
import { when } from '@/lib/datetime';
import type { ReportView } from '@core/ui/contracts.js';

export default function FarmDetailPanel({ runId }: { runId: string }) {
  const state = useAppState((s) => ({ runs: s.runs, reports: s.reports }));
  const run = state.data?.runs.find((item) => item.id === runId);
  if (!run) return <AppShell title="Device Farm"><Link to="/farm" className="text-sm underline">← Quay lại</Link><p className="text-muted-foreground mt-4">{state.isPending ? 'Đang tải…' : 'Không tìm thấy lần chạy.'}</p></AppShell>;
  const reports = (state.data?.reports ?? []).filter((item): item is ReportView => typeof item === 'object' && item !== null && 'id' in item && Boolean(run.runDirs?.includes(String((item as { id: unknown }).id))));
  return <AppShell title="Device Farm"><Link to="/farm" className="text-sm underline">← Quay lại</Link><div className="mt-4 flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold">{run.feature}</h2><StatusPill status={run.status}/><span className="text-muted-foreground text-sm">{when(run.startedAt)}</span></div>{run.error && <p className="text-destructive mt-3">{run.error}</p>}<section className="border-border mt-4 rounded-lg border p-4"><h3 className="font-medium">Tiến trình</h3><ul className="mt-3 space-y-2 text-sm">{run.stages.map((stage) => <li key={stage.name}><span className="me-2">{stage.status === 'done' ? '✓' : stage.status === 'failed' ? '✕' : stage.status === 'running' ? '…' : '·'}</span>{stage.name}</li>)}</ul></section>{reports.map((report) => <ReportCard key={report.id} report={report}/>) }{run.log.length > 0 && <details className="mt-4" open><summary>Log ({run.log.length} dòng)</summary><LogView logs={run.log} className="mt-2 max-h-96" label="Log lượt chạy farm" /></details>}</AppShell>;
}

function ReportCard({ report }: { report: ReportView }) { return <section className="border-border mt-4 rounded-lg border p-4"><div className="flex flex-wrap gap-2"><b>{report.device ?? report.id}</b><StatusPill status={report.status}/>{report.counters && <span className="text-muted-foreground text-sm">{report.counters.passed} passed · {report.counters.failed} failed</span>}<a className="text-sm underline" href={report.url} target="_blank" rel="noreferrer">Báo cáo</a></div>{report.videoUrls?.map((url) => <video key={url} className="mt-3 max-w-full" controls preload="metadata" src={url}/>) }{report.hasLog && <LazyLog url={`${ROUTES.runLog}?id=${encodeURIComponent(report.id)}`} label={`Log ${report.device ?? report.id}`} className="max-h-64"/>}</section>; }
