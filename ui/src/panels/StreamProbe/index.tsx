import { useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { LogView } from '@/components/LogView';
import { useStreamJob } from '@/hooks/useStreamJob';
import { useJobStore } from '@/stores/jobStore';
import { STREAM_ROUTES } from '@/api/routes';

/**
 * Bàn thử của tầng stream — CHỈ chạy ở dev.
 *
 * Tồn tại để nghiệm thu R3 (proxy không buffer) và R10 (job sống sót qua điều
 * hướng) bằng thao tác thật, trước khi Phase 4 dựng Local Runner. Khi trang
 * Local Runner (Phase 4 #7) hoàn thành, xoá panel này và route của nó.
 */
export default function StreamProbePanel() {
  const job = useStreamJob('probe', STREAM_ROUTES.prereqAppium);

  // Chỉ ở dev: cho phép lái store từ bên ngoài để test R10 có tính xác định.
  // Không lọt vào bản build production — import.meta.env.DEV là hằng lúc build.
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as unknown as { __jobStore?: unknown }).__jobStore = useJobStore;
    }
  }, []);

  return (
    <AppShell title="Stream probe (dev)">
      <div className="flex gap-2">
        <button
          type="button"
          data-testid="start"
          onClick={() => job.start()}
          className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm"
        >
          Bắt đầu
        </button>
        <button
          type="button"
          data-testid="abort"
          onClick={job.abort}
          className="border-border rounded-md border px-3 py-1.5 text-sm"
        >
          Dừng
        </button>
      </div>

      <p className="mt-3 text-sm">
        trạng thái: <b data-testid="status">{job.status}</b> · số dòng log:{' '}
        <b data-testid="count">{job.logs.length}</b>
      </p>

      {/* Dùng chung LogView như mọi chỗ hiển thị log khác. `data-testid` giữ
          trên vỏ ngoài để không phải mở thêm API cho một trang tạm. */}
      <div data-testid="log">
        <LogView logs={job.logs} className="mt-3 max-h-96" label="Log probe" />
      </div>
    </AppShell>
  );
}
