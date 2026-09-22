/**
 * Màn điều khiển: xem màn hình một chiếc máy Android và chạm vào nó.
 *
 * Thứ tự trên màn hình theo đúng thứ tự người dùng phải làm: chọn máy → giữ
 * máy → xem và chạm. Không giữ máy thì không có gì để xem, và đó không phải
 * một hạn chế kỹ thuật mà là cả mô hình: chừng nào bạn còn cầm chiếc máy, hàng
 * đợi job không được giao nó cho ai.
 */
import { useCallback, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { ROUTES } from '@/api/routes';
import { AppShell } from '@/components/layout/AppShell';
import { navTitle } from '@/lib/nav';
import { Dropdown } from '@/components/Dropdown';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useDeviceControl, type ControlDevice } from '@/hooks/useDeviceControl';
import { DRAG_THRESHOLD_PX, isDrag, toScreenPoint } from '@/lib/deviceScale';

/**
 * Phím hiện ra theo nền tảng.
 *
 * iPhone không có nút Quay lại, và không có "ứng dụng gần đây" bấm được từ
 * WebDriverAgent. Vẽ những nút ấy rồi để chúng báo lỗi khi bấm là đẩy một sự
 * thật của nền tảng thành một lỗi của người dùng.
 */
const KEYS: Record<'android' | 'ios', Array<{ key: string; label: string }>> = {
  android: [
    { key: 'back', label: 'Quay lại' },
    { key: 'home', label: 'Home' },
    { key: 'recents', label: 'Gần đây' },
    { key: 'enter', label: 'Enter' },
    { key: 'delete', label: 'Xoá' },
  ],
  ios: [
    { key: 'home', label: 'Home' },
    { key: 'enter', label: 'Enter' },
    { key: 'delete', label: 'Xoá' },
  ],
};

export default function DeviceControlPanel() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { state, hold, release, send } = useDeviceControl(canvas);
  const [chosen, setChosen] = useState('');
  const [text, setText] = useState('');
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
        <div className="flex flex-wrap items-center gap-2">
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
              ...(devices.data ?? []).map((device) => ({
                value: device.udid,
                label: device.label,
              })),
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
        </div>

        {state.phase === 'error' && (
          <div
            role="alert"
            className="border-destructive text-destructive rounded-md border p-3 text-sm"
          >
            {state.message}
          </div>
        )}

        {state.phase === 'holding' && (
          <Card aria-labelledby="control-title">
            <CardHeader>
              <CardTitle id="control-title">Màn hình máy</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-start gap-4">
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

            <div className="flex min-w-56 flex-1 flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                {KEYS[state.platform].map((item) => (
                  <Button
                    key={item.key}
                    size="sm"
                    variant="outline"
                    onClick={() => void send({ kind: 'key', key: item.key })}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>

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

              <p className="text-muted-foreground text-xs">
                Bấm để chạm, kéo quá {DRAG_THRESHOLD_PX}px để quét. Không có phím nguồn: một cái
                nút trên web khoá màn hình chiếc máy ở phòng khác là thứ không ai gỡ được từ xa.
              </p>
            </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
