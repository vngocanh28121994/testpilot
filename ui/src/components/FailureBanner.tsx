import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { describeFailure, type FailureKind } from '@/lib/failure';
import { cn } from '@/lib/utils';

/**
 * Băng báo lỗi có phân loại.
 *
 * Ba thứ tách bạch, vì người đọc cần chúng theo thứ tự đó: CHUYỆN GÌ (tiêu đề),
 * CÓ PHẢI LỖI CỦA TÔI KHÔNG (mô tả), TÔI LÀM GÌ TIẾP (gợi ý + nút). Nguyên văn
 * lỗi vẫn còn nguyên nhưng nằm sau một chỗ bấm: nó là thứ cần cho người đi đào,
 * không phải thứ đập vào mắt người chỉ muốn biết nên chờ hay nên sửa.
 *
 * Màu mang nghĩa "chờ được" hay "phải can thiệp", không phải mức độ to nhỏ:
 * Gemini quá tải là vàng dù workflow chết hẳn, vì hành động đúng là đợi rồi bấm
 * lại; khoá API sai là đỏ dù cũng chết y như vậy, vì chờ bao lâu cũng vô ích.
 */
const TONE: Record<FailureKind, 'warn' | 'fail'> = {
  provider_busy: 'warn',
  timeout: 'warn',
  network: 'warn',
  provider_auth: 'fail',
  provider_quota: 'fail',
  test_failed: 'fail',
  unknown: 'fail',
};

const ICON: Record<FailureKind, string> = {
  provider_busy: '⏳',
  timeout: '⏳',
  network: '⚡',
  provider_auth: '🔑',
  provider_quota: '🔑',
  test_failed: '✕',
  unknown: '✕',
};

export function FailureBanner({
  error,
  onRetry,
  actions,
}: {
  error: string | null | undefined;
  /** Chỉ truyền khi thực sự chạy lại được từ đây; không có thì nút không hiện. */
  onRetry?: () => void;
  /** Hành động riêng của từng màn, ví dụ “Xem report”. */
  actions?: ReactNode;
}) {
  const failure = describeFailure(error);
  const tone = TONE[failure.kind];
  const box =
    tone === 'warn'
      ? 'border-s-status-flaky bg-(--tint-warn)'
      : 'border-s-status-fail bg-(--tint-fail)';

  return (
    <div className={cn('rounded-lg border border-s-[3px] px-3.5 py-3 text-sm', box)}>
      <div className="flex items-start gap-2.5">
        <span aria-hidden="true" className="mt-px leading-5">{ICON[failure.kind]}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <b className="leading-5">{failure.title}</b>
          <p className="text-muted-foreground leading-5">{failure.detail}</p>

          {failure.hint && (
            <p className="leading-5">
              <span className="font-medium">Nên làm: </span>
              {failure.hint}
            </p>
          )}

          {(onRetry || actions) && (
            <div className="mt-1 flex flex-wrap gap-2">
              {onRetry && failure.retryable && (
                <Button size="sm" variant="outline" onClick={onRetry}>
                  Chạy lại workflow
                </Button>
              )}
              {actions}
            </div>
          )}

          {/* Chỉ mời xem nguyên văn khi nó thật sự nói thêm điều gì — với lỗi
              không nhận dạng được thì mô tả ĐÃ là nguyên văn rồi. */}
          {failure.kind !== 'unknown' && failure.raw && (
            <details className="mt-1">
              <summary className="text-muted-foreground cursor-pointer text-xs select-none">
                Chi tiết kỹ thuật
              </summary>
              <code className="text-muted-foreground mt-1.5 block max-h-40 overflow-auto rounded bg-black/5 p-2 font-mono text-xs whitespace-pre-wrap dark:bg-white/5">
                {failure.raw}
              </code>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
