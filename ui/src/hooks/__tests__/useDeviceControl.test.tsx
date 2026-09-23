/**
 * Vòng đời phiên điều khiển, đo ở tầng hook.
 *
 * Ba điều đáng đo, và cả ba đều là những lần KHÔNG thành công — vì đường thành
 * công đã được đo trên máy thật (`control.integration.test.ts`), còn những
 * đường này thì chỉ gặp trên máy người dùng:
 *
 *  1. Trình duyệt không có WebCodecs: phải nói ra, không phải để màn hình
 *     trống và im lặng.
 *  2. Máy đang có người giữ: thông báo của server phải tới được mắt người dùng.
 *  3. Rời trang thì nhả máy — nếu không, chiếc máy bị khoá thêm 60 giây cho
 *     người tiếp theo, mỗi lần ai đó lỡ mở nhầm trang.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createRef } from 'react';
import { server } from '@/test/mocks/server';
import { createQueryWrapper } from '@/test/utils';
import { useDeviceControl } from '@/hooks/useDeviceControl';
import { ROUTES } from '@/api/routes';

/** jsdom không có EventSource; hook chỉ cần mở và đóng được. */
class FakeEventSource {
  static last: FakeEventSource | undefined;
  closed = false;
  onerror: (() => void) | undefined;
  constructor(readonly url: string) { FakeEventSource.last = this; }
  addEventListener(): void {}
  close(): void { this.closed = true; }
}

beforeEach(() => {
  FakeEventSource.last = undefined;
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('VideoDecoder', class {});
});

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const canvas = createRef<HTMLCanvasElement>();
  return renderHook(() => useDeviceControl(canvas), { wrapper: createQueryWrapper() });
}

const ANDROID = { platform: 'android' as const, udid: 'emulator-5554', label: 'Pixel' };
const IPHONE = { platform: 'ios' as const, udid: 'C9139335', label: 'iPhone 17 Pro' };

