import { AppShell } from '@/components/layout/AppShell';
import { DataTable } from '@/components/data-table';
import { useAppState } from '@/hooks/useAppState';
import { featureColumns } from './columns';

/** Năm ô số của bản cũ, giữ nguyên thứ tự và nhãn (app.js:1569). */
function useTiles() {
  return useAppState((s) => {
    const scenarios = s.features.reduce((n, f) => n + f.scenarios.length, 0);
    return [
      { value: s.features.length, label: 'feature file' },
      { value: scenarios, label: 'scenario' },
      { value: s.elements, label: 'element' },
      { value: s.runs.length, label: 'lần chạy' },
      { value: s.runs.filter((r) => r.status === 'failed').length, label: 'lần thất bại' },
    ];
  });
}

export default function DashboardPanel() {
  const tiles = useTiles();
  const features = useAppState((s) => s.features);

  return (
    <AppShell title="Dashboard">
      <div role="group" aria-label="Tổng quan" className="flex flex-wrap gap-3">
        {(tiles.data ?? []).map((t) => (
          <div key={t.label} className="border-border min-w-32 rounded-lg border px-4 py-3">
            <div className="text-2xl font-semibold tabular-nums">{t.value}</div>
            <div className="text-muted-foreground text-xs">{t.label}</div>
          </div>
        ))}
      </div>

      {tiles.isError && (
        <p role="alert" className="text-destructive mt-4 text-sm">
          {(tiles.error as Error).message}
        </p>
      )}

      <h2 className="mt-8 mb-3 text-sm font-medium">Feature đã sinh</h2>
      <DataTable
        data={features.data ?? []}
        columns={featureColumns}
        loading={features.isPending}
        empty="Chưa sinh feature nào."
        caption="Danh sách feature đã sinh"
        initialSorting={[{ id: 'name', desc: false }]}
      />
    </AppShell>
  );
}
