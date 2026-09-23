import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Fingerprint,
  Play,
  QrCode,
  RefreshCw,
  Smartphone,
  Square,
  XCircle,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { navTitle } from '@/lib/nav';
import { CheckRow } from '@/components/CheckRow';
import { CheckedAt } from '@/components/CheckedAt';
import { Dropdown } from '@/components/Dropdown';
import { PreflightChecks } from '@/components/PreflightChecks';
import { RegisterDevices } from '@/components/RegisterDevices';
import type { DateRange } from 'react-day-picker';
import { DateRangePicker } from '@/components/DateRangePicker';
import { Pagination } from '@/components/Pagination';
import { useActiveRuns } from '@/hooks/useActiveRuns';
import { inRange } from '@/lib/datetime';
import { LogView } from '@/components/LogView';
import { Field } from '@/components/Field';
import { StatusPill } from '@/components/StatusPill';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api, qs } from '@/api/client';
import { ROUTES, STREAM_ROUTES } from '@/api/routes';
import { DevicePicker } from '@/components/DevicePicker';
import { TagFilter } from '@/components/TagFilter';
import { DeviceChips, deviceToken, type DeviceTarget } from '@/components/DeviceChips';
import { PrereqTools } from './PrereqTools';
import { useAppState } from '@/hooks/useAppState';
import { useStreamJob } from '@/hooks/useStreamJob';
import { when } from '@/lib/datetime';
import { cn } from '@/lib/utils';
import type {
  ControlDeviceView,
  ControlTargetsResponse,
  PreflightResponse,
  PrereqIosNamesResponse,
  PrereqAdbResponse,
  PrereqIosDevicesResponse,
  ReportView,
} from '@core/ui/contracts.js';

const PAGE_DESCRIPTION = 'Chạy bộ test ngay trên máy này, trước khi đẩy lên farm.';

/**
 * Vì sao chưa chạy được trên chiếc máy đã chọn — hoặc `undefined` khi chạy được.
 *
 * Hàm thuần để câu trả lời này nói được thành lời ở hai chỗ: lúc bấm nút và
 * lúc vẽ dòng giải thích bên cạnh nó. Hai bản chép tay sẽ lệch, và người dùng
 * sẽ thấy một nút bấm được kèm một dòng nói không chạy được.
 */
export function notRunnable(
  device: ControlDeviceView | undefined,
  available: number,
): string | undefined {
  if (!device) {
    return available === 0
      ? 'Chưa có máy nào để chạy. Cắm máy vào rồi chạy runner trên chiếc máy tính ấy.'
      : 'Chọn một máy để chạy.';
  }
  if (device.offline) return `Máy "${device.label}" đang tắt.`;
  // `ready === undefined` là CHƯA ĐO, không phải hỏng: một runner vừa khởi
  // động thì chưa kịp đo. Chặn nó lại là chặn một chiếc máy hoàn toàn tốt.
  if (device.ready === false) {
    return device.reason ?? `Máy tính giữ "${device.label}" chưa chạy được nền tảng này.`;
  }
  return undefined;
}

