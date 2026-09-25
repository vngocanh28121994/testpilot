/**
 * Màn điều khiển: xem màn hình một chiếc máy Android và chạm vào nó.
 *
 * Thứ tự trên màn hình theo đúng thứ tự người dùng phải làm: chọn máy → giữ
 * máy → xem và chạm. Không giữ máy thì không có gì để xem, và đó không phải
 * một hạn chế kỹ thuật mà là cả mô hình: chừng nào bạn còn cầm chiếc máy, hàng
 * đợi job không được giao nó cho ai.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { ROUTES } from '@/api/routes';
import { AppShell } from '@/components/layout/AppShell';
import { navTitle } from '@/lib/nav';
import { Dropdown } from '@/components/Dropdown';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  ArrowRightToLine,
  Bell,
  Camera,
  ChevronLeft,
  Circle,
  CornerDownLeft,
  Delete,
  Link,
  Loader2,
  RefreshCw,
  RotateCw,
  SlidersHorizontal,
  Square,
  Volume1,
  Volume2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useDeviceControl, type ControlDevice } from '@/hooks/useDeviceControl';
import type { ControlKey } from '@core/protocol/control.js';
import { DRAG_THRESHOLD_PX, isDrag, toScreenPoint } from '@/lib/deviceScale';

/** Chờ lâu hơn thế này thì không còn là "đang mở" nữa, mà là có gì đó hỏng. */
const SLOW_AFTER_MS = 12_000;

type Platform = 'android' | 'ios';

/**
 * Một nút trong cột thao tác. `key` là phím của hợp đồng (xem
 * protocol/control.ts); nút không phải phím thì có `action` riêng.
 */
interface ToolItem {
  id: string;
  label: string | Record<Platform, string>;
  Icon: LucideIcon;
  /** Vắng mặt = cả hai nền tảng. */
  only?: Platform;
  key?: string;
  action?: 'rotate' | 'restart' | 'close' | 'screenshot';
}

/**
 * Nút chia theo NHÓM, theo thứ người dùng tìm: đi đâu trong máy, nút cứng,
 * app đang test, bàn phím. Một cột mười lăm nút không chia nhóm là mười lăm
 * thứ phải đọc lướt mỗi lần bấm.
 *
 * iPhone không có nút Quay lại, và bàn phím của nó không có Tab — những nút ấy
 * không hiện, thay vì hiện rồi báo lỗi. Đa nhiệm / Thông báo / Trung tâm điều
 * khiển trên iOS là cử chỉ vuốt; runner làm cử chỉ ấy thay người dùng.
 */
const TOOL_GROUPS: Array<{ title: string; items: ToolItem[] }> = [
  {
    title: 'Điều hướng',
    items: [
      // Tam giác, tròn, vuông: đúng ba hình của thanh điều hướng Android.
      { id: 'back', key: 'back', label: 'Quay lại', Icon: ChevronLeft, only: 'android' },
      { id: 'home', key: 'home', label: 'Home', Icon: Circle },
      { id: 'recents', key: 'recents', label: 'Đa nhiệm', Icon: Square },
      { id: 'notifications', key: 'notifications', label: 'Thông báo', Icon: Bell },
      {
        id: 'quick_settings', key: 'quick_settings', Icon: SlidersHorizontal,
        label: { android: 'Cài đặt nhanh', ios: 'Trung tâm điều khiển' },
      },
    ],
  },
  {
    title: 'Phần cứng',
    items: [
      { id: 'volume_up', key: 'volume_up', label: 'Tăng âm lượng', Icon: Volume2 },
      { id: 'volume_down', key: 'volume_down', label: 'Giảm âm lượng', Icon: Volume1 },
      { id: 'rotate', action: 'rotate', label: 'Xoay màn hình', Icon: RotateCw },
    ],
  },
  {
    title: 'App đang test',
    items: [
      { id: 'restart', action: 'restart', label: 'Mở lại app', Icon: RefreshCw },
      { id: 'close', action: 'close', label: 'Đóng app', Icon: X },
      { id: 'screenshot', action: 'screenshot', label: 'Chụp màn hình', Icon: Camera },
    ],
  },
  {
    title: 'Bàn phím',
    items: [
      { id: 'enter', key: 'enter', label: 'Enter', Icon: CornerDownLeft },
      { id: 'delete', key: 'delete', label: 'Xoá', Icon: Delete },
      { id: 'tab', key: 'tab', label: 'Tab', Icon: ArrowRightToLine, only: 'android' },
    ],
  },
];

export function toolsFor(platform: Platform): Array<{ title: string; items: ToolItem[] }> {
  return TOOL_GROUPS
    .map((group) => ({ ...group, items: group.items.filter((item) => !item.only || item.only === platform) }))
    .filter((group) => group.items.length > 0);
}

