/**
 * Cổng phía máy tính cho một phiên Appium — để hai lượt chạy song song không
 * giẫm lên nhau.
 *
 * Mỗi phiên cần một cổng riêng trên máy tính: Android cho `systemPort` (cầu nối
 * tới UiAutomator2 trên máy), iOS cho `wdaLocalPort` (cầu nối tới
 * WebDriverAgent). Chạy một lượt một lúc thì mặc định của Appium là đủ. Khi
 * mỗi thiết bị chạy một job riêng, hai phiên đòi cùng một cổng thì phiên sau
 * hoặc không mở được, hoặc lặng lẽ nói chuyện với máy của phiên trước — và
 * lượt chạy trả về trông hoàn toàn bình thường.
 *
 * Luật:
 *  - Cổng khai trong config mà đang rảnh: dùng đúng nó (không đổi hành vi cũ).
 *  - Cổng khai trong config mà đang BẬN: lấy một cổng rảnh, và nói ra.
 *  - Không khai: Android để UiAutomator2 tự chọn (nó vốn tự tìm cổng rảnh);
 *    iOS lấy một cổng rảnh, vì mặc định 8100 của XCUITest là CỐ ĐỊNH — hai
 *    iPhone không khai cổng là hai phiên cùng đòi 8100.
 *  - Simulator giữ nguyên hành vi cũ: WDA của simulator nghe THẲNG trên cổng
 *    ấy và còn sống sau phiên trước, nên "cổng bận" ở đó thường là chính WDA
 *    của nó — đổi cổng là dựng thêm một WDA thứ hai không vì gì.
 */
import net from 'node:net';

/** Thử mở cổng trên cả IPv4 lẫn IPv6: thứ đang giữ nó có thể nghe ở một trong hai. */
export async function portFree(port: number): Promise<boolean> {
  const tryHost = (host: string): Promise<boolean> => new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err: NodeJS.ErrnoException) => {
      // Máy không có IPv6 thì không phải "bận".
      resolve(err.code === 'EADDRNOTAVAIL' || err.code === 'EAFNOSUPPORT');
    });
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
  return (await tryHost('127.0.0.1')) && (await tryHost('::1'));
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

export interface SessionPort {
  /** Cổng gửi cho Appium; `undefined` là để driver tự chọn. */
  port?: number;
  /** Cổng config đang bận nên đã đổi — để lượt chạy nói ra. */
  moved?: { from: number; to: number };
}

export async function sessionPort(
  platform: 'android' | 'ios',
  configured: number | undefined,
  deps: {
    simulator?: boolean;
    portFree?: (port: number) => Promise<boolean>;
    freePort?: () => Promise<number>;
  } = {},
): Promise<SessionPort> {
  if (deps.simulator) return configured !== undefined ? { port: configured } : {};
  const isFree = deps.portFree ?? portFree;
  const pick = deps.freePort ?? freePort;
  if (configured !== undefined) {
    if (await isFree(configured)) return { port: configured };
    const to = await pick();
    return { port: to, moved: { from: configured, to } };
  }
  if (platform === 'android') return {};
  return { port: await pick() };
}
