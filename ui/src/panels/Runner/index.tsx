import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, Play, RefreshCw, Smartphone, Square, XCircle } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { CheckRow } from '@/components/CheckRow';
import { Field } from '@/components/Field';
import { StatusPill } from '@/components/StatusPill';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api, qs } from '@/api/client';
import { ROUTES, STREAM_ROUTES } from '@/api/routes';
import { useAppState } from '@/hooks/useAppState';
import { useStreamJob } from '@/hooks/useStreamJob';
import { when } from '@/lib/datetime';
import { cn } from '@/lib/utils';
import type { PreflightResponse, ReportView } from '@core/ui/contracts.js';

const PAGE_DESCRIPTION = 'Chạy bộ test ngay trên máy này, trước khi đẩy lên farm.';

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
  const tags = useMemo(
    () => [
      ...new Set(state.data?.features.flatMap((f) => f.scenarios.flatMap((s) => s.tags)) ?? []),
    ].sort(),
    [state.data],
  );
  const reports =
    state.data?.reports.filter(
      (r): r is ReportView => typeof r === 'object' && r !== null && 'platform' in r,
    ) ?? [];
  const environments = Object.keys(state.data?.config.environments ?? {});

  const start = () => {
    if (job.status === 'running') return;
    if (!preflight.data?.ok)
      return toast.error('Chưa qua kiểm tra trước khi chạy. Hãy xử lý các mục đỏ rồi thử lại.');
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

  return (
    <AppShell title="Local Runner" description={PAGE_DESCRIPTION}>
      <section aria-label="Local Runner" className="flex flex-1 flex-col gap-6">
        <div className="grid items-start gap-6 xl:grid-cols-2">
          <Card aria-labelledby="run-config-title">
            <CardHeader>
              <CardTitle id="run-config-title">Cấu hình lượt chạy</CardTitle>
              <CardDescription>Chọn platform và phạm vi test sẽ chạy.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Platform">
                  <select
                    className="input mt-0"
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value as typeof platform)}
                  >
                    <option value="web">web — Playwright</option>
                    <option value="android">android — Appium</option>
                    <option value="ios">ios — Appium</option>
                  </select>
                </Field>
                <Field label="Lọc theo tag">
                  <select
                    className="input mt-0"
                    value={tag}
                    onChange={(e) => setTag(e.target.value)}
                  >
                    <option value="">Tất cả tag</option>
                    {tags.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </Field>
                {environments.length > 0 && (
                  <Field label="Môi trường">
                    <select
                      className="input mt-0"
                      value={env}
                      onChange={(e) => setEnv(e.target.value)}
                    >
                      <option value="">Mặc định</option>
                      {environments.map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </Field>
                )}
              </div>

              <div className="flex flex-col gap-3">
                {platform === 'web' && (
                  <CheckRow
                    label="Hiện trình duyệt để theo dõi (headed)"
                    checked={headed}
                    onChange={setHeaded}
                  />
                )}
                <CheckRow
                  label="Bao gồm test bị cách ly (quarantined)"
                  checked={quarantined}
                  onChange={setQuarantined}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={job.status === 'running' || preflight.isPending || !preflight.data?.ok}
                  onClick={start}
                >
                  <Play className="size-4" />
                  {job.status === 'running' ? 'Đang chạy…' : 'Chạy test'}
                </Button>
                {job.status === 'running' && (
                  <Button variant="destructive" onClick={() => void stop()}>
                    <Square className="size-4" />
                    Dừng test
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <PreflightCard
            result={preflight.data}
            pending={preflight.isPending}
            error={preflight.error}
            onRefresh={() => void preflight.refetch()}
          />
        </div>

        <JobLog logs={job.logs} dropped={job.dropped} error={job.error} />
        <History reports={reports} />
      </section>
    </AppShell>
  );
}

function PreflightCard({
  result,
  pending,
  error,
  onRefresh,
}: {
  result: PreflightResponse | undefined;
  pending: boolean;
  error: Error | null;
  onRefresh: () => void;
}) {
  return (
    <Card aria-labelledby="preflight-title">
      <CardHeader>
        <CardTitle id="preflight-title">Kiểm tra trước khi chạy</CardTitle>
        <CardDescription>
          Driver và thiết bị phải sẵn sàng thì nút chạy mới mở khoá.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {pending && <p className="text-muted-foreground text-sm">Đang kiểm tra máy và driver…</p>}
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error.message}
          </p>
        )}
        {result && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {result.ok ? (
                <Badge>
                  <CheckCircle2 />
                  Sẵn sàng chạy.
                </Badge>
              ) : (
                <Badge variant="outline" className="text-destructive">
                  <XCircle />
                  Chưa sẵn sàng chạy.
                </Badge>
              )}
              <Button variant="outline" size="sm" type="button" onClick={onRefresh}>
                <RefreshCw className="size-4" />
                Kiểm tra lại
              </Button>
            </div>

            <ul className="flex flex-col divide-y">
              {result.checks.map((check) => (
                <li key={check.name} className="flex items-start gap-2 py-2 first:pt-0 last:pb-0">
                  {check.ok ? (
                    <CheckCircle2 className="text-status-pass mt-0.5 size-4 shrink-0" />
                  ) : (
                    <XCircle className="text-destructive mt-0.5 size-4 shrink-0" />
                  )}
                  <span className="text-sm">
                    <b>{check.name}:</b> {check.detail}
                  </span>
                </li>
              ))}
            </ul>

            {result.device && (
              <div className="bg-muted/50 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                <Smartphone className="text-muted-foreground size-4 shrink-0" />
                <span className="min-w-0 truncate">Sẽ dùng thiết bị: {result.device}</span>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function JobLog({
  logs,
  dropped,
  error,
}: {
  logs: string[];
  dropped: number;
  error: string | null;
}) {
  if (!logs.length && !error) return null;
  return (
    <Card aria-labelledby="run-log-title">
      <CardHeader>
        <CardTitle id="run-log-title">Log chạy</CardTitle>
        {dropped > 0 && (
          <CardDescription>Đã ẩn {dropped} dòng đầu để giữ trang phản hồi.</CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <pre className="console mt-0">
          {logs.join('\n')}
          {error ? `\n❌ ${error}` : ''}
        </pre>
      </CardContent>
    </Card>
  );
}

function History({ reports }: { reports: ReportView[] }) {
  return (
    <Card aria-labelledby="run-history-title">
      <CardHeader>
        <CardTitle id="run-history-title">Lịch sử chạy local</CardTitle>
        <CardDescription>Report sinh ra từ máy này.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground text-left">
                <th className="p-2 font-medium">Thời gian</th>
                <th className="p-2 font-medium">Platform</th>
                <th className="p-2 font-medium">Tag</th>
                <th className="p-2 text-right font-medium">Pass</th>
                <th className="p-2 text-right font-medium">Fail</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {reports.length === 0 && (
                <tr className="border-t">
                  <td colSpan={6} className="text-muted-foreground p-6 text-center">
                    Chưa có lần chạy local nào.
                  </td>
                </tr>
              )}
              {reports.map((report) => (
                <tr key={report.id} className="border-t">
                  <td className="p-2 whitespace-nowrap">{when(report.startedAt)}</td>
                  <td className="p-2">
                    <StatusPill status={report.platform} />
                  </td>
                  <td className="p-2">{report.tag ?? 'tất cả'}</td>
                  <td
                    className={cn(
                      'p-2 text-right tabular-nums',
                      (report.counters?.passed ?? 0) > 0 && 'text-status-pass',
                    )}
                  >
                    {report.counters?.passed ?? 0}
                  </td>
                  <td
                    className={cn(
                      'p-2 text-right tabular-nums',
                      (report.counters?.failed ?? 0) > 0 && 'text-status-fail',
                    )}
                  >
                    {report.counters?.failed ?? 0}
                  </td>
                  <td className="p-2">
                    <Link
                      to="/runner/history"
                      search={{ runId: report.id }}
                      className="text-primary underline"
                    >
                      Chi tiết
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
