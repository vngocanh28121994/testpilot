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

export type ControlPlatform = 'android' | 'ios';

/**
 * Kiểu ảnh đang chảy về.
 *
 * Android cho ra H.264 — một luồng liên tục cần bộ giải mã dựng sẵn từ SPS.
 * iOS cho ra JPEG từng khung, vẽ thẳng được. Hai đường vẽ khác nhau hoàn toàn,
 * nên `meta` phải nói kiểu nào TRƯỚC khung đầu tiên.
 */
export type StreamCodec = 'h264' | 'mjpeg';

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

export interface ControlDevice {
  platform: ControlPlatform;
  udid: string;
  label: string;
}

export type ControlState =
  | { phase: 'idle' }
  | {
      phase: 'holding';
      lease: Lease;
      platform: ControlPlatform;
      screen?: ControlScreen;
      codec?: StreamCodec;
      frames: number;
      /**
       * Cú chạm gần nhất hỏng, nhưng phiên VẪN đang giữ máy.
       *
       * Tách khỏi `phase: 'error'` vì hai chuyện khác hẳn nhau. Mất lease hay
       * đứt luồng thì phiên kết thúc — không còn gì để xem. Một cú chạm hỏng
       * thì màn hình vẫn đang chảy về và máy vẫn trong tay người dùng; hạ cả
       * phiên vì nó là vứt đi một thứ đang chạy tốt, và tệ hơn: lease vẫn
       * được giữ, nên chiếc máy bị khoá trong khi không ai xem được nó nữa.
       */
      lastActionError?: string;
    }
  | { phase: 'error'; message: string };

/** Gia hạn mỗi 30 giây; lease sống 60. Một nhịp lỡ vẫn còn một nhịp dự phòng. */
const RENEW_MS = 30_000;

/**
 * Im lặng bao lâu thì coi phần đang gom là một khung trọn vẹn.
 *
 * 300ms: đủ dài để không cắt giữa một khung đang được ghi vào ống, đủ ngắn để
 * người mở màn điều khiển trên một chiếc máy đứng yên không nhìn ô trống.
 */
const IDLE_FLUSH_MS = 300;

