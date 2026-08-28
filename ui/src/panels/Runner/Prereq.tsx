import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Play, RefreshCw, RotateCcw, Wrench, XCircle } from 'lucide-react';
import { api } from '@/api/client';
import { ROUTES, STREAM_ROUTES } from '@/api/routes';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useStreamJob } from '@/hooks/useStreamJob';
import type {
  PrereqAdbResponse,
  PrereqAppiumStatusResponse,
  PrereqIosDevicesResponse,
  PrereqXcodeResponse,
} from '@core/ui/contracts.js';

export function Prereq({ platform }: { platform: 'web' | 'android' | 'ios' }) {
  const mobile = platform !== 'web';
  const appium = useQuery({
    queryKey: ['prereq', 'appium-status'],
    queryFn: () => api.get<PrereqAppiumStatusResponse>(ROUTES.prereqAppiumStatus),
    enabled: mobile,
    refetchInterval: mobile ? 5_000 : false,
    retry: false,
  });
  const adb = useQuery({
    queryKey: ['prereq', 'adb'], queryFn: () => api.get<PrereqAdbResponse>(ROUTES.prereqAdb), enabled: false, retry: false,
  });
  const xcode = useQuery({
    queryKey: ['prereq', 'xcode'], queryFn: () => api.get<PrereqXcodeResponse>(ROUTES.prereqXcode), enabled: false, retry: false,
  });
  const ios = useQuery({
    queryKey: ['prereq', 'ios-devices'], queryFn: () => api.get<PrereqIosDevicesResponse>(ROUTES.prereqIosDevices), enabled: false, retry: false,
  });
  const appiumStart = useStreamJob('prereq-appium-start', STREAM_ROUTES.prereqAppium);
  const appiumRestart = useStreamJob('prereq-appium-restart', STREAM_ROUTES.prereqAppiumRestart);
  const driver = platform === 'ios' ? 'xcuitest' : 'uiautomator2';
  const installDriver = useStreamJob(`prereq-driver-${driver}`, STREAM_ROUTES.prereqDriver);

  if (!mobile) return null;
  const starting = appiumStart.status === 'running';
  const restarting = appiumRestart.status === 'running';
  const installing = installDriver.status === 'running';
  return (
    <Card aria-labelledby="prereq-title">
      <CardHeader>
        <CardTitle id="prereq-title">Chuẩn bị máy thật</CardTitle>
        <CardDescription>Preflight nói điều gì chưa sẵn sàng; các nút này giúp sửa ngay tại chỗ.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-sm">Appium</b>
            {appium.data?.running ? <span className="text-status-pass text-sm">✓ Đang chạy</span> : <span className="text-muted-foreground text-sm">Chưa chạy</span>}
            <Button size="sm" className="ms-auto" disabled={starting || Boolean(appium.data?.running)} onClick={() => appiumStart.start()}>
              <Play /> {starting ? 'Đang khởi động…' : appium.data?.running ? '✓ Đang chạy' : 'Khởi động Appium'}
            </Button>
            <Button size="sm" variant="outline" disabled={restarting} onClick={() => appiumRestart.start()}>
              <RotateCcw /> {restarting ? 'Đang khởi động lại…' : 'Khởi động lại'}
            </Button>
          </div>
          {appium.data?.lastExit && !appium.data.running && <p className="text-amber-700 dark:text-amber-400 mt-2 text-xs">⚠ Appium đã dừng. Hãy khởi động lại trước khi chạy test.</p>}
          <StreamOutput job={appiumStart} />
          <StreamOutput job={appiumRestart} />
        </div>

        {platform === 'android' ? (
          <div className="rounded-lg border p-3">
            <div className="flex items-center gap-2"><b className="text-sm">Thiết bị Android</b><Button className="ms-auto" size="sm" variant="outline" disabled={adb.isFetching} onClick={() => void adb.refetch()}><RefreshCw /> {adb.isFetching ? 'Đang kiểm tra…' : 'adb devices'}</Button></div>
            {adb.data && <AndroidOutput data={adb.data} />}
            {adb.error && <ErrorText error={adb.error} />}
          </div>
        ) : (
          <>
            <div className="rounded-lg border p-3">
              <div className="flex items-center gap-2"><b className="text-sm">Xcode</b><Button className="ms-auto" size="sm" variant="outline" disabled={xcode.isFetching} onClick={() => void xcode.refetch()}><RefreshCw /> {xcode.isFetching ? 'Đang kiểm tra…' : 'Kiểm tra Xcode'}</Button></div>
              {xcode.data && <p className={xcode.data.ok ? 'text-status-pass mt-2 text-xs' : 'text-destructive mt-2 text-xs'}>{xcode.data.ok ? `✓ ${xcode.data.version ?? 'Xcode sẵn sàng'}${xcode.data.sdk ? ` · ${xcode.data.sdk}` : ''}` : `✕ ${xcode.data.reason ?? 'Xcode chưa sẵn sàng.'}`}</p>}
              {xcode.error && <ErrorText error={xcode.error} />}
            </div>
            <div className="rounded-lg border p-3">
              <div className="flex items-center gap-2"><b className="text-sm">Thiết bị iOS</b><Button className="ms-auto" size="sm" variant="outline" disabled={ios.isFetching} onClick={() => void ios.refetch()}><RefreshCw /> {ios.isFetching ? 'Đang kiểm tra…' : 'xctrace list devices'}</Button></div>
              {ios.data && <pre className="text-muted-foreground mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-xs">{ios.data.devices.join('\n') || 'Không thấy thiết bị nào.'}</pre>}
              {ios.error && <ErrorText error={ios.error} />}
            </div>
            <IosInstructions />
          </>
        )}

        <div className="rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-2"><b className="text-sm">Driver {driver === 'xcuitest' ? 'XCUITest' : 'UiAutomator2'}</b><Button className="ms-auto" size="sm" variant="outline" disabled={installing} onClick={() => installDriver.start({ driver })}><Wrench /> {installing ? 'Đang kiểm tra/cài…' : 'Kiểm tra / cài driver'}</Button></div>
          <StreamOutput job={installDriver} />
        </div>
      </CardContent>
    </Card>
  );
}

