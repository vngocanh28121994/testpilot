import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, CircleDashed, Loader2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/api/client';
import { ROUTES, STREAM_ROUTES } from '@/api/routes';
import { useStreamJob } from '@/hooks/useStreamJob';
import type {
  PrereqAdbResponse,
  PrereqAppiumStatusResponse,
  PrereqIosDevicesResponse,
  PrereqXcodeResponse,
} from '@core/ui/contracts.js';

/**
 * Những thứ phải có trước khi bấm chạy, kèm nút sửa ngay tại chỗ.
 *
 * Preflight ở thẻ bên cạnh nói cho biết cái gì hỏng; khối này là chỗ chữa. Chỉ
 * biết mà không sửa được thì vẫn phải mở terminal gõ tay — mà nếu đã phải mở
 * terminal thì màn hình kia cũng không giúp được gì.
 *
 * Web không cần gì ngoài một URL nên không hiện ra.
 */
export function PrereqCard({ platform }: { platform: 'web' | 'android' | 'ios' }) {
  if (platform === 'web') return null;
  return (
    <Card aria-labelledby="prereq-title">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col gap-1.5">
            <CardTitle id="prereq-title">Yêu cầu trước khi chạy</CardTitle>
            <CardDescription>
              Kiểm tra và xử lý ngay ở đây, không cần mở terminal.
            </CardDescription>
          </div>
          <Verdict platform={platform} />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <AppiumRow />
        {platform === 'android' ? <AdbRow /> : <XcodeRow />}
        {platform === 'ios' && <IosDevicesRow />}
        <DriverRow driver={platform === 'android' ? 'uiautomator2' : 'xcuitest'} />
      </CardContent>
    </Card>
  );
}

/**
 * Câu trả lời cho "đã đủ điều kiện chạy chưa", đặt ngay đầu thẻ.
 *
 * Bản trước bắt người đọc tự tổng hợp bằng cách đọc từng hộp log — mà các hộp
 * đó trông giống hệt nhau dù nội dung là "đã cài xong" hay "chưa có máy nào".
 *
 * Chỉ tính những mục kiểm tra được. Driver không có endpoint nào hỏi được nên
 * không được tính vào đây; nói "sẵn sàng" dựa trên một mục chưa từng kiểm tra
 * thì tệ hơn là không nói gì.
 */
function Verdict({ platform }: { platform: 'android' | 'ios' }) {
  const appium = useQuery({
    queryKey: ['prereq-appium'],
    queryFn: () => api.get<PrereqAppiumStatusResponse>(ROUTES.prereqAppiumStatus),
  });
  const adb = useQuery({
    queryKey: ['prereq-adb'],
    queryFn: () => api.get<PrereqAdbResponse>(ROUTES.prereqAdb),
    enabled: platform === 'android',
  });
  const ios = useQuery({
    queryKey: ['prereq-ios-devices'],
    queryFn: () => api.get<PrereqIosDevicesResponse>(ROUTES.prereqIosDevices),
    enabled: platform === 'ios',
  });

  const device = platform === 'android' ? adb : ios;
  if (appium.isPending || device.isPending) {
    return <span className="text-muted-foreground text-sm">Đang kiểm tra…</span>;
  }

  const bad =
    (appium.data?.running ? 0 : 1) +
    (platform === 'android'
      ? (adb.data?.devices.length ?? 0) > 0
        ? 0
        : 1
      : (ios.data?.devices.length ?? 0) > 0
        ? 0
        : 1);

  return bad === 0 ? (
    <span className="text-status-pass flex items-center gap-1.5 text-sm font-medium">
      <CheckCircle2 className="size-4" aria-hidden="true" />
      Đủ điều kiện chạy
    </span>
  ) : (
    <span className="text-destructive flex items-center gap-1.5 text-sm font-medium">
      <XCircle className="size-4" aria-hidden="true" />
      Còn {bad} mục chưa đạt
    </span>
  );
}

/**
 * Trạng thái của một yêu cầu.
 *
 * `unknown` là một trạng thái thật, không phải chỗ trống: "chưa hỏi" và "đã hỏi,
 * không đạt" là hai chuyện khác nhau, mà bản trước hiển thị giống hệt nhau —
 * cùng một hộp xám, hoặc không hiện gì cả.
 */
