/**
 * Chọn đường điều khiển theo nền tảng, và không làm gì khác.
 *
 * Android đi qua `adb` với luồng H.264 ([androidControl.ts](./androidControl.ts));
 * iOS đi qua WebDriverAgent với luồng MJPEG ([iosControl.ts](./iosControl.ts)).
 * Hai đường không có một dòng chung nào, và đó là sự thật của hai nền tảng chứ
 * không phải một thiếu sót cần gộp lại.
 *
 * File này tồn tại để phần còn lại của hệ thống — mặt tiền runner, control
 * plane, giao diện — chỉ biết MỘT bộ việc. Nền tảng đi kèm trong `ControlTarget`
 * chứ không đoán từ hình dạng `udid`: udid của simulator là một UUID, của máy
 * iOS thật là 25 hoặc 40 ký tự, còn Android thì tuỳ nhà sản xuất. Đoán sai
 * nghĩa là gửi lệnh `adb` cho một chiếc iPhone, và câu lỗi sẽ nói về `adb`.
 */
import type { ControlTarget } from '../protocol/control.js';
import * as android from './androidControl.js';
import * as ios from './iosControl.js';
import type { ScreenSize, ScreenStreamHandle, ScreenStreamSink } from './androidControl.js';

/** Kiểu ảnh mà người xem sẽ nhận. Giao diện chọn bộ vẽ theo đúng giá trị này. */
export type StreamCodec = 'h264' | 'mjpeg';

export function codecFor(platform: ControlTarget['platform']): StreamCodec {
  return platform === 'ios' ? 'mjpeg' : 'h264';
}

export function screenSize(target: ControlTarget): Promise<ScreenSize> {
  return target.platform === 'ios'
    ? ios.screenSize(target.udid)
    : android.screenSize(target.udid);
}

export function startScreenStream(
  target: ControlTarget,
  sink: ScreenStreamSink,
): Promise<ScreenStreamHandle> {
  return target.platform === 'ios'
    ? ios.startScreenStream(target.udid, sink)
    : android.startScreenStream(target.udid, sink);
}

export function tap(target: ControlTarget, x: number, y: number): Promise<void> {
  return target.platform === 'ios' ? ios.tap(target.udid, x, y) : android.tap(target.udid, x, y);
}

export function swipe(
  target: ControlTarget,
  from: { x: number; y: number },
  to: { x: number; y: number },
  durationMs?: number,
): Promise<void> {
  return target.platform === 'ios'
    ? ios.swipe(target.udid, from, to, durationMs)
    : android.swipe(target.udid, from, to, durationMs);
}

export function typeText(target: ControlTarget, text: string): Promise<void> {
  return target.platform === 'ios'
    ? ios.typeText(target.udid, text)
    : android.typeText(target.udid, text);
}

export function pressKey(target: ControlTarget, key: string): Promise<void> {
  return target.platform === 'ios'
    ? ios.pressKey(target.udid, key)
    : android.pressKey(target.udid, key);
}

export function stopAllScreenStreams(): void {
  android.stopAllScreenStreams();
  ios.stopAllScreenStreams();
}

export interface ControlDevice extends ControlTarget {
  /** Chuỗi người đọc: tên máy, phiên bản hệ điều hành, thật hay giả lập. */
  label: string;
}

/**
 * Những chiếc máy điều khiển được, cả hai nền tảng, trong MỘT danh sách.
 *
 * Trước đó giao diện phải gộp hai nguồn khác hình dạng: `/api/prereq/adb` trả
 * object có `id`/`model`/`kind`, còn `/api/prereq/ios-devices` trả nguyên văn
 * `xcrun xctrace list devices` dưới dạng chuỗi — và không nguồn nào liệt kê
 * simulator đang bật, thứ mà màn điều khiển dùng nhiều nhất lúc phát triển.
 *
 * Một máy không trả lời thì bỏ qua BÊN ẤY, không làm hỏng cả danh sách: một
 * người chỉ có Android không nên thấy màn hình lỗi vì máy họ không cài Xcode.
 */
export async function controlDevices(): Promise<ControlDevice[]> {
  const [androids, iphones] = await Promise.all([
    android.attachedDevices().catch(() => []),
    ios.bootedSimulators().catch(() => []),
  ]);
  return [
    ...androids.map((device) => ({ platform: 'android' as const, ...device })),
    ...iphones.map((device) => ({ platform: 'ios' as const, ...device })),
  ];
}

export type { ScreenSize, ScreenStreamHandle, ScreenStreamSink };
