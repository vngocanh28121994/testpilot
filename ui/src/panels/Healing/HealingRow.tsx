import type { HealingRecordView } from '@core/ui/contracts.js';
import { when } from '@/lib/datetime';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TableCell, TableRow } from '@/components/ui/table';
import {
  deviceTooltip,
  formatLocator,
  healingStatusLabel,
  qualityLabel,
  qualityTone,
} from './locator';

const TONE_CLASS = {
  stable: 'bg-status-pass/15 text-status-pass',
  review: 'bg-status-flaky/15 text-status-flaky',
  fragile: 'bg-status-fail/15 text-status-fail',
} as const;

function LocatorCell({ value, title }: { value: string; title?: string }) {
  return (
    <TableCell className="max-w-[16rem] align-top">
      <code className="block truncate font-mono text-xs" title={title ?? value}>
        {value}
      </code>
    </TableCell>
  );
}

export interface HealingRowProps {
  record: HealingRecordView;
  pending: 'apply' | 'reject' | null;
  busy: boolean;
  onRequest: (action: 'apply' | 'reject') => void;
  onConfirm: (action: 'apply' | 'reject') => void;
  onCancel: () => void;
}

export function HealingRow({ record, pending, busy, onRequest, onConfirm, onCancel }: HealingRowProps) {
  const q = record.quality;
  // Quality gate: chỉ locator đủ bằng chứng mới được lên primary. Nút bị khoá
  // phải NÓI RA lý do — một nút xám không giải thích được gì (app.js:1130).
  const blocked = q?.promotable === false;
  const tone = q ? qualityTone(q) : 'review';

  // Một máy nhưng nhiều run: bằng chứng yếu hơn con số gợi ý. Bản cũ làm mờ ô
  // này để phân biệt (app.js:1195).
  const weakEvidence = record.deviceCount === 1 && record.runs > 1;

  return (
    <TableRow className="align-top">
      <TableCell className="font-mono text-xs">{record.elementId}</TableCell>
      <TableCell>
        <Badge variant="secondary">{record.platform}</Badge>
      </TableCell>
      <LocatorCell value={formatLocator(record.primary)} />
      <LocatorCell value={formatLocator(record.current)} />
      <TableCell className="max-w-[16rem] align-top">
        <code className="block truncate font-mono text-xs" title={formatLocator(record.proposed)}>
          {formatLocator(record.proposed)}
        </code>
        {q && (
          <span
            className={cn('mt-1 inline-block rounded px-1.5 py-0.5 text-[11px]', TONE_CLASS[tone])}
            title={q.reasons.join(', ')}
          >
            {q.score}/100 · {qualityLabel(q)}
          </span>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">{record.successes}</TableCell>
      <TableCell className="text-right tabular-nums" title={record.runIds.join('\n')}>
        {record.runs}
      </TableCell>
      <TableCell
        className={cn('text-right tabular-nums', weakEvidence && 'text-muted-foreground')}
        title={deviceTooltip(record.devices)}
      >
        {record.deviceCount}
      </TableCell>
      <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
        {when(record.lastSeen)}
      </TableCell>
      <TableCell>
        <Badge variant="outline" className="whitespace-nowrap">
          {healingStatusLabel(record.status)}
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        <Actions
          record={record}
          pending={pending}
          busy={busy}
          blocked={blocked}
          reasons={q?.reasons ?? []}
          onRequest={onRequest}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      </TableCell>
    </TableRow>
  );
}

function Actions({
  record,
  pending,
  busy,
  blocked,
  reasons,
  onRequest,
  onConfirm,
  onCancel,
}: HealingRowProps & { blocked: boolean; reasons: string[] }) {
  // Xác nhận hai bước, giữ nguyên của bản cũ: áp dụng một locator ghi thẳng
  // vào element registry và không có nút hoàn tác.
  if (pending) {
    return (
      <div className="flex justify-end gap-1">
        <Button
          size="sm"
          variant={pending === 'apply' ? 'default' : 'destructive'}
          disabled={busy}
          onClick={() => onConfirm(pending)}
        >
          {busy
            ? pending === 'apply'
              ? 'Đang áp dụng…'
              : 'Đang lưu…'
            : pending === 'apply'
              ? 'Xác nhận áp dụng'
              : 'Xác nhận từ chối'}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onCancel}>
          Huỷ
        </Button>
      </div>
    );
  }

  if (record.status !== 'proposed') return null;

  return (
    <div className="flex justify-end gap-1">
      <Button
        size="sm"
        disabled={blocked}
        title={blocked ? `Chưa đạt quality gate: ${reasons.join(', ')}` : undefined}
        onClick={() => onRequest('apply')}
      >
        Áp dụng
      </Button>
      <Button size="sm" variant="outline" onClick={() => onRequest('reject')}>
        Từ chối
      </Button>
    </div>
  );
}
