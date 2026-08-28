import { useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  FeatureSummary,
  ReportView,
  RunHistoryEntry,
  StateResponse,
  WorkflowQuestion,
} from '@core/ui/contracts.js';
import type {
  WorkflowAnswersRequest,
  WorkflowAnswersResponse,
} from '@core/ui/contracts.js';
import { api } from '@/api/client';
import { ROUTES, STREAM_ROUTES } from '@/api/routes';
import { useStreamJob } from '@/hooks/useStreamJob';
import { stateQueryKey } from '@/hooks/useAppState';

/** Một dòng coverage đã chuẩn hoá từ hai nguồn có hình dạng khác nhau. */
export interface GateCoverageRow {
  id: string;
  rule: string;
}

export interface GateView {
  run: RunHistoryEntry;
  /** File .feature mà workflow này sinh ra. `undefined` nếu nó đã bị xoá. */
  feature: FeatureSummary | undefined;
  counts: { pending: number; approved: number; rejected: number };
  coverage: { total: number; covered: number; missing: GateCoverageRow[] };
  /** Dòng tóm tắt kết quả sinh, đúng câu của app.js:1935. */
  summary: string;
  questions: WorkflowQuestion[];
  pending: WorkflowQuestion[];
  canComplete: boolean;
  /** Vì sao nút hoàn thành đang khoá — hoặc chuyện gì sẽ xảy ra nếu bấm. */
  hint: string;
  reports: ReportView[];
}

/**
 * Chọn lượt workflow mà màn Kịch bản đang nói tới.
 *
 * Bản cũ CHỈ hiện gate khi tới bằng `#scenario-review:<runId>` (app.js:1806);
 * mở thẳng trang Kịch bản thì gate không bao giờ xuất hiện, kể cả khi có một
 * workflow đang chờ. Ở đây thêm một bước lùi: không có `runId` thì tự chọn lượt
 * workflow đang tạm dừng gần nhất. Một workflow đang chờ người mà không màn nào
 * nói ra là cách nó nằm đó mãi mãi.
 */
function pickRun(runs: RunHistoryEntry[], runId: string | undefined): RunHistoryEntry | undefined {
  if (runId) {
    const found = runs.find((run) => run.id === runId);
    // Đúng như bản cũ: chỉ `kind === 'workflow'` mới có gate. Một lượt `run`
    // hay `farm` không có gì để duyệt.
    return found?.kind === 'workflow' ? found : undefined;
  }
  return runs
    .filter(
      (run) =>
        run.kind === 'workflow' &&
        (run.status === 'waiting_review' || run.status === 'waiting_input'),
    )
    .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))[0];
}

function buildSummary(run: RunHistoryEntry, coverage: GateView['coverage']): string {
  const gen = run.generated;
  if (!gen) return run.generatedFile ?? run.feature;
  const parts = [`${gen.scenarios} testcase`, `${gen.steps} bước`];
  if (gen.visuals) parts.push(`${gen.visuals} ảnh/design đã phân tích`);
  if (coverage.total) {
    parts.push(`${coverage.covered}/${coverage.total} yêu cầu bắt buộc đã có testcase`);
  }
  if (gen.coverageRepaired) parts.push('AI đã tự bổ sung coverage thiếu');
  if (run.generatedFile) parts.push(run.generatedFile);
  return parts.join(' · ');
}

/**
 * Câu dưới nút "Hoàn thành kịch bản".
 *
 * Một nút bị khoá không giải thích được gì. Đây là chỗ duy nhất nói ra vì sao
 * nó khoá, nên nó phải phân biệt được ba lý do khác nhau (app.js:1975).
 */
