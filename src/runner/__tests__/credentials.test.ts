/**
 * Token của runner lấy ở đâu.
 *
 * Bài đáng giá nhất ở đây là THỨ TỰ: biến môi trường thắng keychain. Nghe
 * ngược — keychain an toàn hơn — nhưng đây không phải chuyện an toàn mà là
 * chuyện cái nào TỒN TẠI ở nơi runner đang chạy: một container không có phiên
 * đăng nhập để mở keychain, và `security` ở đó hoặc không có hoặc treo chờ mật
 * khẩu. Đảo thứ tự lại là làm runner trong container treo lúc khởi động.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clearToken, readToken, saveToken, type KeychainIo } from '../credentials.js';

function fakeMac(stored = new Map<string, string>()): KeychainIo & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    platform: 'darwin',
    async run(command, args) {
      calls.push([command, ...args]);
      const account = args[args.indexOf('-a') + 1] ?? '';
      if (args[0] === 'find-generic-password') {
        const value = stored.get(account);
        return value ? { code: 0, stdout: `${value}\n` } : { code: 44, stdout: '' };
      }
      if (args[0] === 'add-generic-password') {
        stored.set(account, args[args.indexOf('-w') + 1] ?? '');
        return { code: 0, stdout: '' };
      }
      if (args[0] === 'delete-generic-password') {
        return { code: stored.delete(account) ? 0 : 44, stdout: '' };
      }
      return { code: -1, stdout: '' };
    },
  };
}

describe('đọc token', () => {
  it('biến môi trường thắng keychain, và keychain không bị hỏi tới', async () => {
    const io = fakeMac(new Map([['https://a.dev', 'từ-keychain']]));
    const token = await readToken('https://a.dev', { TESTPILOT_RUNNER_TOKEN: 'từ-env' }, io);
    assert.equal(token, 'từ-env');
    assert.deepEqual(io.calls, [], 'có env rồi thì đừng gọi `security` làm gì');
  });

  it('không có env thì lấy trong keychain', async () => {
    const io = fakeMac(new Map([['https://a.dev', 'từ-keychain']]));
    assert.equal(await readToken('https://a.dev', {}, io), 'từ-keychain');
  });

  it('không có ở đâu cả thì undefined, không ném', async () => {
    assert.equal(await readToken('https://a.dev', {}, fakeMac()), undefined);
  });

  it('một token cho MỖI server', async () => {
    // Một người nối máy mình vào staging và production, và hai bản cấp hai
    // token khác nhau. Một mục dùng chung nghĩa là đăng nhập cái thứ hai làm
    // chết cái thứ nhất, và triệu chứng là 401 ở chỗ người ta không đụng tới.
    const io = fakeMac();
    await saveToken('https://a.dev', 'token-a', io);
    await saveToken('https://b.dev', 'token-b', io);
    assert.equal(await readToken('https://a.dev', {}, io), 'token-a');
    assert.equal(await readToken('https://b.dev', {}, io), 'token-b');
  });

  it('dấu / thừa ở cuối URL không tạo ra một mục thứ hai', async () => {
    const io = fakeMac();
    await saveToken('https://a.dev/', 'token-a', io);
    assert.equal(await readToken('https://a.dev', {}, io), 'token-a');
  });

  it('quên thì quên hẳn', async () => {
    const io = fakeMac();
    await saveToken('https://a.dev', 'token-a', io);
    assert.equal(await clearToken('https://a.dev', io), true);
    assert.equal(await readToken('https://a.dev', {}, io), undefined);
    assert.equal(await clearToken('https://a.dev', io), false, 'xoá cái không có thì nói không');
  });
});

describe('máy không phải macOS', () => {
  const linux: KeychainIo = { platform: 'linux', run: async () => ({ code: 0, stdout: '' }) };

  it('không giả vờ cất được, và chỉ đúng đường thay thế', async () => {
    const saved = await saveToken('https://a.dev', 'token', linux);
    assert.equal(saved.ok, false);
    assert.match(saved.message, /TESTPILOT_RUNNER_TOKEN/);
  });

  it('vẫn đọc được từ biến môi trường', async () => {
    assert.equal(
      await readToken('https://a.dev', { TESTPILOT_RUNNER_TOKEN: 'từ-env' }, linux),
      'từ-env',
    );
  });
});
