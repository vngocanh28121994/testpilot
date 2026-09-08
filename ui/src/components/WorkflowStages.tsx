import { CheckCircle2, Circle, Loader2, MinusCircle, PauseCircle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorkflowStage } from '@core/ui/contracts.js';

/**
 * Các bước của workflow: đã xong, đang chạy, còn chờ.
 *
 * Một khung log đang chạy trả lời được "nó đang nói gì", nhưng không trả lời
 * được hai câu người ta thật sự hỏi khi ngồi đợi: đang ở bước nào, và còn mấy
 * bước nữa. Danh sách này trả lời cả hai mà không phải đọc log.
 *
 * Tên bước lấy thẳng từ server — chúng đã là tiếng Việt viết cho người dùng
 * ("Đọc và xác thực tài liệu", "Sinh bộ testcase") — nên ở đây không dịch lại,
 * và một bước mới thêm ở backend sẽ tự hiện ra mà không phải sửa gì.
 */
export function WorkflowStages({
  stages,
  runStatus,
}: {
  stages: WorkflowStage[];
  /**
   * Trạng thái của cả lượt chạy, để phân biệt "máy đang làm" với "đang chờ bạn".
   *
   * Server đánh dấu bước hiện tại là `running` dù nó đang chờ người duyệt — với
   * server thì đó vẫn là bước đang mở. Nhưng vòng quay nghĩa là "đang xử lý,
   * cứ đợi", nên nó quay mãi ở một bước sẽ không bao giờ tự xong: người dùng
   * ngồi đợi một thứ đang đợi chính họ.
   */
  runStatus?: string;
}) {
  if (stages.length === 0) return null;
  const done = stages.filter((s) => s.status === 'done' || s.status === 'skipped').length;
  const waitingOnUser = runStatus === 'waiting_review' || runStatus === 'waiting_input';

  return (
    <div className="flex flex-col gap-2">
      <div className="text-muted-foreground flex items-center justify-between text-xs">
        <span>Tiến trình</span>
        <span className="tabular-nums">
          {done}/{stages.length} bước
        </span>
      </div>
      <ol aria-label="Các bước của workflow" className="flex flex-col gap-1.5">
        {stages.map((stage) => (
          <li key={stage.name} className="flex items-start gap-2 text-sm">
            <StageIcon
              status={stage.status}
              waitingOnUser={waitingOnUser && stage.status === 'running'}
            />
            <span
              className={cn(
                stage.status === 'pending' && 'text-muted-foreground',
                stage.status === 'running' && 'font-medium',
                stage.status === 'skipped' && 'text-muted-foreground line-through',
                stage.status === 'failed' && 'text-destructive',
              )}
            >
              {stage.name}
              {waitingOnUser && stage.status === 'running' && (
                <span className="text-status-flaky ms-2 text-xs font-normal">đang chờ bạn</span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function StageIcon({
  status,
  waitingOnUser,
}: {
  status: WorkflowStage['status'];
  waitingOnUser: boolean;
}) {
  // Chờ người thì không quay: vòng quay nói "đang xử lý", mà ở đây không có gì
  // đang xử lý cả — nó đợi một cú bấm.
  if (waitingOnUser) {
    return (
      <PauseCircle aria-label="đang chờ bạn" className="text-status-flaky mt-0.5 size-4 shrink-0" />
    );
  }

  // Icon mang nghĩa, không phải trang trí — nên mỗi cái có nhãn riêng cho trình
  // đọc màn hình, thay vì để người dùng đoán qua màu.
  if (status === 'done') {
    return <CheckCircle2 aria-label="đã xong" className="text-status-pass mt-0.5 size-4 shrink-0" />;
  }
  if (status === 'running') {
    return (
      <Loader2 aria-label="đang chạy" className="text-status-running mt-0.5 size-4 shrink-0 animate-spin" />
    );
  }
  if (status === 'failed') {
    return <XCircle aria-label="hỏng" className="text-destructive mt-0.5 size-4 shrink-0" />;
  }
  if (status === 'skipped') {
    return <MinusCircle aria-label="bỏ qua" className="text-muted-foreground mt-0.5 size-4 shrink-0" />;
  }
  return <Circle aria-label="chờ" className="text-muted-foreground/50 mt-0.5 size-4 shrink-0" />;
}
