import { useMemo, useState } from 'react';
import { endOfDay, startOfDay } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, Play, RefreshCw, Smartphone, Square, X, XCircle } from 'lucide-react';
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
import { BuildCard } from './BuildCard';
import { DevicePicker, type DeviceTarget } from './DevicePicker';
import { Prereq } from './Prereq';
import { DateRangePicker } from '@/components/DateRangePicker';
import { Pagination } from '@/components/Pagination';
import { FilterChip } from '@/components/FilterChip';
import { TagFilter } from '@/components/TagFilter';
import { DropdownSelect } from '@/components/DropdownSelect';
import type { PreflightResponse, ReportView, SaveConfigResponse, StateResponse } from '@core/ui/contracts.js';

const PAGE_DESCRIPTION = 'Chạy bộ test ngay trên máy này, trước khi đẩy lên farm.';

export default function RunnerPanel() {
  const state = useAppState((s) => ({ config: s.config, features: s.features, reports: s.reports, appBuilds: s.appBuilds, envBuilds: s.envBuilds, tagTaxonomy: s.tagTaxonomy }));
  const client = useQueryClient();
  const [platform, setPlatform] = useState<'web' | 'android' | 'ios'>('web');
  const [tagsSelected, setTagsSelected] = useState<string[]>([]);
  const [headed, setHeaded] = useState(false);
  const [quarantined, setQuarantined] = useState(false);
  const [env, setEnv] = useState('');
  const [devices, setDevices] = useState<string[]>([]);
  const [slowMoMs, setSlowMoMs] = useState<number | null>(null);
  const [savingSlowMo, setSavingSlowMo] = useState(false);
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
  const targets = useMemo(() => state.data ? deviceTargets(state.data.config) : [], [state.data]);
  const effectiveSlowMoMs = slowMoMs ?? state.data?.config.web.slowMoMs ?? 300;

  const start = async () => {
    if (job.status === 'running') return;
    if (!preflight.data?.ok)
      return toast.error('Chưa qua kiểm tra trước khi chạy. Hãy xử lý các mục đỏ rồi thử lại.');
    if (platform === 'web' && headed && state.data && effectiveSlowMoMs !== state.data.config.web.slowMoMs) {
      setSavingSlowMo(true);
      try {
        await api.put<SaveConfigResponse>(ROUTES.config, { ...state.data.config, web: { ...state.data.config.web, slowMoMs: effectiveSlowMoMs } });
        await client.invalidateQueries({ queryKey: ['state'] });
      } catch (error) {
        toast.error(`Không lưu được slowMo: ${(error as Error).message}`);
        return;
      } finally { setSavingSlowMo(false); }
    }
    job.start({
      platform,
      tag: tagsSelected.length ? tagsSelected.join(',') : undefined,
      headed,
      includeQuarantined: quarantined,
      ...(env ? { env } : {}),
      ...(devices.length ? { devices } : preflight.data.device ? { devices: [`${platform}:${preflight.data.device}`] } : {}),
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
                  <DropdownSelect
                    ariaLabel="Platform"
                    value={platform}
                    onValueChange={(value) => setPlatform(value as typeof platform)}
                    options={[
                      { value: 'web', label: 'web — Playwright' },
                      { value: 'android', label: 'android — Appium' },
                      { value: 'ios', label: 'ios — Appium' },
                    ]}
                  />
                </Field>
                {/* Popover, không phải danh sách luôn mở.
                    `TagPicker` là ô SOẠN tag cho một kịch bản; đặt nó vào đây
                    thì ô này cao gấp bốn ô Platform bên cạnh, tràn ra ngoài thẻ
                    và đẩy nút "Chạy test" xuống dưới màn hình. Xem chú thích
                    đầu TagFilter.tsx. */}
                <Field label="Lọc theo tag">
                  <TagFilter
                    value={tagsSelected}
                    // `setTagsSelected` nhận thẳng hàm cập nhật của TagFilter:
                    // đây đúng là chữ ký `SetStateAction`, nên tick nhiều tag
                    // liên tiếp không mất tag nào.
                    onChange={setTagsSelected}
                    taxonomy={state.data?.tagTaxonomy}
                    options={tags}
                    label="Tất cả tag"
                    className="w-full"
                  />
                </Field>
                {environments.length > 0 && (
                  <Field label="Môi trường">
                    <DropdownSelect
                      ariaLabel="Môi trường"
                      value={env}
                      onValueChange={setEnv}
                      options={[
                        { value: '', label: 'Mặc định' },
                        ...environments.map((item) => ({ value: item, label: item })),
                      ]}
                    />
                  </Field>
                )}
              </div>

              {/* Tag đã chọn quyết định lượt chạy này chạy những gì, nên nó
                  phải đọc được mà không cần mở lại popover — khác một bộ lọc
                  duyệt danh sách, ở đây đoán sai là chạy nhầm bộ test. */}
              {tagsSelected.length > 0 && (
                <ul className="flex flex-wrap items-center gap-1.5">
                  {tagsSelected.map((tag) => (
                    <FilterChip
                      key={tag}
                      label={tag}
                      onRemove={() =>
                        setTagsSelected((prev) => prev.filter((item) => item !== tag))
                      }
                    />
                  ))}
                  <li className="ms-auto">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => setTagsSelected([])}
                    >
                      <X className="size-3.5" />
                      Bỏ chọn ({tagsSelected.length})
                    </Button>
                  </li>
                </ul>
              )}

              <div className="flex flex-col gap-3">
                {platform === 'web' && (
                  <CheckRow
                    label="Hiện trình duyệt để theo dõi (headed)"
                    checked={headed}
                    onChange={setHeaded}
                  />
                )}
                {platform === 'web' && headed && (
                  <Field label="Slow motion giữa các thao tác (ms)">
                    <input className="input mt-0" type="number" min={0} max={5_000} step={50} value={effectiveSlowMoMs} onChange={(event) => setSlowMoMs(Math.max(0, Number(event.target.value) || 0))} />
                  </Field>
                )}
                <CheckRow
                  label="Bao gồm test bị cách ly (quarantined)"
                  checked={quarantined}
                  onChange={setQuarantined}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={job.status === 'running' || savingSlowMo || preflight.isPending || !preflight.data?.ok}
                  onClick={() => void start()}
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

        <DevicePicker targets={targets} selected={devices} onSelectedChange={setDevices} platform={platform} />
        <BuildCard platform={platform} env={env} defaultEnv={state.data?.config.defaultEnv ?? ''} appBuilds={state.data?.appBuilds ?? { android: null, ios: null }} envBuilds={state.data?.envBuilds ?? {}} />
        <Prereq platform={platform} />

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
  const [range, setRange] = useState<DateRange>();
  const [platform, setPlatform] = useState<'all' | 'web' | 'android' | 'ios'>('all');
  const [page, setPage] = useState(1);
  const filtered = reports.filter((report) => (platform === 'all' || report.platform === platform) && inRange(report.startedAt, range));
  const pageCount = Math.max(1, Math.ceil(filtered.length / 10));
  const shown = filtered.slice((Math.min(page, pageCount) - 1) * 10, Math.min(page, pageCount) * 10);
  return (
    <Card aria-labelledby="run-history-title">
      <CardHeader>
        <CardTitle id="run-history-title">Lịch sử chạy local</CardTitle>
        <CardDescription>Report sinh ra từ máy này.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex flex-wrap items-end gap-3"><label className="text-sm">Khoảng ngày<DateRangePicker value={range} onChange={(next) => { setRange(next); setPage(1); }} /></label><div className="flex gap-1">{(['all', 'web', 'android', 'ios'] as const).map((item) => <Button key={item} size="sm" variant={platform === item ? 'default' : 'outline'} onClick={() => { setPlatform(item); setPage(1); }}>{item === 'all' ? 'Tất cả' : item}</Button>)}</div><Button className="ms-auto" size="sm" variant="ghost" onClick={() => { setRange(undefined); setPlatform('all'); setPage(1); }}>Xoá bộ lọc</Button></div>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground text-left">
                <th className="p-2 font-medium">Thời gian</th>
                <th className="p-2 font-medium">Platform</th>
                <th className="p-2 font-medium">Tag</th>
                <th className="p-2 text-right font-medium">Pass</th>
                <th className="p-2 text-right font-medium">Fail</th>
                <th className="p-2 text-right font-medium">Thời lượng</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr className="border-t">
                  <td colSpan={7} className="text-muted-foreground p-6 text-center">
                    Không có lần chạy local khớp bộ lọc.
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
                  <td className="p-2 text-right tabular-nums">{reportDuration(report)}</td>
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
        <Pagination page={Math.min(page, pageCount)} pageCount={pageCount} onPageChange={setPage} />
      </CardContent>
    </Card>
  );
}

function inRange(iso: string, range: DateRange | undefined) { if (!range?.from) return true; const time = Date.parse(iso); return !Number.isNaN(time) && time >= startOfDay(range.from).getTime() && time <= endOfDay(range.to ?? range.from).getTime(); }
function reportDuration(report: ReportView) { const from = Date.parse(report.startedAt); const to = Date.parse(report.finishedAt ?? ''); if (Number.isNaN(from) || Number.isNaN(to) || to < from) return '—'; const seconds = Math.round((to - from) / 1000); return seconds < 90 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`; }

/** Cùng quy ước với `devicesOf()` ở backend, nhưng chỉ là dữ liệu hiển thị. */
function deviceTargets(config: StateResponse['config']): DeviceTarget[] {
  const mobile = (platform: 'android' | 'ios') => {
    const section = config[platform];
    const listed = section.devices?.length
      ? section.devices
      : [{ id: platform, deviceName: section.deviceName }];
    return listed.map((device) => ({
      platform,
      id: device.id,
      deviceName: device.deviceName,
      ...(device.udid ? { udid: device.udid } : {}),
    }));
  };
  return [...mobile('android'), ...mobile('ios')];
}
