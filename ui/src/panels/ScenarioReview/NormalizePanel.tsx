import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/api/client';
import { ROUTES } from '@/api/routes';
import type {
  ActionReviewResponse,
  FeatureNormalizeResponse,
  LearnedActionDef,
} from '@core/ui/contracts.js';

/**
 * Chuẩn hoá bản nháp, và xử lý những câu chưa chạy được.
 *
 * Người duyệt viết bằng tiếng Việt tự nhiên; bước này dịch sang tập mẫu câu
 * chạy được, chỉ ra câu nào chưa dịch nổi, và khi máy đề xuất một action mới
 * thì đưa nó ra cho người quyết định. Thiếu bước này thì một kịch bản sai cú
 * pháp chỉ lộ ra lúc chạy — sau khi đã duyệt xong và đã khởi động thiết bị.
 */
export function NormalizePanel({
  content,
  onApply,
}: {
  content: string;
  /** Nội dung đã chuẩn hoá; người dùng vẫn phải tự bấm Lưu sau đó. */
  onApply: (content: string) => void;
}) {
  const client = useQueryClient();
  const normalize = useMutation({
    mutationFn: () =>
      api.post<FeatureNormalizeResponse>(ROUTES.featureNormalize, { content }),
    onSuccess: (result) => {
      if (result.content !== content) onApply(result.content);
      if (result.changes.length === 0 && result.unresolved.length === 0) {
        toast.success('Không có gì phải sửa.');
      }
    },
    onError: (error) => toast.error((error as Error).message),
  });

  const review = useMutation({
    mutationFn: (body: { id: string; decision: 'approve' | 'reject' }) =>
      api.post<ActionReviewResponse>(ROUTES.actionsReview, body),
    onSuccess: (_, body) => {
      toast.success(body.decision === 'approve' ? 'Đã duyệt action.' : 'Đã từ chối action.');
      // Action vừa duyệt là một mẫu câu mới, nên bảng cú pháp phải biết; và
      // chuẩn hoá lại ngay để câu vừa hợp lệ không còn nằm ở phần chưa dịch được.
      void client.invalidateQueries({ queryKey: ['vocabulary'] });
      if (body.decision === 'approve') normalize.mutate();
    },
    onError: (error) => toast.error((error as Error).message),
  });

  const result = normalize.data;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col items-start gap-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={normalize.isPending}
          onClick={() => normalize.mutate()}
        >
          <Wand2 className="size-4" />
          {normalize.isPending ? 'Đang chuẩn hoá…' : 'Chuẩn hoá'}
        </Button>
        {/* Nói ra ranh giới giữa hai nút.
            Bấm Lưu cũng chuẩn hoá — nó biên dịch bản nháp và nhờ AI sửa lỗi cú
            pháp trước khi ghi. Không nói ra thì nút này trông như một bước bắt
            buộc mà bỏ qua sẽ hỏng, còn người bỏ qua nó lại không hiểu vì sao
            câu mình gõ bị đổi lúc lưu. Hai việc nó làm mà Lưu không làm: cho
            xem trước từng câu sẽ bị sửa, và là nơi duy nhất duyệt action mới. */}
        <span className="text-muted-foreground text-xs">
          Xem trước từng câu sẽ bị sửa, và duyệt action mới. Bấm Lưu cũng tự chuẩn hoá,
          nhưng sửa im lặng và không đề xuất action.
        </span>
      </div>

      {result && (
        <div className="flex flex-col gap-3 text-sm">
          {result.error && (
            <p role="alert" className="text-destructive">
              {result.error}
            </p>
          )}

          {result.changes.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium tracking-wide uppercase">
                Đã sửa {result.changes.length} câu
              </span>
              {result.changes.map((change) => (
                <div key={`${change.line}-${change.to}`} className="text-xs">
                  <span className="text-muted-foreground">dòng {change.line}:</span>{' '}
                  <s className="text-muted-foreground">{change.from}</s> → <b>{change.to}</b>
                  <div className="text-muted-foreground">{change.reason}</div>
                </div>
              ))}
            </div>
          )}

          {/* Câu chưa dịch được là thứ phải sửa tay, nên nói thẳng ra kèm số
              dòng thay vì chỉ bảo "kịch bản chưa hợp lệ". */}
          {result.unresolved.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-status-fail text-xs font-medium tracking-wide uppercase">
                Chưa chạy được {result.unresolved.length} câu
              </span>
              {result.unresolved.map((item) => (
                <div key={`${item.line}-${item.text}`} className="text-xs">
                  <span className="text-muted-foreground">dòng {item.line}:</span> {item.text}
                </div>
              ))}
            </div>
          )}

          {result.actionProposals.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium tracking-wide uppercase">
                Action máy đề xuất
              </span>
              {result.actionProposals.map((action) => (
                <ActionProposal
                  key={action.id}
                  action={action}
                  busy={review.isPending}
                  onDecide={(decision) => review.mutate({ id: action.id, decision })}
                />
              ))}
            </div>
          )}

          {result.usedAi && (
            <p className="text-muted-foreground text-xs">
              Có dùng model để đoán một số câu — đọc lại phần đã sửa trước khi lưu.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ActionProposal({
  action,
  busy,
  onDecide,
}: {
  action: LearnedActionDef;
  busy: boolean;
  onDecide: (decision: 'approve' | 'reject') => void;
}) {
  // `primitive` là action cần driver có capability mới, thứ chưa tồn tại.
  // Duyệt nó là tạo ra một mẫu câu gõ được nhưng chạy sẽ hỏng.
  const executable = action.kind !== 'primitive';
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3 bg-card">
      <div className="flex flex-col gap-0.5">
        <code className="text-xs">{action.phraseTemplate}</code>
        <span className="text-muted-foreground text-xs">{action.label}</span>
        {action.reason && <span className="text-muted-foreground text-xs">{action.reason}</span>}
      </div>
      <ol className="text-muted-foreground list-decimal pl-5 text-xs">
        {[...action.expansion, ...(action.postcondition ? [action.postcondition] : [])].map(
          (step) => (
            <li key={step}>{step}</li>
          ),
        )}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          type="button"
          disabled={busy || !executable}
          title={
            executable
              ? 'Cho phép tái sử dụng action này'
              : 'Driver chưa có capability để thực thi action này'
          }
          onClick={() => onDecide('approve')}
        >
          {executable ? 'Duyệt action' : 'Cần adapter'}
        </Button>
        <Button
          size="sm"
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => onDecide('reject')}
        >
          Từ chối
        </Button>
      </div>
    </div>
  );
}
