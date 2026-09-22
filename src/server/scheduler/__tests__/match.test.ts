/**
 * Ghép job với thiết bị — phần thuần, đo không cần một chiếc máy nào.
 *
 * Bài test quan trọng nhất ở đây là bài về DANH TÍNH: job và màn Điều khiển
 * phải khoá CÙNG một cái tên. Trước P3.3 chúng khoá hai cái khác nhau (`id`
 * của config và `udid` của adb), và không có lỗi nào hiện ra — job vẫn chạy,
 * chỉ là chạy đè lên tay người đang bấm.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigSchema } from '../../../config.js';
import { resolveDevices, runnerPlatforms, type AttachedDevice } from '../match.js';

/** Config thật của dự án này, rút gọn: id khác udid, đúng như đời thật. */
const cfg = ConfigSchema.parse({
  // `web` là trường bắt buộc duy nhất của config; phần còn lại có mặc định.
  web: { baseUrl: 'https://example.test' },
  android: {
    deviceName: 'Android Device',
    devices: [
      { id: 'sm-s918b', deviceName: 'SM_S918B', udid: 'R5CW525G35Y' },
      { id: 'sm-s938b', deviceName: 'SM_S938B', udid: 'R5CY21WADDY' },
    ],
  },
  ios: {
    deviceName: 'iPhone',
    devices: [{ id: 'iphone-12', deviceName: 'iPhone của Anh', udid: '00008101-0009' }],
  },
});

const oneAndroid = ConfigSchema.parse({
  web: { baseUrl: 'https://example.test' },
  android: { deviceName: 'Android Device' },
});

const attached = (...udids: string[]): AttachedDevice[] =>
  udids.map((udid) => ({ platform: udid.startsWith('0000') ? 'ios' : 'android', udid }));

describe('resolveDevices: danh tính thiết bị', () => {
  /**
   * Lõi của P3.3. `sm-s918b` là tên trong config; thứ phải giữ chỗ là
   * `R5CW525G35Y`, vì đó là cái tên mà `adb` và màn Điều khiển dùng.
   */
  it('mã thiết bị của config đổi thành udid', () => {
    const resolved = resolveDevices(
      { deviceTokens: ['android:sm-s918b'], run: { platform: 'android' } },
      cfg, attached('R5CW525G35Y'),
    );
    assert.deepEqual(resolved, { ok: true, udids: ['R5CW525G35Y'] });
  });

  it('nhiều máy thì ra nhiều udid, đúng thứ tự đã chọn', () => {
    const resolved = resolveDevices(
      { deviceTokens: ['android:sm-s938b', 'android:sm-s918b'], run: { platform: 'android' } },
      cfg, attached('R5CW525G35Y', 'R5CY21WADDY'),
    );
    assert.deepEqual(resolved, { ok: true, udids: ['R5CY21WADDY', 'R5CW525G35Y'] });
  });

  /** Máy cắm vào mà chưa khai trong config vẫn điều khiển được, nên job cũng phải hiểu. */
  it('udid trần cũng nhận, nếu máy ấy đang cắm', () => {
    const resolved = resolveDevices(
      { deviceTokens: ['android:emulator-5554'], run: { platform: 'android' } },
      cfg, attached('emulator-5554'),
    );
    assert.deepEqual(resolved, { ok: true, udids: ['emulator-5554'] });
  });

  /**
   * Một mã lạ là CHỜ, không phải hỏng — và đó là một lựa chọn, không phải sự
   * lười biếng.
   *
   * Danh sách chọn máy trên màn hình lấy từ máy đang cắm, nên một mã không có
   * trong config gần như luôn là chiếc máy vừa bị rút ra. Trường hợp kia — mã
   * gõ tay sai — nhìn từ đây giống hệt, nên câu trả lời phải nói ra cả hai để
   * người đọc biết đi kiểm cái tên.
   */
  it('tên lạ thì CHỜ, và câu trả lời nói cả khả năng gõ sai', () => {
    const resolved = resolveDevices(
      { deviceTokens: ['android:khong-ton-tai'], run: { platform: 'android' } },
      cfg, attached('R5CW525G35Y'),
    );
    assert.equal(resolved.ok, false);
    assert.equal(resolved.ok === false && resolved.wait, true);
    assert.match(resolved.ok === false ? resolved.reason : '', /không có trong config/);
  });

  it('mã thiết bị sai dạng thì hỏng, không đoán', () => {
    for (const token of ['sm-s918b', 'windows:abc', 'android:', '']) {
      const resolved = resolveDevices(
        { deviceTokens: [token], run: { platform: 'android' } }, cfg, attached('R5CW525G35Y'),
      );
      assert.equal(resolved.ok, false, token);
    }
  });
});

