/**
 * `testpilot-runner login` — cất token vào keychain thay vì vào `~/.zshrc`.
 *
 *   npm run runner:login -- --server https://testpilot.example.com --token abc…
 *   npm run runner:login -- --server https://testpilot.example.com --forget
 *
 * Vì sao cần một lệnh riêng: token hiện ĐÚNG MỘT LẦN lúc tạo máy, và chỗ người
 * ta dán nó vào quyết định nó sống ở đâu suốt phần đời còn lại. Không có lệnh
 * này thì chỗ ấy là một dòng `export` trong `~/.zshrc` — một bí mật nằm trong
 * một file được backup, được đồng bộ lên đám mây, và được mở ra mỗi lần ai đó
 * chia sẻ màn hình.
 */
import { clearToken, readToken, saveToken } from '../runner/credentials.js';

function arg(argv: string[], name: string): string | undefined {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 ? argv[at + 1] : undefined;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const server = (arg(argv, 'server') ?? process.env.TESTPILOT_SERVER ?? '').trim();
  if (!server) {
    throw new Error('Cần --server (hoặc TESTPILOT_SERVER): token được cất riêng cho từng server.');
  }

  if (argv.includes('--forget')) {
    const gone = await clearToken(server);
    console.log(gone
      ? `[login] Đã xoá token của ${server} khỏi keychain.`
      : `[login] Không có token nào của ${server} trong keychain.`);
    return;
  }

  if (argv.includes('--show')) {
    // KHÔNG in token ra. Câu hỏi thật là "máy này đã đăng nhập chưa", và in
    // token ra để trả lời câu ấy là đặt nó vào lịch sử shell — đúng chỗ ta vừa
    // lôi nó ra khỏi.
    const token = await readToken(server, {});
    console.log(token ? `[login] Đã có token cho ${server}.` : `[login] Chưa đăng nhập ${server}.`);
    return;
  }

  const token = arg(argv, 'token')?.trim();
  if (!token) {
    throw new Error(
      'Cần --token. Token hiện đúng một lần lúc tạo máy ở màn Personal Settings; '
      + 'mất thì tạo cái mới (rotate), không có đường đọc lại.',
    );
  }

  const saved = await saveToken(server, token);
  console.log(`[login] ${saved.message}`);
  if (!saved.ok) process.exit(1);
  console.log('[login] Từ giờ chạy `testpilot-runner` mà không cần đặt TESTPILOT_RUNNER_TOKEN.');
}

main().catch((err: Error) => {
  console.error(`[login] ${err.message}`);
  process.exit(1);
});
