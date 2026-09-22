/**
 * Vòng đời của một phiên điều khiển: giữ máy → xem → chạm → nhả.
 *
 * Bốn thứ phải sống cùng nhau, nên chúng ở chung một chỗ:
 *
 *  1. **Lease** và nhịp tim 30 giây. Lease sống 60 giây, nên ngừng nhịp là mất
 *     máy — và đó là chủ ý: một cái tab bị gập laptop, mất mạng, hay bị kill
 *     đều không gửi được gì, và thứ duy nhất chịu được cả ba là im lặng thì
 *     mất quyền.
 *  2. **Luồng SSE** mang khung H.264.
 *  3. **Bộ giải mã** `VideoDecoder` của WebCodecs, dựng lại mỗi khi luồng khởi
 *     động lại ở mốc 180 giây.
 *  4. **Nhả máy** khi rời trang. Nếu tab đóng đột ngột thì không kịp nhả, và
 *     lúc ấy TTL 60 giây là thứ dọn hộ — chính xác là lý do TTL tồn tại.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';
import { ROUTES } from '@/api/routes';
import { AnnexBAssembler, codecFromAnnexB, decodeBase64 } from '@/lib/h264';

export interface ControlScreen {
  width: number;
  height: number;
}

export interface ControlAction {
  kind: 'tap' | 'swipe' | 'text' | 'key';
  x?: number;
  y?: number;
  toX?: number;
  toY?: number;
  durationMs?: number;
  text?: string;
  key?: string;
}

interface Lease {
  id: string;
  deviceId: string;
  expiresAt: string;
}

export type ControlState =
  | { phase: 'idle' }
  | { phase: 'holding'; lease: Lease; screen?: ControlScreen; frames: number }
  | { phase: 'error'; message: string };

/** Gia hạn mỗi 30 giây; lease sống 60. Một nhịp lỡ vẫn còn một nhịp dự phòng. */
const RENEW_MS = 30_000;

