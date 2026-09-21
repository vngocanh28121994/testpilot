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
  /**
   * Số thứ tự của dòng cuối cùng đã phát.
   *
   * Đây là thứ cho phép một tab nối lại mà KHÔNG nhận lại từ đầu: nó nói "tôi
   * đã có tới dòng N", server gửi tiếp từ N+1. Cùng ý nghĩa với `JobEvent.seq`
   * trong `src/protocol/messages.ts`, và ở P2 nó chính là khoá của bảng
   * `job_event`.
   */
  lastSeq: number;
  /** Thư mục lượt chạy, khi con đã báo. */
  runDir?: string;
}

interface Listener {
  (line: string): void;
}

class ActiveRun {
  readonly startedAt = new Date().toISOString();
  /** Dòng log kèm số thứ tự; `seq` không bao giờ lùi, kể cả khi đệm bị cắt. */
  private buffer: Array<{ seq: number; line: string }> = [];
  private dropped = 0;
  private lastSeq = 0;
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
      const text = this.buffer.map((entry) => entry.line).join('\n');
      writeFileSync(this.logFile, text + (this.buffer.length ? '\n' : ''), 'utf8');
    } catch {
      // Không ghi được thì vẫn phải chạy tiếp; đệm trong RAM vẫn dùng được.
      this.logFile = undefined;
    }
  }

  get dir(): string | undefined {
    return this.logFile ? path.dirname(this.logFile) : undefined;
  }

  push(line: string): void {
    this.lastSeq += 1;
    this.buffer.push({ seq: this.lastSeq, line });
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

  /**
   * Trả về log đã có, rồi nối tiếp. Đây là toàn bộ điểm của việc nối lại.
   *
   * `since` là số thứ tự dòng cuối cùng mà người gọi ĐÃ CÓ. Không truyền thì
   * nhận tất cả — đúng hành vi cũ, và đúng thứ một tab vừa tải lại cần.
   *
   * Nếu phần người gọi thiếu đã bị cắt khỏi đệm thì họ nhận trọn phần còn lại
   * kèm `dropped`. Im lặng gửi tiếp từ chỗ còn sót sẽ để lại một lỗ hổng giữa
   * những gì họ có và những gì họ nhận — một lỗ hổng không ai nhìn thấy.
   */
  subscribe(
    listener: Listener,
    since = 0,
  ): { history: string[]; dropped: number; lastSeq: number; off: () => void } {
    this.listeners.add(listener);
    const firstAvailable = this.buffer[0]?.seq ?? this.lastSeq + 1;
    const gap = since > 0 && since + 1 < firstAvailable;
    const history = since > 0 && !gap
      ? this.buffer.filter((entry) => entry.seq > since)
      : this.buffer;
    return {
      history: history.map((entry) => entry.line),
      dropped: gap || since === 0 ? this.dropped : 0,
      lastSeq: this.lastSeq,
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
      lastSeq: this.lastSeq,
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
