import { useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { StatusPill } from '@/components/StatusPill';
import { useAppState } from '@/hooks/useAppState';
import { api } from '@/api/client';
import type { ReportView } from '@core/ui/contracts.js';

export default function RunnerHistoryPanel({ runId }: { runId?: string }) {
  const state = useAppState((s) => s.reports);
  const reports = state.data?.filter((r): r is ReportView => typeof r === 'object' && r !== null && 'id' in r) ?? [];
  const [picked, setPicked] = useState(() => reports.find((r) => r.id === runId)?.id ?? '');
  const report = reports.find((r) => r.id === picked) ?? reports[0];
  return <AppShell title="E2E History"><div className="flex flex-wrap gap-2">{reports.map((item) => <button key={item.id} className={`rounded px-3 py-1 text-sm ${report?.id === item.id ? 'bg-primary text-primary-foreground' : 'bg-muted'}`} onClick={() => setPicked(item.id)}>{item.platform} · {new Date(item.startedAt).toLocaleDateString('vi-VN')}</button>)}</div>{!report && <p className="text-muted-foreground mt-4">Chưa có report.</p>}{report && <ReportDetail report={report}/>}</AppShell>;
}
function ReportDetail({ report }: { report: ReportView }) { const [network, setNetwork] = useState<string | null>(null); return <section className="mt-4"><div className="flex gap-2"><StatusPill status={report.status}/><a href={report.url} target="_blank" rel="noreferrer" className="text-sm underline">Mở report</a></div><iframe title={`Report ${report.id}`} src={report.url} className="border-border mt-3 h-[550px] w-full rounded border"/>{report.shotUrls && <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">{report.shotUrls.map((shot) => <a key={shot.url} href={shot.url} target="_blank" rel="noreferrer"><img className="border-border rounded border" src={shot.url} alt={shot.name}/><span className="text-xs">{shot.onFailure ? 'khi fail' : shot.name}</span></a>)}</div>}{report.networkLogUrl && <details className="mt-4" onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open && network === null) void api.getText(report.networkLogUrl!).then(setNetwork).catch((err: Error) => setNetwork(`Không đọc được log: ${err.message}`)); }}><summary>Network log</summary><pre className="bg-muted mt-2 max-h-72 overflow-auto rounded p-3 text-xs whitespace-pre-wrap">{network ?? 'Đang tải…'}</pre></details>}{report.log && <details className="mt-4"><summary>Log</summary><pre className="bg-muted mt-2 max-h-72 overflow-auto rounded p-3 text-xs whitespace-pre-wrap">{report.log}</pre></details>}</section>; }
