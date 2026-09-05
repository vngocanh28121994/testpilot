import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api } from '@/api/client';
import { ROUTES, STREAM_ROUTES } from '@/api/routes';
import { useStreamJob } from '@/hooks/useStreamJob';
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
  const job = useStreamJob('workflow-complete', STREAM_ROUTES.workflowComplete);

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
                onClick={() => job.start({ runId: run.id })}
              >
                <PlayCircle className="size-4" />
                {job.status === 'running'
                  ? 'Đang tiếp tục workflow…'
                  : 'Hoàn thành kịch bản và tiếp tục chạy'}
              </Button>
            </div>
            {job.error && (
              <p role="alert" className="text-destructive text-sm">
                {job.error}
              </p>
            )}
            {job.logs.length > 0 && <pre className="console mt-0">{job.logs.join('\n')}</pre>}
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
    <fieldset className="flex flex-col gap-2 rounded-lg border p-3">
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
