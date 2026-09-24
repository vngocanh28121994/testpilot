/**
 * Đợt 1 các nút điều khiển: âm lượng, đa nhiệm, thông báo, xoay, mở URL,
 * mở lại / đóng app, chụp màn hình.
 *
 * Phần đáng kiểm nhất không phải "nút có chạy không" mà là "nút không làm được
 * gì ngoài việc của nó": mở URL trên một chiếc điện thoại dùng chung không được
 * trở thành cửa đọc tệp hay chạy lệnh trên máy.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkAction, checkUrl } from '../control.js';
import { parseScreenSize, shellQuote } from '../../runner/androidControl.js';

const SCREEN = { width: 1080, height: 2340 };

describe('checkUrl', () => {
  it('nhận https và deep link của app', () => {
    assert.deepEqual(checkUrl('https://tcinvest.tcbs.com.vn'), { ok: true, url: 'https://tcinvest.tcbs.com.vn' });
    assert.equal(checkUrl('tcinvest://home').ok, true);
  });

  it('chặn scheme đọc tệp hay chạy mã', () => {
    for (const url of ['javascript:alert(1)', 'file:///etc/hosts', 'data:text/html,x', 'content://sms/inbox']) {
      assert.equal(checkUrl(url).ok, false, url);
    }
  });

  it('chặn ký tự điều khiển — cách chèn thêm lệnh vào một dòng shell', () => {
    assert.equal(checkUrl('https://a.b/\nreboot').ok, false);
  });

  it('không phải URL: nói cách ghi đúng', () => {
    const r = checkUrl('tcinvest.tcbs.com.vn');
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.error : '', /https:\/\//);
  });
});

describe('checkAction — động tác mới', () => {
  it('xoay: chỉ dọc hoặc ngang', () => {
    assert.equal(checkAction({ kind: 'rotate', orientation: 'landscape' }, SCREEN).ok, true);
    assert.equal(checkAction({ kind: 'rotate', orientation: 'upside' }, SCREEN).ok, false);
  });

  it('app: chỉ restart/close, KHÔNG nhận tên app từ request', () => {
    const r = checkAction({ kind: 'app', op: 'restart', appId: 'com.evil' }, SCREEN);
    assert.deepEqual(r, { ok: true, action: { kind: 'app', op: 'restart' } });
    assert.equal(checkAction({ kind: 'app', op: 'uninstall' }, SCREEN).ok, false);
  });

  it('phím theo nền tảng: iPhone có đa nhiệm và âm lượng, không có Quay lại', () => {
    assert.equal(checkAction({ kind: 'key', key: 'recents' }, SCREEN, 'ios').ok, true);
    assert.equal(checkAction({ kind: 'key', key: 'volume_up' }, SCREEN, 'ios').ok, true);
    assert.equal(checkAction({ kind: 'key', key: 'back' }, SCREEN, 'ios').ok, false);
  });
});

describe('Android: shell và kích thước khi xoay', () => {
  it('shellQuote: dấu nháy và $(...) không thoát ra ngoài chuỗi', () => {
    assert.equal(shellQuote("a'b"), "'a'\\''b'");
    assert.equal(shellQuote('https://x/?q=$(reboot)'), "'https://x/?q=$(reboot)'");
  });

  it('màn hình nằm ngang: đổi chiều so với wm size', () => {
    const out = 'Physical size: 1080x2340\n    SurfaceOrientation: 1\n';
    assert.deepEqual(parseScreenSize(out), { width: 2340, height: 1080, overridden: false });
  });

  it('không in hướng (emulator cũ): giữ nguyên như wm size', () => {
    assert.deepEqual(parseScreenSize('Physical size: 1080x2340\n'), { width: 1080, height: 2340, overridden: false });
  });
});
