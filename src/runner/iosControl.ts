/**
 * Xem và chạm một chiếc máy iOS — qua WebDriverAgent, không qua `adb`.
 *
 * iOS không có `adb`, và không có lệnh nào trên máy chủ chạm được vào màn hình
 * một chiếc iPhone. Đường duy nhất là WebDriverAgent: một ứng dụng chạy TRÊN
 * máy ấy, do Appium dựng và cài. Nên bản iOS khác bản Android ở mọi tầng, và
 * hai file tách riêng là vì thế.
 *
 * Ba con số đo được trên simulator iPhone 17 Pro, iOS 26.5, ngày 22/09/2026:
 *
 *  - **Dựng phiên lần đầu: 184 giây.** Appium phải build rồi cài WebDriverAgent.
 *    Lần thứ hai: **4 giây** — WDA còn đó. Nên giao diện phải nói "đang dựng
 *    WebDriverAgent" chứ không đứng im, và phiên được GIỮ LẠI giữa các lần xem.
 *  - **MJPEG ở 9100: 900–1200 KB/s.** Gấp hơn một trăm lần luồng H.264 của
 *    Android, vì MJPEG không nén liên khung — mỗi khung là một ảnh đầy đủ.
 *  - **Màn hình đứng yên: 47 khung liên tiếp giống hệt nhau từng byte.** Đó là
 *    lý do `FrameDeduper` tồn tại, và nó biến 900 KB/s thành gần như không tốn
 *    gì trong đúng tình huống thường gặp nhất: người ta đang nhìn màn hình để
 *    quyết định chạm vào đâu.
 *
 * Toạ độ ở đây là ĐIỂM (point), không phải pixel: `window/rect` của WDA trả
 * 402x874 trong khi ảnh chụp là 1206x2622. W3C actions đi theo điểm, nên đó là
 * hệ toạ độ mà control plane công bố ra ngoài.
 */
import { get, request } from 'node:http';
import { FrameDeduper, MjpegSplitter } from './mjpeg.js';
import type { ScreenSize, ScreenStreamHandle, ScreenStreamSink } from './androidControl.js';
import type { ControlAppOp, ControlOrientation, IosSigning } from '../protocol/control.js';
import { friendlyError } from '../core/friendlyError.js';

const APPIUM = { host: '127.0.0.1', port: Number(process.env.TESTPILOT_APPIUM_PORT ?? 4723) };
/**
 * Cổng trên Mac cho luồng MJPEG và cho WDA của iPhone thật — MỖI PHIÊN MỘT CỔNG
 * TRỐNG, không cố định.
 *
 * Từng cố định 9100/8100, và iPhone thật hỏng với "The port #9100 is occupied":
 * WDA của simulator chạy NGAY TRÊN MAC nên mở thẳng hai cổng ấy, còn iPhone thật
 * cần chuyển tiếp đúng hai cổng ấy qua USB. Hai chiếc máy iOS cùng lúc — hay chỉ
 * một simulator còn chạy WDA từ lượt test trước — là tranh cổng. Biến môi trường
 * vẫn ép được một cổng cố định, cho ai cần mở tường lửa theo số.
 */
const MJPEG_PORT_OVERRIDE = process.env.TESTPILOT_MJPEG_PORT
  ? Number(process.env.TESTPILOT_MJPEG_PORT)
  : undefined;

async function freePort(): Promise<number> {
  const { createServer } = await import('node:net');
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error('Không tìm được cổng trống.'))));
    });
  });
}

/** udid của simulator là một UUID; của iPhone thật thì không. */
function isSimulatorUdid(udid: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(udid);
}

