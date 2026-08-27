import type { HealingRecordView } from '@core/ui/contracts.js';
import { when } from '@/lib/datetime';
import { cn } from '@/lib/utils';
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
    <td className="max-w-[16rem] align-top">
      <code className="block truncate font-mono text-xs" title={title ?? value}>
        {value}
      </code>
    </td>
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
    <tr className="border-border border-t align-top">
      <td className="py-2 font-mono text-xs">{record.elementId}</td>
      <td>
        <span className="bg-accent rounded px-1.5 py-0.5 text-xs">{record.platform}</span>
      </td>
      <LocatorCell value={formatLocator(record.primary)} />
      <LocatorCell value={formatLocator(record.current)} />
      <td className="max-w-[16rem] align-top">
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
      </td>
      <td className="text-right tabular-nums">{record.successes}</td>
      <td className="text-right tabular-nums" title={record.runIds.join('\n')}>
        {record.runs}
      </td>
      <td
        className={cn('text-right tabular-nums', weakEvidence && 'text-muted-foreground')}
        title={deviceTooltip(record.devices)}
      >
        {record.deviceCount}
      </td>
      <td className="text-muted-foreground text-xs whitespace-nowrap">{when(record.lastSeen)}</td>
      <td>
        <span className="bg-accent rounded px-1.5 py-0.5 text-xs whitespace-nowrap">
          {healingStatusLabel(record.status)}
        </span>
      </td>
      <td className="text-right">
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
      </td>
    </tr>
  );
}

const BTN = 'rounded px-2 py-1 text-xs whitespace-nowrap disabled:opacity-50';

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
        <button
          type="button"
          disabled={busy}
          onClick={() => onConfirm(pending)}
          className={cn(
            BTN,
            pending === 'apply'
              ? 'bg-primary text-primary-foreground'
              : 'bg-destructive text-white',
          )}
        >
          {busy
            ? pending === 'apply'
              ? 'Đang áp dụng…'
              : 'Đang lưu…'
            : pending === 'apply'
              ? 'Xác nhận áp dụng'
              : 'Xác nhận từ chối'}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className={cn(BTN, 'border-border border')}>
          Huỷ
        </button>
      </div>
    );
  }

  if (record.status !== 'proposed') return null;

  return (
    <div className="flex justify-end gap-1">
      <button
        type="button"
        disabled={blocked}
        title={blocked ? `Chưa đạt quality gate: ${reasons.join(', ')}` : undefined}
        onClick={() => onRequest('apply')}
        className={cn(BTN, 'bg-primary text-primary-foreground')}
      >
        Áp dụng
      </button>
      <button type="button" onClick={() => onRequest('reject')} className={cn(BTN, 'border-border border')}>
        Từ chối
      </button>
    </div>
  );
}
