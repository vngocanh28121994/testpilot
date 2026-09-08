import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type BannerTone = 'pass' | 'warn' | 'fail' | 'unknown';

/**
 * Một dòng trạng thái mà CẢ DẢI mang nghĩa.
 *
 * Bản React trước đây đặt một huy hiệu nhỏ cạnh một câu chữ xám: muốn biết đang
 * ổn hay sắp hỏng thì phải đọc chữ trong huy hiệu, mà nó chỉ to bằng cỡ chữ phụ.
 * Bản cũ tô cả băng — viền trái đậm, nền nhạt cùng tông — nên trạng thái đọc
 * được từ khoảng cách một mét.
 *
 * Cái chấm lặp lại đúng nghĩa của màu, cho người không phân biệt được màu. Ghi
 * chú trong CSS của bản cũ nói thẳng điều đó, và nó đúng.
 */
export function StatusBanner({
  tone,
  title,
  detail,
  actions,
}: {
  tone: BannerTone;
  title: string;
  detail?: ReactNode;
  actions?: ReactNode;
}) {
  const box = {
    pass: 'border-s-status-pass bg-(--tint-pass)',
    warn: 'border-s-status-flaky bg-(--tint-warn)',
    fail: 'border-s-status-fail bg-(--tint-fail)',
    unknown: 'border-s-muted-foreground bg-muted/40',
  }[tone];
  const dot = {
    pass: 'bg-status-pass',
    warn: 'bg-status-flaky',
    fail: 'bg-status-fail',
    unknown: 'bg-muted-foreground',
  }[tone];

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-s-[3px] px-3.5 py-2.5 text-sm',
        box,
      )}
    >
      <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', dot)} />
      <span className="min-w-[12rem] flex-1">
        <b>{title}</b>
        {detail ? <> — {detail}</> : null}
      </span>
      {actions && <span className="flex flex-wrap gap-2">{actions}</span>}
    </div>
  );
}
