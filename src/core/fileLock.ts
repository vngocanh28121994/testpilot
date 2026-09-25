/**
 * Khoá một tệp giữa NHIỀU TIẾN TRÌNH trên cùng một máy.
 *
 * Bốn kho sống qua các lượt chạy (registry, runtime registry, flake, healing)
 * đều được ghi bằng cách đọc cả tệp, sửa, rồi ghi đè cả tệp. Một tiến trình gộp
 * một lúc thì đúng. Từ khi một runner chạy nhiều job cùng lúc, hai lượt gộp có
 * thể chồng lên nhau — mỗi lượt ở một tiến trình khác (worker trong máy chủ,
 * `run-parallel` của một job khác) — và lượt ghi sau xoá sạch phần lượt trước
 * vừa gộp, không báo gì.
 *
 * Khoá bằng `open(…, 'wx')`: tạo tệp khoá chỉ thành công khi nó chưa tồn tại,
 * và hệ điều hành bảo đảm chỉ một bên thắng. Tệp khoá ghi PID của bên giữ, nên
 * một tiến trình chết giữa chừng (SIGKILL, mất điện) không khoá vĩnh viễn: bên
 * sau thấy PID ấy không còn sống — hoặc khoá đã quá cũ — thì dọn và lấy lại.
 */
import { open, readFile, rm, stat } from 'node:fs/promises';

export interface FileLockOptions {
  /** Khoá cũ hơn mức này thì coi như bị bỏ rơi, kể cả khi PID còn sống. */
  staleMs?: number;
  /** Chờ tối đa bao lâu trước khi bỏ cuộc. */
  waitMs?: number;
  /** Nhịp thử lại khi khoá đang bị giữ. */
  retryMs?: number;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: tiến trình có tồn tại, chỉ là của người dùng khác.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function abandoned(lockPath: string, staleMs: number): Promise<boolean> {
  try {
    const [body, info] = await Promise.all([readFile(lockPath, 'utf8'), stat(lockPath)]);
    if (Date.now() - info.mtimeMs > staleMs) return true;
    const pid = Number.parseInt(body, 10);
    return Number.isFinite(pid) && pid > 0 && !alive(pid);
  } catch {
    // Tệp vừa biến mất giữa hai lệnh đọc: bên giữ đã nhả. Thử lấy lại ngay.
    return true;
  }
}

export async function withFileLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  opts: FileLockOptions = {},
): Promise<T> {
  const staleMs = opts.staleMs ?? 10 * 60_000;
  const waitMs = opts.waitMs ?? 5 * 60_000;
  const retryMs = opts.retryMs ?? 100;
  const deadline = Date.now() + waitMs;

  for (;;) {
    try {
      const handle = await open(lockPath, 'wx');
      try {
        await handle.writeFile(String(process.pid));
      } finally {
        await handle.close();
      }
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      if (await abandoned(lockPath, staleMs)) {
        await rm(lockPath, { force: true });
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `Đang có một lượt chạy khác ghi kết quả vào registry quá lâu (tệp khoá ${lockPath}). `
          + 'Đợi lượt ấy xong rồi thử lại; nếu không có lượt nào đang chạy, xoá tệp khoá đó.',
        );
      }
      await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
  }

  try {
    return await fn();
  } finally {
    await rm(lockPath, { force: true });
  }
}
