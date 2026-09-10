/**
 * `observe()` trên iOS phải đọc được cây của iOS.
 *
 * Cây XCUITest là <XCUIElementTypeButton …>, cây UiAutomator là <node …>.
 * Bản cũ đưa cả hai qua đúng một parser của Android, nên trên iOS `observe()`
 * luôn trả về mảng RỖNG — không ném lỗi, không cảnh báo, chỉ đơn giản là không
 * thấy gì.
 *
 * Đó là kiểu hỏng đắt nhất: discovery đi tìm một element không còn locator nào
 * khớp, nhìn vào một màn hình đầy chữ, rồi kết luận màn hình trống và bỏ cuộc.
 * Đo trên cây thật lưu trong artifact ngày 2026-09-10: 0 thẻ <node>, 30 thẻ
 * XCUIElementType.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { parseIosXml } from '../../discovery/NativeObservationAdapter.js';
import { parseUiAutomatorXml } from '../native.js';

/** Nguyên văn rút gọn từ artifact của một lượt chạy thật. */
const IOS_TREE = `<?xml version="1.0" encoding="UTF-8"?>
<AppiumAUT>
  <XCUIElementTypeApplication type="XCUIElementTypeApplication" name="TCInvest" label="TCInvest">
    <XCUIElementTypeWebView type="XCUIElementTypeWebView" enabled="true" visible="true">
      <XCUIElementTypeButton type="XCUIElementTypeButton" name="ĐĂNG NHẬP" label="ĐĂNG NHẬP" enabled="true"/>
      <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" name="Mật khẩu" label="Mật khẩu"/>
    </XCUIElementTypeWebView>
  </XCUIElementTypeApplication>
</AppiumAUT>`;

describe('đọc cây native của iOS', () => {
  it('parser của Android không đọc được gì từ cây iOS', () => {
    assert.equal(parseUiAutomatorXml(IOS_TREE).length, 0);
  });

  it('parser của iOS thì đọc được', () => {
    const els = parseIosXml(IOS_TREE);
    assert.ok(els.length >= 3, `chỉ đọc được ${els.length} element`);
    const names = els.map((e) => e.accessibilityLabel ?? e.text ?? '');
    assert.ok(names.some((n) => n?.includes('ĐĂNG NHẬP')), JSON.stringify(names));
  });

  it('driver chọn parser theo nền tảng', () => {
    const source = readFileSync('src/drivers/native.ts', 'utf8');
    const fn = source.slice(source.indexOf('  async observe()'));
    const body = fn.slice(0, fn.indexOf('\n  async '));
    assert.match(body, /platform === 'ios'[\s\S]{0,120}parseIosXml\(xml\)/);
    assert.match(body, /return parseUiAutomatorXml\(xml\);/);
  });
});
