import { create } from 'zustand';
import type { JobFrame, WorkflowRun } from '@core/ui/contracts.js';
import { streamJob } from '@/lib/streamJob';
import { queryClient } from '@/lib/queryClient';

/**
 * Trạng thái của các job đang stream — CỐ Ý nằm ngoài vòng đời component.
 *
 * Đây là chỗ chặn R10, hồi quy nguy hiểm nhất của cả đợt migrate.
 *
 * Ở app cũ mỗi trang là một `<section hidden>`: chuyển trang chỉ ẩn nó đi,
 * không huỷ. Một lần chạy Device Farm 20 phút vẫn tiếp tục ghi log trong lúc
 * người dùng đi xem Scenario Review, và quay lại thì log còn nguyên. Với
 * TanStack Router, `<Outlet/>` UNMOUNT panel cũ — nếu stream do component sở
 * hữu thì nó chết giữa chừng và người dùng mất một lần chạy thật trên thiết bị
 * thật, không có cách nào lấy lại.
 *
 * Nên: stream sống ở module scope, component chỉ subscribe. Hệ quả trực tiếp —
 * KHÔNG có `useEffect` cleanup nào được gọi `abort()`. Chỉ nút "Dừng" của
 * người dùng mới được.
 *
 * Đây cũng là store Zustand DUY NHẤT của app (UI-MIGRATION-PLAN §10.1). Mọi
 * state khác là server state và thuộc về TanStack Query. Thêm store thứ hai
 * phải viết ra được lý do.
 */

/** Farm run dài sinh hàng chục nghìn dòng; app cũ append thẳng vào DOM và chậm thấy rõ. */
const MAX_LOG_LINES = 5_000;

export type JobStatus = 'idle' | 'running' | 'done' | 'error';

export interface Job {
  logs: string[];
  run: WorkflowRun | null;
  status: JobStatus;
  error: string | null;
  /** Số dòng đã bị cắt khỏi đầu buffer, để UI nói được "đã ẩn N dòng đầu". */
  dropped: number;
  controller: AbortController | null;
}

const EMPTY: Job = {
  logs: [],
  run: null,
  status: 'idle',
  error: null,
  dropped: 0,
  controller: null,
};

function applyFrame(job: Job, frame: JobFrame): Job {
  switch (frame.type) {
    case 'log':
    case 'error': {
      const line = frame.type === 'error' ? `❌ ${frame.message}` : frame.line;
      const logs = [...job.logs, line];
      const overflow = Math.max(0, logs.length - MAX_LOG_LINES);
      return {
        ...job,
        logs: overflow ? logs.slice(overflow) : logs,
        dropped: job.dropped + overflow,
        ...(frame.type === 'error' ? { error: frame.message } : {}),
      };
    }
    case 'run':
      return { ...job, run: frame.run };
    case 'done':
      return { ...job, status: frame.ok ? 'done' : 'error' };
  }
}

interface JobState {
  jobs: Record<string, Job>;
  start: (id: string, path: string, body?: unknown) => Promise<void>;
  /** Nối lại một lượt đang chạy ở server, thay vì khởi động lượt mới. */
  attach: (id: string, path: string) => Promise<void>;
  abort: (id: string) => void;
  reset: (id: string) => void;
  /** Chỉ dùng trong test — xem src/test/setup.ts. */
  resetAll: () => void;
}

export const useJobStore = create<JobState>((set, get) => ({
  jobs: {},

  async start(id, path, body) {
    // Chạy chồng hai stream lên cùng một job là log của hai lần chạy trộn vào
    // nhau, không tách lại được.
    if (get().jobs[id]?.status === 'running') return;

    const controller = new AbortController();
    const patch = (fn: (job: Job) => Job) =>
      set((s) => ({ jobs: { ...s.jobs, [id]: fn(s.jobs[id] ?? EMPTY) } }));

    patch(() => ({ ...EMPTY, status: 'running', controller }));

    try {
      await streamJob(path, body, (frame) => patch((job) => applyFrame(job, frame)), controller.signal);
      patch((job) => ({ ...job, status: job.status === 'error' ? 'error' : 'done', controller: null }));
    } catch (err) {
      const aborted = controller.signal.aborted;
      patch((job) => ({
        ...job,
        status: aborted ? 'done' : 'error',
        error: aborted ? null : (err as Error).message,
        controller: null,
      }));
    }

    // Cầu nối duy nhất giữa hai mô hình state: một job vừa xong thường đã đổi
    // registry, history, hoặc config trên đĩa, mà Query không có cách nào biết.
    void queryClient.invalidateQueries();
  },

  /**
   * Nối lại một lượt chạy server đang giữ.
   *
   * Giống `start` ở mọi mặt trừ một: nó KHÔNG khởi động gì. Trang vừa tải lại
   * mất sạch job store — vốn nằm trong RAM của trang — trong khi lượt chạy ở
   * server vẫn đang bấm vào thiết bị thật. Đây là đường lấy lại nó.
   */
  async attach(id, path) {
    if (get().jobs[id]?.status === 'running') return;
    const controller = new AbortController();
    const patch = (fn: (job: Job) => Job) =>
      set((s) => ({ jobs: { ...s.jobs, [id]: fn(s.jobs[id] ?? EMPTY) } }));
    patch(() => ({ ...EMPTY, status: 'running', controller }));
    try {
      await streamJob(path, undefined, (frame) => patch((job) => applyFrame(job, frame)), controller.signal, 'GET');
      patch((job) => ({ ...job, status: job.status === 'error' ? 'error' : 'done', controller: null }));
    } catch (err) {
      const aborted = controller.signal.aborted;
      patch((job) => ({
        ...job,
        status: aborted ? 'done' : 'error',
        error: aborted ? null : (err as Error).message,
        controller: null,
      }));
    }
    void queryClient.invalidateQueries();
  },

  abort(id) {
    get().jobs[id]?.controller?.abort();
  },

  reset(id) {
    set((s) => {
      const next = { ...s.jobs };
      delete next[id];
      return { jobs: next };
    });
  },

  resetAll() {
    for (const job of Object.values(get().jobs)) job.controller?.abort();
    set({ jobs: {} });
  },
}));

export function selectJob(id: string) {
  return (s: JobState): Job => s.jobs[id] ?? EMPTY;
}