describe('resolveDevices: chờ hay hỏng', () => {
  /**
   * Máy chưa cắm là CHỜ, không phải hỏng. Đây là hành vi một phòng máy cần:
   * đặt job trước, cắm máy sau — và job tự chạy khi máy về.
   */
  it('máy khai trong config nhưng chưa cắm thì CHỜ', () => {
    const resolved = resolveDevices(
      { deviceTokens: ['android:sm-s918b'], run: { platform: 'android' } },
      cfg, attached('R5CY21WADDY'),
    );
    assert.equal(resolved.ok, false);
    assert.equal(resolved.ok === false && resolved.wait, true);
    assert.match(resolved.ok === false ? resolved.reason : '', /chưa cắm/);
    assert.match(resolved.ok === false ? resolved.reason : '', /R5CW525G35Y/, 'nói cả udid để đi tìm');
  });

  it('không nêu máy, config có hai máy → HỎNG kèm danh sách để chọn', () => {
    const resolved = resolveDevices(
      { deviceTokens: [], run: { platform: 'android' } }, cfg, attached('R5CW525G35Y'),
    );
    assert.equal(resolved.ok, false);
    assert.equal(resolved.ok === false && resolved.wait, false);
    assert.match(resolved.ok === false ? resolved.reason : '', /sm-s918b, sm-s938b/);
  });

  it('không nêu máy, config một máy có udid → giữ chỗ chính nó', () => {
    const one = ConfigSchema.parse({
      web: { baseUrl: 'https://example.test' },
      android: { deviceName: 'X', devices: [{ id: 'may', deviceName: 'X', udid: 'UD1' }] },
    });
    assert.deepEqual(
      resolveDevices({ deviceTokens: [], run: { platform: 'android' } }, one, attached('UD1')),
      { ok: true, udids: ['UD1'] },
    );
  });

  /**
   * Config một-máy không khai udid — mọi config chưa nâng cấp đều thế. Chiếc
   * máy thật là chiếc duy nhất đang cắm.
   */
  it('config không khai udid: lấy chiếc duy nhất đang cắm', () => {
    assert.deepEqual(
      resolveDevices({ deviceTokens: [], run: { platform: 'android' } }, oneAndroid,
        attached('emulator-5554')),
      { ok: true, udids: ['emulator-5554'] },
    );
  });

  /** Đoán sai là chạy nhầm điện thoại, và sai ấy chỉ lộ ra sau khi báo cáo đã được tin. */
  it('config không khai udid mà có hai máy đang cắm: KHÔNG đoán', () => {
    const resolved = resolveDevices(
      { deviceTokens: [], run: { platform: 'android' } }, oneAndroid,
      attached('emulator-5554', 'emulator-5556'),
    );
    assert.equal(resolved.ok, false);
    assert.equal(resolved.ok === false && resolved.wait, false);
    assert.match(resolved.ok === false ? resolved.reason : '', /2 máy android/);
  });

  it('không máy nào cắm thì CHỜ', () => {
    const resolved = resolveDevices(
      { deviceTokens: [], run: { platform: 'android' } }, oneAndroid, [],
    );
    assert.equal(resolved.ok === false && resolved.wait, true);
  });

  /** Web không cần thiết bị: không giữ chỗ gì, và đó không phải một thiếu sót. */
  it('web thì không cần máy nào', () => {
    assert.deepEqual(
      resolveDevices({ deviceTokens: [], run: { platform: 'web' } }, cfg, []),
      { ok: true, udids: [] },
    );
  });
});

describe('runnerPlatforms', () => {
  /**
   * Khai điều ĐO ĐƯỢC, không phải điều mong: job iOS rơi vào một máy không có
   * iPhone nào sẽ fail sau ba phút chờ WebDriverAgent, và đó là ba phút thiết
   * bị của cả đội bị giữ vô ích.
   */
  it('chỉ khai nền tảng có máy thật, cộng web', () => {
    assert.deepEqual(runnerPlatforms([]).sort(), ['web']);
    assert.deepEqual(runnerPlatforms(attached('emulator-5554')).sort(), ['android', 'web']);
    assert.deepEqual(
      runnerPlatforms(attached('emulator-5554', '00008101-0009')).sort(),
      ['android', 'ios', 'web'],
    );
  });
});