function buildHint(
  run: RunHistoryEntry,
  counts: GateView['counts'],
  missing: number,
): string {
  if (run.status !== 'waiting_review') {
    if (run.status === 'running') return 'Workflow đang tự động chạy; không cần thao tác thêm.';
    if (run.status === 'waiting_input') {
      return 'Workflow đang chờ bạn trả lời các câu hỏi ở trên.';
    }
    return run.error ?? 'Workflow đã hoàn tất.';
  }
  if (counts.pending > 0) {
    return `Còn ${counts.pending} chờ duyệt · ${counts.approved} đã duyệt · ${counts.rejected} không duyệt`;
  }
  if (counts.approved === 0) return 'Cần duyệt ít nhất một testcase để tiếp tục.';
  return (
    `${counts.approved} testcase sẽ được chạy · ${counts.rejected} testcase bị loại` +
    (missing > 0 ? ' · Coverage sẽ được kiểm tra lại trước khi chạy' : '')
  );
}

export function buildGateView(
  state: StateResponse,
  runId: string | undefined,
): GateView | null {
  const run = pickRun(state.runs, runId);
  if (!run) return null;

  const feature = state.features.find((item) => item.name === run.generatedFile);
  const counts = { pending: 0, approved: 0, rejected: 0 };
  for (const scenario of feature?.scenarios ?? []) {
    const status = scenario.review?.status ?? 'pending';
    if (status === 'approved' || status === 'rejected') counts[status] += 1;
    else counts.pending += 1;
  }

  // Hai nguồn coverage, hình dạng khác nhau: `feature.coverage` là kết quả audit
  // mới nhất trên đĩa, `run.generated` là ảnh chụp lúc sinh. Ưu tiên cái đầu —
  // người dùng có thể đã sửa file sau khi workflow dừng lại.
  const audited = feature?.coverage ?? null;
  const missing: GateCoverageRow[] = audited
    ? audited.missing.map((item) => ({ id: item.id, rule: item.rule || item.sourceQuote }))
    : (run.generated?.coverageMissing ?? []).map((item) => ({ id: item.id, rule: item.rule }));
  const total = audited?.total ?? run.generated?.coverageRequirements ?? 0;
  const coverage = {
    total,
    covered: audited?.covered ?? run.generated?.coverageCovered ?? total,
    missing,
  };

  const questions = run.questions ?? [];
  const pending = questions.filter((q) => !q.answeredAt);

  return {
    run,
    feature,
    counts,
    coverage,
    summary: buildSummary(run, coverage),
    questions,
    pending,
    // Ba điều kiện, đúng bản cũ (app.js:1969): đang chờ duyệt, không còn kịch
    // bản nào pending, và có ít nhất một kịch bản đã duyệt. Thiếu điều kiện
    // cuối thì workflow chạy tiếp với một bộ test rỗng.
    canComplete:
      run.status === 'waiting_review' && counts.pending === 0 && counts.approved > 0,
    hint: buildHint(run, counts, missing.length),
    reports: (run.runDirs ?? [])
      .map((dir) => state.reports.find((item) => item.id === dir))
      .filter((item): item is ReportView => Boolean(item?.url)),
  };
}

/** Job id ổn định: quay lại trang giữa lúc workflow chạy tiếp thì log còn nguyên (R10). */
export const COMPLETE_JOB_ID = 'workflow-complete';

export function useWorkflowGate(state: StateResponse, runId: string | undefined) {
  const client = useQueryClient();
  const view = useMemo(() => buildGateView(state, runId), [state, runId]);
  const job = useStreamJob(COMPLETE_JOB_ID, STREAM_ROUTES.workflowComplete);

  const answers = useMutation({
    mutationFn: (body: WorkflowAnswersRequest) =>
      api.post<WorkflowAnswersResponse>(ROUTES.workflowAnswers, body),
    onSuccess: (data) => {
      // `remaining > 0` KHÔNG phải lỗi: server ghi từng đợt câu trả lời xuống
      // đĩa, nên điền nửa form rồi quay lại sau vẫn không mất gì.
      if (data.remaining > 0) toast.warning(`Đã lưu. Còn ${data.remaining} câu chưa trả lời.`);
      else toast.success('Đã ghi nhận. Workflow đang chạy tiếp…');
      void client.invalidateQueries({ queryKey: stateQueryKey });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return { view, job, answers };
}
