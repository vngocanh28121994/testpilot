/**
 * Đóng gói một thư mục `.app` của simulator iOS thành `tar.gz`.
 *
 * Ở `src/runner/` chứ không ở `src/server/`, dù người gọi là máy chủ: control
 * plane không chạy lệnh trên máy — đó là ranh giới mà `noDeviceAccess.test.ts`
 * canh. Việc cần chạy lệnh đi qua mặt tiền runner như một việc đã khai báo,
 * cùng chỗ với `readAppVersion` (chạy `aapt`).
 *
 * Vì sao `tar` chứ không `ditto` hay zip: nó có ở cả macOS lẫn Linux, và giữ
 * đúng hai thứ một `.app` cần mà zip hay đánh rơi — symlink trong framework,
 * và bit thực thi của file chạy chính. Mất bit ấy, simulator cài xong rồi từ
 * chối mở app với một câu không nhắc gì tới quyền file.
 */
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function packAppBundle(dir: string, dest: string): Promise<void> {
  if (!/\.app$/i.test(dir)) throw new Error(`${dir} không phải một thư mục .app.`);
  await execFileAsync('tar', ['-czf', dest, '-C', path.dirname(dir), path.basename(dir)], {
    // macOS: không kèm tệp `._*` chứa thuộc tính mở rộng. Chúng vô dụng với
    // simulator và thành rác bên trong bản `.app` ở máy kia.
    env: { ...process.env, COPYFILE_DISABLE: '1' },
    maxBuffer: 16 * 1024 * 1024,
  });
}
