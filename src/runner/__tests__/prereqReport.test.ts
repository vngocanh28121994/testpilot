/**
 * Máy cá nhân thiếu môi trường: từ chối NGAY, và nói việc cần làm.
 *
 * Máy lab do người quản trị dựng một lần rồi để yên; laptop của một người thì
 * hôm nay có Xcode, tuần sau nâng cấp macOS và Appium mất driver. Nếu runner
 * cứ nhận job rồi hỏng ở phút thứ ba, người đặt job nhận một câu lỗi của
 * Appium — thứ không nói được rằng chiếc máy ở đầu kia thiếu gì.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { measurePrereq, refuseReason } from '../prereqReport.js';
import type { Runner } from '../index.js';

function fakeRunner(appiumRunning: boolean, xcode: { ok: boolean; reason?: string }): Runner {
  return {
    prereq: {
      appiumStatus: async () => ({ running: appiumRunning, managed: false }),
      xcode: async () => xcode,
    },
  } as unknown as Runner;
}

const AT = new Date('2026-09-23T10:00:00.000Z');

describe('measurePrereq', () => {
  it('web luôn chạy được: không cần thiết bị, không cần Appium', async () => {
    const report = await measurePrereq(fakeRunner(false, { ok: false }), AT);
    assert.equal(report.web?.ok, true);
  });

  it('Appium chưa chạy thì cả android lẫn ios đều chưa chạy được', async () => {
    const report = await measurePrereq(fakeRunner(false, { ok: true }), AT);

    assert.equal(report.android?.ok, false);
    assert.equal(report.ios?.ok, false);
    // Câu nói VIỆC CẦN LÀM, không chỉ nói cái thiếu.
    assert.match(report.android?.reason ?? '', /bấm khởi động Appium|chạy `appium`/);
  });

  it('Appium chạy nhưng Xcode hỏng thì chỉ iOS bị chặn', async () => {
    const report = await measurePrereq(
      fakeRunner(true, { ok: false, reason: 'Chưa cài driver xcuitest.' }), AT,
    );

    assert.equal(report.android?.ok, true);
    assert.equal(report.ios?.ok, false);
    assert.equal(report.ios?.reason, 'Chưa cài driver xcuitest.');
  });

  it('đủ cả thì cả ba nền tảng đều sẵn sàng', async () => {
    const report = await measurePrereq(fakeRunner(true, { ok: true }), AT);
    assert.deepEqual(
      Object.entries(report).map(([platform, value]) => [platform, value.ok]),
      [['web', true], ['android', true], ['ios', true]],
    );
  });

  /** Phép đo hỏng không được làm chết vòng lặp của worker. */
  it('lời gọi prereq ném thì coi như chưa chạy được, không vỡ', async () => {
    const broken = {
      prereq: {
        appiumStatus: async () => { throw new Error('adb chết'); },
        xcode: async () => ({ ok: true }),
      },
    } as unknown as Runner;

    const report = await measurePrereq(broken, AT);
    assert.equal(report.android?.ok, false);
  });
});

describe('refuseReason', () => {
  const ready = { web: { ok: true, at: '' }, android: { ok: true, at: '' } };

  it('sẵn sàng thì không từ chối', () => {
    assert.equal(refuseReason(ready, 'android'), undefined);
  });

  it('thiếu thì trả đúng câu của phép đo', () => {
    const missing = {
      ios: { ok: false, reason: 'Chưa cài driver xcuitest — chạy `appium driver install xcuitest`.', at: '' },
    };
    assert.match(refuseReason(missing, 'ios') ?? '', /appium driver install xcuitest/);
  });

  /**
   * Chưa đo bao giờ thì KHÔNG từ chối: thà chạy rồi hỏng còn hơn từ chối một
   * máy hoàn toàn tốt vì phép đo chưa kịp chạy lần đầu.
   */
  it('chưa đo thì cho chạy', () => {
    assert.equal(refuseReason({}, 'android'), undefined);
    assert.equal(refuseReason(ready, undefined), undefined);
  });
});