export function useDeviceControl(canvas: React.RefObject<HTMLCanvasElement | null>) {
  const [state, setState] = useState<ControlState>({ phase: 'idle' });
  const leaseRef = useRef<Lease | undefined>(undefined);
  const platformRef = useRef<ControlPlatform>('android');
  const sourceRef = useRef<EventSource | undefined>(undefined);
  const decoderRef = useRef<VideoDecoder | undefined>(undefined);
  const assemblerRef = useRef(new AnnexBAssembler());
  const framesRef = useRef(0);
  /**
   * Đưa "đã có khung đầu tiên" LÊN STATE, chứ không chỉ giữ trong ref.
   *
   * Không có tín hiệu này thì màn hình vẽ một ô trống y hệt nhau cho hai tình
   * huống khác hẳn: luồng đang mở (scrcpy mất vài giây dựng tiến trình trên
   * máy), và luồng đã chết. Người dùng ngồi trước ô trống ấy không biết nên
   * chờ hay nên bấm lại — và "treo" là chữ họ dùng cho cả hai.
   *
   * Chỉ báo MỘT lần: một `setState` cho mỗi khung là một lần dựng lại React
   * sáu mươi lần một giây.
   */
  const toldRef = useRef(false);
  /** Số khung đã GỬI ĐI giải mã. Khác `framesRef` — xem chú thích ở `decode`. */
  const decodeSeq = useRef(0);
  /** Khung mới nhất chưa vẽ, và nhịp vẽ đang chờ. Xem `draw`. */
  const pendingFrame = useRef<VideoFrame | undefined>(undefined);
  const paintRef = useRef<number | undefined>(undefined);
  const codecRef = useRef<StreamCodec>('h264');
  const idleRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const teardown = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = undefined;
    if (decoderRef.current && decoderRef.current.state !== 'closed') decoderRef.current.close();
    decoderRef.current = undefined;
    assemblerRef.current.reset();
    framesRef.current = 0;
    toldRef.current = false;
    decodeSeq.current = 0;
    // Khung chưa vẽ cũng phải đóng: nó giữ bộ nhớ ngoài vùng thu gom rác.
    if (paintRef.current !== undefined) cancelAnimationFrame(paintRef.current);
    paintRef.current = undefined;
    pendingFrame.current?.close();
    pendingFrame.current = undefined;
    clearTimeout(idleRef.current);
  }, []);

  /**
   * Nhận một khung đã giải mã, và vẽ NHIỀU NHẤT một khung cho mỗi nhịp màn hình.
   *
   * Vì sao không vẽ ngay: hàm này chạy trong luồng chính, và bộ giải mã chỉ
   * đẩy khung tiếp theo ra sau khi nó trả về. Vẽ thẳng ở đây biến tốc độ vẽ
   * thành trần của tốc độ GIẢI MÃ — đo được trên máy thật: điện thoại gửi 17
   * khung mỗi giây, màn hình chỉ ra 9, hàng đợi dồn tới 48 khung và mỗi khung
   * chờ 761 ms trước khi hiện. Người dùng thấy máy phản hồi ngay mà hình thì
   * chạy sau vài giây.
   *
   * Khung đến trong lúc khung trước chưa kịp vẽ thì BỎ khung trước. Bỏ ở đây
   * an toàn, khác hẳn với bỏ trước khi giải mã: mọi khung vẫn được giải mã
   * nên chuỗi tham chiếu H.264 còn nguyên — chỉ có ảnh cũ không bao giờ lên
   * màn hình, và nó vốn đã lỗi thời.
   *
   * `VideoFrame` giữ bộ nhớ ngoài vùng thu gom rác của JS. Quên `close()` thì
   * bộ giải mã dừng lại sau vài chục khung với một lỗi về hàng đợi đầy — và
   * triệu chứng là video đứng hình chứ không phải một ngoại lệ.
   */
  const noteFirstFrame = useCallback(() => {
    if (toldRef.current) return;
    toldRef.current = true;
    setState((prev) => (prev.phase === 'holding' ? { ...prev, frames: 1 } : prev));
  }, []);

  const draw = useCallback((frame: VideoFrame) => {
    pendingFrame.current?.close();
    pendingFrame.current = frame;
    if (paintRef.current !== undefined) return;

    paintRef.current = requestAnimationFrame(() => {
      paintRef.current = undefined;
      const next = pendingFrame.current;
      pendingFrame.current = undefined;
      if (!next) return;

      const node = canvas.current;
      if (!node) { next.close(); return; }
      if (node.width !== next.displayWidth || node.height !== next.displayHeight) {
        node.width = next.displayWidth;
        node.height = next.displayHeight;
      }
      node.getContext('2d')?.drawImage(next, 0, 0);
      next.close();
      framesRef.current += 1;
      noteFirstFrame();
    });
  }, [canvas, noteFirstFrame]);

  /**
   * Vẽ một khung JPEG (iOS).
   *
   * `createImageBitmap` giải mã NGOÀI luồng chính, nên một khung 63 KB không
   * làm giao diện khựng. Và khung được đóng lại sau khi vẽ, vì bitmap giữ bộ
   * nhớ ngoài vùng thu gom rác của JS — cùng cái bẫy với `VideoFrame`.
   */
  const drawJpeg = useCallback(async (bytes: Uint8Array) => {
    const node = canvas.current;
    if (!node) return;
    let bitmap: ImageBitmap | undefined;
    try {
      bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/jpeg' }));
    } catch {
      // Một khung hỏng không đáng làm đứt cả phiên: khung sau sẽ vẽ lại.
      return;
    }
    if (node.width !== bitmap.width || node.height !== bitmap.height) {
      node.width = bitmap.width;
      node.height = bitmap.height;
    }
    node.getContext('2d')?.drawImage(bitmap, 0, 0);
    bitmap.close();
    framesRef.current += 1;
    noteFirstFrame();
  }, [canvas, noteFirstFrame]);

  /**
   * Giải mã một đơn vị truy cập và vẽ nó.
   *
   * Tách khỏi chỗ nhận sự kiện vì có HAI đường tới đây: mảnh mới đẩy tới, và
   * phần còn lại được phát nốt khi luồng im lặng. Hai bản chép tay của cùng
   * đoạn này sẽ lệch nhau ở phần dựng bộ giải mã.
   */
  const decode = useCallback((unit: { data: Uint8Array; key: boolean }) => {
    // Bộ giải mã dựng ở khung KHOÁ đầu tiên, vì chuỗi codec đọc từ SPS đi kèm
    // nó. Dựng sẵn bằng một chuỗi đặt cứng sẽ đúng cho phần lớn máy và sai
    // lặng lẽ cho những máy mã hoá ở profile khác.
    if (!decoderRef.current && unit.key) {
      const codec = codecFromAnnexB(unit.data);
      if (!codec) return;
      const decoder = new VideoDecoder({
        output: draw,
        error: (err) => setState({
          phase: 'error',
          message: 'Trình duyệt không giải mã được hình từ máy. Bấm Giữ máy lại; nếu vẫn lỗi, '
            + `thử Chrome hoặc Edge bản mới. Chi tiết kỹ thuật: ${err.message}`,
        }),
      });
      decoder.configure({ codec, optimizeForLatency: true });
      decoderRef.current = decoder;
    }
    const decoder = decoderRef.current;
    if (!decoder || decoder.state !== 'configured') return;
    // Khung thường trước khi có khung khoá thì bỏ: giải mã chúng chỉ ra hình
    // vỡ, vì chúng mô tả PHẦN ĐỔI so với một khung ta chưa có.
    if (!unit.key && framesRef.current === 0 && decoder.decodeQueueSize === 0) return;
    decoder.decode(new EncodedVideoChunk({
      type: unit.key ? 'key' : 'delta',
      // Mốc thời gian phải TĂNG DẦN, và đếm theo khung đã GỬI ĐI giải mã.
      //
      // Bản đầu đếm theo `framesRef` — số khung đã VẼ XONG. Hai con số ấy
      // bằng nhau khi mọi thứ thong thả, và lệch hẳn khi có một loạt khung
      // dồn tới: cả loạt nhận CÙNG một mốc thời gian, vì chưa khung nào kịp
      // vẽ. Bộ giải mã gặp mốc không tăng thì giữ khung lại để sắp xếp, và độ
      // trễ dồn lên. Đo được trên máy thật: hàng đợi sâu 32 khung, mỗi khung
      // chờ 745 ms — màn hình giật và chậm trong khi điện thoại phản hồi ngay.
      timestamp: (decodeSeq.current += 1) * 16_667,
      data: unit.data,
    }));
  }, [draw]);

  const open = useCallback((lease: Lease, platform: ControlPlatform) => {
    const source = new EventSource(
      `${ROUTES.controlStream}?platform=${platform}`
        + `&deviceId=${encodeURIComponent(lease.deviceId)}`
        + `&leaseId=${encodeURIComponent(lease.id)}`,
    );
    sourceRef.current = source;

    source.addEventListener('meta', (event) => {
      const meta = JSON.parse((event as MessageEvent<string>).data) as {
        screen: ControlScreen;
        codec: StreamCodec;
      };
      codecRef.current = meta.codec;
      setState((prev) => (
        prev.phase === 'holding' ? { ...prev, screen: meta.screen, codec: meta.codec } : prev
      ));
    });

    source.addEventListener('video', (event) => {
      const bytes = decodeBase64(JSON.parse((event as MessageEvent<string>).data) as string);
      // Màn hình đứng yên thì mảnh kế tiếp có thể không tới trong nhiều giây,
      // và bộ ghép chỉ phát một khung khi thấy khung sau. Hẹn giờ để phát nốt.
      clearTimeout(idleRef.current);
      idleRef.current = setTimeout(() => {
        for (const unit of assemblerRef.current.flush()) decode(unit);
      }, IDLE_FLUSH_MS);
      // iOS: mỗi sự kiện là MỘT ảnh JPEG trọn vẹn. Không có bộ giải mã nào để
      // dựng, không có khung khoá để chờ — vẽ thẳng.
      if (codecRef.current === 'mjpeg') {
        void drawJpeg(bytes);
        return;
      }
      for (const unit of assemblerRef.current.push(bytes)) decode(unit);
    });

    source.addEventListener('restart', () => {
      // Chỉ Android mới khởi động lại luồng; với MJPEG thì không có trạng thái
      // nào để dựng lại, nên các dòng dưới đây là vô hại ở cả hai đường.
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
      setState({
        phase: 'error',
        message: 'Mất kết nối tới luồng màn hình — máy chủ vừa khởi động lại, mạng rớt, hoặc '
          + 'lượt giữ máy đã hết. Bấm Giữ máy lại.',
      });
    };
  }, [canvas, decode, drawJpeg, teardown]);

  const hold = useCallback(async (device: ControlDevice) => {
    // WebCodecs chỉ cần cho Android (H.264). iOS gửi JPEG, mà mọi trình duyệt
    // đều vẽ được — nên chặn cả hai ở đây là từ chối một thứ chạy được.
    if (device.platform === 'android' && typeof VideoDecoder === 'undefined') {
      setState({
        phase: 'error',
        message: 'Trình duyệt này chưa giải mã được H.264 trong trang (cần WebCodecs). '
          + 'Chrome hoặc Edge thì xem được.',
      });
      return;
    }
    try {
      const { lease } = await api.post<{ lease: Lease }>(
        ROUTES.deviceLease, { deviceId: device.udid },
      );
      leaseRef.current = lease;
      platformRef.current = device.platform;
      toldRef.current = false;
      setState({ phase: 'holding', lease, platform: device.platform, frames: 0 });
      open(lease, device.platform);
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
      await api.post(ROUTES.controlInput, {
        deviceId: lease.deviceId,
        leaseId: lease.id,
        platform: platformRef.current,
        action,
      });
    } catch (err) {
      // KHÔNG hạ phiên: xem `lastActionError`. Người dùng chạm lại được ngay,
      // và lần chạm sau thành công thì câu lỗi tự biến mất.
      setState((prev) => (
        prev.phase === 'holding'
          ? { ...prev, lastActionError: (err as Error).message }
          : prev
      ));
      return;
    }
    setState((prev) => {
      if (prev.phase !== 'holding' || !prev.lastActionError) return prev;
      const { lastActionError: _cleared, ...rest } = prev;
      return rest;
    });
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
