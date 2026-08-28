import { Check, CircleDashed, Loader2, Minus, X } from 'lucide-react';
import type { WorkflowStage } from '@core/ui/contracts.js';
import { cn } from '@/lib/utils';

/**
 * Danh sách stage của một lượt chạy — port của `renderStageList` (app.js:937).
 *
 * Bản cũ dùng chung đúng một hàm này cho Studio (`#stages`), Device Farm
 * (`#fStages`) và Workflow Gate (`#workflowReviewStages`). Giữ nguyên cách đó:
 * ba màn hình vẽ tiến trình khác nhau là ba cách người dùng phải học lại cùng
 * một thứ.
 *
 * Câu hỏi hữu ích sau một lần fail không phải "có fail không" mà là "đi được
 * tới đâu" — 3/11 nói rằng bước sinh Gherkin chưa từng chạy, 9/11 nói rằng
 * sinh và chạy đều ổn và chỉ khâu report hỏng (`core/history.ts:6`).
 */
export function StageList({
  stages,
  idle,
  label = 'Tiến trình',
  className,
}: {
  /** `undefined` khi chưa có khung `run` nào — khi đó `idle` được vẽ. */
  stages: WorkflowStage[] | undefined;
  idle: readonly string[];
  /**
   * Tên của danh sách. Một `<ol>` 11 mục không tiêu đề thì trình đọc màn hình
   * chỉ đọc được "list, 11 items" — và test cũng không tách được nó khỏi danh
   * sách coverage nằm ngay bên dưới trong cùng một thẻ.
   */
  label?: string;
  className?: string;
}) {
  const rows: WorkflowStage[] =
    stages && stages.length > 0
      ? stages
      : idle.map((name) => ({ name, status: 'pending' as const }));

  return (
    <ol aria-label={label} className={cn('flex flex-col', className)}>
      {rows.map((stage, index) => (
        <li
          key={`${index}-${stage.name}`}
          className="flex items-start gap-2.5 py-1.5 text-sm first:pt-0 last:pb-0"
        >
          <StageMark status={stage.status} />
          <span
            className={cn(
              stage.status === 'pending' && 'text-muted-foreground',
              stage.status === 'skipped' && 'text-muted-foreground line-through',
              stage.status === 'running' && 'font-medium',
              stage.status === 'failed' && 'text-destructive font-medium',
            )}
          >
            {stage.name}
          </span>
        </li>
      ))}
    </ol>
  );
}

function StageMark({ status }: { status: WorkflowStage['status'] }) {
  const common = 'mt-0.5 size-4 shrink-0';
  switch (status) {
    case 'done':
      return <Check className={cn(common, 'text-status-pass')} aria-label="xong" />;
    case 'failed':
      return <X className={cn(common, 'text-destructive')} aria-label="lỗi" />;
    case 'running':
      // Vòng xoay là thứ duy nhất phân biệt "đang chạy" với "đã dừng ở đây".
      return (
        <Loader2
          className={cn(common, 'text-status-running animate-spin')}
          aria-label="đang chạy"
        />
      );
    case 'skipped':
      return <Minus className={cn(common, 'text-muted-foreground')} aria-label="bỏ qua" />;
    default:
      return (
        <CircleDashed className={cn(common, 'text-muted-foreground')} aria-label="chưa chạy" />
      );
  }
}