/**
 * Tốc độ khung và tỉ lệ thu nhỏ của luồng MJPEG.
 *
 * Đo trên iPhone 12 Pro Max (iOS 26.6.1), màn hình đang vuốt liên tục, tỉ lệ 30%
 * (ảnh 385×834, ~95 KB/khung):
 *
 *   đặt  5 → nhận  4.8 khung/s,  457 KB/s
 *   đặt 10 → nhận  9.5 khung/s,  904 KB/s
 *   đặt 15 → nhận 13.8 khung/s, 1308 KB/s
 *   đặt 20 → nhận 17.6 khung/s, 1684 KB/s
 *   đặt 30 → nhận 19.2 khung/s, 1807 KB/s
 *
 * Trần ~19 khung/s nằm ở phía máy: đổi tỉ lệ 20%/50%/100% vẫn chỉ 18–19. Nên 20
 * là chỗ dừng — 30 chỉ thêm 1.6 khung. Mức 5 cũ trông giật rõ khi vuốt hay
 * chuyển màn, dù đủ cho người đứng đọc. Màn hình đứng yên thì phép bỏ trùng
 * vẫn giữ băng thông gần bằng 0.
 */
const MJPEG_SETTINGS = {
  mjpegServerFramerate: 20,
  mjpegServerScreenshotQuality: 25,
  mjpegScalingFactor: 30,
};

interface Session {
  id: string;
  screen: ScreenSize;
  /** Cổng trên Mac nơi luồng MJPEG của phiên này nghe. */
  mjpegPort: number;
}

