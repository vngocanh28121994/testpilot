/**
 * Đường iOS, đo trên một simulator THẬT đang chạy.
 *
 * Bài đơn ở [mjpeg.test.ts](./mjpeg.test.ts) đo phép cắt luồng và phép bỏ
 * khung trùng mà không cần máy nào. Bài này đo phần không giả được: phiên
 * WebDriverAgent có dựng lên không, MJPEG có chảy không, và một cú chạm có tới
 * màn hình không.
 *
 * Cần: một simulator đang bật và một Appium đang chạy ở cổng 4723. Không có
 * thì bài test nói ra và dừng — im lặng bỏ qua là cách để một đường hỏng nằm
 * yên vài tháng.
 *
 * `.integration` nên `npm test` bỏ qua. Chạy bằng `npm run test:integration`.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { get } from 'node:http';
import {
  bootedSimulators,
  pressKey,
  screenSize,
  startScreenStream,
  stopAllScreenStreams,
  tap,
  typeText,
} from '../iosControl.js';

let udid: string | undefined;

function appiumUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = get({ host: '127.0.0.1', port: 4723, path: '/status' }, (res) => {
      res.resume();
      resolve((res.statusCode ?? 500) < 400);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(3_000, () => { req.destroy(); resolve(false); });
  });
}

before(async () => {
  const simulators = await bootedSimulators();
  udid = simulators[0]?.udid;
  if (!udid) {
    throw new Error(
      'Không có simulator nào đang bật. Bật một cái rồi chạy lại: '
        + 'xcrun simctl boot "iPhone 17 Pro"',
    );
  }
  if (!await appiumUp()) {
    throw new Error('Appium chưa chạy ở cổng 4723. Bật ở màn Local Runner hoặc chạy `appium`.');
  }
});

after(() => stopAllScreenStreams());

describe('bootedSimulators', () => {
  it('nhãn đọc được, có tên máy và phiên bản iOS', async () => {
    const simulators = await bootedSimulators();
    assert.ok(simulators.length > 0);
    for (const simulator of simulators) {
      assert.match(simulator.udid, /^[0-9A-F-]{36}$/i);
      assert.match(simulator.label, /simulator/);
      assert.match(simulator.label, /iOS \d/);
    }
  });

  /** Máy không có thì trả mảng rỗng, không ném — danh sách chọn máy vẫn vẽ được. */
  it('không bao giờ ném', async () => {
    assert.ok(Array.isArray(await bootedSimulators()));
  });
});

describe('phiên WebDriverAgent', () => {
  /**
   * Kích thước là ĐIỂM, không phải pixel.
   *
   * `window/rect` cho 402x874 trong khi ảnh chụp là 1206x2622. W3C actions đi
   * theo điểm, nên nhầm sang pixel làm mọi cú chạm lệch đúng ba lần — và lệch
   * đều đặn thì trông như "ứng dụng hỏng" chứ không như "toạ độ sai".
   */
  it('đọc được kích thước màn hình theo điểm', async () => {
    const size = await screenSize(udid!);
    assert.ok(size.width > 200 && size.width < 1_400, `rộng ${size.width} không giống điểm`);
    assert.ok(size.height > size.width, 'điện thoại thì cao hơn rộng');
    assert.equal(size.overridden, false);
  });

  /** Phiên được giữ lại: dựng lần đầu mất 184 giây, lần sau 4 giây. */
  it('hỏi lần hai không dựng lại phiên', async () => {
    const started = Date.now();
    await screenSize(udid!);
    assert.ok(Date.now() - started < 3_000, 'lần hỏi thứ hai phải lấy từ phiên đã có');
  });
});

describe('luồng MJPEG', () => {
  it('ra ảnh JPEG trọn vẹn, và bỏ khung trùng', async () => {
    const frames: Buffer[] = [];
    let failure: string | undefined;
    const handle = await startScreenStream(udid!, {
      chunk: (data) => frames.push(data),
      restart: () => {},
      fail: (message) => { failure = message; },
    });

    await new Promise((resolve) => setTimeout(resolve, 5_000));
    handle.stop();

    assert.equal(failure, undefined, `luồng chết: ${failure}`);
    assert.ok(frames.length > 0, 'không có khung nào trong năm giây');
    for (const frame of frames) {
      assert.equal(frame[0], 0xff, 'khung phải mở bằng SOI của JPEG');
      assert.equal(frame[1], 0xd8);
      assert.equal(frame.at(-2), 0xff, 'và đóng bằng EOI — khung cụt chỉ vẽ ra nửa ảnh');
      assert.equal(frame.at(-1), 0xd9);
    }
    // Màn hình đứng yên cho 47 khung giống hệt nhau; phép bỏ trùng phải cắt
    // gần hết. Mốc rộng vì đồng hồ trên màn hình vẫn nhảy mỗi phút.
    assert.ok(frames.length < 20, `bỏ trùng không hoạt động: ${frames.length} khung trong 5 giây`);
  });

  it('người xem thứ hai nhận được khung mà không mở thêm kết nối', async () => {
    const a: Buffer[] = [];
    const b: Buffer[] = [];
    const first = await startScreenStream(udid!, {
      chunk: (d) => a.push(d), restart: () => {}, fail: () => {},
    });
    const second = await startScreenStream(udid!, {
      chunk: (d) => b.push(d), restart: () => {}, fail: () => {},
    });
    assert.deepEqual(second.frame, first.frame);

    // Một cú chạm để màn hình đổi, nếu không thì phép bỏ trùng giữ lại đúng
    // một khung và bài test đo nhầm sự im lặng.
    const size = await screenSize(udid!);
    await tap(udid!, Math.round(size.width / 2), Math.round(size.height / 2));
    await new Promise((resolve) => setTimeout(resolve, 4_000));

    first.stop();
    second.stop();
    assert.ok(a.length > 0 && b.length > 0, 'cả hai người xem đều phải nhận được khung');
  });
});

describe('đầu vào iOS', () => {
  it('chạm giữa màn hình không ném', async () => {
    const size = await screenSize(udid!);
    await tap(udid!, Math.round(size.width / 2), Math.round(size.height / 2));
  });

  it('bấm Home không ném', async () => {
    await pressKey(udid!, 'home');
  });

  /**
   * `mobile: keys` nhận TỪNG KÝ TỰ. Đưa cả chuỗi vào thì Appium từ chối:
   * "Input key 'xin chao' is too long (8 characters)".
   *
   * Chuỗi ngắn ở đây là chủ ý: mỗi ký tự là một hành động XCUITest riêng, đo
   * được 2-3 giây/ký tự khi không có ô nhập nào đang mở, nên một bài test gõ
   * tám ký tự chỉ đo được sự kiên nhẫn của người chạy test. Phần chuỗi dài đã
   * chạy thật qua giao diện, và hạn chờ của nó giãn theo độ dài.
   */
  it('gõ nhiều ký tự một lần không ném', async () => {
    await typeText(udid!, 'ab');
  });

  /** iPhone không có nút Quay lại, và câu từ chối phải nói ra điều đó. */
  it('phím của Android bị từ chối kèm lý do', async () => {
    await assert.rejects(() => pressKey(udid!, 'back'), /không dùng được trên iOS/);
    await assert.rejects(() => pressKey(udid!, 'recents'), /không dùng được trên iOS/);
    await assert.rejects(() => pressKey(udid!, 'power'), /không dùng được trên iOS/);
  });
});