function labelOf(item: ToolItem, platform: Platform): string {
  return typeof item.label === 'string' ? item.label : item.label[platform];
}

/**
 * Hai chiếc máy cùng đời thì cùng tên — thêm số sê-ri cho đúng những cái ấy.
 *
 * Nhãn của máy là tên model chứ không phải số sê-ri, vì "Samsung SM-S918B"
 * nhận ra được còn "R5CW525G35Y" thì phải đi tra. Nhưng một phòng máy có hai
 * chiếc S23 là chuyện thường, và lúc ấy hai dòng giống hệt nhau còn tệ hơn
 * hai số sê-ri: người ta chọn nhầm mà không biết mình đã chọn nhầm.
 *
 * Chỉ thêm vào những dòng THẬT SỰ trùng. Gắn số sê-ri vào mọi dòng để phòng
 * xa là bắt mọi người đọc một chuỗi mười một ký tự mỗi ngày vì một trường hợp
 * họ có thể không bao giờ gặp.
 */
export function withDistinctLabels(
  devices: ReadonlyArray<{ udid: string; label: string }>,
): Array<{ value: string; label: string }> {
  const seen = new Map<string, number>();
  for (const device of devices) {
    seen.set(device.label, (seen.get(device.label) ?? 0) + 1);
  }
  return devices.map((device) => ({
    value: device.udid,
    label: (seen.get(device.label) ?? 0) > 1
      ? `${device.label} · ${device.udid}`
      : device.label,
  }));
}

