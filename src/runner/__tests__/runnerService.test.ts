/**
 * File dịch vụ nền của runner, và script đóng gói.
 *
 * Ba file này không có test tự nhiên nào — chúng chỉ chạy trên máy phòng lab,
 * và lúc ấy sai thì phát hiện bằng "job nằm chờ mãi mà không ai biết vì sao".
 * Nên phần được canh ở đây là những dòng mà XOÁ ĐI THÌ VẪN CHẠY, chỉ hỏng theo
 * cách khó chẩn đoán.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const plist = readFileSync('infra/runner/com.testpilot.runner.plist', 'utf8');
const service = readFileSync('infra/runner/testpilot-runner.service', 'utf8');
const bundle = readFileSync('scripts/bundle-runner.sh', 'utf8');

/** Bỏ chú thích trước khi đo — luật của dự án này, và nó có bốn vết sẹo. */
const code = (text: string, comment: RegExp): string => text.replace(comment, '');
const serviceCode = code(service, /^\s*#.*$/gm);
const bundleCode = code(bundle, /^\s*#.*$/gm);
const plistCode = plist.replace(/<!--[\s\S]*?-->/g, '');

describe('launchd (macOS)', () => {
  it('tự bật lại và tự chạy khi máy khởi động', () => {
    assert.match(plistCode, /<key>KeepAlive<\/key>\s*<true\/>/);
    assert.match(plistCode, /<key>RunAtLoad<\/key>\s*<true\/>/);
  });

  /**
   * `-lc` nạp hồ sơ đăng nhập. Thiếu nó thì `adb`, `node` và `xcrun` không có
   * trong PATH — runner vẫn chạy, chỉ là không thấy máy nào, và triệu chứng
   * là "mọi job Android nằm chờ" chứ không phải một lỗi.
   */
  it('chạy qua shell đăng nhập để có PATH của người dùng', () => {
    assert.match(plistCode, /-lc/);
  });

  it('ghi log ra file cố định', () => {
    assert.match(plistCode, /StandardOutPath/);
    assert.match(plistCode, /StandardErrorPath/);
  });

  /** LaunchAgent, không phải LaunchDaemon: thiết bị USB thuộc về phiên người dùng. */
  it('không chạy dưới quyền hệ thống', () => {
    assert.doesNotMatch(plistCode, /UserName|LaunchDaemons/);
  });
});

describe('systemd (Linux)', () => {
  it('chạy dưới người dùng thường, không phải root', () => {
    assert.match(serviceCode, /^User=(?!root$)\S+$/m);
  });

  /**
   * Token trong file unit là token mà mọi người trên máy đọc được: file unit
   * để 644, còn `EnvironmentFile` thì chmod 600 được.
   */
  it('token đi qua EnvironmentFile, không viết thẳng vào unit', () => {
    assert.match(serviceCode, /EnvironmentFile=/);
    assert.doesNotMatch(serviceCode, /Environment=TESTPILOT_RUNNER_TOKEN=/);
  });

  /**
   * Bật lại KHÔNG NGHỈ biến một runner hỏng cấu hình thành vòng lặp đốt CPU:
   * nó chết ngay lập tức, systemd bật lại ngay lập tức, mãi mãi.
   */
  it('bật lại có nghỉ giữa các lần', () => {
    assert.match(serviceCode, /Restart=always/);
    assert.match(serviceCode, /RestartSec=\d+/);
  });

  it('chờ có mạng rồi mới chạy', () => {
    assert.match(serviceCode, /After=.*network-online/);
  });
});

describe('scripts/bundle-runner.sh', () => {
  /** Một lần secret lọt vào gói là một lần nó nằm trên đĩa một máy khác. */
  it('không gói secret', () => {
    assert.match(bundleCode, /rm -f .*\.testpilot\.secrets\.json/);
    assert.match(bundleCode, /\.env/);
  });

  it('không gói phần web và không gói test', () => {
    assert.match(bundleCode, /rm -rf .*src\/ui/);
    assert.match(bundleCode, /__tests__/);
  });

  /**
   * `node_modules` phụ thuộc kiến trúc máy — `better-sqlite3` và driver của
   * Appium đều có phần nhị phân. Gói nó theo nghĩa là máy đích chạy một bản
   * build cho CPU khác, và lỗi hiện ra ở tận lúc nạp module.
   */
  it('không gói node_modules', () => {
    assert.doesNotMatch(bundleCode, /cp -R node_modules/);
    assert.match(bundleCode, /npm ci --omit=dev/);
  });

  it('dừng ngay khi có lệnh hỏng', () => {
    assert.match(bundleCode, /set -euo pipefail/);
  });
});
