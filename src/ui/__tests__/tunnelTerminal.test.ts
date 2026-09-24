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

/**
 * Hai file từ P1 (2026-09-21): hàm sang `src/runner/` vì nó `spawn` trên máy
 * đang chạy, route ở lại phía server. Ràng buộc bên dưới không đổi — chỉ đổi
 * chỗ đọc.
 */
const runner = readFileSync('src/runner/prereq.ts', 'utf8');
const routes = readFileSync('src/server/routes/prereq.ts', 'utf8');
/** Thân MỘT hàm: từ khai báo tới khai báo `export` kế tiếp. */
function body(name: string): string {
  const start = runner.indexOf(`export async function ${name}`);
  const next = runner.indexOf('\nexport ', start + 1);
  return runner.slice(start, next < 0 ? undefined : next);
}
const handler = body('openTunnelTerminal');
const fixTunnel = body('fixTunnel');

describe('mở Terminal để dựng tunnel', () => {
  it('có endpoint riêng, không nằm trong nhóm SSE', () => {
    assert.match(routes, /'POST \/api\/prereq\/ios-tunnel': async/);
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

  /**
   * Khởi động lại DỊCH VỤ tunnel (máy chủ, nơi không ai ngồi gõ mật khẩu):
   * `sudo -n` — không bao giờ hỏi mật khẩu, chỉ chạy được nhờ quy tắc sudoers
   * cho đúng một lệnh. Câu lỗi được phép NHẮC tới mật khẩu (để nói việc cần
   * làm), nhưng không có đường nào đưa mật khẩu vào.
   */
  it('khởi động lại dịch vụ tunnel bằng sudo -n, không đưa mật khẩu vào đâu', () => {
    assert.ok(fixTunnel.length > 0, 'không tìm thấy fixTunnel');
    assert.match(fixTunnel, /'sudo',\s*\[\s*'-n', '\/bin\/launchctl', 'kickstart', '-k'/);
    assert.doesNotMatch(fixTunnel, /sudo -S|'-S'|stdin|readJson|req\./);
  });
});
