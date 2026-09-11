import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PlayCircle } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import { WorkflowCompletion, useWorkflowCompletion } from '@/components/WorkflowCompletion';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api } from '@/api/client';
import { ROUTES } from '@/api/routes';
import type {
  RunHistoryEntry,
  WorkflowAnswersResponse,
  WorkflowQuestion,
  WorkflowQuestionsResponse,
} from '@core/ui/contracts.js';

/**
 * Chỗ một workflow đang tạm dừng được trả lời và cho chạy tiếp.
 *
 * Không có phần này thì V2 khởi động được workflow nhưng không kết thúc được
 * nó: một lượt chạy dừng ở cổng duyệt sẽ nằm đó vĩnh viễn, vì cả câu hỏi giữa
 * chừng lẫn nút chạy tiếp đều không có đường nào bấm tới.
 *
 * `waiting_review` và `waiting_input` là hai kiểu dừng khác nhau (history.ts:70)
 * nên hiện ở đây khác nhau: một bên đang chờ câu trả lời, một bên đang chờ
 * người duyệt xong kịch bản.
 */
export function WorkflowGate({ runs }: { runs: RunHistoryEntry[] }) {
  // Lượt chạy mới nhất đang dừng. Nhiều lượt cùng dừng là chuyện bất thường,
  // và giải quyết cái mới nhất trước là thứ tự duy nhất không gây bất ngờ.
  const run = runs.find((r) => r.status === 'waiting_input' || r.status === 'waiting_review');
  if (!run) return null;
  return <Gate run={run} />;
}

