import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

/**
 * Tiến trình chạy test sống sót sau khi server chết.
 *
 * Server spawn `tsx src/cli/run.ts` rồi giữ handle trong một Set nằm trong RAM.
 * Set đó là thứ duy nhất nút Dừng biết tới. Server chết là Set biến mất — còn
 * tiến trình con thì KHÔNG chết theo, vì trên POSIX giết cha không giết con.
 *
 * Người dùng thấy đúng cảnh này: tool tải lại, màn hình về trạng thái ban đầu,
 * nhưng điện thoại cắm ở bàn vẫn tiếp tục bấm — và không còn nút nào dừng nó
 * được, vì server mới không biết nó tồn tại. Với một bộ test chuyển tiền thật
 * thì đó không phải phiền toái.
 *
 * Nên PID được ghi xuống đĩa ngay lúc spawn. Server sau đọc lại và dọn.
 */

export interface OrphanRecord {
  pid: number;
  /**
   * Một mẩu dòng lệnh đủ nhận ra tiến trình. PID được hệ điều hành dùng lại,
   * nên giết theo PID trần là có ngày giết nhầm thứ hoàn toàn khác — đúng cái
   * bẫy mà chỗ dừng WebDriverAgent đã nêu ra.
   */
  signature: string;
  startedAt: string;
  label: string;
}

const FILE = 'registry/running-pids.json';

function read(file: string): OrphanRecord[] {
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { pids?: OrphanRecord[] };
    return Array.isArray(parsed.pids) ? parsed.pids : [];
  } catch {
    // File hỏng không được phép chặn server khởi động; mất dấu vài PID còn hơn
    // không lên được.
    return [];
  }
}

function write(file: string, pids: OrphanRecord[]): void {
  if (pids.length === 0) {
    if (existsSync(file)) unlinkSync(file);
    return;
  }
  writeFileSync(file, JSON.stringify({ version: 1, pids }, null, 2) + '\n', 'utf8');
}

/** Dòng lệnh hiện tại của một PID, hoặc undefined nếu nó đã chết. */
function commandOf(pid: number): string | undefined {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim();
  } catch {
    return undefined;
  }
}

export class OrphanTracker {
  private constructor(private readonly file: string, private records: OrphanRecord[]) {}

  static load(file = FILE): OrphanTracker {
    return new OrphanTracker(path.resolve(file), read(path.resolve(file)));
  }

  add(pid: number, signature: string, label: string): void {
    this.records = this.records.filter((r) => r.pid !== pid);
    this.records.push({ pid, signature, startedAt: new Date().toISOString(), label });
    write(this.file, this.records);
  }

  remove(pid: number): void {
    this.records = this.records.filter((r) => r.pid !== pid);
    write(this.file, this.records);
  }

  /**
   * Giết những tiến trình còn sống từ lần chạy trước.
   *
   * Không nhận nuôi được: stream log của chúng đã đứt, không ai đọc kết quả,
   * và lượt chạy tương ứng trong history cũng đã bị đóng lại. Để chúng tiếp tục
   * bấm vào một thiết bị thật là điều tệ nhất trong ba lựa chọn.
   *
   * Chỉ giết khi dòng lệnh hiện tại VẪN khớp chữ ký đã ghi — PID bị dùng lại
   * thì thứ đang mang nó là một tiến trình khác hẳn.
   */
  reapOrphans(): Array<{ pid: number; label: string; killed: boolean }> {
    const out: Array<{ pid: number; label: string; killed: boolean }> = [];
    for (const record of this.records) {
      const command = commandOf(record.pid);
      if (command === undefined) continue;              // đã chết, không cần làm gì
      if (!command.includes(record.signature)) continue; // PID đã bị dùng lại
      let killed = false;
      try {
        process.kill(record.pid, 'SIGTERM');
        killed = true;
      } catch { /* vừa chết xong giữa hai lệnh */ }
      out.push({ pid: record.pid, label: record.label, killed });
    }
    this.records = [];
    write(this.file, this.records);
    return out;
  }
}
