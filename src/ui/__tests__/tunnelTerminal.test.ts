/**
 * Nút "Bật tunnel" mở Terminal, không cầm mật khẩu.
 *
 * Cách hiển nhiên hơn là hỏi mật khẩu máy trên giao diện rồi đẩy vào stdin của
 * `sudo`. Nó bị bỏ có chủ đích, và chủ đích đó phải sống lâu hơn trí nhớ của
 * người viết: mật khẩu sẽ đi qua trình duyệt, qua HTTP, rồi qua chính tiến
 * trình này — nơi ActiveRun giữ 8.000 dòng log và ghi dần xuống log.txt — trên
 * một server không có xác thực nào cả.
 *
 * Đoạn AppleScript cũng phải ghép từ hằng số, không từ dữ liệu người dùng gửi
 * lên: một chuỗi lọt vào `do script` là một lệnh chạy bằng quyền của người đang
 * đăng nhập.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const server = readFileSync('src/ui/server.ts', 'utf8');
const handler = server.slice(server.indexOf('async function openTunnelTerminal'), server.indexOf('async function iosDeviceNames'));

describe('mở Terminal để dựng tunnel', () => {
  it('có endpoint riêng, không nằm trong nhóm SSE', () => {
    assert.match(server, /case 'POST \/api\/prereq\/ios-tunnel':/);
  });

  it('chạy qua osascript và chỉ trên macOS', () => {
    assert.match(handler, /process\.platform !== 'darwin'/);
    assert.match(handler, /execFileAsync\('osascript', \['-e', script\]/);
  });

  it('lệnh ghép từ hằng số, không từ thân request', () => {
    assert.match(handler, /do script \$\{JSON\.stringify\(IOS_TUNNEL_COMMAND\)\}/);
    assert.doesNotMatch(handler, /readJson|req\.|body/);
  });

  it('không nhận mật khẩu dưới bất kỳ dạng nào', () => {
    assert.doesNotMatch(handler, /password|mật khẩu|sudo -S|stdin/i);
  });
});
