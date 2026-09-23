/**
 * Đường video và đường chạm, đo trên một chiếc máy Android THẬT.
 *
 * Bài test đơn ở [controlGate.test.ts](../../routes/__tests__/controlGate.test.ts)
 * đo mọi đường TỪ CHỐI, và nó không cần thiết bị. Bài này đo đường đi được, và
 * nó là đường duy nhất không thể giả: `screenrecord` có chạy không, luồng ra
 * có phải H.264 hợp lệ không, và một cú chạm gửi qua HTTP có tới màn hình
 * không.
 *
 * `.integration` nên `npm test` bỏ qua: cần một emulator hoặc một máy đang
 * cắm. Chạy bằng `npm run test:integration`.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  frameSizeFor,
  parseScreenSize,
  pressKey,
  screenSize,
  startScreenStream,
  stopAllScreenStreams,
  tap,
  typeText,
} from '../androidControl.js';

/** Máy đầu tiên ở trạng thái `device`. Không có thì bài test nói ra và dừng. */
function firstDevice(): string | undefined {
  const out = spawnSync('adb', ['devices'], { encoding: 'utf8' }).stdout ?? '';
  for (const line of out.split('\n').slice(1)) {
    const [id = '', state = ''] = line.trim().split(/\s+/);
    if (id && state === 'device') return id;
  }
  return undefined;
}

const udid = firstDevice();

before(() => {
  if (!udid) {
    throw new Error(
      'Không có máy Android nào đang cắm. Bật emulator rồi chạy lại: '
        + '$ANDROID_HOME/emulator/emulator -avd <tên> -no-window',
    );
  }
});

after(() => stopAllScreenStreams());

describe('parseScreenSize', () => {
  it('lấy Override size khi có, vì `input tap` đi theo con số đó', () => {
    const both = parseScreenSize('Physical size: 1080x2400\nOverride size: 720x1600\n');
    assert.deepEqual(both, { width: 720, height: 1600, overridden: true });
  });

  it('không có Override thì lấy Physical', () => {
    assert.deepEqual(parseScreenSize('Physical size: 1080x2400\n'),
      { width: 1080, height: 2400, overridden: false });
  });

  it('không đọc được thì trả undefined, không đoán', () => {
    assert.equal(parseScreenSize('adb: device offline'), undefined);
  });
});

describe('frameSizeFor', () => {
  it('thu về 720 và giữ tỉ lệ', () => {
    assert.deepEqual(frameSizeFor({ width: 1080, height: 2400 }), { width: 720, height: 1600 });
  });

  /** Bộ mã hoá H.264 trên Android từ chối kích thước lẻ, và chết lúc khởi động. */
  it('mọi chiều đều chẵn', () => {
    for (const screen of [
      { width: 1080, height: 2401 }, { width: 1440, height: 3121 }, { width: 721, height: 1601 },
    ]) {
      const frame = frameSizeFor(screen);
      assert.equal(frame.width % 2, 0, JSON.stringify(screen));
      assert.equal(frame.height % 2, 0, JSON.stringify(screen));
    }
  });

  it('màn nhỏ hơn mức đích thì không phóng to', () => {
    assert.deepEqual(frameSizeFor({ width: 480, height: 800 }), { width: 480, height: 800 });
  });
});

