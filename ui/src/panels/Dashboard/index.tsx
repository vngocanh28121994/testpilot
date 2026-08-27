import { AppShell } from '@/components/layout/AppShell';
import { useElementCount, useRecentRuns } from '@/hooks/useAppState';

/**
 * Giữ chỗ của Phase 2 — đủ để chứng minh tầng API + layout chạy thật với dữ
 * liệu thật. Phase 4 (trang #2) thay bằng Dashboard đầy đủ.
 */
export default function DashboardPanel() {
  const runs = useRecentRuns();
  const elements = useElementCount();

  return (
    <AppShell title="Dashboard">
      <div className="grid max-w-3xl grid-cols-2 gap-4">
        <div className="border-border rounded-lg border p-4">
          <div className="text-muted-foreground text-xs">Element trong registry</div>
          <div className="mt-1 text-2xl font-semibold">
            {elements.isPending ? '…' : (elements.data ?? 0)}
          </div>
        </div>
        <div className="border-border rounded-lg border p-4">
          <div className="text-muted-foreground text-xs">Lần chạy gần đây</div>
          <div className="mt-1 text-2xl font-semibold">
            {runs.isPending ? '…' : (runs.data?.length ?? 0)}
          </div>
        </div>
      </div>
      {runs.isError && (
        <p className="text-destructive mt-4 text-sm">{(runs.error as Error).message}</p>
      )}
      <p className="text-muted-foreground mt-6 text-sm">
        Khung Phase 2 đã chạy: sidebar 14 mục, tầng API có type, dark mode. Các trang thật đến ở
        Phase 4.
      </p>
    </AppShell>
  );
}
