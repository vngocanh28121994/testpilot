import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Lượt chạy đang sống, và log của nó, giữ ở phía server.
 *
 * Trước đây log chỉ tồn tại trên đường dây SSE tới đúng cái tab đã bấm nút.
 * Tab đóng hoặc tải lại là đứt, và không có đường nối lại: job store phía UI
 * nằm trong RAM của trang, `log.txt` thì tới cuối lượt chạy mới được ghi, còn
 * `/api/state` không hề nói có gì đang chạy. Thiết bị vẫn bấm, tool nói không
 * có gì — đúng cảnh người dùng gặp.
 *
 * Nên log đi qua đây: một bản trong RAM để nối lại ngay, và ghi dần xuống
 * `log.txt` để cả lượt chạy bị giết giữa chừng cũng còn lại dấu vết.
 */

/** Đủ cho một lượt Android dài; quá số này thì cắt đầu và đếm phần đã cắt. */
const MAX_LINES = 8_000;

export interface ActiveRunView {
  id: string;
  label: string;
  kind: 'run' | 'workflow';
  startedAt: string;
  lines: number;
  /** Số dòng đã bị cắt khỏi đầu đệm. Giao diện nói ra thay vì im lặng. */
  dropped: number;
  /** Thư mục lượt chạy, khi con đã báo. */
  runDir?: string;
}

interface Listener {
  (line: string): void;
}

class ActiveRun {
  readonly startedAt = new Date().toISOString();
  private buffer: string[] = [];
  private dropped = 0;
  private listeners = new Set<Listener>();
  private logFile?: string;

  constructor(
    readonly id: string,
    readonly label: string,
    readonly kind: 'run' | 'workflow',
  ) {}

  /**
   * Thư mục lượt chạy chỉ biết được sau khi tiến trình con báo `[run:dir]`,
   * tức là muộn hơn dòng log đầu tiên. Nên những dòng đã trôi qua được ghi bù
   * ngay lúc biết chỗ, thay vì mất.
   */
  attachDir(dir: string): void {
    if (this.logFile) return;
    try {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      this.logFile = path.join(dir, 'log.txt');
      writeFileSync(this.logFile, this.buffer.join('\n') + (this.buffer.length ? '\n' : ''), 'utf8');
    } catch {
      // Không ghi được thì vẫn phải chạy tiếp; đệm trong RAM vẫn dùng được.
      this.logFile = undefined;
    }
  }

  get dir(): string | undefined {
    return this.logFile ? path.dirname(this.logFile) : undefined;
  }

  push(line: string): void {
    this.buffer.push(line);
    if (this.buffer.length > MAX_LINES) {
      this.dropped += this.buffer.length - MAX_LINES;
      this.buffer = this.buffer.slice(-MAX_LINES);
    }
    if (this.logFile) {
      try {
        appendFileSync(this.logFile, line + '\n', 'utf8');
      } catch { /* đĩa đầy hoặc thư mục bị xoá — không được làm hỏng lượt chạy */ }
    }
    for (const listener of this.listeners) listener(line);
  }

  /** Trả về log đã có, rồi nối tiếp. Đây là toàn bộ điểm của việc nối lại. */
  subscribe(listener: Listener): { history: string[]; dropped: number; off: () => void } {
    this.listeners.add(listener);
    return {
      history: [...this.buffer],
      dropped: this.dropped,
      off: () => this.listeners.delete(listener),
    };
  }

  view(): ActiveRunView {
    return {
      id: this.id,
      label: this.label,
      kind: this.kind,
      startedAt: this.startedAt,
      lines: this.buffer.length,
      dropped: this.dropped,
      ...(this.dir ? { runDir: path.basename(this.dir) } : {}),
    };
  }
}

const active = new Map<string, ActiveRun>();
let counter = 0;

export function beginActiveRun(label: string, kind: 'run' | 'workflow'): ActiveRun {
  counter += 1;
  const run = new ActiveRun(`live-${Date.now().toString(36)}-${counter}`, label, kind);
  active.set(run.id, run);
  return run;
}

export function endActiveRun(run: { id: string }): void {
  active.delete(run.id);
}

export function activeRuns(): ActiveRunView[] {
  return [...active.values()].map((run) => run.view());
}

export function findActiveRun(id: string): ActiveRun | undefined {
  return active.get(id);
}

export type { ActiveRun };