describe('luồng video trên máy thật', () => {
  it('ra H.264 Annex-B, bắt đầu bằng SPS và PPS', async () => {
    const chunks: Buffer[] = [];
    let restarts = 0;
    let failure: string | undefined;
    const handle = await startScreenStream(udid!, {
      chunk: (data) => chunks.push(data),
      restart: () => { restarts += 1; },
      fail: (message) => { failure = message; },
    });

    await new Promise((resolve) => setTimeout(resolve, 5_000));
    handle.stop();

    assert.equal(failure, undefined, `luồng chết: ${failure}`);
    assert.equal(restarts, 0, 'năm giây thì chưa tới mốc 180 giây');
    assert.ok(chunks.length > 0, 'không có mảnh nào trong năm giây');

    const all = Buffer.concat(chunks);
    // Loại NAL nằm ở 5 bit thấp của byte sau mã bắt đầu 00 00 00 01.
    const kinds = new Set<number>();
    for (let i = 0; i + 4 < all.length; i += 1) {
      if (all[i] === 0 && all[i + 1] === 0 && all[i + 2] === 0 && all[i + 3] === 1) {
        kinds.add(all[i + 4]! & 0x1f);
      }
    }
    assert.ok(kinds.has(7), 'thiếu SPS — bộ giải mã phía trình duyệt sẽ không dựng được');
    assert.ok(kinds.has(8), 'thiếu PPS');
    assert.ok(kinds.has(5) || kinds.has(1), 'không có khung hình nào');
    // Băng thông đo được ngày 22/09/2026 trên emulator API 36: khoảng 6 KB/s.
    // Mốc này rộng gấp nhiều lần, chỉ để bắt trường hợp luồng phình ra vì một
    // lần đổi tham số — ví dụ quên mất `--size`.
    assert.ok(all.length < 5 * 1024 * 1024, `năm giây ra ${all.length} byte, quá lớn`);
  });

  /**
   * Nhiều người xem dùng CHUNG một tiến trình.
   *
   * Hai `screenrecord` trên một máy là hai bộ mã hoá tranh nhau, và kết quả là
   * cả hai giật. Một người mở hai tab là đủ để gặp chuyện đó.
   */
  it('hai người xem chung một tiến trình, và tắt khi người cuối rời đi', async () => {
    // Đo bằng SỐ TIẾN TRÌNH, không bằng "có khung mới chảy về".
    //
    // Bản đầu của bài này khẳng định người xem còn lại vẫn nhận thêm khung
    // trong 1,5 giây sau khi người kia rời đi, và nó đỏ một cách hợp lý:
    // `screenrecord` chỉ sinh dữ liệu khi màn hình ĐỔI, mà launcher đứng yên
    // thì vài giây không có gì. Khẳng định ấy đo tốc độ khung của Android chứ
    // không đo điều nó muốn nói.
    // `pgrep -f` in ra PID, mỗi dòng một cái. Bản đầu dùng `-fa` để in cả dòng
    // lệnh rồi lọc theo chữ "screenrecord" — `-a` không phải cờ của pgrep trên
    // macOS, nên nó in PID trần và phép lọc ra 0 mãi mãi.
    //
    // Đếm CẢ HAI đường bắt hình: hôm nay scrcpy đi trước và `screenrecord` là
    // đường lui, nên đếm mỗi một cái tên là ra 0 và bài này xanh vì đo nhầm
    // thứ. Điều cần giữ không đổi theo đường nào đang chạy: một chiếc máy,
    // một tiến trình bắt hình.
    const running = (): number => [
      'screenrecord', 'com.genymobile.scrcpy.Server',
    ].reduce((total, pattern) => {
      const out = spawnSync('pgrep', ['-f', pattern], { encoding: 'utf8' }).stdout ?? '';
      return total + out.split('\n').filter((line) => line.trim().length > 0).length;
    }, 0);
    const before = running();

    const a: Buffer[] = [];
    const b: Buffer[] = [];
    let failed: string | undefined;
    const sinkA = { chunk: (d: Buffer) => a.push(d), restart: () => {}, fail: (m: string) => { failed = m; } };
    const sinkB = { chunk: (d: Buffer) => b.push(d), restart: () => {}, fail: (m: string) => { failed = m; } };

    const first = await startScreenStream(udid!, sinkA);
    const second = await startScreenStream(udid!, sinkB);
    assert.deepEqual(second.frame, first.frame, 'hai người xem phải thấy cùng một khung');

    await new Promise((resolve) => setTimeout(resolve, 3_000));
    assert.equal(failed, undefined);
    assert.ok(a.length > 0 && b.length > 0, 'cả hai người xem đều phải nhận được khung');
    assert.equal(running(), before + 1, 'hai người xem chỉ được sinh MỘT tiến trình');

    first.stop();
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(running(), before + 1, 'người xem còn lại vẫn cần tiến trình ấy');
    assert.equal(failed, undefined, 'người rời đi không được làm hỏng luồng của người còn lại');

    second.stop();
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    assert.equal(running(), before, 'người cuối rời đi thì tiến trình phải tắt');
  });
});

describe('đầu vào trên máy thật', () => {
  it('bấm Home thì về launcher', async () => {
    await pressKey(udid!, 'home');
    const size = await screenSize(udid!);
    assert.ok(size.width > 0 && size.height > 0);
  });

  it('chạm giữa màn hình không ném', async () => {
    const size = await screenSize(udid!);
    await tap(udid!, Math.round(size.width / 2), Math.round(size.height / 2));
  });

  it('gõ chuỗi có dấu cách không ném', async () => {
    await typeText(udid!, 'xin chao testpilot');
  });

  it('phím ngoài danh sách bị từ chối TRƯỚC khi tới adb', async () => {
    await assert.rejects(() => pressKey(udid!, 'power'), /danh sách cho phép/);
    await assert.rejects(() => pressKey(udid!, 'KEYCODE_POWER'), /danh sách cho phép/);
  });

  it('toạ độ không phải số nguyên bị từ chối', async () => {
    await assert.rejects(() => tap(udid!, 10.5, 10), /số nguyên/);
    await assert.rejects(() => tap(udid!, -1, 10), /số nguyên/);
  });
});