export default function DeviceControlPanel() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { state, hold, release, send, reconnect, captureScreenshot } = useDeviceControl(canvas);
  const [chosen, setChosen] = useState('');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  // Hướng hiện tại, để nút Xoay biết xoay sang đâu. Giữ máy lại = về dọc: đó là
  // hướng máy đứng lúc ta chưa đụng vào.
  const [landscape, setLandscape] = useState(false);
  const [busyTool, setBusyTool] = useState<string | undefined>(undefined);
  const holding = state.phase === 'holding';
  useEffect(() => {
    if (!holding) setLandscape(false);
  }, [holding]);

  const runTool = useCallback(async (item: ToolItem) => {
    setBusyTool(item.id);
    try {
      if (item.key) {
        await send({ kind: 'key', key: item.key as ControlKey });
      } else if (item.action === 'rotate') {
        const next = !landscape;
        if (await send({ kind: 'rotate', orientation: next ? 'landscape' : 'portrait' })) {
          setLandscape(next);
          // Kích thước màn hình vừa đổi chiều: mở lại luồng để nhận kích thước
          // mới, không thì mọi cú chạm sau đó rơi sai chỗ.
          reconnect();
        }
      } else if (item.action === 'restart' || item.action === 'close') {
        await send({ kind: 'app', op: item.action });
      } else if (item.action === 'screenshot') {
        await captureScreenshot();
      }
    } finally {
      setBusyTool(undefined);
    }
  }, [captureScreenshot, landscape, reconnect, send]);

  const openUrl = useCallback(() => {
    const target = url.trim();
    if (!target) return;
    void send({ kind: 'open_url', url: target }).then((ok) => { if (ok) setUrl(''); });
  }, [send, url]);
  const down = useRef<{ x: number; y: number; at: number } | undefined>(undefined);

  const devices = useQuery({
    queryKey: ['control-devices'],
    queryFn: async () =>
      (await api.get<{ devices: ControlDevice[] }>(ROUTES.deviceTargets)).devices,
  });
  const picked = (devices.data ?? []).find((device) => device.udid === chosen);

  const screen = state.phase === 'holding' ? state.screen : undefined;

  const pointAt = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!screen) return undefined;
    return toScreenPoint(event, event.currentTarget.getBoundingClientRect(), screen);
  }, [screen]);

  /**
   * Chạm hay quét quyết định lúc NHẢ tay, không lúc bấm xuống.
   *
   * Kéo vài pixel trong lúc bấm là chuyện thường với chuột, nên coi mọi lần
   * bấm-nhả là quét sẽ làm mọi cú chạm thành một cú vuốt ngắn — và trong ứng
   * dụng thật, vuốt ngắn thường không kích hoạt nút.
   */
  const onUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const from = down.current;
    down.current = undefined;
    const to = pointAt(event);
    if (!from || !to) return;
    if (isDrag(from, to)) {
      void send({
        kind: 'swipe', x: from.x, y: from.y, toX: to.x, toY: to.y,
        durationMs: Math.max(80, Math.min(1_000, Date.now() - from.at)),
      });
    } else {
      void send({ kind: 'tap', x: to.x, y: to.y });
    }
  }, [pointAt, send]);

  return (
    <AppShell
      title={navTitle('device-control')}
      description={
        'Giữ chỗ một chiếc máy rồi xem màn hình và chạm vào nó. '
        + 'Trong lúc bạn giữ, hàng đợi job không giao chiếc máy ấy cho ai.'
      }
    >
      <div className="flex flex-col gap-4">
        {/* Thanh công cụ nằm TRONG Card, như mọi panel khác. Không phải để
            cho đẹp: nền chấm động của AppShell vẽ xuyên qua bất cứ gì không
            có màu nền riêng, và ô chọn máy có nền trong suốt — nên trước đây
            nó nổi lơ lửng trên nền chấm, nhạt hơn hẳn mọi dropdown còn lại
            của app dù cùng một component. */}
        <Card aria-labelledby="pick-title">
          <CardHeader>
            <CardTitle id="pick-title">Chọn máy</CardTitle>
            <CardDescription>
              Giữ chỗ trước khi xem màn hình. Máy đang có người giữ hoặc đang chạy job thì
              không giữ được — chờ tới lượt.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
          {/* Dropdown dùng chung, không phải `<select>` trần: popup của hệ
              điều hành không theo theme, và mũi tên do hệ điều hành vẽ nằm
              lệch khỏi lề phải của ô. Xem components/Dropdown.tsx. */}
          <Dropdown
            aria-label="Chọn máy"
            className="mt-0 w-72"
            value={chosen}
            disabled={state.phase === 'holding'}
            onChange={setChosen}
            // Mục rỗng nằm TRONG danh sách, không phải `placeholder`:
            // `placeholder` của Radix chỉ hiện khi chưa có giá trị nào, mà ở
            // đây "chưa chọn" là một giá trị thật — chuỗi rỗng. Dropdown dùng
            // chung đã quy đổi sẵn cho trường hợp ấy.
            options={[
              { value: '', label: '— chọn máy —' },
              ...withDistinctLabels(devices.data ?? []),
            ]}
          />

          <Button
            size="sm"
            variant="outline"
            onClick={() => void devices.refetch()}
            disabled={devices.isFetching}
          >
            {devices.isFetching ? 'Đang tìm…' : 'Tìm lại'}
          </Button>

          {state.phase === 'holding' ? (
            <Button size="sm" variant="destructive" onClick={() => void release()}>Nhả máy</Button>
          ) : (
            <Button size="sm" disabled={!picked} onClick={() => picked && void hold(picked)}>
              Giữ máy
            </Button>
          )}

          {state.phase === 'holding' && (
            <span className="text-muted-foreground text-xs">
              {screen
                ? `${screen.width}×${screen.height} · ${state.codec === 'mjpeg' ? 'JPEG' : 'H.264'}`
                  + ' · lease tự gia hạn mỗi 30 giây'
                // iOS lần đầu phải build WebDriverAgent — đo được 184 giây.
                // Im lặng ba phút thì người dùng bấm lại, và lần bấm ấy không
                // giúp gì cả.
                : state.platform === 'ios'
                  ? 'Đang dựng WebDriverAgent trên máy… lần đầu có thể mất vài phút.'
                  : 'Đang mở luồng màn hình…'}
            </span>
          )}
          </CardContent>
        </Card>

        {state.phase === 'error' && (
          <div
            role="alert"
            className="border-destructive text-destructive bg-card flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm"
          >
            <span className="min-w-0 flex-1">{state.message}</span>
            {/* Chính mình đang giữ ở chỗ khác: chuyển sang đây bằng một cú bấm. */}
            {state.takeOver && (
              <Button size="sm" onClick={() => state.takeOver && void hold(state.takeOver, { takeOver: true })}>
                Giữ ở đây
              </Button>
            )}
          </div>
        )}

        {/* Cú chạm hỏng, nhưng phiên vẫn sống: báo NGAY TRÊN màn hình máy, và
            đừng gỡ màn hình đi. Người dùng chạm lại được ngay, và lần chạm sau
            thành công thì dòng này tự biến mất. */}
        {state.phase === 'holding' && state.lastActionError && (
          <div
            role="status"
            className="border-destructive/40 text-destructive bg-card rounded-md border p-3 text-sm"
          >
            Thao tác vừa rồi không tới được máy: {state.lastActionError}
          </div>
        )}

        {state.phase === 'holding' && (
          <Card aria-labelledby="control-title">
            <CardHeader>
              <CardTitle id="control-title">Màn hình máy</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-start gap-4">
            <div className="relative">
              <canvas
                ref={canvas}
                aria-label="Màn hình thiết bị"
                // `touch-none`: trên màn cảm ứng, thao tác cuộn của trình duyệt
                // sẽ nuốt mất cú kéo trước khi nó tới đây.
                className="bg-muted max-h-[70vh] w-auto touch-none rounded-md border"
                onPointerDown={(event) => {
                  const at = pointAt(event);
                  if (at) down.current = { ...at, at: Date.now() };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerUp={onUp}
              />
              {state.frames === 0 && <WaitingForFrames />}
            </div>

            {/* Cột thao tác, sát ngay cạnh màn hình máy.
                Xếp DỌC chứ không cuộn ngang: đây là những nút bấm đi bấm lại
                trong lúc mắt vẫn đang nhìn màn hình bên trái, nên chúng cần một
                chỗ cố định, và một hàng ngang tự xuống dòng thì thứ tự nút đổi
                theo bề rộng cửa sổ. */}
            {/* Nút vuông chỉ có icon, tên hiện khi rê chuột — như các device
                farm khác. Cột hẹp để màn hình máy được rộng chỗ; nhóm cách nhau
                bằng một vạch mảnh thay cho tiêu đề chữ. Tên vẫn nằm trong
                `aria-label` cho trình đọc màn hình, và trong tooltip cho mắt. */}
            <div
              aria-label="Thao tác"
              role="group"
              className="flex shrink-0 flex-col items-center gap-2"
            >
              {toolsFor(state.platform).map((group, index) => (
                <div
                  key={group.title}
                  role="group"
                  aria-label={group.title}
                  className={cn(
                    'flex flex-col gap-1.5',
                    index > 0 && 'border-t pt-2',
                  )}
                >
                  {group.items.map((item) => {
                    const label = item.action === 'rotate'
                      ? (landscape ? 'Xoay về dọc' : 'Xoay ngang')
                      : labelOf(item, state.platform);
                    const busy = busyTool === item.id;
                    return (
                      <Tooltip key={item.id}>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon"
                            variant="outline"
                            className="size-9"
                            aria-label={label}
                            disabled={busy}
                            onClick={() => void runTool(item)}
                          >
                            {busy
                              ? <Loader2 className="size-4 animate-spin" aria-hidden />
                              : <item.Icon className="size-4" aria-hidden />}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="right" sideOffset={6}>{label}</TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              ))}
            </div>

            <div className="flex min-w-56 flex-1 flex-col gap-2">
              <div className="flex gap-2">
                <Input
                  value={text}
                  placeholder="Gõ chữ vào máy"
                  onChange={(event) => setText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' || !text) return;
                    void send({ kind: 'text', text });
                    setText('');
                  }}
                />
                <Button
                  size="sm"
                  disabled={!text}
                  onClick={() => { void send({ kind: 'text', text }); setText(''); }}
                >
                  Gõ
                </Button>
              </div>

              <div className="flex gap-2">
                <Input
                  value={url}
                  aria-label="URL hoặc deep link"
                  placeholder="Mở URL hoặc deep link (https://…, tcinvest://…)"
                  onChange={(event) => setUrl(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') openUrl();
                  }}
                />
                <Button size="sm" variant="outline" disabled={!url.trim()} onClick={openUrl}>
                  <Link className="size-4" aria-hidden /> Mở
                </Button>
              </div>

              <p className="text-muted-foreground text-xs">
                Bấm để chạm, kéo quá {DRAG_THRESHOLD_PX}px để quét. "Mở lại app" và "Đóng app" tác
                động lên app đang test khai trong Cấu hình. Không có phím nguồn: một cái nút trên
                web khoá màn hình chiếc máy ở phòng khác là thứ không ai gỡ được từ xa.
              </p>
            </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

/**
 * Nói ra rằng luồng đang mở, thay vì để một ô trống.
 *
 * Một ô trống trông GIỐNG HỆT nhau ở hai tình huống khác hẳn: scrcpy đang dựng
 * tiến trình trên máy (mất vài giây, nhất là lần đầu vì phải đẩy file lên), và
 * luồng đã chết. Người dùng ngồi trước ô ấy không biết nên chờ hay nên bấm
 * lại, và "treo" là chữ họ dùng cho cả hai.
 *
 * Sau `SLOW_AFTER_MS` thì đổi giọng: chờ lâu hơn thế là bất thường, và lúc ấy
 * điều hữu ích không phải là trấn an mà là nói cho họ biết làm gì.
 */
export function WaitingForFrames() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      role="status"
      className="text-muted-foreground absolute inset-0 flex flex-col items-center
        justify-center gap-2 px-4 text-center text-xs"
    >
      <Loader2 className="size-5 animate-spin" aria-hidden />
      {slow ? (
        <>
          <span className="font-medium">Chưa nhận được khung hình nào.</span>
          <span>
            Bấm <b>Nhả máy</b> rồi <b>Giữ máy</b> lại. Còn nữa thì máy có thể đang khoá màn
            hình, hoặc chiếc máy tính nó cắm vào đã mất kết nối.
          </span>
        </>
      ) : (
        <span>Đang mở luồng hình — máy đang dựng bộ mã hoá, mất vài giây.</span>
      )}
    </div>
  );
}