export function useDeviceControl(canvas: React.RefObject<HTMLCanvasElement | null>) {
  const [state, setState] = useState<ControlState>({ phase: 'idle' });
  const leaseRef = useRef<Lease | undefined>(undefined);
  const sourceRef = useRef<EventSource | undefined>(undefined);
  const decoderRef = useRef<VideoDecoder | undefined>(undefined);
  const assemblerRef = useRef(new AnnexBAssembler());
  const framesRef = useRef(0);

  const teardown = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = undefined;
    if (decoderRef.current && decoderRef.current.state !== 'closed') decoderRef.current.close();
    decoderRef.current = undefined;
    assemblerRef.current.reset();
    framesRef.current = 0;
  }, []);

  /**
   * Vẽ một khung đã giải mã, rồi đóng nó lại.
   *
   * `VideoFrame` giữ bộ nhớ ngoài vùng thu gom rác của JS. Quên `close()` thì
   * bộ giải mã dừng lại sau vài chục khung với một lỗi về hàng đợi đầy — và
   * triệu chứng là video đứng hình chứ không phải một ngoại lệ.
   */
  const draw = useCallback((frame: VideoFrame) => {
    const node = canvas.current;
    if (!node) { frame.close(); return; }
    if (node.width !== frame.displayWidth || node.height !== frame.displayHeight) {
      node.width = frame.displayWidth;
      node.height = frame.displayHeight;
    }
    node.getContext('2d')?.drawImage(frame, 0, 0);
    frame.close();
    framesRef.current += 1;
  }, [canvas]);

  const open = useCallback((lease: Lease) => {
    const source = new EventSource(
      `${ROUTES.controlStream}?deviceId=${encodeURIComponent(lease.deviceId)}`
        + `&leaseId=${encodeURIComponent(lease.id)}`,
    );
    sourceRef.current = source;

    source.addEventListener('meta', (event) => {
      const meta = JSON.parse((event as MessageEvent<string>).data) as {
        screen: ControlScreen;
      };
      setState((prev) => (prev.phase === 'holding' ? { ...prev, screen: meta.screen } : prev));
    });

    source.addEventListener('video', (event) => {
      const bytes = decodeBase64(JSON.parse((event as MessageEvent<string>).data) as string);
      for (const unit of assemblerRef.current.push(bytes)) {
        // Bộ giải mã dựng ở khung KHOÁ đầu tiên, vì chuỗi codec đọc từ SPS đi
        // kèm nó. Dựng sẵn bằng một chuỗi đặt cứng sẽ đúng cho phần lớn máy và
        // sai lặng lẽ cho những máy mã hoá ở profile khác.
        if (!decoderRef.current && unit.key) {
          const codec = codecFromAnnexB(unit.data);
          if (!codec) continue;
          const decoder = new VideoDecoder({
            output: draw,
            error: (err) => setState({ phase: 'error', message: err.message }),
          });
          decoder.configure({ codec, optimizeForLatency: true });
          decoderRef.current = decoder;
        }
        const decoder = decoderRef.current;
        if (!decoder || decoder.state !== 'configured') continue;
        // Khung thường trước khi có khung khoá thì bỏ: giải mã chúng chỉ ra
        // hình vỡ, vì chúng mô tả PHẦN ĐỔI so với một khung ta chưa có.
        if (!unit.key && framesRef.current === 0 && decoder.decodeQueueSize === 0) continue;
        decoder.decode(new EncodedVideoChunk({
          type: unit.key ? 'key' : 'delta',
          // Mốc thời gian phải tăng dần; giá trị thật không quan trọng vì ta
          // vẽ ngay chứ không đồng bộ với âm thanh.
          timestamp: framesRef.current * 16_667,
          data: unit.data,
        }));
      }
    });

    source.addEventListener('restart', () => {
      // `screenrecord` vừa chạy lại ở mốc 180 giây: chuỗi mới không nối tiếp
      // chuỗi cũ, nên bộ giải mã phải dựng lại từ khung khoá kế tiếp.
      assemblerRef.current.reset();
      if (decoderRef.current && decoderRef.current.state !== 'closed') decoderRef.current.close();
      decoderRef.current = undefined;
      framesRef.current = 0;
    });

    source.addEventListener('ended', (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as { reason: string };
      teardown();
      setState({ phase: 'error', message: data.reason });
    });

    source.onerror = () => {
      // EventSource tự nối lại, nhưng nếu lease đã mất thì lần nối lại sẽ nhận
      // 409 và lặp mãi. Đóng hẳn và nói ra, để người dùng bấm giữ máy lần nữa.
      teardown();
      setState({ phase: 'error', message: 'Mất kết nối tới luồng màn hình.' });
    };
  }, [draw, teardown]);

  const hold = useCallback(async (deviceId: string) => {
    if (typeof VideoDecoder === 'undefined') {
      setState({
        phase: 'error',
        message: 'Trình duyệt này chưa giải mã được H.264 trong trang (cần WebCodecs). '
          + 'Chrome hoặc Edge thì xem được.',
      });
      return;
    }
    try {
      const { lease } = await api.post<{ lease: Lease }>(ROUTES.deviceLease, { deviceId });
      leaseRef.current = lease;
      setState({ phase: 'holding', lease, frames: 0 });
      open(lease);
    } catch (err) {
      setState({ phase: 'error', message: (err as Error).message });
    }
  }, [open]);

  const release = useCallback(async () => {
    const lease = leaseRef.current;
    leaseRef.current = undefined;
    teardown();
    setState({ phase: 'idle' });
    if (lease) {
      await api.post(ROUTES.deviceLeaseRelease, { leaseId: lease.id }).catch(() => undefined);
    }
  }, [teardown]);

  const send = useCallback(async (action: ControlAction) => {
    const lease = leaseRef.current;
    if (!lease) return;
    try {
      await api.post(ROUTES.controlInput, { deviceId: lease.deviceId, leaseId: lease.id, action });
    } catch (err) {
      setState({ phase: 'error', message: (err as Error).message });
    }
  }, []);

  // Nhịp tim. Ngừng nhịp là mất máy sau 60 giây, nên lỗi gia hạn phải hiện ra
  // ngay chứ không đợi tới lúc một cú chạm bị từ chối.
  useEffect(() => {
    if (state.phase !== 'holding') return undefined;
    const timer = setInterval(() => {
      const lease = leaseRef.current;
      if (!lease) return;
      void api.post(ROUTES.deviceLeaseRenew, { leaseId: lease.id }).catch((err: Error) => {
        teardown();
        setState({ phase: 'error', message: err.message });
      });
    }, RENEW_MS);
    return () => clearInterval(timer);
  }, [state.phase, teardown]);

  // Rời trang thì nhả máy. Tab đóng đột ngột thì không kịp, và TTL 60 giây dọn
  // hộ — chính xác là lý do TTL tồn tại.
  //
  // Thân KHỐI, không phải `useEffect(() => () => …)`: xem
  // [effectBody.test.ts](../__tests__/effectBody.test.ts) về vì sao luật ấy có.
  useEffect(() => {
    return () => {
      const lease = leaseRef.current;
      teardown();
      if (lease) {
        void api.post(ROUTES.deviceLeaseRelease, { leaseId: lease.id }).catch(() => undefined);
      }
    };
  }, [teardown]);

  return { state, hold, release, send };
}