async function appium<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
  timeoutMs = 240_000,
): Promise<T> {
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf8');
  return new Promise<T>((resolve, reject) => {
    const req = request({
      ...APPIUM,
      method,
      path,
      headers: payload
        ? { 'content-type': 'application/json', 'content-length': payload.length }
        : {},
      timeout: timeoutMs,
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { raw += chunk; });
      res.on('end', () => {
        let parsed: { value?: unknown } = {};
        try {
          parsed = JSON.parse(raw) as { value?: unknown };
        } catch {
          reject(new Error(`Appium trả về thứ không phải JSON: ${raw.slice(0, 200)}`));
          return;
        }
        const value = parsed.value as { error?: string; message?: string } | undefined;
        if ((res.statusCode ?? 500) >= 400 || (value && typeof value === 'object' && value.error)) {
          // Câu của Appium dài và lặp; phần người đọc cần là `message`.
          reject(new Error(value?.message ?? value?.error ?? `Appium lỗi ${res.statusCode}`));
          return;
        }
        resolve(parsed.value as T);
      });
    });
    req.on('timeout', () => { req.destroy(new Error('Appium không trả lời kịp.')); });
    req.on('error', (err) => {
      reject(new Error(
        `Không gọi được Appium ở ${APPIUM.host}:${APPIUM.port} (${err.message}). `
          + 'Bật Appium ở màn Local Runner trước.',
      ));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Một phiên cho một chiếc máy, GIỮ LẠI giữa các lần xem.
 *
 * Dựng phiên lần đầu mất 184 giây vì Appium build WebDriverAgent. Đóng phiên
 * mỗi lần người xem rời đi nghĩa là người tiếp theo phải chờ lại từ đầu —
 * nên phiên sống tới khi tiến trình runner tắt, hoặc tới khi nó hỏng.
 */
const sessions = new Map<string, Promise<Session>>();

/**
 * Chữ ký WDA thành capability — cùng cách `drivers/native.ts` làm cho lượt
 * chạy test, để một chiếc iPhone đã chạy test được thì cũng xem được.
 *
 * Dùng lại WDA đã cài thì KHÔNG gửi cờ ký: Appium bỏ hẳn xcodebuild, và gửi
 * kèm chỉ khiến nó build lại — rồi iOS hỏi tin cậy lại.
 */
export function signingCaps(signing: IosSigning | undefined): Record<string, unknown> {
  if (!signing) return {};
  return {
    ...(signing.usePrebuiltWDA ? { 'appium:usePrebuiltWDA': true } : {}),
    ...(signing.derivedDataPath ? { 'appium:derivedDataPath': signing.derivedDataPath } : {}),
    ...(signing.usePreinstalledWDA && signing.wdaBundleId
      ? { 'appium:usePreinstalledWDA': true, 'appium:updatedWDABundleId': signing.wdaBundleId }
      : {}),
    ...(!signing.usePreinstalledWDA && signing.teamId
      ? {
        'appium:xcodeOrgId': signing.teamId,
        'appium:xcodeSigningId': signing.signingId ?? 'Apple Development',
        ...(signing.wdaBundleId ? { 'appium:updatedWDABundleId': signing.wdaBundleId } : {}),
        'appium:allowProvisioningDeviceRegistration': true,
      }
      : {}),
    // Build WDA lần đầu cho máy thật mất vài phút; mặc định 60s của Appium
    // bỏ ngang một bản build đang chạy bình thường.
    'appium:wdaLaunchTimeout': signing.usePreinstalledWDA ? 60_000 : 10 * 60_000,
    'appium:showXcodeLog': true,
  };
}

/**
 * Mã phiên Appium đã mở, theo udid — GHI RA ĐĨA.
 *
 * Phiên sống tới khi tiến trình tắt, nhưng tắt tiến trình (tsx watch khởi động
 * lại, Ctrl+C, sập) KHÔNG đóng phiên bên Appium. Với iPhone thật, phiên cũ còn
 * giữ cổng chuyển tiếp MJPEG 9100 qua USB, và phiên mới hỏng ngay với "The port
 * #9100 is occupied" — suốt 10 phút tới khi `newCommandTimeout` tự đóng nó.
 * Simulator không chuyển tiếp cổng, nên lỗi này chỉ lộ ra trên máy thật.
 *
 * Nhớ trong bộ nhớ thì chết cùng tiến trình; Appium thì không cho liệt kê phiên
 * (`session_discovery` tắt). Nên ghi ra đĩa, và lần sau mở phiên cho cùng máy
 * thì đóng phiên cũ trước.
 */
export const SESSION_RECORD = '.testpilot/control-sessions.json';

export async function readSessionRecord(file = SESSION_RECORD): Promise<Record<string, string>> {
  const { readFile } = await import('node:fs/promises');
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, string> : {};
  } catch {
    return {};
  }
}

export async function writeSessionRecord(
  udid: string, sessionId: string | undefined, file = SESSION_RECORD,
): Promise<void> {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const record = await readSessionRecord(file);
  if (sessionId) record[udid] = sessionId;
  else delete record[udid];
  await mkdir(path.dirname(path.resolve(file)), { recursive: true });
  await writeFile(file, JSON.stringify(record, null, 2) + '\n', 'utf8');
}

async function openSession(udid: string, signing?: IosSigning): Promise<Session> {
  const stale = (await readSessionRecord())[udid];
  if (stale) {
    // Phiên đã hết hạn thì Appium trả 404 — cũng là kết quả mong muốn.
    await appium('DELETE', `/session/${stale}`, undefined, 30_000).catch(() => undefined);
    await writeSessionRecord(udid, undefined).catch(() => undefined);
  }
  const mjpegPort = MJPEG_PORT_OVERRIDE ?? await freePort();
  // iPhone thật: Appium chuyển tiếp cổng WDA qua USB, nên cũng cần một cổng
  // trống — cổng 8100 mặc định là của WDA simulator nếu có simulator đang chạy.
  const wdaLocalPort = isSimulatorUdid(udid) ? undefined : await freePort();
  const created = await appium<{ sessionId: string }>('POST', '/session', {
    capabilities: {
      alwaysMatch: {
        platformName: 'iOS',
        'appium:automationName': 'XCUITest',
        'appium:udid': udid,
        'appium:mjpegServerPort': mjpegPort,
        ...(wdaLocalPort ? { 'appium:wdaLocalPort': wdaLocalPort } : {}),
        // Không mở ứng dụng nào: màn điều khiển bắt đầu ở nơi chiếc máy đang
        // đứng, chứ không kéo nó về màn hình chính.
        'appium:noReset': true,
        // Mười phút im lặng thì Appium mới tự đóng phiên. Người ta nhìn một
        // màn hình rồi đi pha cà phê là chuyện thường.
        'appium:newCommandTimeout': 600,
        ...signingCaps(signing),
      },
      firstMatch: [{}],
    },
  });
  await writeSessionRecord(udid, created.sessionId).catch(() => undefined);
  const rect = await appium<{ width: number; height: number }>(
    'GET', `/session/${created.sessionId}/window/rect`, undefined, 30_000,
  );
  await appium('POST', `/session/${created.sessionId}/appium/settings`,
    { settings: MJPEG_SETTINGS }, 30_000);

  return {
    id: created.sessionId,
    // `overridden` false: toạ độ W3C đi theo đúng số này, không có lớp quy đổi
    // nào ở giữa như `wm size` của Android.
    screen: { width: rect.width, height: rect.height, overridden: false },
    mjpegPort,
  };
}

/**
 * Câu Appium cho mọi thứ hỏng quanh WDA là "xcodebuild failed with code NN" —
 * tiếng Anh, và không nói gì về việc phải làm. Hai mã hay gặp nhất trên iPhone
 * thật, đo trên chính máy dev (iPhone 12 Pro Max, Apple ID miễn phí):
 *
 * - 70: iOS từ chối CÀI — "This provisioning profile has expired". Profile
 *   của Apple ID miễn phí chỉ sống 7 ngày, và `usePrebuiltWDA` cài lại đúng
 *   bản cũ mang profile đã chết.
 * - 65: cài được nhưng iOS từ chối MỞ — chứng chỉ chưa được tin cậy trên máy.
 *   Luôn xảy ra ngay sau khi profile được cấp lại.
 *
 * Giữ nguyên câu gốc ở cuối để ai cần vẫn tra được.
 */
export function explainWdaStart(message: string): string {
  // Câu chữ nằm ở bộ dịch lỗi chung, để lỗi WDA đọc giống nhau dù đi qua
  // màn điều khiển hay qua một lượt chạy test.
  return friendlyError(message);
}

/**
 * Phiên đã nhớ còn sống không — hỏi Appium, không hỏi WDA, nên chỉ vài ms.
 *
 * Phiên có thể chết mà tiến trình này không hay: một lượt TEST mở phiên riêng
 * trên cùng chiếc iPhone là Appium đóng phiên của màn điều khiển. Dùng lại lời
 * hứa cũ thì người xem nhận "ECONNREFUSED" ở cổng MJPEG của một phiên đã mất.
 */
async function alive(open: Session): Promise<boolean> {
  try {
    await appium('GET', `/session/${open.id}`, undefined, 10_000);
    return true;
  } catch {
    return false;
  }
}

/** Quên phiên của máy này — lần gọi sau sẽ mở phiên mới. */
function forget(udid: string, open?: Session): void {
  const pending = sessions.get(udid);
  if (!pending) return;
  if (!open) { sessions.delete(udid); return; }
  // Chỉ xoá nếu mục đang nhớ VẪN là phiên hỏng ấy — có thể một phiên mới đã
  // được mở trong lúc chờ.
  void pending.then((current) => { if (current.id === open.id) sessions.delete(udid); }, () => undefined);
}

/**
 * Chữ ký WDA đã biết cho từng máy — để MỌI đường mở phiên đều mang nó.
 *
 * Từng chỉ có `screenSize` và `startScreenStream` truyền chữ ký; một phiên mở
 * từ đường khác (chụp màn hình, mở URL, khi phiên cũ vừa chết) thì mở TRẦN, và
 * trên iPhone thật Appium quay về đường xcodebuild rồi hỏng với code 65 — dù
 * WDA đã cài sẵn trên máy. Người gọi báo chữ ký qua `rememberSigning` trước
 * mỗi thao tác (xem control.ts).
 */
const signings = new Map<string, IosSigning>();

export function rememberSigning(udid: string, signing: IosSigning | undefined): void {
  if (signing) signings.set(udid, signing);
}

async function session(udid: string, signingArg?: IosSigning, verify = false): Promise<Session> {
  rememberSigning(udid, signingArg);
  const signing = signingArg ?? signings.get(udid);
  const cached = sessions.get(udid);
  if (cached && verify) {
    const open = await cached.catch(() => undefined);
    if (open && !(await alive(open))) {
      if (sessions.get(udid) === cached) sessions.delete(udid);
    }
  }
  let pending = sessions.get(udid);
  if (!pending) {
    pending = openSession(udid, signing).catch((err: Error) => {
      throw new Error(explainWdaStart(err.message));
    });
    sessions.set(udid, pending);
    // Dựng hỏng thì XOÁ lời hứa hỏng đi: giữ lại nghĩa là mọi lần thử sau đều
    // nhận lại đúng lỗi cũ, kể cả sau khi người dùng đã sửa nguyên nhân.
    pending.catch(() => sessions.delete(udid));
  }
  return pending;
}

export async function screenSize(udid: string, signing?: IosSigning): Promise<ScreenSize> {
  return (await session(udid, signing, true)).screen;
}

/* ── Luồng màn hình ───────────────────────────────────────────────────── */

const streams = new Map<string, {
  sinks: Set<ScreenStreamSink>;
  frame: { width: number; height: number };
  stopped: boolean;
  close?: () => void;
}>();

/**
 * Mở luồng MJPEG của WDA, một tiến trình đọc cho một chiếc máy.
 *
 * Cổng 9100 chỉ nhận một người đọc có ích: mỗi kết nối là một luồng ảnh riêng
 * từ cùng một bộ chụp, nên hai người xem mở hai kết nối là nhân đôi công việc
 * của chiếc máy. Dùng chung một kết nối và phát tiếp cho mọi người xem.
 */
export async function startScreenStream(
  udid: string,
  sink: ScreenStreamSink,
  signing?: IosSigning,
): Promise<ScreenStreamHandle> {
  const existing = streams.get(udid);
  if (existing) {
    existing.sinks.add(sink);
    return { frame: existing.frame, stop: () => detach(udid, sink) };
  }

  const open = await session(udid, signing, true);
  const state = {
    sinks: new Set([sink]),
    // Khung MJPEG là PIXEL đã thu nhỏ; kích thước thật của ảnh do WDA quyết
    // định. Công bố kích thước màn hình theo điểm để client quy đổi toạ độ —
    // đúng con số mà W3C actions dùng.
    frame: { width: open.screen.width, height: open.screen.height },
    stopped: false,
  } as {
    sinks: Set<ScreenStreamSink>;
    frame: { width: number; height: number };
    stopped: boolean;
    close?: () => void;
  };
  streams.set(udid, state);

  const splitter = new MjpegSplitter();
  const deduper = new FrameDeduper();

  const req = get({ host: APPIUM.host, port: open.mjpegPort, path: '/' }, (res) => {
    res.on('data', (chunk: Buffer) => {
      for (const frame of splitter.push(chunk)) {
        const fresh = deduper.keep(frame);
        if (!fresh) continue;
        for (const each of state.sinks) each.chunk(fresh);
      }
    });
    res.on('end', () => {
      if (state.stopped) return;
      for (const each of state.sinks) {
        each.fail('Luồng hình của iPhone đã đóng — thường là phiên bị một lượt test chiếm. Bấm Giữ máy lại.');
      }
      streams.delete(udid);
      forget(udid, open);
    });
  });
  req.on('error', (err) => {
    if (state.stopped) return;
    for (const each of state.sinks) {
      each.fail(
        'Mất kết nối với luồng hình của iPhone — phiên điều khiển đã đóng (thường vì một lượt test '
        + 'vừa dùng máy). Bấm Giữ máy lại để mở phiên mới. '
        + `Chi tiết kỹ thuật: cổng ${open.mjpegPort}, ${err.message}`,
      );
    }
    streams.delete(udid);
    // Cổng không ai nghe = phiên đã chết. Quên nó, để lần giữ máy sau mở phiên
    // mới thay vì nhận lại đúng lỗi này.
    forget(udid, open);
  });
  state.close = () => req.destroy();

  return { frame: state.frame, stop: () => detach(udid, sink) };
}

function detach(udid: string, sink: ScreenStreamSink): void {
  const state = streams.get(udid);
  if (!state) return;
  state.sinks.delete(sink);
  if (state.sinks.size > 0) return;
  state.stopped = true;
  state.close?.();
  streams.delete(udid);
}

/**
 * Đóng mọi luồng, nhưng KHÔNG đóng phiên.
 *
 * Phiên là thứ đắt (184 giây lần đầu) và nó sống trên chiếc máy chứ không
 * trong tiến trình này. Đóng nó lúc runner tắt chỉ làm người dùng chờ lại từ
 * đầu ở lần chạy sau; Appium tự dọn sau mười phút im lặng.
 */
export function stopAllScreenStreams(): void {
  for (const [udid, state] of streams) {
    state.stopped = true;
    state.close?.();
    streams.delete(udid);
  }
}

/* ── Đầu vào ──────────────────────────────────────────────────────────── */

/**
 * Chạy một `mobile:` script của driver XCUITest.
 *
 * Đây là đường DUY NHẤT còn lại cho các việc riêng của thiết bị: xcuitest 12.5
 * đã bỏ `/wda/keys` và `/appium/device/press_button`, cả hai trả
 * "unknown command" — một câu không nói gì về việc route đã dời chỗ.
 */
async function script(
  udid: string,
  name: string,
  args: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<void> {
  const open = await session(udid);
  await appium('POST', `/session/${open.id}/execute/sync`, { script: name, args: [args] }, timeoutMs);
}

async function pointer(udid: string, moves: Array<Record<string, unknown>>): Promise<void> {
  const open = await session(udid);
  await appium('POST', `/session/${open.id}/actions`, {
    actions: [{
      type: 'pointer',
      id: 'finger1',
      parameters: { pointerType: 'touch' },
      actions: moves,
    }],
  }, 30_000);
}

export async function tap(udid: string, x: number, y: number): Promise<void> {
  await pointer(udid, [
    { type: 'pointerMove', duration: 0, x, y },
    { type: 'pointerDown', button: 0 },
    // Chạm 60ms: bấm rồi nhả ngay lập tức đôi khi không được nhận, còn giữ lâu
    // hơn thì thành bấm-giữ và mở ra menu ngữ cảnh.
    { type: 'pause', duration: 60 },
    { type: 'pointerUp', button: 0 },
  ]);
}

export async function swipe(
  udid: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
  durationMs = 200,
): Promise<void> {
  await pointer(udid, [
    { type: 'pointerMove', duration: 0, x: from.x, y: from.y },
    { type: 'pointerDown', button: 0 },
    { type: 'pointerMove', duration: Math.max(1, Math.round(durationMs)), x: to.x, y: to.y },
    { type: 'pointerUp', button: 0 },
  ]);
}

/**
 * Gõ chữ: `mobile: keys`, TỪNG KÝ TỰ MỘT.
 *
 * Không phải lựa chọn phong cách — đưa cả chuỗi vào thì Appium từ chối:
 * "Input key 'xin chao' is too long (8 characters)". Nó gõ vào phần tử đang có
 * con trỏ, nên không có ô nhập nào đang mở thì nó báo lỗi, và câu ấy đúng hơn
 * là im lặng nuốt chuỗi.
 *
 * `/wda/keys` và `/appium/device/press_button` KHÔNG còn tồn tại ở
 * xcuitest 12.5 — cả hai trả "unknown command". Mọi việc của thiết bị đi qua
 * `execute/sync` với một `mobile:` script.
 */
export async function typeText(udid: string, text: string): Promise<void> {
  if (text.length === 0) return;
  // Hạn chờ theo ĐỘ DÀI chuỗi: mỗi ký tự là một hành động XCUITest riêng, đo
  // được khoảng 2-3 giây/ký tự khi không có ô nhập nào đang mở. Một hạn cố
  // định 30 giây làm chuỗi mười ký tự đứt GIỮA CHỪNG — và đứt giữa chừng thì
  // trên màn hình còn lại một nửa chuỗi, tệ hơn là không gõ gì.
  await script(udid, 'mobile: keys', { keys: [...text] },
    Math.max(30_000, text.length * 4_000));
}

/**
 * Phím trên iOS: nút cứng qua WDA, phím bàn phím qua `keys`.
 *
 * iPhone không có nút Quay lại, nên danh sách ngắn hơn Android — xem
 * `CONTROL_KEYS_BY_PLATFORM` trong protocol. Và không có `power`: khoá màn
 * hình một chiếc máy ở phòng khác từ web là thứ không ai gỡ được từ xa.
 */
/**
 * Cử chỉ hệ thống của iOS, theo phần trăm màn hình (điểm, hướng hiện tại).
 *
 * Trên iPhone Face ID, Đa nhiệm / Thông báo / Trung tâm điều khiển không có
 * phím — chúng là cú vuốt bắt đầu SÁT MÉP màn hình. Bắt đầu cách mép vài điểm
 * là cuộn nội dung app, không phải cử chỉ hệ thống.
 */
const GESTURES: Record<'notifications' | 'quick_settings', {
  from: [number, number]; to: [number, number]; durationMs: number; holdMs: number;
}> = {
  // Nửa trái mép trên là Trung tâm thông báo, góc phải là Trung tâm điều khiển.
  notifications: { from: [0.3, 0.001], to: [0.3, 0.6], durationMs: 300, holdMs: 0 },
  quick_settings: { from: [0.92, 0.001], to: [0.92, 0.6], durationMs: 300, holdMs: 0 },
};

const HARDWARE: Record<'volume_up' | 'volume_down', string> = {
  volume_up: 'volumeUp',
  volume_down: 'volumeDown',
};

export async function pressKey(udid: string, key: string): Promise<void> {
  if (key === 'home') {
    await script(udid, 'mobile: pressButton', { name: 'home' });
    return;
  }
  if (key === 'volume_up' || key === 'volume_down') {
    await script(udid, 'mobile: pressButton', { name: HARDWARE[key] });
    return;
  }
  if (key === 'recents') {
    // Đa nhiệm: vuốt lên từ thanh Home rồi GIỮ. Làm bằng W3C actions thì iOS
    // BỎ QUA — đã thử ba kiểu (sát mép, cách mép 5 điểm, kéo chậm 1,2 giây,
    // giữ 1,5 giây) trên iPhone 12 Pro Max, iOS 26.6.1, và máy vẫn nằm yên
    // trong app. Bấm Home hai lần (cả qua pressButton lẫn sự kiện HID) thì chỉ
    // về màn hình chính. Chỉ đường kéo của CHÍNH XCTest — press, kéo có vận
    // tốc, rồi giữ — mới mở được màn đa nhiệm.
    const { screen } = await session(udid);
    await script(udid, 'mobile: dragFromToWithVelocity', {
      pressDuration: 0.1,
      holdDuration: 1.0,
      fromX: screen.width / 2,
      fromY: screen.height - 1,
      toX: screen.width / 2,
      toY: screen.height * 0.55,
      velocity: 400,
    });
    return;
  }
  if (key === 'notifications' || key === 'quick_settings') {
    const { screen } = await session(udid);
    const g = GESTURES[key];
    const at = ([fx, fy]: [number, number]) => ({
      x: Math.round(fx * (screen.width - 1)),
      y: Math.round(fy * (screen.height - 1)),
    });
    await pointer(udid, [
      { type: 'pointerMove', duration: 0, ...at(g.from) },
      { type: 'pointerDown', button: 0 },
      { type: 'pointerMove', duration: g.durationMs, ...at(g.to) },
      ...(g.holdMs > 0 ? [{ type: 'pause', duration: g.holdMs }] : []),
      { type: 'pointerUp', button: 0 },
    ]);
    return;
  }
  const value = KEY_CHARS[key];
  if (!value) throw new Error(`Phím "${key}" không dùng được trên iOS.`);
  await script(udid, 'mobile: keys', { keys: [value] });
}

/** Mã app iOS hợp lệ — thứ duy nhất được phép đi vào terminate/activate. */
const BUNDLE_ID = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

export async function rotate(udid: string, orientation: ControlOrientation): Promise<void> {
  const open = await session(udid);
  await appium('POST', `/session/${open.id}/orientation`,
    { orientation: orientation === 'landscape' ? 'LANDSCAPE' : 'PORTRAIT' }, 30_000);
  // Toạ độ chạm đi theo hướng HIỆN TẠI: đọc lại kích thước, không thì mọi cú
  // chạm sau khi xoay rơi sai chỗ. Luồng hình mở lại sẽ đọc đúng con số này.
  const rect = await appium<{ width: number; height: number }>(
    'GET', `/session/${open.id}/window/rect`, undefined, 30_000,
  );
  open.screen = { width: rect.width, height: rect.height, overridden: false };
}

export async function openUrl(udid: string, url: string): Promise<void> {
  // `mobile: deepLink` mở cả https (vào Safari) lẫn scheme riêng của app.
  await script(udid, 'mobile: deepLink', { url });
}

export async function appControl(udid: string, appId: string, op: ControlAppOp): Promise<void> {
  if (!BUNDLE_ID.test(appId)) throw new Error(`"${appId}" không phải bundle id iOS hợp lệ.`);
  await script(udid, 'mobile: terminateApp', { bundleId: appId });
  if (op === 'restart') await script(udid, 'mobile: activateApp', { bundleId: appId });
}

/** Ảnh PNG đúng độ phân giải của máy — không phải khung MJPEG đã thu nhỏ. */
export async function screenshot(udid: string): Promise<Buffer> {
  const open = await session(udid);
  const base64 = await appium<string>('GET', `/session/${open.id}/screenshot`, undefined, 30_000);
  return Buffer.from(base64, 'base64');
}

/**
 * Enter và Delete là hai KÝ TỰ, không phải hai tên phím.
 *
 * Dựng bằng `String.fromCharCode` chứ không viết thẳng: chúng nằm ở vùng dùng
 * riêng của Unicode, nên viết thẳng thì chúng VÔ HÌNH trong file — và một lần
 * sinh mã nhầm đã ghi đúng ký tự ấy vào nguồn thay vì chuỗi escape, làm mọi
 * phép tìm-thay sau đó không khớp mà không ai thấy vì sao.
 */
const KEY_CHARS: Record<string, string> = {
  enter: String.fromCharCode(0xe007),
  delete: String.fromCharCode(0xe003),
};

/**
 * iPhone thật đang cắm và dùng được — cùng luật với preflight
 * (`usableFromDevicectl`), để màn Điều khiển và phép kiểm trước khi chạy
 * không bao giờ nói khác nhau về cùng một chiếc máy.
 */
export async function connectedIphones(): Promise<Array<{ udid: string; label: string }>> {
  const { execFile } = await import('node:child_process');
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { usableFromDevicectl } = await import('../core/iosDevices.js');
  const dir = await mkdtemp(path.join(tmpdir(), 'tp-devicectl-'));
  const out = path.join(dir, 'devices.json');
  try {
    await new Promise<void>((resolve, reject) => {
      execFile('xcrun', ['devicectl', 'list', 'devices', '--json-output', out], { timeout: 20_000 },
        (err) => (err ? reject(err) : resolve()));
    });
    return usableFromDevicectl(JSON.parse(await readFile(out, 'utf8'))).map((device) => ({
      udid: device.udid,
      label: [device.name ?? 'iPhone', device.osVersion && `iOS ${device.osVersion}`]
        .filter(Boolean).join(' · '),
    }));
  } catch {
    return [];
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Simulator đang bật. Dùng cho danh sách chọn máy. */
export async function bootedSimulators(): Promise<Array<{ udid: string; label: string }>> {
  const { execFile } = await import('node:child_process');
  return new Promise((resolve) => {
    execFile('xcrun', ['simctl', 'list', 'devices', 'booted', '--json'], { timeout: 15_000 },
      (err, stdout) => {
        if (err) { resolve([]); return; }
        try {
          const parsed = JSON.parse(stdout) as {
            devices: Record<string, Array<{ udid: string; name: string; state: string }>>;
          };
          const out: Array<{ udid: string; label: string }> = [];
          for (const [runtime, list] of Object.entries(parsed.devices)) {
            const version = /iOS-([\d-]+)/.exec(runtime)?.[1]?.replace(/-/g, '.');
            for (const device of list) {
              if (device.state !== 'Booted') continue;
              out.push({
                udid: device.udid,
                label: [device.name, version && `iOS ${version}`, 'simulator']
                  .filter(Boolean).join(' · '),
              });
            }
          }
          resolve(out);
        } catch {
          resolve([]);
        }
      });
  });
}
