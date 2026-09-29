/**
 * Chứng chỉ chưa tin cậy: kiểu hỏng iOS mà tool phải nói ra trước khi chạy.
 *
 * Khi iOS từ chối mở WebDriverAgent vì chứng chỉ nhà phát triển chưa được tin
 * cậy, Appium không nói ra điều đó — nó chờ hết giờ rồi báo một lỗi phiên chung
 * chung, sau vài phút. Người dùng nhìn vào thấy "tool hỏng", trong khi thứ cần
 * làm là ba lần chạm trên chính chiếc điện thoại đang cắm.
 *
 * Các chuỗi dưới đây là câu trả lời thật của devicectl, không phải bảng tự nghĩ.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { iosWdaCheck, tryRun, wdaCheckUdid } from '../preflight.js';
import type { TestPilotConfig } from '../../config.js';

const cfg = { ios: { wdaBundleId: 'com.tuoiha17.WebDriverAgentRunner' } } as TestPilotConfig;
const BUNDLE = 'com.tuoiha17.WebDriverAgentRunner.xctrunner';

/** Dựng một devicectl giả: khớp theo tên lệnh con, trả đúng dạng chuỗi thật. */
function fakeRun(replies: { apps?: string; processes?: string; launch?: { ok: boolean; out: string } }) {
  return async (_file: string, args: string[]) => {
    if (args.includes('apps')) return { ok: true, stdout: replies.apps ?? '' };
    if (args.includes('processes')) return { ok: true, stdout: replies.processes ?? '' };
    const launch = replies.launch ?? { ok: false, out: '' };
    return launch.ok
      ? { ok: true, stdout: launch.out }
      : { ok: false, stdout: '', error: launch.out };
  };
}

describe('iosWdaCheck', () => {
  /**
   * iPhone mới + WDA cài sẵn: Appium không cài gì, nên thiếu WDA là lượt chạy
   * hỏng ngay ("… is not installed"). Trước đây dòng này báo xanh.
   */
  it('dùng WDA cài sẵn mà máy chưa có thì đỏ, kèm nút cài', async () => {
    const preinstalled = { ios: { ...cfg.ios, usePreinstalledWDA: true } } as TestPilotConfig;
    const check = await iosWdaCheck(preinstalled, 'UDID', fakeRun({ apps: '{"apps":[]}' }), async () => undefined);
    assert.equal(check.ok, false);
    assert.equal(check.fix, 'ios-wda');
  });

  it('bản WDA dựng sẵn chưa ký cho máy này thì đỏ, kèm nút cài', async () => {
    const prebuilt = {
      ios: { ...cfg.ios, usePrebuiltWDA: true, derivedDataPath: '/dd' },
    } as TestPilotConfig;
    const run = async (file: string, args: string[]) => {
      if (file === 'security') return { ok: true, stdout: '<string>MAY-CU</string>' };
      return fakeRun({ apps: BUNDLE })(file, args);
    };
    const check = await iosWdaCheck(prebuilt, 'MAY-MOI', run, async () => undefined);
    assert.equal(check.ok, false);
    assert.equal(check.fix, 'ios-wda');
  });

  it('chưa cài thì không báo đỏ: lượt chạy đầu tiên vốn tự cài', async () => {
    const check = await iosWdaCheck(cfg, 'UDID', fakeRun({ apps: '{"apps":[]}' }), async () => undefined);
    assert.equal(check.ok, true);
    assert.match(check.detail, /Lượt chạy đầu tiên/);
  });

  /**
   * Không được tắt WDA đang chạy.
   *
   * Màn hình điều kiện dò lại định kỳ, kể cả trong lúc một lượt chạy đang diễn
   * ra. Mở lại WDA lúc đó là giết đúng phiên đang chạy — phần kiểm tra tự làm
   * hỏng thứ nó đi kiểm tra.
   */
  it('đang chạy thì để yên, không mở lại', async () => {
    let launched = false;
    const run = async (_f: string, args: string[]) => {
      if (args.includes('apps')) return { ok: true, stdout: BUNDLE };
      if (args.includes('processes')) {
        return { ok: true, stdout: '3826   /private/var/.../WebDriverAgentRunner-Runner.app/WebDriverAgentRunner-Runner' };
      }
      launched = true;
      return { ok: true, stdout: 'Launched application' };
    };
    const check = await iosWdaCheck(cfg, 'UDID', run, async () => undefined);
    assert.equal(check.ok, true);
    assert.equal(launched, false, 'không được mở lại WDA đang chạy');
  });

  it('mở được thì xanh', async () => {
    const check = await iosWdaCheck(
      cfg,
      'UDID',
      fakeRun({ apps: BUNDLE, launch: { ok: true, out: 'Launched application with com.tuoiha17… bundle identifier.' } }),
      async () => undefined,
    );
    assert.equal(check.ok, true);
  });

  /**
   * Nguyên văn lỗi khi chứng chỉ chưa được tin cậy, từ devicectl:
   * "The operation couldn't be completed. Unable to launch … because it has an
   *  invalid code signature, inadequate entitlements or its profile has not
   *  been explicitly trusted by the user. (Security)"
   */
  it('bị từ chối vì chứng chỉ thì chỉ đúng chỗ bấm, kèm nút chữa', async () => {
    const check = await iosWdaCheck(
      cfg,
      'UDID',
      fakeRun({
        apps: BUNDLE,
        launch: {
          ok: false,
          out: 'Unable to launch because it has an invalid code signature, inadequate entitlements '
            + 'or its profile has not been explicitly trusted by the user. (Security)',
        },
      }),
      async () => 'TCBS',
    );
    assert.equal(check.ok, false);
    assert.equal(check.fix, 'ios-trust');
    assert.match(check.detail, /VPN & Quản lý thiết bị › TCBS/);
    assert.match(check.detail, /Tắt VPN/);
  });

  it('hỏng vì lý do khác thì không gợi ý đi tin cậy chứng chỉ', async () => {
    const check = await iosWdaCheck(
      cfg,
      'UDID',
      fakeRun({ apps: BUNDLE, launch: { ok: false, out: 'The device is locked.' } }),
      async () => 'TCBS',
    );
    assert.equal(check.ok, false);
    assert.equal(check.fix, undefined);
    assert.match(check.detail, /device is locked/);
  });
});

