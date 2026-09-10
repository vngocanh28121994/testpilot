/**
 * iOS không gỡ-cài lại app ở mỗi lượt nữa.
 *
 * Mặc định của XCUITest khi có capability `app` là gỡ app rồi cài lại ở MỖI
 * phiên. Đo trên máy người dùng ngày 2026-09-10, đọc từ log Appium:
 *
 *   App 'com.tcbs.digital.tcinvest' is already installed
 *   Reset requested. Removing app with id 'com.tcbs.digital.tcinvest'
 *   Installing '/Users/…/build/App.ipa' … (109 MB, ~20s)
 *
 * Không cấu hình nào yêu cầu chuyện đó — capabilities gửi lên không hề có
 * `fullReset` hay `enforceAppInstall`. Đó thuần tuý là mặc định của driver, và
 * nó kéo theo một lần iOS hỏi xác nhận cài app ký bằng chứng chỉ dev.
 *
 * Hai điều kiện dưới đây là thứ giữ cho `noReset` không đổi thành một lỗi khác:
 *  - lượt chạy CỐ Ý cài lại (--reinstall, đổi môi trường) phải thắng;
 *  - app hybrid phải tự xoá storage đầu mỗi kịch bản, vì không còn lần cài lại
 *    nào vô tình dọn hộ phiên đăng nhập nữa.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const native = readFileSync('src/drivers/native.ts', 'utf8');
const run = readFileSync('src/cli/run.ts', 'utf8');
const config = readFileSync('src/config.ts', 'utf8');

describe('ios.isolation', () => {
  it('có trong config, mặc định giữ app lại', () => {
    const ios = config.slice(config.indexOf('usePreinstalledWDA'));
    assert.match(ios.slice(0, 2000), /isolation: z\.enum\(\['restart', 'none'\]\)\.default\('restart'\)/);
  });

  it('được truyền xuống driver', () => {
    assert.match(run, /isolation: cfg\.ios\.isolation,/);
  });

  it('gửi noReset cho iOS', () => {
    assert.match(native, /!isAndroid && this\.opts\.isolation === 'restart'[\s\S]{0,120}'appium:noReset': true/);
  });

  it('nhường chỗ khi lượt chạy cố ý cài lại app', () => {
    assert.match(
      native,
      /!isAndroid && this\.opts\.isolation === 'restart' && !this\.opts\.enforceAppInstall/,
    );
  });

  it('xoá storage WebView đầu mỗi kịch bản để kịch bản không dính nhau', () => {
    const branch = native.slice(native.indexOf('bringing the app forward is'));
    assert.match(
      branch.slice(0, 1200),
      /this\.opts\.hybrid && this\.opts\.isolation === 'restart'[\s\S]{0,300}await this\.resetWebView\(\)/,
    );
  });
});
