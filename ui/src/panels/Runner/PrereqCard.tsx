import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
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
        <CardTitle id="prereq-title">Yêu cầu trước khi chạy</CardTitle>
        <CardDescription>
          Kiểm tra và xử lý ngay ở đây, không cần mở terminal.
        </CardDescription>
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

/** Khung chung: tên, câu lệnh tương đương, nút, và phần kết quả. */
function Row({
  title,
  command,
  hint,
  actions,
  output,
}: {
  title: string;
  command: string;
  hint?: string;
  actions: React.ReactNode;
  output?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium">{title}</span>
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

  return (
    <Row
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
          <Button
            size="sm"
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
  const [asked, setAsked] = useState(false);
  const devices = useQuery({
    queryKey: ['prereq-adb'],
    queryFn: () => api.get<PrereqAdbResponse>(ROUTES.prereqAdb),
    enabled: asked,
  });
  return (
    <Row
      title="Thiết bị Android"
      command="adb devices -l"
      actions={
        <Button
          size="sm"
          variant="outline"
          disabled={devices.isFetching}
          onClick={() => (asked ? void devices.refetch() : setAsked(true))}
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
  const [asked, setAsked] = useState(false);
  const xcode = useQuery({
    queryKey: ['prereq-xcode'],
    queryFn: () => api.get<PrereqXcodeResponse>(ROUTES.prereqXcode),
    enabled: asked,
  });
  return (
    <Row
      title="Xcode"
      command="xcodebuild -version"
      hint="Command Line Tools là không đủ — cần Xcode đầy đủ."
      actions={
        <Button
          size="sm"
          variant="outline"
          disabled={xcode.isFetching}
          onClick={() => (asked ? void xcode.refetch() : setAsked(true))}
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
  const [asked, setAsked] = useState(false);
  const devices = useQuery({
    queryKey: ['prereq-ios-devices'],
    queryFn: () => api.get<PrereqIosDevicesResponse>(ROUTES.prereqIosDevices),
    enabled: asked,
  });
  return (
    <Row
      title="Thiết bị iOS"
      command="xcrun xctrace list devices"
      actions={
        <Button
          size="sm"
          variant="outline"
          disabled={devices.isFetching}
          onClick={() => (asked ? void devices.refetch() : setAsked(true))}
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