export default function RunnerPanel() {
  const state = useAppState((s) => ({ config: s.config, features: s.features, reports: s.reports }));
  const [platform, setPlatform] = useState<'web' | 'android' | 'ios'>('web');
  const [runMode, setRunMode] = useState<'standard' | 'native'>('standard');
  // Nhiều tag, nối bằng '+' khi gửi xuống: đó là "và" ở tầng lọc — mỗi tag chọn
  // thêm là hẹp phạm vi lại, đúng hướng người ta dùng một bộ lọc.
  const [tags, setTags] = useState<string[]>([]);
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
  //
  // Nối lại MỖI KHI dòng chảy đứt, không phải một lần rồi thôi.
  //
  // Luồng SSE đứt là chuyện thường: máy ngủ, mạng chớp một nhịp, server nạp lại
  // mã. Khi đó jobStore đặt status = 'done' — không phân biệt được "chạy xong"
  // với "mất kết nối" — nên màn hình báo đã xong trong khi tiến trình vẫn đang
  // bấm vào điện thoại thật. Đã xảy ra: người dùng thấy giao diện dừng từ lâu,
  // còn lượt chạy thì vẫn đang ở kịch bản thứ chín.
  //
  // `/api/run/active` là trọng tài: còn tên trong đó nghĩa là server vẫn coi nó
  // đang sống, và lúc đó tab này phải nối lại. Riêng một job đã nhận `done` là
  // kết quả cuối cùng: cache active có thể còn cũ vài giây, không được dùng ảnh
  // chụp cũ đó để nối lại rồi xoá log vừa chạy xong.
  const lastAttachAt = useRef(0);
  useEffect(() => {
    if (!liveRun || job.status === 'running' || job.status === 'done') return;
    // Chặn vòng lặp: một cú nối hỏng ngay sẽ lập tức kéo effect chạy lại.
    if (Date.now() - lastAttachAt.current < 3_000) return;
    lastAttachAt.current = Date.now();
    // `since` nói ra tab này đang có tới dòng nào. Rớt mạng vài giây thì nhận
    // đúng phần thiếu; tab vừa tải lại có lastSeq = 0 và nhận trọn lịch sử.
    job.attach(`${ROUTES.runAttach}?id=${encodeURIComponent(liveRun.id)}&since=${job.lastSeq}`);
  }, [liveRun, job]);
  /**
   * Máy chạy được, lấy từ SỔ THIẾT BỊ chứ không từ `adb` của máy chủ.
   *
   * Đây là điểm đổi của bước này. Preflight hỏi chính chiếc máy đang chạy tiến
   * trình web — đúng ở bản chạy một mình, và vô nghĩa sau khi lên server: ở đó
   * máy chủ không cắm thiết bị nào, còn điện thoại nằm trên laptop của từng
   * người. Sổ thiết bị gom máy từ MỌI runner và đã lọc theo quyền nhìn.
   */
  const registry = useQuery({
    queryKey: ['device-targets'],
    queryFn: () => api.get<ControlTargetsResponse>(ROUTES.deviceTargets),
    refetchInterval: 10_000,
  });
  const runnable = useMemo(
    () => (registry.data?.devices ?? []).filter((device) => device.platform === platform),
    [registry.data, platform],
  );
  const chosenDevice = useMemo(
    // Đúng một máy thì không có gì để chọn — nó LÀ máy sẽ chạy. Bắt bấm chọn
    // một lựa chọn duy nhất là một bước không trả lời câu hỏi nào.
    () => runnable.find((item) => item.udid === device) ?? (runnable.length === 1
      ? runnable[0]
      : undefined),
    [runnable, device],
  );

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
  const allTags = useMemo(
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
    // Web thì hỏi preflight như cũ — nó nói về trình duyệt và địa chỉ, không
    // về điện thoại. Android/iOS thì hỏi CHÍNH chiếc máy đã chọn: môi trường
    // cần kiểm là của máy tính mà nó cắm vào, không phải của máy chủ.
    const blocked = platform === 'web'
      ? (preflight.data?.ok ? undefined : 'Chưa qua kiểm tra trước khi chạy. Hãy xử lý các mục đỏ rồi thử lại.')
      : notRunnable(chosenDevice, runnable.length);
    if (blocked) return toast.error(blocked);
    job.start({
      platform,
      tag: runMode === 'native'
        ? '@native+@regression'
        : tags.length > 0
          ? tags.join('+')
          : undefined,
      headed,
      includeQuarantined: quarantined,
      ...(env ? { env } : {}),
      ...(platform === 'web' ? {} : { appSource }),
      ...(() => {
        // Tích nhiều máy thì gửi cả danh sách: server thấy `devices.length > 1`
        // là rẽ sang run-parallel.ts. Trước đây chỗ này luôn gửi đúng một phần
        // tử, nên giao diện không có cách nào khởi động một lượt song song.
        if (multi.length > 0) return { devices: multi };
        // Máy đã chọn từ sổ (udid), hoặc — khi chỉ có một máy và không phải
        // chọn gì — chiếc duy nhất trong sổ. Không rơi về `preflight.device`
        // nữa: nó là `id` trong config của MÁY CHỦ, thứ vô nghĩa với một
        // chiếc điện thoại cắm ở laptop người khác.
        const picked = device
          || (runnable.length === 1 ? runnable[0]!.udid : undefined)
          || preflight.data?.device;
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
    <AppShell title={navTitle('e2e-runner')} description={PAGE_DESCRIPTION}>
      <section aria-label="Local Runner" className="flex flex-1 flex-col gap-6">
        {/* `items-stretch` (mặc định) + `h-full` cho từng thẻ: hai cột cao bằng
            nhau.
            Với `items-start`, mỗi thẻ cao đúng bằng nội dung của nó — thẻ bên
            trái ngắn hơn nhiều so với thẻ có danh sách thiết bị bên phải, và
            phần dưới nó là một mảng trống giữa hai đường viền lệch nhau. Cho
            thẻ ngắn giãn ra thì chỗ trống nằm BÊN TRONG thẻ, không còn là một
            lỗ hổng trong bố cục. */}
          <div className="grid gap-6 xl:grid-cols-2">
          <Card className="h-full" aria-labelledby="run-config-title">
            <CardHeader>
              <CardTitle id="run-config-title">Cấu hình lượt chạy</CardTitle>
              <CardDescription>Chọn platform và phạm vi test sẽ chạy.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Loại bộ test">
                  <Dropdown
                    className="mt-0"
                    value={runMode}
                    onChange={(next) => {
                      const mode = next as typeof runMode;
                      setRunMode(mode);
                      if (mode === 'native' && platform === 'web') {
                        setPlatform('android');
                        setMulti([]);
                      }
                    }}
                    options={[
                      { value: 'standard', label: 'Thông thường / WebView' },
                      { value: 'native', label: 'Native Regression' },
                    ]}
                  />
                </Field>
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
                      ...(runMode === 'standard'
                        ? [{ value: 'web', label: 'web — Playwright' }]
                        : []),
                      { value: 'android', label: 'android — Appium' },
                      { value: 'ios', label: 'ios — Appium' },
                    ]}
                  />
                </Field>
                {runMode === 'standard' ? (
                  <Field label="Lọc theo tag">
                    <TagFilter all={allTags} value={tags} onChange={setTags} />
                  </Field>
                ) : (
                  <Field
                    label="Phạm vi native"
                    hint="Chỉ chạy scenario có đồng thời @native và @regression."
                  >
                    <div className="border-input bg-muted/40 flex h-9 items-center gap-2 rounded-md border px-2">
                      <Badge variant="secondary">@native</Badge>
                      <Badge variant="secondary">@regression</Badge>
                    </div>
                  </Field>
                )}
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

              {runMode === 'native' && <NativeCapabilityNotice platform={platform} />}

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
                  // Web hỏi preflight (trình duyệt, địa chỉ); android/iOS hỏi
                  // CHÍNH chiếc máy đã chọn, vì môi trường cần kiểm là của máy
                  // tính mà nó cắm vào — không phải của máy chủ.
                  disabled={
                    job.status === 'running'
                    || (platform === 'web'
                      ? preflight.isPending || !preflight.data?.ok
                      : Boolean(notRunnable(chosenDevice, runnable.length)))
                  }
                  onClick={start}
                >
                  <Play className="size-4" />
                  {job.status === 'running'
                    ? 'Đang chạy…'
                    : runMode === 'native'
                      ? 'Chạy Native Regression'
                      : 'Chạy test'}
                </Button>
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
            runnable={runnable}
            chosenDevice={chosenDevice}
          />
        </div>

        <JobLog
          logs={job.logs}
          dropped={job.dropped}
          error={job.error}
          status={job.status}
          reports={reports}
          onStop={() => void stop()}
        />
        <History reports={reports} />
      </section>
    </AppShell>
  );
}

function NativeCapabilityNotice({ platform }: { platform: 'web' | 'android' | 'ios' }) {
  if (platform === 'web') return null;
  const android = platform === 'android';
  return (
    <div
      role="status"
      className="border-primary/25 bg-primary/5 flex flex-col gap-2 rounded-lg border p-3 text-sm"
    >
      <div className="flex items-center gap-2 font-medium">
        <Fingerprint className="text-primary size-4" />
        {android ? 'Khả năng native trên Android' : 'Khả năng native trên iOS'}
      </div>
      <p className="text-muted-foreground">
        {android
          ? 'Android Emulator hỗ trợ giả lập vân tay; máy thật chỉ chạy luồng mở tính năng và kiểm tra app không crash.'
          : 'iOS Simulator hỗ trợ Touch ID và Face ID. Máy thật chỉ chạy luồng mở tính năng và kiểm tra app không crash.'}
      </p>
      <div className="flex items-start gap-2">
        <QrCode className="text-primary mt-0.5 size-4 shrink-0" />
        <p className="text-muted-foreground">
          {android
            ? 'Inject ảnh QR chỉ hỗ trợ Android Emulator đã bật VirtualScene; máy thật/Device Farm chỉ kiểm tra scanner mở và app còn phản hồi.'
            : 'iOS không inject ảnh camera qua fixture hiện tại; hãy dùng smoke case mở scanner và kiểm tra app còn phản hồi.'}
        </p>
      </div>
    </div>
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
  runnable,
  chosenDevice,
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
  /** Máy chạy được của nền tảng này, từ sổ thiết bị. */
  runnable: ControlDeviceView[];
  /** Chiếc đang chọn trong số đó, nếu có. */
  chosenDevice: ControlDeviceView | undefined;
}) {
  return (
    <Card className="h-full" aria-labelledby="preflight-title">
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

            {/* Máy đang cắm mà config chưa khai. Đặt NGAY DƯỚI bảng kiểm, vì
                đó là chỗ người dùng vừa đọc dòng "2 máy sẵn sàng" rồi không
                tìm thấy máy thứ hai ở bất kỳ ô chọn nào. */}
            {platform !== 'web' && (result.unregistered?.length ?? 0) > 0 && (
              <RegisterDevices platform={platform} devices={result.unregistered!} />
            )}

            {/* Máy để chạy, lấy từ SỔ THIẾT BỊ — gồm cả máy cắm ở máy chủ lẫn
                máy cắm ở laptop của từng người. Nhãn mang tên chiếc máy tính
                giữ nó, vì "Pixel 7" một mình không nói được nó nằm ở đâu, mà
                đó là câu người dùng cần trả lời trước khi bấm chạy. */}
            {platform !== 'web' && runnable.length > 1 && (
              <DevicePicker
                name="runner"
                candidates={runnable.map((item) => ({
                  id: item.udid,
                  label: item.runnerName ? `${item.label} — ${item.runnerName}` : item.label,
                }))}
                chosen={chosen}
                onPick={onPick}
              />
            )}
            {platform !== 'web' && runnable.length === 1 && (
              <div className="bg-muted/50 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                <Smartphone className="text-muted-foreground size-4 shrink-0" />
                <span className="min-w-0 truncate">
                  Sẽ dùng thiết bị: {runnable[0]!.label}
                  {runnable[0]!.runnerName ? ` — ${runnable[0]!.runnerName}` : ''}
                </span>
              </div>
            )}
            {/* Vì sao chưa bấm chạy được, nói ngay cạnh chỗ chọn máy. Cùng một
                hàm với phép chặn ở nút, nên hai bên không thể nói khác nhau. */}
            {platform !== 'web' && notRunnable(chosenDevice, runnable.length) && (
              <p className="text-destructive text-sm">
                {notRunnable(chosenDevice, runnable.length)}
              </p>
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
  status,
  reports,
  onStop,
}: {
  logs: string[];
  dropped: number;
  error: string | null;
  status: 'idle' | 'running' | 'done' | 'error';
  reports: ReportView[];
  onStop: () => void;
}) {
  // Đang chạy thì thẻ này phải có mặt kể cả khi chưa có dòng log nào: nút Dừng
  // nằm ở đây, và khoảng lặng đầu lượt chạy — lúc driver đang khởi động — đúng
  // là lúc người ta hay đổi ý nhất.
  if (!logs.length && !error && status !== 'running') return null;

  // CLI emits the absolute run directory as an internal marker. Match by its
  // basename because `/api/state` deliberately exposes only the safe run id.
  // A parallel run may emit more than one directory, hence an array here.
  const runIds = new Set(
    logs.flatMap((line) => {
      const dir = /^\[run:dir\]\s+(.+)$/.exec(line)?.[1]?.trim();
      return dir ? [dir.split(/[\\/]/).filter(Boolean).at(-1)!] : [];
    }),
  );
  const completedReports = reports.filter((report) => runIds.has(report.id));
  const failed = completedReports.some(
    (report) => report.status === 'failed' || (report.counters?.failed ?? 0) > 0,
  );

  return (
    <Card aria-labelledby="run-log-title">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle id="run-log-title">Log chạy</CardTitle>
          {/* Nút Dừng ở ĐÂY, không ở cạnh nút Chạy.
              
              Log chảy liên tục trong lúc chạy, nên trang dài ra không ngừng và
              cụm nút chạy bị đẩy lên trên màn hình. Muốn dừng thì phải cuộn
              ngược lên, mà nội dung mới vẫn đang được thêm vào bên dưới —
              đúng lúc cần dừng nhất thì nút dừng là thứ khó với tới nhất.
              
              Ở đầu thẻ log thì nó đi cùng thứ người ta đang nhìn. */}
          {status === 'running' && (
            <Button variant="destructive" size="sm" onClick={onStop}>
              <Square className="size-4" />
              Dừng test
            </Button>
          )}
          {status === 'done' && (
            <div role="status" className="flex flex-wrap items-center gap-2">
              <Badge
                variant={failed ? 'outline' : 'default'}
                className={cn(failed && 'text-destructive')}
              >
                {failed ? <XCircle /> : <CheckCircle2 />}
                {failed ? 'Đã chạy xong, có lỗi' : 'Đã chạy xong'}
              </Badge>
              {completedReports.map((report, index) => (
                <a
                  key={report.id}
                  href={report.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary text-sm underline underline-offset-4"
                >
                  {completedReports.length > 1 ? `Xem report ${index + 1}` : 'Xem report'}
                </a>
              ))}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <LogView
          logs={logs}
          dropped={dropped}
          error={error}
          active={status === 'running'}
          label="Log chạy"
        />
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
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Thời gian</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead>Tag</TableHead>
                <TableHead className="text-right">Pass</TableHead>
                <TableHead className="text-right">Fail</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground p-6 text-center">
                    {reports.length === 0
                      ? 'Chưa có lần chạy local nào.'
                      : `Không có lần chạy nào khớp ${active.join(' và ')}.`}
                  </TableCell>
                </TableRow>
              )}
              {shown.map((report) => (
                <TableRow key={report.id}>
                  <TableCell className="whitespace-nowrap">{when(report.startedAt)}</TableCell>
                  <TableCell>
                    <StatusPill status={report.platform} />
                  </TableCell>
                  <TableCell>{report.tag ?? 'tất cả'}</TableCell>
                  <TableCell
                    className={cn(
                      'p-2 text-right tabular-nums',
                      (report.counters?.passed ?? 0) > 0 && 'text-status-pass',
                    )}
                  >
                    {report.counters?.passed ?? 0}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'p-2 text-right tabular-nums',
                      (report.counters?.failed ?? 0) > 0 && 'text-status-fail',
                    )}
                  >
                    {report.counters?.failed ?? 0}
                  </TableCell>
                  <TableCell>
                    <Link
                      to="/runner/history"
                      search={{ runId: report.id }}
                      className="text-primary underline"
                    >
                      Chi tiết
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <Pagination page={current} pageCount={pageCount} onPageChange={setPage} />
      </CardContent>
    </Card>
  );
}
