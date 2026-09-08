import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, Play, RefreshCw, Smartphone, Square, XCircle } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { CheckRow } from '@/components/CheckRow';
import { Dropdown } from '@/components/Dropdown';
import { PreflightChecks } from '@/components/PreflightChecks';
import type { DateRange } from 'react-day-picker';
import { DateRangePicker } from '@/components/DateRangePicker';
import { Pagination } from '@/components/Pagination';
import { inRange } from '@/lib/datetime';
import { LogView } from '@/components/LogView';
import { Field } from '@/components/Field';
import { StatusPill } from '@/components/StatusPill';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api, qs } from '@/api/client';
import { ROUTES, STREAM_ROUTES } from '@/api/routes';
import { DevicePicker } from '@/components/DevicePicker';
import { PrereqTools } from './PrereqTools';
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
  /**
   * Máy đã chọn, khi nhiều máy cùng cắm. Rỗng nghĩa là để preflight tự quyết —
   * đúng đường cũ, vì một máy duy nhất thì không có gì phải hỏi.
   */
  const [device, setDevice] = useState('');
  const job = useStreamJob('local-run', STREAM_ROUTES.run);
  const preflight = useQuery({
    // Máy đang chọn nằm trong khoá cache: chọn máy khác là một câu hỏi khác,
    // và câu trả lời cũ không được phép ghi đè câu trả lời mới.
    queryKey: ['preflight', platform, device],
    queryFn: () =>
      api.get<PreflightResponse>(`${ROUTES.preflight}${qs({ platform, device: device || undefined })}`),
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
      ...(() => {
        const picked = device || preflight.data.device;
        return picked ? { devices: [`${platform}:${picked}`] } : {};
      })(),
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
                  <Dropdown
                    className="mt-0"
                    value={platform}
                    onChange={(next) => setPlatform(next as typeof platform)}
                    options={[
                      { value: 'web', label: 'web — Playwright' },
                      { value: 'android', label: 'android — Appium' },
                      { value: 'ios', label: 'ios — Appium' },
                    ]}
                  />
                </Field>
                <Field label="Lọc theo tag">
                  <Dropdown
                    className="mt-0"
                    value={tag}
                    onChange={setTag}
                    options={[
                      { value: '', label: 'Tất cả tag' },
                      ...tags.map((item) => ({ value: item, label: item })),
                    ]}
                  />
                </Field>
                {environments.length > 0 && (
                  <Field label="Môi trường">
                    <Dropdown
                      className="mt-0"
                      value={env}
                      onChange={setEnv}
                      options={[
                        { value: '', label: 'Mặc định' },
                        ...environments.map((item) => ({ value: item, label: item })),
                      ]}
                    />
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
            platform={platform}
            chosen={device}
            onPick={setDevice}
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
  platform,
  chosen,
  onPick,
}: {
  result: PreflightResponse | undefined;
  pending: boolean;
  error: Error | null;
  onRefresh: () => void;
  platform: 'web' | 'android' | 'ios';
  chosen: string;
  onPick: (id: string) => void;
}) {
  return (
    <Card aria-labelledby="preflight-title">
      <CardHeader>
        <CardTitle id="preflight-title">Trước khi chạy</CardTitle>
        <CardDescription>
          Driver và thiết bị phải sẵn sàng thì nút chạy mới mở khoá. Sửa được ngay ở đây,
          không cần mở terminal.
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

            <PreflightChecks checks={result.checks} />

            {/* Nhiều máy cùng cắm thì phải hỏi, chứ không phải im lặng chặn
                lượt chạy rồi bắt người dùng đi sửa file config. */}
            {(result.candidates?.length ?? 0) > 1 ? (
              <DevicePicker
                name="runner"
                candidates={result.candidates!}
                chosen={chosen || result.device}
                onPick={onPick}
              />
            ) : (
              result.device && (
                <div className="bg-muted/50 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                  <Smartphone className="text-muted-foreground size-4 shrink-0" />
                  <span className="min-w-0 truncate">Sẽ dùng thiết bị: {result.device}</span>
                </div>
              )
            )}

            {/* Web chỉ cần một URL nên không có gì để sửa ở đây. */}
            {platform !== 'web' && <PrereqTools platform={platform} />}
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
      </CardHeader>
      <CardContent>
        <LogView logs={logs} dropped={dropped} error={error} label="Log chạy" />
      </CardContent>
    </Card>
  );
}

const HISTORY_PAGE_SIZE = 10;

function History({ reports }: { reports: ReportView[] }) {
  const [range, setRange] = useState<DateRange>();
  const [platform, setPlatform] = useState('');
  const [page, setPage] = useState(1);

  const filtered = useMemo(
    () =>
      reports.filter(
        (report) =>
          inRange(report.startedAt, range) && (!platform || report.platform === platform),
      ),
    [reports, range, platform],
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / HISTORY_PAGE_SIZE));
  // Lọc xong mà đang đứng ở trang 5 thì bảng rỗng dù có kết quả — kẹp lại thay
  // vì để người dùng tự đoán là phải bấm về trang 1.
  const current = Math.min(page, pageCount);
  const shown = filtered.slice((current - 1) * HISTORY_PAGE_SIZE, current * HISTORY_PAGE_SIZE);

  // Nói rõ đang lọc gì, để "không có kết quả" không bị đọc thành "chưa chạy bao giờ".
  const active = [
    range?.from ? 'khoảng thời gian đã chọn' : '',
    platform ? `platform ${platform}` : '',
  ].filter(Boolean);

  return (
    <Card aria-labelledby="run-history-title">
      <CardHeader>
        <CardTitle id="run-history-title">Lịch sử chạy local</CardTitle>
        <CardDescription>Report sinh ra từ máy này.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            Khoảng thời gian
            <DateRangePicker
              value={range}
              onChange={(next) => {
                setRange(next);
                setPage(1);
              }}
            />
          </label>
          <Field label="Platform">
            <Dropdown
              className="mt-0 w-40"
              aria-label="Lọc theo platform"
              value={platform}
              onChange={(next) => {
                setPlatform(next);
                setPage(1);
              }}
              options={[
                { value: '', label: 'Tất cả' },
                { value: 'web', label: 'web' },
                { value: 'android', label: 'android' },
                { value: 'ios', label: 'ios' },
              ]}
            />
          </Field>
          {active.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setRange(undefined);
                setPlatform('');
                setPage(1);
              }}
            >
              Xoá bộ lọc
            </Button>
          )}
        </div>
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
              {shown.length === 0 && (
                <tr className="border-t">
                  <td colSpan={6} className="text-muted-foreground p-6 text-center">
                    {reports.length === 0
                      ? 'Chưa có lần chạy local nào.'
                      : `Không có lần chạy nào khớp ${active.join(' và ')}.`}
                  </td>
                </tr>
              )}
              {shown.map((report) => (
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
        <Pagination page={current} pageCount={pageCount} onPageChange={setPage} />
      </CardContent>
    </Card>
  );
}
