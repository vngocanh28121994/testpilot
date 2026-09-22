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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDeviceControl } from '@/hooks/useDeviceControl';
import { DRAG_THRESHOLD_PX, isDrag, toScreenPoint } from '@/lib/deviceScale';
import type { PrereqAdbResponse, PrereqAndroidDevice } from '@core/ui/contracts.js';

const KEYS: Array<{ key: string; label: string }> = [
  { key: 'back', label: 'Quay lại' },
  { key: 'home', label: 'Home' },
  { key: 'recents', label: 'Gần đây' },
  { key: 'enter', label: 'Enter' },
  { key: 'delete', label: 'Xoá' },
];

function deviceLabel(device: PrereqAndroidDevice): string {
  return [
    device.marketName ?? device.model ?? device.id,
    device.androidVersion && `Android ${device.androidVersion}`,
    device.kind === 'emulator' ? 'emulator' : undefined,
  ].filter(Boolean).join(' · ');
}

export default function DeviceControlPanel() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { state, hold, release, send } = useDeviceControl(canvas);
  const [chosen, setChosen] = useState('');
  const [text, setText] = useState('');
  const down = useRef<{ x: number; y: number; at: number } | undefined>(undefined);

  const devices = useQuery({
    queryKey: ['control-devices'],
    queryFn: async () => (await api.get<PrereqAdbResponse>(ROUTES.prereqAdb)).devices,
  });

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
      title="Điều khiển thiết bị"
      description={
        'Giữ chỗ một chiếc máy rồi xem màn hình và chạm vào nó. '
        + 'Trong lúc bạn giữ, hàng đợi job không giao chiếc máy ấy cho ai.'
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Chọn máy"
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
            value={chosen}
            disabled={state.phase === 'holding'}
            onChange={(event) => setChosen(event.target.value)}
          >
            <option value="">— chọn máy —</option>
            {(devices.data ?? []).filter((device) => device.state === 'device').map((device) => (
              <option key={device.id} value={device.id}>{deviceLabel(device)}</option>
            ))}
          </select>

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
            <Button size="sm" disabled={!chosen} onClick={() => void hold(chosen)}>Giữ máy</Button>
          )}

          {state.phase === 'holding' && screen && (
            <span className="text-muted-foreground text-xs">
              {screen.width}×{screen.height} · lease tự gia hạn mỗi 30 giây
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
          <div className="flex flex-wrap items-start gap-4">
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
                {KEYS.map((item) => (
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
          </div>
        )}
      </div>
    </AppShell>
  );
}
