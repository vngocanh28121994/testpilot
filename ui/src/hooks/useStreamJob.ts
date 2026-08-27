import { useCallback } from 'react';
import { useJobStore, selectJob, type Job } from '@/stores/jobStore';

export interface StreamJobHandle extends Job {
  start: (body?: unknown) => void;
  abort: () => void;
  reset: () => void;
}

/**
 * Đọc/điều khiển một job đang stream.
 *
 * Chú ý điều KHÔNG có ở đây: không `useEffect` nào abort lúc unmount. Đó là
 * chủ ý, không phải thiếu sót — xem stores/jobStore.ts và R10. Đổi trang trong
 * lúc một farm run đang chạy phải là chuyện vô hại.
 *
 * `id` phải ổn định theo màn hình (ví dụ 'local-run', 'farm-run'), không phải
 * sinh mới mỗi lần render — nó là khoá để tìm lại đúng job khi quay lại trang.
 */
export function useStreamJob(id: string, path: string): StreamJobHandle {
  const job = useJobStore(selectJob(id));
  const startFn = useJobStore((s) => s.start);
  const abortFn = useJobStore((s) => s.abort);
  const resetFn = useJobStore((s) => s.reset);

  const start = useCallback((body?: unknown) => void startFn(id, path, body), [startFn, id, path]);
  const abort = useCallback(() => abortFn(id), [abortFn, id]);
  const reset = useCallback(() => resetFn(id), [resetFn, id]);

  return { ...job, start, abort, reset };
}