type RowState = 'ok' | 'bad' | 'busy' | 'unknown';

const STATE_LABEL: Record<RowState, string> = {
  ok: 'Đạt',
  bad: 'Chưa đạt',
  busy: 'Đang kiểm tra…',
  unknown: 'Chưa kiểm tra',
};

function StateBadge({ state }: { state: RowState }) {
  const Icon =
    state === 'ok' ? CheckCircle2 : state === 'bad' ? XCircle : state === 'busy' ? Loader2 : CircleDashed;
  const tone =
    state === 'ok'
      ? 'text-status-pass'
      : state === 'bad'
        ? 'text-destructive'
        : 'text-muted-foreground';
  return (
    <span className={`flex shrink-0 items-center gap-1.5 text-xs font-medium ${tone}`}>
      <Icon className={`size-4 ${state === 'busy' ? 'animate-spin' : ''}`} aria-hidden="true" />
      {STATE_LABEL[state]}
    </span>
  );
}

/** Khung chung: trạng thái, tên, câu lệnh tương đương, nút, và phần kết quả. */
function Row({
  title,
  command,
  hint,
  state,
  actions,
  output,
}: {
  title: string;
  command: string;
  hint?: string;
  state: RowState;
  actions: React.ReactNode;
  output?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-2 text-sm font-medium">
            <StateBadge state={state} />
            {title}
          </span>
          {/* Câu lệnh tương đương hiện ra để việc màn hình vừa làm là thứ kiểm
              chứng lại được, chứ không phải một hộp đen bấm rồi tin. */}
          <code className="text-muted-foreground text-xs">{command}</code>
          {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
        </div>
        <div className="flex flex-wrap gap-2">{actions}</div>
      </div>
      {output}
    </div>
  );
}

function Out({ children }: { children: React.ReactNode }) {
  return <pre className="console mt-0 max-h-48 overflow-auto text-xs">{children}</pre>;
}

function AppiumRow() {
  const status = useQuery({
    queryKey: ['prereq-appium'],
    queryFn: () => api.get<PrereqAppiumStatusResponse>(ROUTES.prereqAppiumStatus),
  });
  const start = useStreamJob('prereq-appium', STREAM_ROUTES.prereqAppium);
  const restart = useStreamJob('prereq-appium-restart', STREAM_ROUTES.prereqAppiumRestart);
  const busy = start.status === 'running' || restart.status === 'running';
  const after = () => void status.refetch();
  const state: RowState = busy || status.isPending
    ? 'busy'
    : status.data
      ? status.data.running
        ? 'ok'
        : 'bad'
      : 'unknown';

  return (
    <Row
      state={state}
      title={
        status.data
          ? status.data.running
            ? `Appium đang chạy${status.data.managed ? ' (TestPilot bật)' : ''}`
            : 'Appium chưa chạy'
          : 'Appium'
      }
      command="appium"
      hint='Chờ tới khi thấy "listener started on 0.0.0.0:4723".'
      actions={
        <>
          <Button size="sm" variant="outline" onClick={after} disabled={status.isFetching}>
            ⟳ Kiểm tra
          </Button>
          {/* Chỉ nổi bật khi đang thiếu. Một nút primary tô đầy nằm cạnh một
              hàng đã đạt thì mắt đọc nó như một huy hiệu trạng thái màu xanh —
              đúng thứ đã gây hiểu nhầm ở bản trước. */}
          <Button
            size="sm"
            variant={state === 'bad' ? 'default' : 'outline'}
            disabled={busy || status.data?.running}
            onClick={() => {
              start.start();
              after();
            }}
          >
            Bật Appium
          </Button>
          {/* Khởi động lại luôn bấm được, kể cả khi đang chạy: đó chính là lúc
              cần nó — một Appium còn sống nhưng đã treo phiên cũ. */}
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              restart.start();
              after();
            }}
          >
            Khởi động lại
          </Button>
        </>
      }
      output={
        (start.logs.length > 0 || restart.logs.length > 0) && (
          <Out>{[...start.logs, ...restart.logs].join('\n')}</Out>
        )
      }
    />
  );
}

