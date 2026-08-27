import type { ColumnDef } from '@tanstack/react-table';
import type { FeatureSummary } from '@core/ui/contracts.js';

export const featureColumns: ColumnDef<FeatureSummary, unknown>[] = [
  {
    accessorKey: 'name',
    header: 'File',
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.name}</span>,
  },
  {
    id: 'feature',
    header: 'Feature',
    accessorFn: (f) => f.error ?? f.feature,
    // Một file không parse được vẫn phải hiện, và hiện kèm lỗi: lỗi binding
    // chính là thứ cần sửa, giấu đi thì không ai biết nó tồn tại (server.ts:1067).
    cell: ({ row }) =>
      row.original.error ? (
        <span className="text-status-fail">⚠ {row.original.error}</span>
      ) : (
        row.original.feature
      ),
  },
  {
    id: 'scenarios',
    header: 'Scenario',
    accessorFn: (f) => f.scenarios.length,
    meta: { align: 'right' },
  },
  {
    id: 'steps',
    header: 'Step',
    accessorFn: (f) => f.scenarios.reduce((n, s) => n + s.steps, 0),
    meta: { align: 'right' },
  },
];