describe('useDeviceControl', () => {
  it('giữ máy xong thì mở luồng kèm đúng leaseId', async () => {
    server.use(http.post(ROUTES.deviceLease, () => HttpResponse.json({
      lease: { id: 'lease-1', deviceId: 'emulator-5554', expiresAt: '2026-09-22T10:01:00.000Z' },
    })));

    const { result } = setup();
    await act(() => result.current.hold(ANDROID));

    expect(result.current.state.phase).toBe('holding');
    expect(FakeEventSource.last?.url).toContain('leaseId=lease-1');
    expect(FakeEventSource.last?.url).toContain('deviceId=emulator-5554');
    expect(FakeEventSource.last?.url).toContain('platform=android');
  });

  /**
   * Không có WebCodecs thì nói ra TRƯỚC khi giữ máy.
   *
   * Giữ máy rồi mới phát hiện không xem được nghĩa là chiếc máy bị khoá 60
   * giây cho một người không dùng được nó.
   */
  it('Android cần WebCodecs: thiếu thì nói ra, và không giữ máy', async () => {
    vi.stubGlobal('VideoDecoder', undefined);
    let asked = 0;
    server.use(http.post(ROUTES.deviceLease, () => { asked += 1; return HttpResponse.json({}); }));

    const { result } = setup();
    await act(() => result.current.hold(ANDROID));

    expect(result.current.state).toMatchObject({ phase: 'error' });
    expect((result.current.state as { message: string }).message).toMatch(/WebCodecs/);
    expect(asked).toBe(0);
  });

  /**
   * Nhưng iOS thì KHÔNG cần: luồng của nó là JPEG từng khung, mà mọi trình
   * duyệt đều vẽ được. Chặn cả hai nền tảng vì một yêu cầu chỉ của một bên là
   * từ chối một thứ đang chạy được.
   */
  it('iOS không cần WebCodecs', async () => {
    vi.stubGlobal('VideoDecoder', undefined);
    server.use(http.post(ROUTES.deviceLease, () => HttpResponse.json({
      lease: { id: 'lease-ios', deviceId: IPHONE.udid, expiresAt: '2026-09-22T10:01:00.000Z' },
    })));

    const { result } = setup();
    await act(() => result.current.hold(IPHONE));

    expect(result.current.state.phase).toBe('holding');
    expect(FakeEventSource.last?.url).toContain('platform=ios');
  });

  it('máy đang có người giữ thì hiện đúng câu của server', async () => {
    server.use(http.post(ROUTES.deviceLease, () => HttpResponse.json(
      { error: 'Thiết bị "emulator-5554" đang được an@example.com giữ tới 10:01.' },
      { status: 409 },
    )));

    const { result } = setup();
    await act(() => result.current.hold(ANDROID));

    await waitFor(() => expect(result.current.state.phase).toBe('error'));
    expect((result.current.state as { message: string }).message).toMatch(/an@example.com/);
  });

  it('nhả máy thì đóng luồng và gọi release', async () => {
    let released: unknown;
    server.use(
      http.post(ROUTES.deviceLease, () => HttpResponse.json({
        lease: { id: 'lease-1', deviceId: 'emulator-5554', expiresAt: '2026-09-22T10:01:00.000Z' },
      })),
      http.post(ROUTES.deviceLeaseRelease, async ({ request }) => {
        released = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );

    const { result } = setup();
    await act(() => result.current.hold(ANDROID));
    await act(() => result.current.release());

    expect(result.current.state.phase).toBe('idle');
    expect(FakeEventSource.last?.closed).toBe(true);
    await waitFor(() => expect(released).toEqual({ leaseId: 'lease-1' }));
  });

  /** Rời trang mà không nhả là khoá chiếc máy thêm 60 giây cho người tiếp theo. */
  /**
   * Một cú chạm hỏng KHÔNG được hạ cả phiên.
   *
   * Đã xảy ra thật: `adb` không trả lời trong tám giây khi ai đó đang thao tác
   * với emulator, và cả màn hình biến mất kèm dòng "adb kết thúc với mã null".
   * Hai thứ bị mất cùng lúc, và cái thứ hai tệ hơn: lease vẫn được giữ, nên
   * chiếc máy bị khoá trong khi không còn ai xem được nó.
   */
  it('cú chạm hỏng thì báo, nhưng vẫn giữ máy và vẫn xem được', async () => {
    server.use(
      http.post(ROUTES.deviceLease, () => HttpResponse.json({
        lease: { id: 'lease-1', deviceId: ANDROID.udid, expiresAt: '2026-09-22T10:01:00.000Z' },
      })),
      http.post(ROUTES.controlInput, () => HttpResponse.json(
        { error: 'adb input tap không trả lời trong 8 giây.' }, { status: 500 },
      )),
    );

    const { result } = setup();
    await act(() => result.current.hold(ANDROID));
    await act(() => result.current.send({ kind: 'tap', x: 10, y: 20 }));

    expect(result.current.state.phase).toBe('holding');
    expect((result.current.state as { lastActionError?: string }).lastActionError)
      .toMatch(/không trả lời/);
    expect(FakeEventSource.last?.closed).toBe(false);
  });

  it('cú chạm sau thành công thì câu lỗi tự biến mất', async () => {
    let fail = true;
    server.use(
      http.post(ROUTES.deviceLease, () => HttpResponse.json({
        lease: { id: 'lease-1', deviceId: ANDROID.udid, expiresAt: '2026-09-22T10:01:00.000Z' },
      })),
      http.post(ROUTES.controlInput, () => (fail
        ? HttpResponse.json({ error: 'hỏng' }, { status: 500 })
        : HttpResponse.json({ ok: true }))),
    );

    const { result } = setup();
    await act(() => result.current.hold(ANDROID));
    await act(() => result.current.send({ kind: 'tap', x: 1, y: 2 }));
    expect((result.current.state as { lastActionError?: string }).lastActionError).toBeTruthy();

    fail = false;
    await act(() => result.current.send({ kind: 'tap', x: 1, y: 2 }));
    // Để dòng lỗi nằm lại sau khi mọi thứ đã bình thường là dạy người dùng
    // bỏ qua nó.
    expect((result.current.state as { lastActionError?: string }).lastActionError)
      .toBeUndefined();
  });

  it('rời trang thì tự nhả máy', async () => {
    let released = false;
    server.use(
      http.post(ROUTES.deviceLease, () => HttpResponse.json({
        lease: { id: 'lease-9', deviceId: 'emulator-5554', expiresAt: '2026-09-22T10:01:00.000Z' },
      })),
      http.post(ROUTES.deviceLeaseRelease, () => { released = true; return HttpResponse.json({ ok: true }); }),
    );

    const { result, unmount } = setup();
    await act(() => result.current.hold(ANDROID));
    unmount();

    await waitFor(() => expect(released).toBe(true));
    expect(FakeEventSource.last?.closed).toBe(true);
  });
});