/**
 * Lệnh hỏng phải giữ lại phần nó đã in ra.
 *
 * Đây là chỗ đã hỏng thật khi chạy thử trên máy: `devicectl` viết lý do vào
 * stderr — "profile has not been explicitly trusted by the user. (Security)" —
 * còn dòng đầu của Error chỉ là "Command failed: xcrun …". tryRun vứt stderr
 * đi, nên phần kiểm tra không nhận ra kiểu hỏng mà nó sinh ra để bắt, và dán
 * nguyên dòng lệnh vào mặt người dùng thay cho câu trả lời.
 */
describe('tryRun', () => {
  it('giữ lại stderr của lệnh hỏng, không chỉ dòng "Command failed"', async () => {
    const result = await tryRun('sh', ['-c', 'echo "profile has not been explicitly trusted (Security)" >&2; exit 1']);
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /explicitly trusted \(Security\)/);
  });

  it('giữ lại cả stdout của lệnh hỏng', async () => {
    const result = await tryRun('sh', ['-c', 'echo đã-in-ra; exit 3']);
    assert.match(result.stdout, /đã-in-ra/);
  });
});

/**
 * Lỗi thật: cắm iPhone 16 mới, chọn nó, dòng WebDriverAgent vẫn hỏi iPhone 12
 * (máy đầu tiên trong cấu hình, đã rút ra) — nên báo "chưa cài" mãi, kể cả sau
 * khi nút cài đã cài xong lên chiếc iPhone 16.
 */
describe('dòng WebDriverAgent hỏi đúng máy', () => {
  const two = {
    ios: {
      devices: [
        { id: 'iphone-12', deviceName: 'iPhone 12', udid: 'UDID-12' },
        { id: 'iphone-16', deviceName: 'iPhone 16', udid: 'UDID-16' },
      ],
    },
  } as unknown as TestPilotConfig;

  it('máy đang chọn, không phải máy đầu danh sách', () => {
    assert.equal(wdaCheckUdid(two, 'iphone-16'), 'UDID-16');
  });

  it('chưa chọn máy nào thì mới lấy máy đầu tiên', () => {
    assert.equal(wdaCheckUdid(two, undefined), 'UDID-12');
  });

  it('không hỏi được máy thì không kết luận "chưa cài"', async () => {
    const preinstalled = { ios: { ...cfg.ios, usePreinstalledWDA: true } } as TestPilotConfig;
    const failing = async () => ({ ok: false, stdout: '', error: 'ERROR: The device is not connected.' });
    const check = await iosWdaCheck(preinstalled, 'UDID', failing, async () => undefined);
    assert.equal(check.ok, true);
    assert.equal(check.fix, undefined);
    assert.doesNotMatch(check.detail, /Chưa cài/);
  });
});