function StreamOutput({ job }: { job: { logs: string[]; error: string | null } }) {
  if (!job.logs.length && !job.error) return null;
  return <pre className="console mt-2 max-h-32 text-xs">{[...job.logs, ...(job.error ? [`❌ ${job.error}`] : [])].join('\n')}</pre>;
}

function ErrorText({ error }: { error: Error | null }) { return error ? <p className="text-destructive mt-2 text-xs">❌ {error.message}</p> : null; }

function AndroidOutput({ data }: { data: PrereqAdbResponse }) {
  if (!data.devices.length) return <p className="text-amber-700 dark:text-amber-400 mt-2 text-xs">⚠ Không thấy thiết bị nào. Kết nối USB và bật USB Debugging.</p>;
  return <ul className="mt-2 space-y-1 text-xs">{data.devices.map((device) => <li key={device.id} className="flex gap-1.5"><span>{device.state === 'device' ? <CheckCircle2 className="text-status-pass size-3.5" /> : <XCircle className="text-destructive size-3.5" />}</span><span>{[device.manufacturer, device.model, device.androidVersion && `Android ${device.androidVersion}`, device.kind === 'emulator' ? 'Emulator' : 'Thiết bị thật'].filter(Boolean).join(' · ')} — <code>{device.id}</code> ({device.state})</span></li>)}</ul>;
}

function IosInstructions() {
  return <aside className="bg-muted/50 rounded-lg border p-3 text-xs"><b>Trước khi chạy iPhone/iPad</b><ul className="mt-2 list-disc space-y-1 ps-4"><li>Tin cậy máy tính này trên thiết bị.</li><li>Bật Chế độ nhà phát triển.</li><li>Bật Web Inspector nếu test có webview/Safari.</li><li>Đăng nhập Apple ID và ký WebDriverAgent trong Xcode khi được hỏi.</li></ul></aside>;
}
