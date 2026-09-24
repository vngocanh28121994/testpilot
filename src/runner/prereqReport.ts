/**
 * Máy này có chạy được job không — hỏi TRƯỚC, không phát hiện GIỮA CHỪNG.
 *
 * Đây là khác biệt giữa một phòng lab và một máy cá nhân. Máy lab do người
 * quản trị dựng một lần rồi để yên; laptop của một người thì hôm nay có Xcode,
 * tuần sau nâng cấp macOS và Appium mất driver, tháng sau cài lại máy. Nếu
 * runner cứ nhận job rồi hỏng ở phút thứ ba, người đặt job nhận một câu lỗi
 * của Appium — thứ không nói được rằng chiếc máy ở đầu kia thiếu gì.
 *
 * Nên trạng thái môi trường là một thứ ĐO ĐƯỢC và BÁO LÊN, và job bị từ chối
 * ngay với câu nói rõ việc cần làm.
 */
import type { Runner } from './index.js';
import { iosTunnelCheck } from '../core/preflight.js';

export interface PrereqReport {
  /** Nền tảng này chạy được không. */
  ok: boolean;
  /** Vì sao không, viết cho người sẽ đi sửa nó. */
  reason?: string;
  /** Nút sửa được ngay từ web, khi có — việc sẽ làm trên CHÍNH máy này. */
  fix?: 'appium';
  /**
   * Tunnel cho WebView (iOS 17+), đo trên máy này. Chỉ để báo, KHÔNG làm
   * `ok` sai: app native chạy được không cần nó, và từ chối job vì một thứ
   * lượt chạy có thể không dùng tới là từ chối nhầm.
   */
  tunnel?: { ok: boolean; detail: string; service?: boolean };
  at: string;
}

export type PrereqByPlatform = Partial<Record<'web' | 'android' | 'ios', PrereqReport>>;

/**
 * Đo môi trường của chính máy này.
 *
 * `web` luôn sẵn sàng: Playwright đi kèm dự án và không cần thiết bị. Android
 * và iOS thì cần Appium đang chạy, cộng với Xcode cho iOS — ba điều kiện mà
 * một chiếc laptop mất dần theo thời gian.
 */
export async function measurePrereq(runner: Runner, now = new Date()): Promise<PrereqByPlatform> {
  const at = now.toISOString();
  const report: PrereqByPlatform = { web: { ok: true, at } };

  const appium = await runner.prereq.appiumStatus().catch(() => ({ running: false }));
  const appiumReason = appium.running
    ? undefined
    : 'Appium chưa chạy trên máy này. Mở màn Local Runner rồi bấm khởi động Appium, '
      + 'hoặc chạy `appium` trong một terminal.';

  report.android = appiumReason
    ? { ok: false, reason: appiumReason, fix: 'appium', at }
    : { ok: true, at };

  if (appiumReason) {
    report.ios = { ok: false, reason: appiumReason, fix: 'appium', at };
    return report;
  }

  // Xcode chỉ hỏi khi Appium đã chạy: nó là lời gọi đắt nhất trong nhóm, và
  // không có Appium thì câu trả lời của nó không đổi được kết luận.
  const xcode = await runner.prereq.xcode().catch((err: Error) => ({
    ok: false, reason: err.message,
  }));
  // Tunnel đo ở ĐÂY, trên máy cắm iPhone: máy chủ không nhìn được tunnel của
  // laptop người khác, và trước đây màn chuẩn bị chỉ biết tunnel của máy chủ.
  const tunnel = process.platform === 'darwin'
    ? await iosTunnelCheck()
      .then((c) => ({ ok: c.ok, detail: c.detail, service: runner.prereq.tunnelService() }))
      .catch(() => undefined)
    : undefined;
  report.ios = xcode.ok
    ? { ok: true, at, ...(tunnel ? { tunnel } : {}) }
    : { ok: false, reason: xcode.reason ?? 'Xcode chưa dùng được.', at, ...(tunnel ? { tunnel } : {}) };

  return report;
}

/**
 * Job này chạy được trên máy này không.
 *
 * Trả về lý do TỪ CHỐI, hoặc `undefined` khi chạy được. Câu từ chối đi thẳng
 * vào `job.error` và lên màn hình, nên nó phải nói việc cần làm chứ không chỉ
 * nói cái thiếu.
 */
export function refuseReason(
  prereq: PrereqByPlatform,
  platform: string | undefined,
): string | undefined {
  if (!platform) return undefined;
  const report = prereq[platform as keyof PrereqByPlatform];
  // Chưa đo bao giờ thì KHÔNG từ chối: thà chạy rồi hỏng còn hơn từ chối một
  // máy hoàn toàn tốt vì phép đo chưa kịp chạy lần đầu.
  if (!report || report.ok) return undefined;
  return report.reason ?? `Máy này chưa chạy được job ${platform}.`;
}
