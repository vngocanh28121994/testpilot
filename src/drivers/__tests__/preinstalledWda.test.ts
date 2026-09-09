/**
 * Bỏ qua bước cài lại WebDriverAgent.
 *
 * Mỗi lượt chạy iOS, Appium build rồi cài lại WDA, và máy thật hỏi mật mã để
 * cho phép cài — người chạy phải gõ tay giữa chừng. `usePreinstalledWDA` bảo
 * Appium dùng bản đã nằm sẵn trên máy nên không còn bước cài nào để hỏi.
 *
 * Hai cờ ký số (`xcodeOrgId`, `allowProvisioningDeviceRegistration`) chỉ phục
 * vụ việc build. Gửi kèm khi đã bỏ build là mâu thuẫn, và Appium từng dựa vào
 * chúng để quyết định vẫn build — nên phép loại trừ dưới đây là điều kiện
 * đúng đắn của tính năng này, không phải chuyện dọn dẹp.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const native = readFileSync('src/drivers/native.ts', 'utf8');
const run = readFileSync('src/cli/run.ts', 'utf8');

describe('usePreinstalledWDA', () => {
  it('là một tuỳ chọn của driver', () => {
    assert.match(native, /usePreinstalledWDA\?: boolean;/);
  });

  it('gửi capability kèm bundle id của bản đã cài', () => {
    assert.match(
      native,
      /this\.opts\.usePreinstalledWDA && this\.opts\.wdaBundleId[\s\S]{0,200}'appium:usePreinstalledWDA': true,[\s\S]{0,120}'appium:updatedWDABundleId': this\.opts\.wdaBundleId,/,
    );
  });

  it('không gửi cờ ký số khi đã bỏ build', () => {
    assert.match(native, /!this\.opts\.usePreinstalledWDA && this\.opts\.teamId/);
    const signing = native.indexOf("'appium:xcodeOrgId'");
    assert.ok(signing > 0);
    const spread = native.lastIndexOf('...(', signing);
    assert.ok(
      native.slice(spread, signing).includes('!this.opts.usePreinstalledWDA'),
      'khối ký số phải nằm trong nhánh chỉ chạy khi không dùng WDA có sẵn',
    );
  });

  it('không bắt chờ 10 phút cho một bản build không tồn tại', () => {
    assert.match(
      native,
      /'appium:wdaLaunchTimeout': this\.opts\.usePreinstalledWDA \? 60_000 : 10 \* 60_000/,
    );
  });

  it('được truyền xuống từ config, trừ khi chạy trên Device Farm', () => {
    assert.match(run, /!onFarm && cfg\.ios\.usePreinstalledWDA \? \{ usePreinstalledWDA: true \}/);
  });

  it('nói rõ phải làm gì khi bản WDA có sẵn không mở cổng', () => {
    assert.match(run, /explainDriverStart\(err as Error, platform, cfg\.ios\.usePreinstalledWDA\)/);
    assert.match(run, /reusingWda && \/wda\|webdriveragent\|status\/i/);
    assert.match(run, /đặt ios\.usePreinstalledWDA = false/);
  });
});
