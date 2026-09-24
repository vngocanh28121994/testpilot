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
import type { IosSigning } from '../protocol/control.js';

const APPIUM = { host: '127.0.0.1', port: Number(process.env.TESTPILOT_APPIUM_PORT ?? 4723) };
const MJPEG_PORT = Number(process.env.TESTPILOT_MJPEG_PORT ?? 9100);

/**
 * Tốc độ khung và tỉ lệ thu nhỏ của luồng MJPEG.
 *
 * 5 khung/giây cho một màn hình mà người ta đang đọc là đủ, và ở tỉ lệ 30% thì
 * một khung nặng 63 KB thay vì 135 KB. Cộng với phép bỏ trùng, một phiên xem
 * màn hình tĩnh gần như không tốn băng thông.
 */
const MJPEG_SETTINGS = {
  mjpegServerFramerate: 5,
  mjpegServerScreenshotQuality: 25,
  mjpegScalingFactor: 30,
};

interface Session {
  id: string;
  screen: ScreenSize;
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
    ...(signing.wdaLocalPort ? { 'appium:wdaLocalPort': signing.wdaLocalPort } : {}),
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

async function openSession(udid: string, signing?: IosSigning): Promise<Session> {
  const created = await appium<{ sessionId: string }>('POST', '/session', {
    capabilities: {
      alwaysMatch: {
        platformName: 'iOS',
        'appium:automationName': 'XCUITest',
        'appium:udid': udid,
        'appium:mjpegServerPort': MJPEG_PORT,
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
  if (/xcodebuild failed with code 70/i.test(message)) {
    return 'iPhone từ chối cài WebDriverAgent — thường là vì provisioning profile đã hết hạn '
      + '(Apple ID miễn phí chỉ cho 7 ngày). Dựng lại WDA một lần để Xcode cấp profile mới: '
      + 'tạm tắt ios.usePrebuiltWDA rồi mở lại, hoặc chạy `bash scripts/prepare-wda.sh`. '
      + `Nguyên văn: ${message}`;
  }
  if (/xcodebuild failed with code 65/i.test(message)) {
    return 'WebDriverAgent đã cài nhưng iPhone không cho mở — thường là chứng chỉ nhà phát '
      + 'triển chưa được tin cậy. Trên điện thoại: Cài đặt › Cài đặt chung › VPN & Quản lý '
      + 'thiết bị › chọn chứng chỉ › Tin cậy, mở khoá máy, rồi bấm Giữ máy lại. '
      + `Nguyên văn: ${message}`;
  }
  return message;
}

async function session(udid: string, signing?: IosSigning): Promise<Session> {
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
  return (await session(udid, signing)).screen;
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

  const open = await session(udid, signing);
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

  const req = get({ host: APPIUM.host, port: MJPEG_PORT, path: '/' }, (res) => {
    res.on('data', (chunk: Buffer) => {
      for (const frame of splitter.push(chunk)) {
        const fresh = deduper.keep(frame);
        if (!fresh) continue;
        for (const each of state.sinks) each.chunk(fresh);
      }
    });
    res.on('end', () => {
      if (state.stopped) return;
      for (const each of state.sinks) each.fail('Luồng MJPEG của WebDriverAgent đã đóng.');
      streams.delete(udid);
    });
  });
  req.on('error', (err) => {
    if (state.stopped) return;
    for (const each of state.sinks) {
      each.fail(`Không mở được luồng MJPEG ở cổng ${MJPEG_PORT}: ${err.message}`);
    }
    streams.delete(udid);
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
export async function pressKey(udid: string, key: string): Promise<void> {
  if (key === 'home') {
    await script(udid, 'mobile: pressButton', { name: 'home' });
    return;
  }
  const value = KEY_CHARS[key];
  if (!value) throw new Error(`Phím "${key}" không dùng được trên iOS.`);
  await script(udid, 'mobile: keys', { keys: [value] });
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