function AdbRow() {
  // Hỏi ngay khi mở, không chờ ai bấm: cả khối sinh ra để trả lời câu "đã đủ
  // điều kiện chưa", mà một hàng trống thì không trả lời gì cả.
  const devices = useQuery({
    queryKey: ['prereq-adb'],
    queryFn: () => api.get<PrereqAdbResponse>(ROUTES.prereqAdb),
  });
  return (
    <Row
      state={
        devices.isPending
          ? 'busy'
          : devices.data
            ? devices.data.devices.length > 0
              ? 'ok'
              : 'bad'
            : 'unknown'
      }
      title="Thiết bị Android"
      command="adb devices -l"
      actions={
        <Button
          size="sm"
          variant="outline"
          disabled={devices.isFetching}
          onClick={() => void devices.refetch()}
        >
          ⟳ Kiểm tra
        </Button>
      }
      output={
        devices.data && (
          <Out>
            {devices.data.devices.length === 0
              ? 'Chưa có máy nào. Cắm máy và bật USB debugging, hoặc khởi động một emulator.'
              : devices.data.devices
                  .map(
                    (d) =>
                      `${d.id}  ${d.state}  ${[d.manufacturer, d.model, d.androidVersion]
                        .filter(Boolean)
                        .join(' ')} (${d.kind})`,
                  )
                  .join('\n')}
          </Out>
        )
      }
    />
  );
}

function XcodeRow() {
  const xcode = useQuery({
    queryKey: ['prereq-xcode'],
    queryFn: () => api.get<PrereqXcodeResponse>(ROUTES.prereqXcode),
  });
  return (
    <Row
      state={xcode.isPending ? 'busy' : xcode.data ? (xcode.data.ok ? 'ok' : 'bad') : 'unknown'}
      title="Xcode"
      command="xcodebuild -version"
      hint="Command Line Tools là không đủ — cần Xcode đầy đủ."
      actions={
        <Button
          size="sm"
          variant="outline"
          disabled={xcode.isFetching}
          onClick={() => void xcode.refetch()}
        >
          ⟳ Kiểm tra
        </Button>
      }
      output={
        xcode.data && (
          <Out>
            {xcode.data.ok
              ? [xcode.data.version, xcode.data.path, xcode.data.sdk].filter(Boolean).join('\n')
              : (xcode.data.reason ?? 'Chưa dùng được.')}
          </Out>
        )
      }
    />
  );
}

function IosDevicesRow() {
  const devices = useQuery({
    queryKey: ['prereq-ios-devices'],
    queryFn: () => api.get<PrereqIosDevicesResponse>(ROUTES.prereqIosDevices),
  });
  return (
    <Row
      state={
        devices.isPending
          ? 'busy'
          : devices.data
            ? devices.data.devices.length > 0
              ? 'ok'
              : 'bad'
            : 'unknown'
      }
      title="Thiết bị iOS"
      command="xcrun xctrace list devices"
      actions={
        <Button
          size="sm"
          variant="outline"
          disabled={devices.isFetching}
          onClick={() => void devices.refetch()}
        >
          ⟳ Kiểm tra
        </Button>
      }
      output={devices.data && <Out>{devices.data.devices.join('\n')}</Out>}
    />
  );
}

function DriverRow({ driver }: { driver: 'uiautomator2' | 'xcuitest' }) {
  const install = useStreamJob(`prereq-driver-${driver}`, STREAM_ROUTES.prereqDriver);
  return (
    <Row
      // Không có endpoint nào hỏi được "driver đã cài chưa", nên nói thẳng là
      // chưa kiểm tra, thay vì vẽ một dấu tích mà không có gì chống lưng.
      state={
        install.status === 'running'
          ? 'busy'
          : install.status === 'done'
            ? 'ok'
            : install.status === 'error'
              ? 'bad'
              : 'unknown'
      }
      title={`Driver Appium: ${driver}`}
      command={`appium driver install ${driver}`}
      actions={
        <Button
          size="sm"
          variant="outline"
          disabled={install.status === 'running'}
          onClick={() => {
            install.start({ driver });
            toast.info(`Đang cài driver ${driver}…`);
          }}
        >
          {install.status === 'running' ? 'Đang cài…' : 'Cài driver'}
        </Button>
      }
      output={install.logs.length > 0 && <Out>{install.logs.join('\n')}</Out>}
    />
  );
}
