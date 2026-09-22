/**
 * Token của runner: lấy ở đâu, và cất ở đâu.
 *
 * Hôm qua nó chỉ đến từ biến môi trường, và điều đó đủ cho một dịch vụ nền:
 * systemd đọc từ `EnvironmentFile` chmod 600, và file ấy do người quản trị
 * đặt. Nó KHÔNG đủ cho laptop của một người — ở đó "biến môi trường" nghĩa là
 * một dòng `export` trong `~/.zshrc`, tức là một bí mật nằm trong một file
 * được backup, được đồng bộ lên đám mây, và được mở ra mỗi lần ai đó chia sẻ
 * màn hình.
 *
 * Nên trên máy cá nhân, token đi vào keychain của hệ điều hành: nơi nó được mã
 * hoá khi máy khoá, và nơi người dùng thấy được rằng nó tồn tại.
 *
 * **Biến môi trường vẫn THẮNG.** Không phải vì nó an toàn hơn mà vì máy chủ
 * không có keychain nào để mở: một container chạy runner không có phiên đăng
 * nhập, và `security` ở đó hoặc không tồn tại hoặc treo chờ mật khẩu. Thứ tự
 * này làm cho cùng một bản mã chạy được ở cả hai chỗ.
 */
import { spawn } from 'node:child_process';

/** Tên "dịch vụ" trong keychain. Một hằng, vì `login` ghi và runner đọc. */
export const KEYCHAIN_SERVICE = 'testpilot-runner';

export interface KeychainIo {
  /** Chạy một lệnh, trả về mã thoát và stdout. Tiêm được để test. */
  run(command: string, args: string[], input?: string): Promise<{ code: number; stdout: string }>;
  platform: NodeJS.Platform;
}

const realIo: KeychainIo = {
  platform: process.platform,
  run(command, args, input) {
    return new Promise((resolve) => {
      const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'ignore'] });
      let stdout = '';
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.on('error', () => resolve({ code: -1, stdout: '' }));
      child.on('close', (code) => resolve({ code: code ?? -1, stdout }));
      if (input !== undefined) child.stdin.end(input);
      else child.stdin.end();
    });
  },
};

/**
 * Token để nối tới server này.
 *
 * Thứ tự: biến môi trường trước, keychain sau. Xem chú thích đầu file — đây
 * không phải chuyện cái nào an toàn hơn, mà là chuyện cái nào TỒN TẠI ở nơi
 * runner đang chạy.
 */
export async function readToken(
  serverUrl: string,
  env: NodeJS.ProcessEnv = process.env,
  io: KeychainIo = realIo,
): Promise<string | undefined> {
  const fromEnv = env.TESTPILOT_RUNNER_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  return keychainGet(serverUrl, io);
}

export async function saveToken(
  serverUrl: string,
  token: string,
  io: KeychainIo = realIo,
): Promise<{ ok: boolean; message: string }> {
  if (io.platform !== 'darwin') {
    return {
      ok: false,
      message: 'Keychain chỉ hỗ trợ macOS. Trên Linux hãy đặt TESTPILOT_RUNNER_TOKEN '
        + 'trong file môi trường của dịch vụ (chmod 600) — xem packaging/README.md.',
    };
  }
  // `-U` để ghi đè mục đã có: đổi token là việc thường (rotate), và bắt người
  // dùng tự đi xoá mục cũ là cách chắc chắn để họ có hai mục và dùng nhầm.
  //
  // Token truyền qua ARGV ở đây, và đó là một đánh đổi có thật: `ps` trong
  // khoảnh khắc ấy nhìn thấy nó. `security` không nhận mật khẩu qua stdin, nên
  // hai lựa chọn là thế này hoặc không có keychain. Khoảnh khắc ấy ngắn và chỉ
  // xảy ra một lần lúc đăng nhập; token nằm trong `~/.zshrc` thì nhìn thấy mãi.
  const { code } = await io.run('security', [
    'add-generic-password', '-U',
    '-s', KEYCHAIN_SERVICE,
    '-a', account(serverUrl),
    '-w', token,
    '-D', 'TestPilot runner token',
  ]);
  return code === 0
    ? { ok: true, message: `Đã cất token vào keychain cho ${serverUrl}.` }
    : { ok: false, message: `Không ghi được vào keychain (mã ${code}).` };
}

export async function clearToken(
  serverUrl: string,
  io: KeychainIo = realIo,
): Promise<boolean> {
  if (io.platform !== 'darwin') return false;
  const { code } = await io.run('security', [
    'delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account(serverUrl),
  ]);
  return code === 0;
}

async function keychainGet(serverUrl: string, io: KeychainIo): Promise<string | undefined> {
  if (io.platform !== 'darwin') return undefined;
  const { code, stdout } = await io.run('security', [
    'find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account(serverUrl), '-w',
  ]);
  if (code !== 0) return undefined;
  return stdout.trim() || undefined;
}

/**
 * Một token cho mỗi server, không phải một token cho cả máy.
 *
 * Một người có thể nối máy mình vào bản staging và bản production, và hai bản
 * ấy cấp hai token khác nhau. Một mục duy nhất nghĩa là đăng nhập vào cái thứ
 * hai làm chết cái thứ nhất — và triệu chứng là 401 ở một chỗ mà người dùng
 * không hề đụng tới.
 */
function account(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, '');
}
