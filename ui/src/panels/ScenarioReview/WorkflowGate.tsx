import { useState } from 'react';
import { ExternalLink, Play, ShieldQuestion, TriangleAlert } from 'lucide-react';
import type {
  AnswerSubmission,
  StateResponse,
  WorkflowQuestion,
} from '@core/ui/contracts.js';
import { StageList } from '@/components/StageList';
import { StatusPill } from '@/components/StatusPill';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { WORKFLOW_IDLE_STAGES, runStatusLabel } from '@/lib/stages';
import { useWorkflowGate } from './hooks/useWorkflowGate';

/**
 * Chỗ nối giữa "đã sinh xong kịch bản" và "chạy test" — port của khối
 * `#workflowGate` (index.html:174, app.js:1908).
 *
 * Đây không phải một widget trang trí. Workflow dừng lại ở `waiting_review` và
 * nếu màn hình này không có nút nào cho nó chạy tiếp thì cả pipeline đứt ở giữa,
 * và người dùng phải quay ra CLI.
 *
 * Trả về `null` khi không có lượt workflow nào đang chờ — màn Kịch bản vẫn dùng
 * được bình thường để duyệt lại kịch bản cũ.
 */
export function WorkflowGate({
  state,
  runId,
}: {
  state: StateResponse;
  runId: string | undefined;
}) {
  const { view, job, answers } = useWorkflowGate(state, runId);
  const [draft, setDraft] = useState<Record<string, string[]>>({});

  if (!view) return null;
  const { run, counts, coverage, pending } = view;

  // Khung `run` mới nhất từ stream thắng snapshot trong /api/state: trong lúc
  // workflow chạy tiếp, stage phải nhúc nhích ngay chứ không đợi lượt refetch.
  const live = job.run?.id === run.id ? job.run : null;
  const stages = live?.stages ?? run.stages;
  const status = live?.status ?? run.status;
  const running = job.status === 'running';

  const submit = () => {
    const payload: AnswerSubmission[] = pending.map((question) => ({
      id: question.id,
      values: (draft[question.id] ?? []).filter((value) => value.trim()),
    }));
    answers.mutate({ runId: run.id, answers: payload });
  };

  return (
    // `role="region"` cho khối này một landmark có tên: nó là một mảng nội
    // dung độc lập mà người dùng bàn phím và trình đọc màn hình cần nhảy thẳng
    // tới, chứ không phải một thẻ trang trí trong luồng.
    <Card role="region" aria-labelledby="gate-title" className="border-primary/30">
      <CardHeader>
        <CardTitle id="gate-title">Workflow đang chờ review</CardTitle>
        <CardDescription>{view.summary}</CardDescription>
        <CardAction className="self-center">
          <StatusPill status={runStatusLabel(status)} />
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        <StageList stages={stages} idle={WORKFLOW_IDLE_STAGES} label="Tiến trình workflow" />

        {coverage.missing.length > 0 && (
          <section
            aria-labelledby="coverage-title"
            className="border-status-flaky/40 bg-status-flaky/5 flex flex-col gap-2 rounded-lg border p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <TriangleAlert className="text-status-flaky size-4 shrink-0" />
              <strong id="coverage-title" className="text-sm">
                Coverage cần bổ sung trước khi chạy
              </strong>
              <span className="text-muted-foreground ms-auto text-xs">
                {coverage.missing.length} quy tắc
              </span>
            </div>
            {/* Bản nháp KHÔNG bị chặn lại vì thiếu coverage — nó vẫn ở đây để
                review. Nói rõ điều đó, nếu không dòng cảnh báo đọc như một lỗi
                chặn đường. */}
            <p className="text-muted-foreground text-sm">
              Bản nháp vẫn được giữ để review. Hãy sửa hoặc thêm testcase tương ứng; hệ thống sẽ
              kiểm tra lại khi bấm Hoàn thành kịch bản.
            </p>
            <ul className="flex flex-col gap-1.5 text-sm">
              {coverage.missing.map((item) => (
                <li key={item.id} className="flex gap-2">
                  <code className="bg-muted shrink-0 rounded px-1.5 py-0.5 font-mono text-xs">
                    {item.id}
                  </code>
                  <span className="text-muted-foreground">{item.rule}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {pending.length > 0 && (
          <section
            aria-labelledby="questions-title"
            className="flex flex-col gap-4 rounded-lg border p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <ShieldQuestion className="text-primary size-4 shrink-0" />
              <strong id="questions-title" className="text-sm">
                Cần bạn quyết định
              </strong>
              <span className="text-muted-foreground ms-auto text-xs">{pending.length} câu</span>
            </div>
            <p className="text-muted-foreground text-sm">
              Hệ thống dừng lại vì những điểm sau không thể tự quyết mà không đoán. Trả lời xong,
              workflow chạy tiếp từ đúng chỗ đang dở.
            </p>

            {pending.map((question) => (
              <QuestionField
                key={question.id}
                question={question}
                values={draft[question.id] ?? []}
                onChange={(values) => setDraft((old) => ({ ...old, [question.id]: values }))}
              />
            ))}

            <div>
              <Button disabled={answers.isPending} onClick={submit}>
                {answers.isPending ? 'Đang lưu…' : 'Bổ sung thông tin và chạy tiếp'}
              </Button>
            </div>
          </section>
        )}

        {job.logs.length > 0 && (
          <pre className="console mt-0">
            {job.logs.join('\n')}
            {job.error ? `\n❌ ${job.error}` : ''}
          </pre>
        )}

        {view.reports.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {view.reports.map((report) => (
              <a
                key={report.id}
                href={report.url}
                target="_blank"
                rel="noreferrer"
                className="text-primary inline-flex items-center gap-1.5 text-sm underline"
              >
                <ExternalLink className="size-3.5" />
                Xem report {report.platform ?? ''}
              </a>
            ))}
          </div>
        )}

        {/* Ẩn hẳn khi lượt chạy đã kết thúc: một nút vô nghĩa còn khó đọc hơn
            một nút vắng mặt (app.js:1974). */}
        {status !== 'passed' && status !== 'failed' && (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={!view.canComplete || running}
              onClick={() => job.start({ runId: run.id })}
            >
              <Play className="size-4" />
              {running ? 'Đang tiếp tục workflow…' : 'Hoàn thành kịch bản và tiếp tục chạy'}
            </Button>
            <span className="text-muted-foreground text-sm">{view.hint}</span>
          </div>
        )}

        {counts.pending === 0 && counts.approved === 0 && counts.rejected === 0 && (
          <p className="text-muted-foreground text-sm">
            Không tìm thấy kịch bản nào trong <code className="font-mono">{run.generatedFile}</code>
            . File có thể đã bị xoá hoặc đổi tên.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Một câu hỏi, ba kiểu.
 *
 * `rationale` và `context` được hiện cùng câu hỏi vì một người không thấy vì sao
 * mình bị hỏi thì không đánh giá được câu trả lời — và câu hỏi không ai hiểu sẽ
 * bị trả lời bừa, tệ hơn là không hỏi (core/history.ts:38).
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
  const at = question.context?.scenario
    ? question.context.line
      ? `${question.context.scenario}, dòng ${question.context.line}`
      : question.context.scenario
    : null;

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">{question.prompt}</legend>
      {question.rationale && (
        <p className="text-muted-foreground text-xs">{question.rationale}</p>
      )}
      {at && <p className="text-muted-foreground text-xs">Phát sinh tại: {at}</p>}

      {question.kind === 'text' ? (
        <Input
          aria-label={question.prompt}
          value={values[0] ?? ''}
          onChange={(e) => onChange([e.target.value])}
        />
      ) : (
        <div className="flex flex-col gap-1.5">
          {(question.options ?? []).map((option) => (
            <label key={option} className="flex items-start gap-2.5 text-sm">
              <input
                className="accent-primary mt-0.5 size-4 shrink-0"
                type={question.kind === 'radio' ? 'radio' : 'checkbox'}
                name={question.id}
                value={option}
                checked={values.includes(option)}
                onChange={(e) =>
                  onChange(
                    question.kind === 'radio'
                      ? [option]
                      : e.target.checked
                        ? [...values, option]
                        : values.filter((value) => value !== option),
                  )
                }
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}
