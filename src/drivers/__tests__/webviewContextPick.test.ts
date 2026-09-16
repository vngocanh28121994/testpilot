/**
 * Chọn WebView nào để lái.
 *
 * Đo trên máy thật (SM-S938B, lượt chạy 10:20 ngày 16-09): Appium trả về
 *
 *   ["NATIVE_APP","WEBVIEW_chrome","WEBVIEW_com.fss.tcbs.mobiletrading"]
 *
 * và hàm này lấy cái WebView đầu tiên, tức Chrome — trình duyệt của chủ máy,
 * với mấy tab bóng đá còn mở. Chromedriver bám vào một tab trắng (`url: ""`),
 * mọi lệnh sau đó xếp hàng sau một lần "Waiting for pending navigations..."
 * không bao giờ xong, và chết sau 240s ở proxy timeout của Appium — rồi lệnh
 * tiếp theo lại chờ từ đầu.
 *
 * Cái giá không nằm ở chỗ chạy sai: nằm ở chỗ nó KHÔNG BÁO LỖI. Màn hình đứng
 * im 6 phút không một dòng log, và người chạy phải đi đọc log của chromedriver
 * mới biết chuyện gì. Một lượt chạy hỏng mà nói ra mình hỏng thì rẻ hơn nhiều.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pickWebviewContext } from '../native.js';

const APP = 'com.fss.tcbs.mobiletrading';

describe('pickWebviewContext', () => {
  it('lấy WebView của app, không lấy Chrome đứng trước nó', () => {
    const seen = ['NATIVE_APP', 'WEBVIEW_chrome', `WEBVIEW_${APP}`];
    assert.equal(pickWebviewContext(seen, APP), `WEBVIEW_${APP}`);
  });

  /** Appium gắn thêm pid khi WebView chạy nhiều tiến trình. */
  it('nhận cả tên có đuôi pid', () => {
    const seen = ['NATIVE_APP', 'WEBVIEW_chrome', `WEBVIEW_${APP}_13504`];
    assert.equal(pickWebviewContext(seen, APP), `WEBVIEW_${APP}_13504`);
  });

  /**
   * `enableWebviewDetailsCollection` tắt thì context giữ tên `WEBVIEW_<pid>`,
   * không mang package. Không so được package thì vẫn phải loại trình duyệt ra.
   */
  it('không có package để so thì vẫn tránh trình duyệt', () => {
    assert.equal(pickWebviewContext(['NATIVE_APP', 'WEBVIEW_chrome', 'WEBVIEW_13504'], APP), 'WEBVIEW_13504');
    assert.equal(pickWebviewContext(['NATIVE_APP', 'WEBVIEW_chrome', 'WEBVIEW_13504']), 'WEBVIEW_13504');
  });

  it('loại các trình duyệt khác, không riêng Chrome', () => {
    const browsers = [
      'WEBVIEW_com.android.chrome',
      'WEBVIEW_org.mozilla.firefox',
      'WEBVIEW_com.microsoft.emmx',
      'WEBVIEW_com.sec.android.app.sbrowser',
      'WEBVIEW_com.brave.browser',
      'WEBVIEW_com.opera.browser',
    ];
    for (const browser of browsers) {
      assert.equal(pickWebviewContext(['NATIVE_APP', browser, 'WEBVIEW_9001']), 'WEBVIEW_9001', browser);
    }
  });

  /**
   * Chỉ có mỗi trình duyệt thì thà không trả về gì: chỗ gọi sẽ chờ tiếp rồi ném
   * ra câu lỗi có liệt kê context nhìn thấy được. "Chỉ thấy WEBVIEW_chrome" là
   * một chẩn đoán; bám vào Chrome là 4 phút treo không tên.
   */
  it('chỉ thấy trình duyệt thì coi như không thấy gì', () => {
    assert.equal(pickWebviewContext(['NATIVE_APP', 'WEBVIEW_chrome'], APP), undefined);
    assert.equal(pickWebviewContext(['NATIVE_APP'], APP), undefined);
  });

  /** App đang test chính là trình duyệt: khớp package thì vẫn phải nhận. */
  it('khớp package thì nhận, kể cả khi đó là trình duyệt', () => {
    const seen = ['NATIVE_APP', 'WEBVIEW_com.android.chrome'];
    assert.equal(pickWebviewContext(seen, 'com.android.chrome'), 'WEBVIEW_com.android.chrome');
  });

  it('vẫn nhận context kiểu CHROMIUM', () => {
    assert.equal(pickWebviewContext(['NATIVE_APP', 'CHROMIUM'], APP), 'CHROMIUM');
  });
});
