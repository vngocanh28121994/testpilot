import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AppShell } from '@/components/layout/AppShell';
import { StatusPill } from '@/components/StatusPill';
import { api, qs } from '@/api/client';
import { ROUTES, STREAM_ROUTES } from '@/api/routes';
import { useAppState } from '@/hooks/useAppState';
import { useStreamJob } from '@/hooks/useStreamJob';
import { when } from '@/lib/datetime';
import type { PreflightResponse, ReportView } from '@core/ui/contracts.js';

export default function RunnerPanel() {
  const state = useAppState((s) => ({ config: s.config, features: s.features, reports: s.reports }));
  const [platform, setPlatform] = useState<'web' | 'android' | 'ios'>('web');
  const [tag, setTag] = useState('');
  const [headed, setHeaded] = useState(false);
  const [quarantined, setQuarantined] = useState(false);
  const [env, setEnv] = useState('');
  const job = useStreamJob('local-run', STREAM_ROUTES.run);
  const preflight = useQuery({
    queryKey: ['preflight', platform],
    queryFn: () => api.get<PreflightResponse>(`${ROUTES.preflight}${qs({ platform })}`),
    enabled: Boolean(state.data),
  });
  const tags = useMemo(() => [...new Set(state.data?.features.flatMap((f) => f.scenarios.flatMap((s) => s.tags)) ?? [])].sort(), [state.data]);
  const reports = state.data?.reports.filter((r): r is ReportView => typeof r === 'object' && r !== null && 'platform' in r) ?? [];

  const start = () => {
    if (job.status === 'running') return;
    if (!preflight.data?.ok) return toast.error('Chưa qua kiểm tra trước khi chạy. Hãy xử lý các mục đỏ rồi thử lại.');
    job.start({
      platform,
      tag: tag || undefined,
      headed,
      includeQuarantined: quarantined,
      ...(env ? { env } : {}),
      ...(preflight.data.device ? { devices: [`${platform}:${preflight.data.device}`] } : {}),
    });
  };
  const stop = async () => {
    try {
      await api.post<{ ok: boolean }>(ROUTES.runStop);
      toast.success('Đã gửi yêu cầu dừng test.');
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  return <AppShell title="Local Runner">
    <section className="border-border max-w-3xl rounded-lg border p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm">Platform<select className="input" value={platform} onChange={(e) => setPlatform(e.target.value as typeof platform)}><option value="web">web — Playwright</option><option value="android">android — Appium</option><option value="ios">ios — Appium</option></select></label>
        <label className="text-sm">Lọc theo tag<select className="input" value={tag} onChange={(e) => setTag(e.target.value)}><option value="">Tất cả tag</option>{tags.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        {Object.keys(state.data?.config.environments ?? {}).length > 0 && <label className="text-sm">Môi trường<select className="input" value={env} onChange={(e) => setEnv(e.target.value)}><option value="">Mặc định</option>{Object.keys(state.data?.config.environments ?? {}).map((item) => <option key={item}>{item}</option>)}</select></label>}
      </div>
      {platform === 'web' && <label className="mt-4 flex gap-2 text-sm"><input type="checkbox" checked={headed} onChange={(e) => setHeaded(e.target.checked)} />Hiện trình duyệt để theo dõi (headed)</label>}
      <label className="mt-3 flex gap-2 text-sm"><input type="checkbox" checked={quarantined} onChange={(e) => setQuarantined(e.target.checked)} />Bao gồm test bị cách ly (quarantined)</label>
      <PreflightCard result={preflight.data} pending={preflight.isPending} error={preflight.error} onRefresh={() => void preflight.refetch()} />
      <div className="mt-5 flex gap-2"><button className="bg-primary text-primary-foreground rounded px-3 py-2 text-sm disabled:opacity-50" disabled={job.status === 'running' || preflight.isPending || !preflight.data?.ok} onClick={start}>{job.status === 'running' ? 'Đang chạy…' : 'Chạy test'}</button>{job.status === 'running' && <button className="bg-destructive text-white rounded px-3 py-2 text-sm" onClick={() => void stop()}>Dừng test</button>}</div>
    </section>
    <JobLog logs={job.logs} dropped={job.dropped} error={job.error} />
    <History reports={reports} />
  </AppShell>;
}

function PreflightCard({ result, pending, error, onRefresh }: { result: PreflightResponse | undefined; pending: boolean; error: Error | null; onRefresh: () => void }) {
  return <section className="border-border mt-5 rounded border p-3"><div className="flex flex-wrap items-center gap-2"><h2 className="font-medium">Kiểm tra trước khi chạy</h2><button className="button" type="button" onClick={onRefresh}>Kiểm tra lại</button></div>{pending && <p className="text-muted-foreground mt-2 text-sm">Đang kiểm tra máy và driver…</p>}{error && <p role="alert" className="text-destructive mt-2 text-sm">{error.message}</p>}{result && <><p className={`mt-2 text-sm ${result.ok ? 'text-status-pass' : 'text-destructive'}`}>{result.ok ? 'Sẵn sàng chạy.' : 'Chưa sẵn sàng chạy.'}</p><ul className="mt-2 space-y-1 text-sm">{result.checks.map((check) => <li key={check.name}><span className={check.ok ? 'text-status-pass' : 'text-destructive'}>{check.ok ? '✓' : '✕'}</span> <b>{check.name}:</b> {check.detail}</li>)}</ul>{result.device && <p className="text-muted-foreground mt-2 text-xs">Sẽ dùng thiết bị: {result.device}</p>}</>}</section>;
}

function JobLog({ logs, dropped, error }: { logs: string[]; dropped: number; error: string | null }) {
  if (!logs.length && !error) return null;
  return <section className="mt-4"><h2 className="font-medium">Log chạy</h2>{dropped > 0 && <p className="text-muted-foreground text-xs">Đã ẩn {dropped} dòng đầu để giữ trang phản hồi.</p>}<pre className="console">{logs.join('\n')}{error ? `\n❌ ${error}` : ''}</pre></section>;
}

function History({ reports }: { reports: ReportView[] }) {
  return <section className="mt-6"><h2 className="font-medium">Lịch sử chạy local</h2><div className="border-border mt-3 overflow-x-auto rounded border"><table className="w-full text-sm"><thead><tr className="text-muted-foreground text-left"><th className="p-2">Thời gian</th><th className="p-2">Platform</th><th className="p-2">Tag</th><th className="p-2 text-right">Pass</th><th className="p-2 text-right">Fail</th><th /></tr></thead><tbody>{reports.length === 0 && <tr><td colSpan={6} className="p-5 text-center">Chưa có lần chạy local nào.</td></tr>}{reports.map((report) => <tr key={report.id} className="border-border border-t"><td className="p-2">{when(report.startedAt)}</td><td className="p-2"><StatusPill status={report.platform} /></td><td className="p-2">{report.tag ?? 'tất cả'}</td><td className="p-2 text-right">{report.counters?.passed ?? 0}</td><td className="p-2 text-right">{report.counters?.failed ?? 0}</td><td className="p-2"><Link to="/runner/history" search={{ runId: report.id }} className="underline">Chi tiết</Link></td></tr>)}</tbody></table></div></section>;
}
