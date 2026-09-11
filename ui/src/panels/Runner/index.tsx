import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, Play, RefreshCw, Smartphone, Square, XCircle } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { CheckRow } from '@/components/CheckRow';
import { CheckedAt } from '@/components/CheckedAt';
import { Dropdown } from '@/components/Dropdown';
import { PreflightChecks } from '@/components/PreflightChecks';
import type { DateRange } from 'react-day-picker';
import { DateRangePicker } from '@/components/DateRangePicker';
import { Pagination } from '@/components/Pagination';
import { useActiveRuns } from '@/hooks/useActiveRuns';
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
import { DeviceChips, deviceToken, type DeviceTarget } from '@/components/DeviceChips';
import { PrereqTools } from './PrereqTools';
import { useAppState } from '@/hooks/useAppState';
import { useStreamJob } from '@/hooks/useStreamJob';
import { when } from '@/lib/datetime';
import { cn } from '@/lib/utils';
import type {
  PreflightResponse,
  PrereqIosNamesResponse,
  PrereqAdbResponse,
  PrereqIosDevicesResponse,
  ReportView,
} from '@core/ui/contracts.js';

const PAGE_DESCRIPTION = 'Chạy bộ test ngay trên máy này, trước khi đẩy lên farm.';

export default function RunnerPanel() {
  const state = useAppState((s) => ({ config: s.config, features: s.features, reports: s.reports }));
  const [platform, setPlatform] = useState<'web' | 'android' | 'ios'>('web');
  const [tag, setTag] = useState('');
  const [headed, setHeaded] = useState(false);
  const [quarantined, setQuarantined] = useState(false);
  const [env, setEnv] = useState('');
  /**
   * Lượt này lấy app ở đâu: bản đã cài sẵn trên máy, hay bản đã tải lên.
   *
   * Ở đây chứ không phải trong cấu hình, vì câu trả lời đổi theo từng lượt —
   * sáng chạy trên bản vừa cài tay, chiều chạy lại sau khi có bản build mới.
   * Mặc định là bản trên máy: cài đè 100–200 MB mỗi lượt vừa chậm vừa xoá sạch
   * dữ liệu app, mà phần lớn lượt chạy không cần thế.
   */
  const [appSource, setAppSource] = useState<'device' | 'upload'>('device');
  /**
   * Máy đã chọn, khi nhiều máy cùng cắm. Rỗng nghĩa là để preflight tự quyết —
   * đúng đường cũ, vì một máy duy nhất thì không có gì phải hỏi.
   */
  const [device, setDevice] = useState('');
  /**
   * Máy được tích để chạy song song.
   *
   * Tách khỏi `device` (lựa chọn MỘT máy của preflight): hai câu hỏi khác nhau
   * — "máy nào khi có nhiều máy cùng cắm" và "chạy trên mấy máy cùng lúc".
   */
  const [multi, setMulti] = useState<string[]>([]);
  /**
   * UDID của những máy đang thật sự cắm, dò cho CẢ hai nền tảng.
   *
   * `null` nghĩa là chưa dò lần nào — khác hẳn "dò rồi và không có máy nào".
   * Preflight chỉ dò nền tảng đang chọn, nên một mình nó không đủ để vẽ trạng
   * thái cho chip của nền tảng còn lại.
   */
  const [attachedUdids, setAttachedUdids] = useState<Set<string> | null>(null);
  /** udid → tên máy đọc được, gom từ cả hai nền tảng sau khi dò. */
  const [deviceNames, setDeviceNames] = useState<Record<string, string>>({});

  /**
   * Tên máy iOS, hỏi ngay khi mở màn.
   *
   * Không đợi người dùng bấm "Kiểm tra máy đang cắm": tên máy không đổi theo
   * việc máy có đang cắm hay không, và tải lại trang mà chip tụt về
   * "iPhone của Anh" — tên ai đó gõ vào Cài đặt — là mất đúng thứ vừa làm ra.
   *
   * Rẻ nên gọi được: `devicectl` mất 0,05 giây, khác hẳn `xctrace` 1,5 giây
   * của endpoint danh sách đầy đủ.
   */
  const iosNames = useQuery({
    queryKey: ['ios-device-names'],
    queryFn: () => api.get<PrereqIosNamesResponse>(ROUTES.prereqIosNames),
    staleTime: 5 * 60_000,
  });
  const [detecting, setDetecting] = useState(false);
  const job = useStreamJob('local-run', STREAM_ROUTES.run);

  /**
   * Nối lại lượt chạy còn sống ở server.
   *
   * Job store nằm trong RAM của trang, nên tải lại là mất sạch — trong khi tiến
   * trình ở server vẫn đang bấm vào thiết bị thật. Trước đây màn hình trở về
   * trạng thái ban đầu và cả nút Dừng cũng biến mất, dù server vẫn dừng được.
   *
   * Chỉ nối khi màn này chưa có gì: một job đang chạy trong chính tab này thì
   * không được đụng vào.
   */
  const live = useActiveRuns();
  const liveRun = live.data?.runs.find((r) => r.kind === 'run');
  const attached = useRef(false);
  useEffect(() => {
    if (!liveRun || attached.current) return;
    if (job.status !== 'idle' || job.logs.length > 0) return;
    attached.current = true;
    job.attach(`${ROUTES.runAttach}?id=${encodeURIComponent(liveRun.id)}`);
  }, [liveRun, job]);
  const preflight = useQuery({
    // Máy đang chọn nằm trong khoá cache: chọn máy khác là một câu hỏi khác,
    // và câu trả lời cũ không được phép ghi đè câu trả lời mới.
    // `env` nằm trong khoá cache, không chỉ trong query string: đổi môi trường
    // là một câu hỏi khác, và câu trả lời cũ không được phép ở lại. Thiếu nó
    // thì bấm "Kiểm tra lại" cũng chỉ nạp lại đúng câu trả lời cũ.
    queryKey: ['preflight', platform, device, env],
    queryFn: () =>
      api.get<PreflightResponse>(
        `${ROUTES.preflight}${qs({ platform, device: device || undefined, env: env || undefined })}`,
      ),
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
      ...(platform === 'web' ? {} : { appSource }),
      ...(() => {
        // Tích nhiều máy thì gửi cả danh sách: server thấy `devices.length > 1`
        // là rẽ sang run-parallel.ts. Trước đây chỗ này luôn gửi đúng một phần
        // tử, nên giao diện không có cách nào khởi động một lượt song song.
        if (multi.length > 0) return { devices: multi };
        const picked = device || preflight.data.device;
        return picked ? { devices: [`${platform}:${picked}`] } : {};
      })(),
    });
  };
  /**
   * Máy có thể chạy: lấy từ config, đánh dấu cái nào đang cắm.
   *
   * Cả những máy chưa cắm cũng hiện — chúng là thứ người ta mong thấy khi đi
   * tìm xem còn máy nào; giấu đi thì danh sách trông như config bị mất.
   */
  const targets: DeviceTarget[] = useMemo(() => {
    const cfg = state.data?.config;
    const attached = new Set((preflight.data?.candidates ?? []).map((c) => c.id));
    return (['android', 'ios'] as const).flatMap((p) =>
      (cfg?.[p]?.devices ?? []).map((d) => ({
        platform: p,
        id: d.id,
        deviceName: d.deviceName,
        udid: d.udid,
        // Đã dò cả hai nền tảng thì dùng kết quả đó; chưa dò thì chỉ nền
        // tảng đang chọn mới biết được, phần còn lại để trống.
        // Nhãn trong config đứng TRƯỚC mọi thứ dò được: nó do đội đặt, nằm
        // trong repo, và không đổi theo việc ai đang cầm máy.
        ...(() => {
          const probed = d.udid ? deviceNames[d.udid] ?? iosNames.data?.names[d.udid] : undefined;
          const name = d.label ?? probed;
          return name ? { friendlyName: name } : {};
        })(),
        ...(attachedUdids
          ? { attached: Boolean(d.udid && attachedUdids.has(d.udid)) }
          : p === platform
            ? { attached: attached.has(d.id) }
            : {}),
      })),
    );
  }, [state.data?.config, preflight.data?.candidates, platform, attachedUdids, deviceNames, iosNames.data]);

  /**
   * Dò cả android lẫn ios, rồi tự tích những máy đang cắm.
   *
   * Server quyết định "đang cắm" nghĩa là gì. Tự suy ra từ danh sách in ra sẽ
   * đếm nhầm cả máy offline lẫn simulator vào — đúng cái bẫy master đã ghi lại.
   *
   * Thay hẳn lựa chọn chứ không cộng thêm: một máy không cắm thì chạy cũng
   * không được — run-parallel bỏ qua nó — nên để nó tích chỉ là hứa một lượt
   * chạy sẽ không xảy ra.
   */
  const detectDevices = async () => {
    setDetecting(true);
    try {
      const [android, ios] = await Promise.all([
        api.get<PrereqAdbResponse>(ROUTES.prereqAdb).catch(() => ({ devices: [] })),
        api
          .get<PrereqIosDevicesResponse>(ROUTES.prereqIosDevices)
          .catch(() => ({ attached: [] as string[], names: {} as Record<string, string> })),
      ]);
      setDeviceNames({
        ...(ios.names ?? {}),
        // Android: tên thương mại nếu máy khai, không thì mã máy kèm hãng.
        ...Object.fromEntries(
          android.devices
            .filter((d) => d.state === 'device')
            // CHỈ tên thương mại máy tự khai. Ghép hãng + mã máy ra
            // "samsung SM-S938B" — dài hơn `deviceName` trong config mà không
            // nói thêm được gì.
            .map((d) => [d.id, d.marketName ?? ''])
            .filter(([, name]) => Boolean(name)),
        ),
      });
      const udids = new Set<string>([
        ...android.devices.filter((d) => d.state === 'device').map((d) => d.id),
        ...(ios.attached ?? []),
      ]);
      setAttachedUdids(udids);
      const cfg = state.data?.config;
      const ticked = (['android', 'ios'] as const).flatMap((p) =>
        (cfg?.[p]?.devices ?? [])
          .filter((d) => d.udid && udids.has(d.udid))
          .map((d) => deviceToken({ platform: p, id: d.id })),
      );
      setMulti(ticked);
      toast.success(
        ticked.length > 0
          ? `${ticked.length} máy đang cắm, đã tích sẵn.`
          : 'Không thấy máy nào đang cắm.',
      );
    } finally {
      setDetecting(false);
    }
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
                    onChange={(next) => {
                      setPlatform(next as typeof platform);
                      // Đổi sang web là bỏ hết tích: ô chọn máy biến mất, nhưng
                      // lựa chọn cũ thì không — và nó vẫn được gửi đi trong
                      // `devices`, khiến lượt chạy web bỗng thành chạy máy.
                      if (next === 'web') setMulti([]);
                    }}
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
                {platform !== 'web' && (
                  <Field label="Nguồn app">
                    <Dropdown
                      className="mt-0"
                      value={appSource}
                      onChange={(value) => setAppSource(value as 'device' | 'upload')}
                      options={[
                        { value: 'device', label: 'Bản có sẵn trên thiết bị' },
                        { value: 'upload', label: 'Bản build đã tải lên' },
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

              {/* Chọn nhiều máy nằm CẠNH nút chạy, không nằm trong thẻ kiểm tra
                  môi trường: nó là một phần của câu "chạy cái gì", chứ không
                  phải một kết luận về việc chạy được hay chưa. */}
              {/* Web không có máy để chọn, và một máy duy nhất thì không có gì
                  để chọn giữa — hiện ô này ở hai trường hợp đó chỉ là thêm một
                  thứ phải đọc rồi bỏ qua. */}
              {platform !== 'web' && targets.length > 1 && (
                <DeviceChips
                  targets={targets}
                  selected={multi}
                  fallbackPlatform={platform}
                  detecting={detecting}
                  onDetect={() => void detectDevices()}
                  onToggle={(token) =>
                    setMulti((prev) =>
                      prev.includes(token) ? prev.filter((t) => t !== token) : [...prev, token],
                    )
                  }
                />
              )}
            </CardContent>
          </Card>

          <PreflightCard
            result={preflight.data}
            pending={preflight.isPending}
            fetching={preflight.isFetching}
            checkedAt={preflight.dataUpdatedAt}
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
  fetching,
  checkedAt,
  error,
  onRefresh,
  platform,
  chosen,
  onPick,
}: {
  result: PreflightResponse | undefined;
  pending: boolean;
  /** Đang dò lại, kể cả khi đã có kết quả cũ trên màn hình. */
  fetching: boolean;
  /** Lúc kết quả đang hiển thị được lấy về. */
  checkedAt?: number;
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
              {/* Nút phải cho thấy nó đã làm gì.
                  Kết quả preflight thường KHÔNG đổi sau khi bấm — máy vẫn thế,
                  Appium vẫn thế — nên nếu màn hình đứng im thì không phân biệt
                  được "đã kiểm, vẫn vậy" với "nút hỏng". Trước đây dòng "Đang
                  kiểm tra…" chỉ gắn với `isPending`, mà cờ đó chỉ đúng ở lần
                  tải ĐẦU; mọi lần bấm sau đều im lặng hoàn toàn. */}
              <Button
                variant="outline"
                size="sm"
                type="button"
                disabled={fetching}
                onClick={onRefresh}
              >
                <RefreshCw className={cn('size-4', fetching && 'animate-spin')} />
                {fetching ? 'Đang kiểm tra…' : 'Kiểm tra lại'}
              </Button>
              {/* Cùng một component với các nút kiểm tra bên dưới: sửa cho
                  một nút mà quên nút bên cạnh là đúng chuyện vừa xảy ra. */}
              <CheckedAt at={checkedAt || undefined} busy={fetching} />
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
