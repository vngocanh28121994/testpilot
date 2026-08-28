import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Wrench } from 'lucide-react';
import { api } from '@/api/client';
import { ROUTES } from '@/api/routes';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ActionsReviewRequest, ActionsReviewResponse, LearnedActionDef } from '@core/ui/contracts.js';

export function ActionProposals({
  proposals,
  onReviewed,
}: {
  proposals: LearnedActionDef[];
  onReviewed: () => void;
}) {
  const review = useMutation({
    mutationFn: (body: ActionsReviewRequest) => api.post<ActionsReviewResponse>(ROUTES.actionsReview, body),
    onSuccess: (_, body) => {
      toast.success(body.decision === 'approve' ? 'Đã duyệt action. Đang chuẩn hoá lại.' : 'Đã từ chối action.');
      onReviewed();
    },
    onError: (error) => toast.error((error as Error).message),
  });

  if (!proposals.length) return null;
  return (
    <section aria-label="Action AI đề xuất" className="space-y-3">
      {proposals.map((action) => {
        const executable = action.kind !== 'primitive';
        const steps = [...action.expansion, ...(action.postcondition && !action.expansion.includes(action.postcondition) ? [action.postcondition] : [])];
        return (
          <Card key={action.id} className="border-amber-500/40">
            <CardHeader className="pb-2">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                <Wrench className="size-4" /> {action.label}
                <Badge variant="outline">{action.kind === 'macro' ? 'Macro' : action.kind === 'alias' ? 'Alias' : 'Capability mới'}</Badge>
              </CardTitle>
              <code className="text-muted-foreground break-all text-xs">{action.phraseTemplate}</code>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {action.reason && <p className="text-muted-foreground">{action.reason}</p>}
              <ol className="list-decimal space-y-1 ps-5 text-xs">
                {steps.map((step) => <li key={step}>{step}</li>)}
              </ol>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={!executable || review.isPending}
                  title={executable ? 'Cho phép tái sử dụng action này' : 'Driver chưa có capability để thực thi action này'}
                  onClick={() => review.mutate({ id: action.id, decision: 'approve' })}
                >
                  {executable ? 'Duyệt action' : 'Cần adapter'}
                </Button>
                <Button size="sm" variant="outline" disabled={review.isPending} onClick={() => review.mutate({ id: action.id, decision: 'reject' })}>
                  Từ chối
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}