function Gate({ run }: { run: RunHistoryEntry }) {
  const client = useQueryClient();
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const job = useWorkflowCompletion();
  const navigate = useNavigate();

  // Bỏ hẳn lượt chờ này. Kịch bản đã sinh vẫn nằm nguyên trong danh sách duyệt:
  // bỏ workflow là bỏ cái cổng, không phải bỏ việc đã làm.
  const abandon = useMutation({
    mutationFn: () => api.post(ROUTES.workflowAbandon, { runId: run.id }),
    onSuccess: () => {
      toast.success('Đã bỏ workflow đang chờ. Kịch bản đã sinh vẫn còn trong danh sách.');
      void client.invalidateQueries({ queryKey: ['state'] });
    },
    onError: (error) => toast.error((error as Error).message),
  });
  const questions = useQuery({
    queryKey: ['workflow-questions', run.id],
    queryFn: () =>
      api.get<WorkflowQuestionsResponse>(
        `${ROUTES.workflowQuestions}?runId=${encodeURIComponent(run.id)}`,
      ),
  });

  const submit = useMutation({
    mutationFn: () =>
      api.post<WorkflowAnswersResponse>(ROUTES.workflowAnswers, {
        runId: run.id,
        answers: Object.entries(answers).map(([id, values]) => ({ id, values })),
      }),
    onSuccess: (res) => {
      // Trả lời và chạy tiếp là hai việc tách rời: server ghi lại từng đợt trả
      // lời, nên trả lời nửa chừng rồi đi làm việc khác không mất gì.
      if (res.remaining > 0) toast.info(`Còn ${res.remaining} câu chưa trả lời.`);
      else toast.success('Đã ghi nhận. Workflow chạy tiếp được rồi.');
      void client.invalidateQueries({ queryKey: ['workflow-questions', run.id] });
      void client.invalidateQueries({ queryKey: ['state'] });
    },
    onError: (error) => toast.error((error as Error).message),
  });

  const pending = questions.data?.questions.filter((q) => !q.answeredAt) ?? [];

  return (
    <Card aria-labelledby="workflow-gate-title">
      <CardHeader>
        <CardTitle id="workflow-gate-title">Workflow đang chờ bạn</CardTitle>
        <CardDescription>
          {run.status === 'waiting_input'
            ? 'Có câu hỏi cần trả lời trước khi workflow chạy tiếp.'
            : 'Kịch bản đã sinh xong và đang chờ duyệt. Duyệt xong thì cho chạy tiếp.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {pending.length > 0 && (
          <form
            className="flex flex-col gap-4"
            aria-label="Câu hỏi của workflow"
            onSubmit={(e) => {
              e.preventDefault();
              submit.mutate();
            }}
          >
            {pending.map((question) => (
              <QuestionField
                key={question.id}
                question={question}
                values={answers[question.id] ?? []}
                onChange={(values) => setAnswers((all) => ({ ...all, [question.id]: values }))}
              />
            ))}
            <div>
              <Button type="submit" size="sm" disabled={submit.isPending}>
                {submit.isPending ? 'Đang lưu câu trả lời…' : 'Gửi câu trả lời'}
              </Button>
            </div>
          </form>
        )}

        {/* Chỉ mở đường chạy tiếp khi không còn câu nào bỏ ngỏ: chạy tiếp trên
            một quyết định mới làm được nửa là cách hỏng âm thầm nhất. */}
        {pending.length === 0 && (
          <div className="flex flex-col gap-3">
            <div>
              <Button
                size="sm"
                disabled={job.status === 'running'}
                onClick={() => {
                  job.start({ runId: run.id });
                  // Quay về Studio để cả luồng khép kín tại một chỗ: chính từ
                  // đó người dùng khởi động workflow, và log chạy test hiện
                  // tiếp ngay dưới log sinh kịch bản. Luồng không bị gián đoạn
                  // vì job store là toàn cục — đổi trang không dừng nó.
                  void navigate({ to: '/studio' });
                }}
              >
                <PlayCircle className="size-4" />
                {job.status === 'running'
                  ? 'Đang tiếp tục workflow…'
                  : 'Hoàn thành kịch bản và tiếp tục chạy'}
              </Button>
              {/* Đường ra cho một workflow bỏ dở.
                  Không có nó thì banner này hiện ở MỌI lần vào màn Kịch bản, kể
                  cả khi lượt chạy đã hai ngày tuổi và người ta đã sinh bộ
                  testcase khác từ lâu — banner nói đúng sự thật, chỉ là không
                  có cách nào làm cho nó thôi đúng. */}
              <Button
                variant="outline"
                disabled={job.status === 'running' || abandon.isPending}
                onClick={() => abandon.mutate()}
              >
                {abandon.isPending ? 'Đang bỏ…' : 'Bỏ workflow này'}
              </Button>
            </div>
            <WorkflowCompletion />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Một câu hỏi, dựng theo đúng `kind` của nó.
 *
 * `rationale` hiện cùng câu hỏi vì người không thấy được vì sao mình bị hỏi thì
 * không thể cân nhắc câu trả lời — và câu hỏi không ai hiểu sẽ bị trả lời bừa.
 */
function QuestionField({
  question,
  values,
  onChange,
}: {
  question: WorkflowQuestion;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2 rounded-lg border p-3 bg-card">
      <legend className="px-1 text-sm font-medium">{question.prompt}</legend>
      {question.rationale && (
        <p className="text-muted-foreground text-xs">{question.rationale}</p>
      )}
      {question.kind === 'text' && (
        <Input
          aria-label={question.prompt}
          value={values[0] ?? ''}
          onChange={(e) => onChange([e.target.value])}
        />
      )}
      {question.kind !== 'text' &&
        (question.options ?? []).map((option) => (
          <label key={option} className="flex items-center gap-2 text-sm">
            <input
              type={question.kind === 'radio' ? 'radio' : 'checkbox'}
              className="accent-primary size-4"
              name={`q-${question.id}`}
              checked={values.includes(option)}
              onChange={(e) =>
                onChange(
                  question.kind === 'radio'
                    ? [option]
                    : e.target.checked
                      ? [...values, option]
                      : values.filter((v) => v !== option),
                )
              }
            />
            <span>{option}</span>
          </label>
        ))}
    </fieldset>
  );
}
